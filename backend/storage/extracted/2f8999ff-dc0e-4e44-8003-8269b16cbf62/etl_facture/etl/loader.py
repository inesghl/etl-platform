import pandas as pd
import logging
from pathlib import Path

log = logging.getLogger(__name__)

def load_and_validate(path, schema: dict) -> pd.DataFrame:
    path = Path(path)

    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")

    # 🔹 Detect file type
    if path.suffix.lower() in [".xlsx", ".xls"]:
        df = pd.read_excel(path)
    elif path.suffix.lower() == ".csv":
        df = pd.read_csv(path)
    else:
        raise ValueError(f"Unsupported file format: {path.suffix}")

    log.info("Input loaded: %s rows", len(df))

    # 🔹 Schema validation
    for col, dtype in schema.items():
        if col not in df.columns:
            raise ValueError(f"Missing column: {col}")
        df[col] = df[col].astype(dtype, errors="ignore")

    log.info("Schema validated")
    return df
