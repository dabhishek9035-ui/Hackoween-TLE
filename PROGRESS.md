# Integration progress

## Step 1 — Inspect workspace and integration point

- Confirmed the project is a streamflow forecasting app with CatBoost assets in the existing `models/` directory.
- The backend loads `caravan_streamflow_h1d.cbm`, `caravan_streamflow_h3d.cbm`, and `caravan_streamflow_h5d.cbm` from `models/` (`backend/inference.py`).
- The requested destination `fimo/` does not exist yet.
- Checked the source repository page and Git access. GitHub could not be reached from the default network sandbox, so the source folder contents are not yet available.

**Status:** Inspection complete.

## Step 2 — Fetch and copy the source models

- Retrieved only `models/` from [Ronitkapar/halloween](https://github.com/Ronitkapar/halloween) using a sparse checkout.
- Copied its five `.joblib` estimators and `manifest.json` into `fimo/`.
- Removed the temporary checkout after copying so the source repository's other files are not included in this workspace.

**Status:** Model files copied.

## Step 3 — Check application compatibility

- The source manifest describes pooled scikit-learn HistGradientBoosting models for forecast horizons **1, 3, and 7 days**, using a 15-column feature vector (14 listed hydrometeorological features plus a horizon value).
- The current backend loads CatBoost files from `models/`, uses a different 32-column feature schema, and exposes horizons **1, 3, and 5 days**. Its current request inputs also synthesize some feature values that the source model expects as observed lag/rolling features.
- Wiring these estimators into the existing predictions would require an explicit, defensible feature mapping and a horizon/API change. The files alone do not define that mapping, so direct substitution would produce unsupported forecasts.

**Status:** Initial compatibility review identified the feature and horizon contract that the integration needed to honor.

## Step 4 — Verify and assemble the model heads

- Confirmed the five artifacts are separate estimator heads, not byte-split parts. The manifest provides a SHA-256 and expected size for each file.
- Verified all five files against the manifest and assembled their mean, q05, q95, high-flow, and extreme-flow heads into `fimo/fimo_bundle.joblib` with the 1/3/7 horizon and feature metadata.
- Added `fimo/assemble.py` so the bundle can be regenerated after integrity checks.

**Status:** Bundle assembled.

## Step 5 — Connect FIMO inference to the app

- Added a FIMO loader and feature adapter in `backend/fimo_models.py`. It validates the bundle schema, head names, and 15-feature model shape.
- The API now uses the FIMO mean model for discharge, q05/q95 models for intervals, and the two classifiers for high/extreme-flow probabilities. CatBoost remains a fallback if the bundle is unavailable.
- Updated backend responses, risk board, custom forecast, and the UI horizon contract to 1, 3, and 7 days.
- The existing standard request only supplies a seven-day rainfall total; its daily precipitation lag features are therefore evenly distributed estimates. The custom forecast has explicit precipitation lag inputs.

**Status:** Runtime integration complete.

## Step 6 — Scan for errors

- `python -m compileall -q backend fimo`: passed.
- Backend smoke inference for both standard and custom forecasts: passed; both return horizons `[1, 3, 7]` and seven daily series points.
- UI `npm run typecheck`: passed.
- UI `npm run build`: passed.
- The first smoke scan caught and fixed a stale 5-day risk variable, a pre-existing wrong custom-input property (`area_km2`), and a UI default horizon still set to 5.
- The source artifacts were serialized with scikit-learn 1.9.1. Upgraded the project virtual environment to 1.9.1 and regenerated the bundle, eliminating the estimator version mismatch warning. The non-fatal Windows core-count warning from joblib was also avoided by setting its supported worker-count environment variable before model imports.

**Status:** Scans passed after fixes. No remaining compile, inference, typecheck, or production build errors found.

## Step 7 — Score FIMO accuracy on public validation

- Added `scripts/evaluate_fimo.py` to recreate the manifest's 14 dynamic features and horizon column from Caravan observations, use the existing seed-2026 public catchment split and 500-row basin cap, and compute point, interval, and probability scores.
- Evaluated against the complete Caravan archive: 3,256 public-validation catchments, with about 1.61 million valid rows per horizon. Also scored persistence on the same origins.
- Saved full results to `reports/fimo_validation_metrics.json`.
- Main finding: FIMO reduces pooled RMSE compared with persistence at 3 and 7 days, but not at 1 day. FIMO's 90% quantile interval covers 96.6–98.2% of observations, suggesting it is over-wide on this validation run. At a fixed 0.5 classifier cutoff, rare-event recall is low, especially for extreme flows.
- FIMO's manifest does not list its training basin IDs. It says training used 12,469 basins with seed 42, while this public validation split uses seed 2026; overlap cannot be excluded, so these are diagnostic scores rather than a fully guaranteed unseen-basin evaluation.

**Scores (flow in mm/day):**

| Horizon | FIMO RMSE | Persistence RMSE | FIMO MAE | FIMO pooled NSE/R² | 90% interval coverage | High-flow ROC AUC | Extreme ROC AUC |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 day | 4.005 | 3.396 | 1.271 | -0.040 | 98.2% | 0.853 | 0.862 |
| 3 days | 3.755 | 4.132 | 1.066 | 0.017 | 96.6% | 0.798 | 0.778 |
| 7 days | 3.893 | 4.397 | 1.142 | -0.019 | 97.0% | 0.754 | 0.730 |

**Status:** Validation scan complete. 1-day RMSE is worse than persistence; 3- and 7-day RMSE are better. Classifier metrics use source-specific training-only p90/p99 thresholds and a 0.5 decision cutoff.
