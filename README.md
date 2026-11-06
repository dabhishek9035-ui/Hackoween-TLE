# BASINSHIFT flood forecasting

This repository builds multi-horizon streamflow forecasts from Caravan v1.6. The training entry point is `train.py`; it fits separate CatBoost residual models for 1-, 3-, and 5-day forecasts and scores each against persistence on the same held-out catchments.

The inference backend uses the bundled FIMO model suite in `fimo/` for its 1-, 3-, and 7-day forecasts. `fimo/assemble.py` verifies source artifact hashes and assembles the five prediction heads into `fimo/fimo_bundle.joblib`. The backend keeps the CatBoost models as a fallback if the FIMO bundle is unavailable.

The challenge document describes a proposed challenge, not a released leaderboard. The repository's deterministic public catchment split and persistence comparison are development benchmarks, not official BASINSHIFT scores.

## Project layout

- `configs/`: forecast horizons and model settings.
- `data/Caravan/`: archive, generated manifests, metadata, and data documentation.
- `logs/`: download, scan, and training logs.
- `models/`: trained CatBoost benchmark models used as a fallback.
- `fimo/`: verified FIMO mean, quantile, and exceedance models used for 1-, 3-, and 7-day backend forecasts.
- `reports/`: benchmark metrics, coverage, and attribute inventories.
- `scripts/`: split generation, data audits, and finalization.
- `src/basinshift/`: shared Caravan archive reader for NetCDF3 and NetCDF4.
- `backend/`: FastAPI backend serving real-time CatBoost inference and data endpoints.
- `ui/`: Next.js 14 interactive flood intelligence web application.
- `train.py`: root training and benchmark entry point.
- `requirements.txt` and `pyproject.toml`: runtime and packaging dependencies.

## Setup and run

Use Python 3.12 or later. From the repository root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python train.py
```

### Run the backend and web UI

Start the FastAPI inference backend:
```powershell
python run_backend.py
```

In a separate terminal, launch the Next.js UI:
```powershell
cd ui
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the live interface.

The input archive belongs at `data/Caravan/Caravan-nc.tar.gz`. The training script can also read the current `.partial` archive and will use only complete NetCDF members; those results are marked preliminary in `reports/benchmark_metrics.json`. The finalizer verifies the checksum and scans coverage before training on the complete archive.

To check download progress manually in PowerShell:

```powershell
$archivePath = 'data/Caravan/Caravan-nc.tar.gz'
if (-not (Test-Path $archivePath)) { $archivePath += '.partial' }
$expectedBytes = 24775734275
$downloadedBytes = (Get-Item $archivePath).Length
'{0:N2} GB of 24.78 GB ({1:N1}%)' -f ($downloadedBytes / 1e9), (100 * $downloadedBytes / $expectedBytes)
```

The finalizer writes its status to `logs/download_status.txt`; the full scan and training output are logged under `logs/`. The final scan verifies the archive MD5, extracts metadata, and regenerates the inventory and split before training.

## Forecast definition

For each horizon `h` in `{1, 3, 5}`, the target is `streamflow(t+h)` and features use observations through day `t`. Flow lags, precipitation lags and rolling sums, meteorology, soil water, and day-of-year are used. A separate CatBoost model predicts the residual from the persistence forecast `streamflow(t)`. Caravan streamflow is area-normalized runoff in mm/day.

Catchments are assigned using `data/Caravan/manifests/public_catchment_split.csv`, so all dates from a catchment remain in one partition. Training and validation use deterministic date samples capped at 250 and 500 rows per catchment respectively. Final metrics and per-catchment scores are written under `reports/`; models are written under `models/`.

See `data/Caravan/docs/` for the inventory, field dictionary, and split/evaluation notes.
