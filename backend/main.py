from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from backend.data_loader import manager
    from backend.inference import HORIZONS, engine
    from backend.models import (
        Catchment,
        CustomForecastResult,
        CustomModelInputs,
        DischargePoint,
        ForecastInputs,
        ForecastResult,
        RiskBoardEntry,
        RiskLevel,
    )
except ImportError:
    from data_loader import manager
    from inference import HORIZONS, engine
    from models import (
        Catchment,
        CustomForecastResult,
        CustomModelInputs,
        DischargePoint,
        ForecastInputs,
        ForecastResult,
        RiskBoardEntry,
        RiskLevel,
    )

PROJECT_ROOT = Path(__file__).resolve().parent.parent
REPORT_FILE = PROJECT_ROOT / "reports" / "benchmark_metrics.json"

app = FastAPI(
    title="BASINSHIFT Flood Intelligence Backend",
    description="Real-time 1-, 3-, and 7-day streamflow forecasting with the bundled FIMO gradient-boosting model suite.",
    version="1.0.0",
)

# Enable CORS for local development and UI communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check() -> dict[str, Any]:
    """Health check endpoint reporting model and catchment network status."""
    return {
        "status": "healthy",
        "service": "BASINSHIFT ML Inference Engine",
        "models_loaded": list(engine.models.keys()),
        "fimo_bundle_loaded": engine.fimo is not None,
        "fimo_horizons": engine.fimo.horizons if engine.fimo is not None else [],
        "catchments_registered": len(manager.list_catchments()),
        "engine_ready": engine.is_ready(),
    }


@app.get("/api/catchments", response_model=list[Catchment])
def get_catchments() -> list[Catchment]:
    """Return all gauged river catchments available in the network."""
    return manager.list_catchments()


@app.get("/api/catchments/{catchment_id}", response_model=Catchment)
def get_catchment_by_id(catchment_id: str) -> Catchment:
    """Return a single catchment by its unique ID."""
    c = manager.get_catchment(catchment_id)
    if not c:
        raise HTTPException(status_code=404, detail=f"Catchment '{catchment_id}' not found")
    return c


@app.get("/api/history", response_model=list[DischargePoint])
def get_history(
    catchment_id: str = Query(None, alias="catchmentId"),
    catchment_id_alt: str = Query(None, alias="catchment_id"),
    as_of: str = Query(None, alias="asOf"),
    as_of_alt: str = Query(None, alias="as_of"),
    days: int = Query(365, ge=1, le=1000),
) -> list[DischargePoint]:
    """Retrieve historical daily discharge records for a catchment up to as_of date."""
    cid = catchment_id or catchment_id_alt
    if not cid:
        raise HTTPException(status_code=400, detail="Missing catchment ID parameter")

    as_of_date = as_of or as_of_alt or date.today().strftime("%Y-%m-%d")
    return manager.generate_history(cid, as_of_date, days)


@app.post("/api/forecast", response_model=ForecastResult)
def run_forecast_endpoint(payload: dict[str, Any] = Body(...)) -> ForecastResult:
    """Run FIMO model inference to produce multi-horizon flood forecasts."""
    # Support both flat and nested payloads
    cid = (
        payload.get("catchmentId")
        or payload.get("catchment_id")
        or (payload.get("catchment", {}).get("id") if isinstance(payload.get("catchment"), dict) else None)
    )
    if not cid:
        raise HTTPException(status_code=400, detail="Missing catchment ID in request")

    catchment = manager.get_catchment(cid)
    if not catchment:
        # If full catchment was passed in payload, use it
        raw_c = payload.get("catchment")
        if isinstance(raw_c, dict):
            catchment = Catchment(**raw_c)
        else:
            raise HTTPException(status_code=404, detail=f"Catchment '{cid}' not found")

    as_of = payload.get("asOf") or payload.get("as_of") or date.today().strftime("%Y-%m-%d")
    horizon = int(payload.get("horizon", 7))

    raw_inputs = payload.get("inputs") or {}
    inputs = ForecastInputs(**raw_inputs) if isinstance(raw_inputs, dict) else catchment.defaultInputs

    # Retrieve recent history to populate lag features
    history = manager.generate_history(cid, as_of, 30)
    flows = [p.discharge for p in history if p.discharge is not None]

    return engine.predict(catchment, as_of, inputs, horizon, flows)


@app.post("/api/predict/custom", response_model=CustomForecastResult)
def run_custom_forecast_endpoint(inputs: CustomModelInputs) -> CustomForecastResult:
    """Run multi-horizon FIMO inference using the supplied catchment features."""
    return engine.predict_custom(inputs)


@app.get("/api/risk-board", response_model=list[RiskBoardEntry])
def get_risk_board() -> list[RiskBoardEntry]:
    """Return real-time risk board assessments across all registered catchments."""
    today_str = date.today().strftime("%Y-%m-%d")
    board: list[RiskBoardEntry] = []

    for c in manager.list_catchments():
        history = manager.generate_history(c.id, today_str, 30)
        flows = [p.discharge for p in history if p.discharge is not None]
        result = engine.predict(c, today_str, c.defaultInputs, 7, flows)
        pred_val = result.output.predicted_discharge[-1]
        p_h = result.pHigh.get("7", 0.0)
        p_e = result.pExt.get("7", 0.0)

        board.append(
            RiskBoardEntry(
                catchment=c,
                risk=result.risk,
                current=c.lastRecorded.discharge,
                predicted5=0.0,
                pHigh5=0.0,
                pExt5=0.0,
                predicted7=pred_val,
                pHigh7=p_h,
                pExt7=p_e,
            )
        )

    return board


@app.get("/api/metrics")
def get_benchmark_metrics() -> dict[str, Any]:
    """Return trained CatBoost benchmark metrics, data splits, and model scores."""
    if REPORT_FILE.exists():
        with REPORT_FILE.open("r", encoding="utf-8") as f:
            return json.load(f)
    return {"message": "Benchmark metrics report not available"}


def start():
    """Start uvicorn server directly."""
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    start()
