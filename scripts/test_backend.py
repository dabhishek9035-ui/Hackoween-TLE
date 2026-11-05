"""Integration test for BASINSHIFT FastAPI backend and CatBoost inference."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi.testclient import TestClient
from backend.main import app

def main():
    client = TestClient(app)

    print("1. Testing /api/health...")
    res = client.get("/api/health")
    assert res.status_code == 200, f"Health check failed: {res.text}"
    health_data = res.json()
    print("   Health response:", health_data)
    assert health_data["status"] == "healthy"
    assert health_data["engine_ready"] is True

    print("\n2. Testing /api/catchments...")
    res = client.get("/api/catchments")
    assert res.status_code == 200, f"Catchments failed: {res.text}"
    catchments = res.json()
    print(f"   Registered {len(catchments)} catchments")
    assert len(catchments) >= 10
    sample_c = catchments[0]
    print(f"   Sample catchment: {sample_c['id']} ({sample_c['code']}) - {sample_c['name']}")

    print("\n3. Testing /api/history...")
    res = client.get(f"/api/history?catchmentId={sample_c['id']}&days=30")
    assert res.status_code == 200, f"History failed: {res.text}"
    history = res.json()
    print(f"   History points returned: {len(history)}")
    assert len(history) == 30

    print("\n4. Testing /api/forecast...")
    payload = {
        "catchmentId": sample_c["id"],
        "catchment": sample_c,
        "asOf": sample_c["lastRecorded"]["date"],
        "horizon": 5,
        "inputs": sample_c["defaultInputs"],
    }
    res = client.post("/api/forecast", json=payload)
    assert res.status_code == 200, f"Forecast failed: {res.text}"
    fc = res.json()
    print("   Forecast source:", fc["source"])
    print("   Predicted discharge [1d, 3d, 5d]:", fc["output"]["predicted_discharge"])
    print("   High-flow probabilities:", fc["pHigh"])
    print("   Risk level:", fc["risk"])
    print("   Series point count:", len(fc["series"]))
    assert fc["source"] == "catboost_caravan"
    assert len(fc["output"]["predicted_discharge"]) == 3
    assert len(fc["series"]) == 5

    print("\n5. Testing /api/risk-board...")
    res = client.get("/api/risk-board")
    assert res.status_code == 200, f"Risk board failed: {res.text}"
    board = res.json()
    print(f"   Risk board entries: {len(board)}")
    assert len(board) == len(catchments)

    print("\n6. Testing /api/metrics...")
    res = client.get("/api/metrics")
    assert res.status_code == 200
    metrics = res.json()
    print("   Metrics task:", metrics.get("task", "Available"))

    print("\nALL INTEGRATION TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    main()
