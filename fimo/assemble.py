"""Verify and bundle the FIMO model heads listed in manifest.json."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import joblib


MODEL_DIR = Path(__file__).resolve().parent
BUNDLE_PATH = MODEL_DIR / "fimo_bundle.joblib"


def assemble() -> Path:
    manifest = json.loads((MODEL_DIR / "manifest.json").read_text(encoding="utf-8"))
    heads: dict[str, Any] = {}

    for artifact in manifest["artifacts"]:
        path = MODEL_DIR / artifact["filename"]
        content = path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        if digest != artifact["sha256"]:
            raise ValueError(f"SHA-256 mismatch for {path.name}")
        if len(content) != artifact["size_bytes"]:
            raise ValueError(f"Size mismatch for {path.name}")
        head_name = path.stem.removeprefix("gbm_")
        heads[head_name] = joblib.load(path)

    bundle = {
        "schema": manifest["schema"],
        "features": manifest["features"],
        "horizons_days": manifest["horizons_days"],
        "target_unit": manifest["target_unit"],
        "heads": heads,
    }
    joblib.dump(bundle, BUNDLE_PATH, compress=3)
    return BUNDLE_PATH


if __name__ == "__main__":
    print(assemble())
