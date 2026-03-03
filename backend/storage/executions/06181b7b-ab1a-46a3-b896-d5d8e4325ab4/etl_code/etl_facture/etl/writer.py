# Excel output
import pandas as pd

def write_outputs(path, outputs, measures):
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        for name, df in outputs.items():
            df.to_excel(writer, sheet_name=name, index=False)
            pd.DataFrame([measures[name]]).to_excel(
                writer, sheet_name=f"{name}_MEASURES", index=False
            )
