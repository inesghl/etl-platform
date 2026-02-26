import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, Tuple

from django.conf import settings
from django.utils import timezone

from ..models import ETL, Execution, InputFile, OutputFile


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _copy_inputs_to_workspace(execution: Execution, work_dir: Path) -> Dict[str, str]:
    """
    Copy all validated InputFile objects into work_dir/inputs and
    return a mapping {file_key: absolute_path}.
    """
    inputs_dir = work_dir / "inputs"
    _ensure_dir(inputs_dir)

    key_to_path: Dict[str, str] = {}
    for input_file in execution.input_files.all():
        src = Path(input_file.uploaded_file.path)
        if not src.exists():
            continue
        dest = inputs_dir / src.name
        shutil.copy2(src, dest)
        key_to_path[input_file.file_key] = str(dest)

    return key_to_path


def _prepare_etl_code(etl: ETL, work_dir: Path) -> Path:
    """
    Copy extracted ETL code into work_dir/etl_code and return that path.
    """
    source_path = Path(etl.extracted_path)
    if not source_path.exists():
        raise FileNotFoundError(f"Extracted ETL path does not exist: {source_path}")

    etl_code_dir = work_dir / "etl_code"
    if etl_code_dir.exists():
        shutil.rmtree(etl_code_dir)
    shutil.copytree(source_path, etl_code_dir)
    return etl_code_dir


def _write_runtime_config(
    execution: Execution,
    etl: ETL,
    work_dir: Path,
    input_paths: Dict[str, str],
) -> Path:
    outputs_dir = work_dir / "outputs"
    _ensure_dir(outputs_dir)

    runtime_config = {
        "execution_id": str(execution.id),
        "etl_id": str(etl.id),
        "work_directory": str(work_dir),
        "inputs": input_paths,
        "outputs": {
            "directory": str(outputs_dir),
        },
        "config": etl.config,
    }

    config_path = work_dir / "runtime_config.json"
    with config_path.open("w", encoding="utf-8") as f:
        json.dump(runtime_config, f, indent=2)

    # Persist for later inspection
    execution.runtime_config = runtime_config
    execution.save(update_fields=["runtime_config"])

    return config_path


def _detect_python_version() -> str:
    return ".".join(str(v) for v in sys.version_info[:3])


def _create_venv(work_dir: Path) -> Tuple[Path, str]:
    """
    Create a virtual environment for this execution.

    For now we use the standard library 'venv' module instead of uv directly,
    because it is guaranteed to exist. If you prefer uv, you can swap this
    function to shell out to `uv venv`.
    """
    venv_dir = work_dir / ".venv"
    if venv_dir.exists():
        shutil.rmtree(venv_dir)

    subprocess.run(
        [sys.executable, "-m", "venv", str(venv_dir)],
        check=True,
        cwd=str(work_dir),
    )

    if os.name == "nt":
        python_bin = venv_dir / "Scripts" / "python.exe"
    else:
        python_bin = venv_dir / "bin" / "python"

    return venv_dir, str(python_bin)


def _install_requirements(python_bin: str, etl_code_dir: Path) -> str:
    """
    Install dependencies from requirements.txt using pip inside the venv.
    Returns the full installation log.
    """
    req_path = etl_code_dir / "requirements.txt"
    if not req_path.exists():
        return "No requirements.txt found; skipping dependency installation.\n"

    cmd = [python_bin, "-m", "pip", "install", "-r", str(req_path)]
    result = subprocess.run(
        cmd,
        cwd=str(etl_code_dir),
        capture_output=True,
        text=True,
    )
    log = f"$ {' '.join(cmd)}\n" f"{result.stdout}\n{result.stderr}"

    if result.returncode != 0:
        raise RuntimeError(f"Dependency installation failed with code {result.returncode}")

    return log


def _run_etl_script(
    python_bin: str,
    etl_code_dir: Path,
    entry_point: str,
    runtime_config_path: Path,
) -> Tuple[int, str, str]:
    """
    Execute the ETL entry point using the given Python binary and runtime config.

    The entry point is a Python file path relative to etl_code_dir (e.g. main.py).
    The script is expected to read the runtime_config.json either from the
    ETL_RUNTIME_CONFIG environment variable or by convention.
    """
    entry_path = etl_code_dir / entry_point
    if not entry_path.exists():
        raise FileNotFoundError(f"Entry point not found: {entry_path}")

    env = os.environ.copy()
    env["ETL_RUNTIME_CONFIG"] = str(runtime_config_path)

    cmd = [python_bin, str(entry_path)]
    result = subprocess.run(
        cmd,
        cwd=str(etl_code_dir),
        capture_output=True,
        text=True,
        env=env,
    )
    return result.returncode, result.stdout, result.stderr


def run_execution(execution: Execution) -> None:
    """
    Core execution pipeline.

    Steps (all synchronous for now):
    1. Prepare workspace (inputs, outputs, logs, etl_code).
    2. Create virtualenv and install requirements.
    3. Run the ETL entry point.
    4. Discover outputs and create OutputFile records.
    5. Update execution status, logs, and metadata.
    """
    etl = execution.etl

    work_dir = Path(execution.work_dir)
    _ensure_dir(work_dir)
    logs_dir = work_dir / "logs"
    _ensure_dir(logs_dir)

    execution.started_at = timezone.now()
    execution.status = "INSTALLING_DEPS"
    execution.stdout_log = ""
    execution.stderr_log = ""
    execution.error_message = ""
    execution.python_version_used = _detect_python_version()
    execution.save(
        update_fields=[
            "started_at",
            "status",
            "stdout_log",
            "stderr_log",
            "error_message",
            "python_version_used",
        ]
    )

    try:
        # 1) Prepare code and inputs
        etl_code_dir = _prepare_etl_code(etl, work_dir)
        input_paths = _copy_inputs_to_workspace(execution, work_dir)
        runtime_config_path = _write_runtime_config(execution, etl, work_dir, input_paths)

        # 2) Create venv and install requirements
        venv_dir, python_bin = _create_venv(work_dir)
        execution.venv_path = str(venv_dir)
        execution.save(update_fields=["venv_path"])

        deps_log = _install_requirements(python_bin, etl_code_dir)
        execution.dependencies_log = deps_log
        execution.dependencies_installed = True
        execution.status = "RUNNING"
        execution.stdout_log += "Dependencies installed successfully.\n"
        execution.save(
            update_fields=[
                "dependencies_log",
                "dependencies_installed",
                "status",
                "stdout_log",
            ]
        )

        # 3) Run the ETL
        return_code, out, err = _run_etl_script(
            python_bin, etl_code_dir, etl.entry_point, runtime_config_path
        )
        execution.return_code = return_code
        execution.stdout_log += out
        execution.stderr_log += err

        # 4) Collect outputs
        outputs_dir = work_dir / "outputs"
        if outputs_dir.exists():
            for child in outputs_dir.iterdir():
                if child.is_file():
                    ext = child.suffix.lower()
                    if ext in {".xlsx", ".xls"}:
                        file_type = "excel"
                    elif ext in {".csv"}:
                        file_type = "csv"
                    else:
                        file_type = ext.lstrip(".") or "file"

                    OutputFile.objects.create(
                        execution=execution,
                        filename=child.name,
                        file_path=str(child),
                        file_size=child.stat().st_size,
                        file_type=file_type,
                    )

        # 5) Final status
        execution.completed_at = timezone.now()
        execution.status = "SUCCESS" if return_code == 0 else "FAILED"
        if return_code != 0 and not execution.error_message:
            execution.error_message = "ETL process exited with non-zero status."

        execution.save(
            update_fields=[
                "completed_at",
                "status",
                "return_code",
                "stdout_log",
                "stderr_log",
                "error_message",
            ]
        )

    except Exception as exc:  # broad catch to mark failure
        execution.completed_at = timezone.now()
        execution.status = "FAILED"
        execution.error_message = str(exc)
        execution.stderr_log += f"\n[ENGINE ERROR] {exc!r}"
        execution.save(
            update_fields=[
                "completed_at",
                "status",
                "error_message",
                "stderr_log",
            ]
        )

