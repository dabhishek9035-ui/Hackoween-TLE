from __future__ import annotations

import math
import os
from datetime import date
from pathlib import Path
from typing import Any

os.environ.setdefault("LOKY_MAX_CPU_COUNT", str(os.cpu_count() or 1))

import joblib
import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parent.parent
BUNDLE_PATH = PROJECT_ROOT / "fimo" / "fimo_bundle.joblib"


class FimoModelSuite:
    """Loaded bundle of pooled mean, quantile, and exceedance model heads."""

    def __init__(self, bundle_path: Path = BUNDLE_PATH) -> None:
        self.bundle: dict[str, Any] = joblib.load(bundle_path)
        if self.bundle.get("schema") != "basinshift-models-manifest-v1":
            raise ValueError("Unsupported FIMO bundle schema")
        self.features: list[str] = list(self.bundle["features"])
        self.horizons: list[int] = list(self.bundle["horizons_days"])
        self.heads: dict[str, Any] = self.bundle["heads"]
        expected = {"mean", "q05", "q95", "clf_high", "clf_ext"}
        if set(self.heads) != expected:
            raise ValueError(f"FIMO bundle heads mismatch: {sorted(self.heads)}")
        if any(getattr(model, "n_features_in_", None) != len(self.features) + 1 for model in self.heads.values()):
            raise ValueError("FIMO model feature count does not match manifest")

    def predict(self, features: dict[str, float], horizon: int) -> dict[str, float]:
        if horizon not in self.horizons:
            raise ValueError(f"Unsupported FIMO horizon {horizon}; expected one of {self.horizons}")
        row = np.asarray([[*(float(features[name]) for name in self.features), float(horizon)]])
        heads = self.heads
        p_high = float(heads["clf_high"].predict_proba(row)[0, 1])
        p_ext = float(heads["clf_ext"].predict_proba(row)[0, 1])
        lower = max(0.0, float(heads["q05"].predict(row)[0]))
        mean = max(0.0, float(heads["mean"].predict(row)[0]))
        upper = max(lower, float(heads["q95"].predict(row)[0]))
        return {"mean": mean, "lower": lower, "upper": upper, "p_high": p_high, "p_ext": p_ext}


def build_fimo_features(
    flows_mm: list[float], antecedent_rain_mm: float, temp_c: float, as_of: date
) -> dict[str, float]:
    """Build the source manifest's feature vector from recent catchment history.

    The app currently receives a seven-day rainfall total rather than daily rainfall
    observations, so rainfall lags are evenly distributed estimates.
    """
    flows = [max(0.0, float(value)) for value in flows_mm] or [2.0]

    def lag(days_ago: int) -> float:
        return flows[-1 - days_ago] if len(flows) > days_ago else flows[0]

    recent7 = [lag(day) for day in range(7)]
    recent30 = [lag(day) for day in range(30)]
    daily_rain = max(0.0, float(antecedent_rain_mm)) / 7.0
    day_of_year = as_of.timetuple().tm_yday
    angle = 2.0 * math.pi * (day_of_year - 1) / 365.2425
    return {
        "sf_lag1": lag(0),
        "sf_lag3": lag(2),
        "sf_lag7": lag(6),
        "sf_rollmean7": float(np.mean(recent7)),
        "sf_rollmax7": float(np.max(recent7)),
        "sf_rollmean30": float(np.mean(recent30)),
        "sf_rollmax30": float(np.max(recent30)),
        "pr_lag1": daily_rain,
        "pr_lag3": daily_rain,
        "pr_rollsum7": max(0.0, float(antecedent_rain_mm)),
        "pr_rollsum30": max(0.0, float(antecedent_rain_mm)) * 30.0 / 7.0,
        "t2m_lag1": float(temp_c),
        "doy_sin": math.sin(angle),
        "doy_cos": math.cos(angle),
    }


def build_fimo_custom_features(values: dict[str, Any], as_of: date) -> dict[str, float]:
    flows = [
        float(values["flow_lag_0"]),
        float(values["flow_lag_1"]),
        float(values["flow_lag_2"]),
        float(values["flow_lag_3"]),
        float(values["flow_lag_7"]),
        float(values["flow_lag_14"]),
    ]
    recent7 = flows[:5] + [flows[-1], flows[-1]]
    recent30 = recent7 + [flows[-1]] * 23
    day_of_year = as_of.timetuple().tm_yday
    angle = 2.0 * math.pi * (day_of_year - 1) / 365.2425
    return {
        "sf_lag1": flows[0],
        "sf_lag3": flows[2],
        "sf_lag7": flows[4],
        "sf_rollmean7": float(np.mean(recent7)),
        "sf_rollmax7": float(np.max(recent7)),
        "sf_rollmean30": float(np.mean(recent30)),
        "sf_rollmax30": float(np.max(recent30)),
        "pr_lag1": float(values["precip_lag_0"]),
        "pr_lag3": float(values["precip_lag_2"]),
        "pr_rollsum7": float(values["precip_sum_7d"]),
        "pr_rollsum30": float(values["precip_sum_14d"]) * 30.0 / 14.0,
        "t2m_lag1": float(values["temperature_2m_mean"]),
        "doy_sin": math.sin(angle),
        "doy_cos": math.cos(angle),
    }
