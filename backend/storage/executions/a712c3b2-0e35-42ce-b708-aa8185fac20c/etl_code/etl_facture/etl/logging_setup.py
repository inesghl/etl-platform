import logging
from pathlib import Path
from datetime import datetime

def setup_logging(log_dir: Path, label: str) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    logfile = log_dir / f"{label}_{datetime.now():%Y%m%d_%H%M%S}.log"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        handlers=[
            logging.FileHandler(logfile),
            logging.StreamHandler()
        ],
    )
