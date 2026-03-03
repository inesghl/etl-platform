import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from typing import Dict, Tuple

from django.conf import settings
from django.utils import timezone

from ..models import ETL, Execution, OutputFile

# Folders never copied from ETL zips — platform-specific binaries cause
# PermissionError on Windows when we try to delete them later.
_EXCLUDED_DIRS = {
    ".venv", "venv", "__pycache__", ".git",
    "node_modules", ".tox", ".mypy_cache", ".idea", ".vscode",
}


# ─── helpers ──────────────────────────────────────────────────────────────────

def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _safe_rmtree(path: Path) -> None:
    """
    Delete a directory tree on Windows without hitting PermissionError on
    read-only / memory-mapped .pyd / .dll files.
    Strategy: on error, clear the read-only bit and retry once.
    """
    if not path.exists():
        return

    def _on_error(func, fpath, _exc):
        try:
            os.chmod(fpath, stat.S_IWRITE | stat.S_IREAD)
            func(fpath)
        except Exception:
            pass  # best-effort

    shutil.rmtree(str(path), onerror=_on_error)


def _safe_work_dir(execution: Execution) -> Path:
    """
    Return a work_dir that is ALWAYS inside MEDIA_ROOT/executions/<id>.

    If the value stored in the DB points somewhere else (e.g. the project
    root — a bug from an earlier version) we recompute, save, and carry on.
    This is what was silently deleting the Django project .venv before.
    """
    media_executions = Path(settings.MEDIA_ROOT) / "executions"
    expected = media_executions / str(execution.id)

    stored = Path(execution.work_dir) if execution.work_dir else None

    if stored and str(stored).startswith(str(media_executions)):
        return stored

    # Stored path is wrong — fix it
    execution.work_dir = str(expected)
    execution.save(update_fields=["work_dir"])
    return expected


# ─── system Python detection ──────────────────────────────────────────────────

def _find_system_python() -> str:
    """
    Find a real, system-level Python — NOT the one inside the Django .venv.
    Calling `venv_python -m venv <new_venv>` fails with exit 106 on Windows
    because you cannot nest virtual environments.

    Priority:
    1. ETL_EXECUTOR_PYTHON env var  (explicit override — set this in .env)
    2. pyvenv.cfg of the current venv  → home = C:\\PythonXY
    3. py.exe launcher (Windows — always system-level)
    4. Walk PATH, skip entries inside a venv folder
    5. sys.executable as last resort
    """
    def _in_venv(p: str) -> bool:
        lp = p.replace("\\", "/").lower()
        return "/.venv/" in lp or "/venv/" in lp

    # 1. Explicit override in .env  e.g.  ETL_EXECUTOR_PYTHON=C:\Python312\python.exe
    override = os.environ.get("ETL_EXECUTOR_PYTHON", "").strip()
    if override and Path(override).exists():
        return override

    # 2. Read pyvenv.cfg to find the base Python that created this venv
    try:
        # sys.executable → .../.venv/Scripts/python.exe
        # parent.parent  → .../.venv/
        cfg = Path(sys.executable).parent.parent / "pyvenv.cfg"
        if cfg.exists():
            for line in cfg.read_text(encoding="utf-8").splitlines():
                if "=" in line and line.split("=")[0].strip().lower() == "home":
                    home = line.split("=", 1)[1].strip()
                    for name in ("python.exe", "python3.exe", "python3", "python"):
                        candidate = Path(home) / name
                        if candidate.exists():
                            return str(candidate)
    except Exception:
        pass

    # 3. Windows py.exe launcher
    if os.name == "nt":
        py = shutil.which("py")
        if py and not _in_venv(py):
            return py

    # 4. PATH scan — skip anything inside a venv
    for name in ("python3", "python", "python3.exe", "python.exe"):
        found = shutil.which(name)
        if found and not _in_venv(found):
            return found

    # 5. Last resort
    return sys.executable


# ─── workspace helpers ────────────────────────────────────────────────────────

def _copy_inputs(execution: Execution, work_dir: Path) -> Dict[str, str]:
    inputs_dir = work_dir / "inputs"
    _ensure_dir(inputs_dir)
    key_to_path: Dict[str, str] = {}
    for inp in execution.input_files.all():
        src = Path(inp.uploaded_file.path)
        if not src.exists():
            continue
        dest = inputs_dir / src.name
        shutil.copy2(src, dest)
        key_to_path[inp.file_key] = str(dest)
    return key_to_path


def _copy_etl_code(etl: ETL, work_dir: Path) -> Path:
    source = Path(etl.extracted_path)
    if not source.exists():
        raise FileNotFoundError(f"Extracted ETL path missing: {source}")

    dest = work_dir / "etl_code"
    _safe_rmtree(dest)  # safe-delete any previous copy

    def _ignore(src: str, names: list) -> set:
        skip = set()
        for n in names:
            nl = n.lower()
            if n in _EXCLUDED_DIRS or nl.startswith(".venv") or nl.startswith("venv"):
                skip.add(n)
        return skip

    shutil.copytree(str(source), str(dest), ignore=_ignore)
    return dest


def _write_runtime_config(
    execution: Execution, etl: ETL, work_dir: Path, input_paths: Dict[str, str]
) -> Path:
    outputs_dir = work_dir / "outputs"
    _ensure_dir(outputs_dir)

    cfg = {
        "execution_id": str(execution.id),
        "etl_id": str(etl.id),
        "work_directory": str(work_dir),
        "inputs": input_paths,
        "outputs": {"directory": str(outputs_dir)},
        "config": etl.config,
    }
    cfg_path = work_dir / "runtime_config.json"
    cfg_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    execution.runtime_config = cfg
    execution.save(update_fields=["runtime_config"])
    return cfg_path


# ─── venv helpers ─────────────────────────────────────────────────────────────

def _create_venv(work_dir: Path) -> Tuple[Path, str]:
    """
    Create a fresh venv inside work_dir/.venv using a SYSTEM-level Python.
    work_dir is always inside MEDIA_ROOT so we never accidentally touch
    the Django project's own .venv.
    """
    venv_dir = work_dir / ".venv"
    _safe_rmtree(venv_dir)  # remove previous run's venv safely

    base_python = _find_system_python()

    result = subprocess.run(
        [base_python, "-m", "venv", str(venv_dir)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"venv creation failed using: {base_python}\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )

    python_bin = (
        venv_dir / "Scripts" / "python.exe"
        if os.name == "nt"
        else venv_dir / "bin" / "python"
    )
    return venv_dir, str(python_bin)


def _install_requirements(python_bin: str, etl_code_dir: Path) -> str:
    req = etl_code_dir / "requirements.txt"
    if not req.exists():
        return "No requirements.txt — skipping.\n"

    cmd = [python_bin, "-m", "pip", "install", "-r", str(req)]
    r = subprocess.run(cmd, cwd=str(etl_code_dir), capture_output=True, text=True)
    log = f"$ {' '.join(cmd)}\n{r.stdout}\n{r.stderr}"
    if r.returncode != 0:
        raise RuntimeError(f"pip install failed (exit {r.returncode}):\n{r.stderr}")
    return log


def _resolve_entry_point(etl_code_dir: Path, entry_point: str) -> Tuple[Path, Path]:
    """
    Find the entry point file inside etl_code_dir, searching recursively.

    Handles any nesting depth. For example:
        etl_code/etl_facture/etl/main.py   ← 2 levels deep
        etl_code/myetl/main.py             ← 1 level deep
        etl_code/main.py                   ← direct

    Returns (entry_file_path, cwd_to_use) where cwd is the folder
    containing the entry point (so relative imports work correctly).
    """
    # Search recursively for the entry point filename
    matches = list(etl_code_dir.rglob(entry_point))
    if matches:
        # Prefer the shallowest match
        matches.sort(key=lambda p: len(p.parts))
        entry = matches[0]
        return entry, entry.parent

    # Give a helpful error listing what IS there
    contents = [
        str(p.relative_to(etl_code_dir))
        for p in etl_code_dir.rglob("*")
    ][:40]
    raise FileNotFoundError(
        f"Entry point '{entry_point}' not found in ETL package.\n"
        f"Files present:\n  " + "\n  ".join(contents or ["(empty)"])
    )


def _run_script(
    python_bin: str, etl_code_dir: Path, entry_point: str, cfg_path: Path
) -> Tuple[int, str, str]:
    entry, cwd = _resolve_entry_point(etl_code_dir, entry_point)
    env = os.environ.copy()
    env["ETL_RUNTIME_CONFIG"] = str(cfg_path)
    r = subprocess.run(
        [python_bin, str(entry)],
        cwd=str(cwd), capture_output=True, text=True, env=env,
    )
    return r.returncode, r.stdout, r.stderr


# ─── main pipeline ────────────────────────────────────────────────────────────

def run_execution(execution: Execution) -> None:
    etl = execution.etl

    # Always use a safe work_dir inside MEDIA_ROOT — never the project root
    work_dir = _safe_work_dir(execution)
    _ensure_dir(work_dir)
    _ensure_dir(work_dir / "logs")

    execution.started_at = timezone.now()
    execution.status = "INSTALLING_DEPS"
    execution.stdout_log = ""
    execution.stderr_log = ""
    execution.error_message = ""
    execution.python_version_used = ".".join(str(v) for v in sys.version_info[:3])
    execution.save(update_fields=[
        "started_at", "status", "stdout_log",
        "stderr_log", "error_message", "python_version_used",
    ])

    try:
        etl_code_dir = _copy_etl_code(etl, work_dir)
        input_paths  = _copy_inputs(execution, work_dir)
        cfg_path     = _write_runtime_config(execution, etl, work_dir, input_paths)

        venv_dir, python_bin = _create_venv(work_dir)
        execution.venv_path = str(venv_dir)
        execution.save(update_fields=["venv_path"])

        deps_log = _install_requirements(python_bin, etl_code_dir)
        execution.dependencies_log       = deps_log
        execution.dependencies_installed = True
        execution.status                 = "RUNNING"
        execution.stdout_log            += "✓ Dependencies installed.\n"
        execution.save(update_fields=[
            "dependencies_log", "dependencies_installed", "status", "stdout_log",
        ])

        rc, out, err = _run_script(python_bin, etl_code_dir, etl.entry_point, cfg_path)
        execution.return_code  = rc
        execution.stdout_log  += out
        execution.stderr_log  += err

        # Collect output files.
        # Strategy:
        #   1. If ETL config lists expected_outputs, only collect those files
        #      by searching recursively under etl_code_dir and work_dir/outputs.
        #   2. Otherwise fall back to only named output folders:
        #      work_dir/outputs/, etl_code/.../outputs/, etl_code/.../deleted/
        #   Never pick up source code, config files, or input files.

        output_extensions = {".xlsx", ".xls", ".csv", ".pdf", ".zip"}
        expected_outputs = etl.expected_outputs  # list from config.json, may be empty

        def _register(child: Path) -> None:
            """Create an OutputFile record if not already registered."""
            if not child.is_file():
                return
            if child.suffix.lower() not in output_extensions:
                return
            if not OutputFile.objects.filter(execution=execution, filename=child.name).exists():
                ext = child.suffix.lower()
                ftype = (
                    "excel" if ext in {".xlsx", ".xls"}
                    else "csv" if ext == ".csv"
                    else ext.lstrip(".") or "file"
                )
                OutputFile.objects.create(
                    execution=execution,
                    filename=child.name,
                    file_path=str(child),
                    file_size=child.stat().st_size,
                    file_type=ftype,
                )

        if expected_outputs:
            # Precise: only collect files whose name is in expected_outputs
            search_roots = [work_dir, etl_code_dir]
            for root in search_roots:
                for expected_name in expected_outputs:
                    for match in root.rglob(expected_name):
                        _register(match)
        else:
            # Fallback: only look inside folders explicitly named outputs/ or deleted/
            output_folder_names = {"outputs", "deleted"}
            for root in [work_dir, etl_code_dir]:
                for folder in root.rglob("*"):
                    if folder.is_dir() and folder.name.lower() in output_folder_names:
                        for child in folder.iterdir():
                            _register(child)

        execution.completed_at = timezone.now()
        execution.status       = "SUCCESS" if rc == 0 else "FAILED"
        if rc != 0 and not execution.error_message:
            execution.error_message = "ETL process exited with non-zero status."
        execution.save(update_fields=[
            "completed_at", "status", "return_code",
            "stdout_log", "stderr_log", "error_message",
        ])

    except Exception as exc:
        execution.completed_at  = timezone.now()
        execution.status        = "FAILED"
        execution.error_message = str(exc)
        execution.stderr_log   += f"\n[ENGINE ERROR] {exc!r}"
        execution.save(update_fields=[
            "completed_at", "status", "error_message", "stderr_log",
        ])