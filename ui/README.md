# BASINSHIFT UI — Global Flood Intelligence

A full-stack interface for the **BASINSHIFT** flood forecasting challenge (generalizable ML for extreme river-discharge prediction in unseen catchments). It pairs Next.js 14 with a FastAPI backend running multi-horizon CatBoost residual models trained on Caravan v1.6 streamflow benchmarks.

## Pages

| Route | Page | What it does |
|---|---|---|
| `/` | **Home** | Project description, key facts, and a CTA into the forecast workbench. |
| `/predict` | **Prediction workbench** | The challenge §8.2 inputs (identity, hydrology history, meteorology, catchment attributes, missingness metadata) and a §8.3-shaped output space: predicted discharge, high-flow / extreme-flow probabilities, prediction intervals, plus copyable submission JSON. |
| `/history` | **Run ledger** | Every workbench run logged with inputs + outputs (localStorage), reopenable with one click. |
| `/map` | **Risk globe** | Interactive 3D Earth (react-globe.gl + Three.js) with gauged catchments marked as red / amber / green risk columns — column height encodes how close each river runs to its extreme threshold, high-risk basins pulse with rings, hover shows odds, click opens the forecast. |
| `/watchlist` | **Watch list** | High-flood-risk basins: red & amber catchments with odds, exposure regions, and steady catchments. |

## Architecture & Live Backend

- **Backend**: FastAPI app (`backend/main.py`) serving endpoints for health, catchments, history, CatBoost model forecasts, and the risk board.
- **Inference Engine**: `backend/inference.py` loads the bundled FIMO mean, quantile, and exceedance models from `fimo/fimo_bundle.joblib` for 1-, 3-, and 7-day forecasts. CatBoost benchmark artifacts remain available as a fallback.
- **Frontend**: Next.js 14 App Router with React Query. `next.config.mjs` automatically proxies `/api/*` to `http://127.0.0.1:8000/api/*`.
- **API Client**: `ui/src/data/api.ts` directly queries the backend with safe fallback handling.

## Running the Application

### 1. Start the Backend (Terminal 1)
```powershell
.\.venv\Scripts\Activate.ps1
python backend/run_server.py
```
Backend runs at `http://localhost:8000` (API documentation at `http://localhost:8000/docs`).

### 2. Start the Frontend (Terminal 2)
```powershell
cd ui
npm install
npm run dev
```
UI runs at `http://localhost:3000`.

## Stack

Next.js 14 (App Router) · React 18 · TypeScript · FastAPI · CatBoost · Uvicorn · three / @react-three/fiber · react-globe.gl · recharts · framer-motion · lucide-react · @tanstack/react-query · zustand.
