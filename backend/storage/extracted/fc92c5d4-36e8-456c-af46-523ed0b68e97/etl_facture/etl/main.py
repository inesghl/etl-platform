# entrypoint (guarded)
from pathlib import Path
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import json, toml, logging
from etl.logging_setup import setup_logging
from etl.loader import load_and_validate
from etl.splitter import split_df
from etl.rules import apply_rg
from etl.measures import compute_measures
from etl.writer import write_outputs

def main():
    paths = json.load(open("config/paths.json"))
    schema = json.load(open("config/schema.json"))
    rules = json.load(open("config/split_rules.json"))
    cfg = toml.load("config/config.toml")

    setup_logging(Path(paths["logs_dir"]), "PY_ETL_IDE_AGNOSTIC")
    log = logging.getLogger(__name__)
#not one df , one input but define a new dfs toread more 
    # df = load_and_validate(paths["input_excel"], schema["input_schema"])
   
   #########################################
    dfs = []

    for file_path in paths["input_files"]:
        df_part = load_and_validate(file_path, schema["input_schema"])
        dfs.append(df_part)

    # 🔹 Combine all inputs
    df = pd.concat(dfs, ignore_index=True)

    log.info("All inputs combined: %s rows", len(df))

   ######################################""
    outputs, deleted = split_df(df, rules)

    final_outputs = {}
    measures = {}

    for name, part in outputs.items():
        clean, removed = apply_rg(part, cfg["rg"].get(name, {}))
        deleted = deleted._append(removed)
        final_outputs[name] = clean
        measures[name] = compute_measures(clean)

    write_outputs(paths["output_excel"], final_outputs, measures)
    deleted.to_excel(paths["deleted_rows"], index=False)

    log.info("ETL completed successfully")

if __name__ == "__main__":
    main()
