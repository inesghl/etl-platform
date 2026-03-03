# KPIs / metrics
def compute_measures(df):
    return {
        "row_count": len(df),
        "total_amount": df["amount"].sum()
    }
