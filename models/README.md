# Trained models

The root command `python train.py` fits a separate CatBoost residual model for each forecast horizon:

- `caravan_streamflow_h1d.cbm`
- `caravan_streamflow_h3d.cbm`
- `caravan_streamflow_h5d.cbm`

Each model predicts `streamflow(t+h)` from data available through day `t`. `preliminary_partial_archive/` preserves models trained before the archive completed. Metrics and validation summaries are in `reports/`.
