"""Entry point to launch the BASINSHIFT FastAPI backend server."""

import os
import sys
from pathlib import Path

# Ensure project root is in sys.path whether run from project root or backend/ directory
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent

for p in [str(PROJECT_ROOT), str(BACKEND_DIR)]:
    if p not in sys.path:
        sys.path.insert(0, p)

import uvicorn

try:
    from backend.main import app
except ImportError:
    from main import app

if __name__ == "__main__":
    print(f"Starting BASINSHIFT Backend from {PROJECT_ROOT}...")
    print("API will be accessible at http://127.0.0.1:8000 (docs at http://127.0.0.1:8000/docs)")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
