"""Root runner for the BASINSHIFT FastAPI backend server."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.run_server import app
import uvicorn

if __name__ == "__main__":
    print(f"Starting BASINSHIFT Backend from {ROOT}...")
    print("API accessible at http://127.0.0.1:8000 (docs at http://127.0.0.1:8000/docs)")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
