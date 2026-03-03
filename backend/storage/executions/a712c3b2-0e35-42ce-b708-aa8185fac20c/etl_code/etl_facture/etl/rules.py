# RG evaluation
import logging

log = logging.getLogger(__name__)

def apply_rg(df, rg_config):
    removed = []
    for rule, value in rg_config.items():
        if rule == "amount_min":
            bad = df[df["amount"] < value]
            df = df[df["amount"] >= value]
            removed.append(bad)
            log.info("RG amount_min=%s removed %s rows", value, len(bad))

    removed_df = (
        removed[0] if removed else df.iloc[0:0]
    )
    return df, removed_df
