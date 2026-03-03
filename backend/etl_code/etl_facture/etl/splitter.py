# df partitioning
import logging

log = logging.getLogger(__name__)

def split_df(df, rules):
    outputs = {}
    used_idx = set()

    for name, rule in rules.items():
        mask = df[rule["column"]].isin(rule["values"])
        part = df[mask].copy()
        outputs[name] = part
        used_idx.update(part.index)
        log.info("%s created: %s rows", name, len(part))

    deleted = df.loc[~df.index.isin(used_idx)].copy()
    log.warning("Deleted rows: %s", len(deleted))

    return outputs, deleted
