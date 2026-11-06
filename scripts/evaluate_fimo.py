"""Evaluate the FIMO bundle on the local public catchment validation split."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("LOKY_MAX_CPU_COUNT", str(os.cpu_count() or 1))

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, f1_score, log_loss, precision_score, recall_score, roc_auc_score

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import train
from backend.fimo_models import FimoModelSuite
from basinshift.caravan import iter_netcdf


ARCHIVE = PROJECT_ROOT / "data" / "Caravan" / "Caravan-nc.tar.gz"
SPLIT = PROJECT_ROOT / "data" / "Caravan" / "manifests" / "public_catchment_split.csv"
OUTPUT = PROJECT_ROOT / "reports" / "fimo_validation_metrics.json"
HORIZONS = (1, 3, 7)
ROW_CAP = 500
MIN_THRESHOLD_ROWS = 30


def rolling_sum(values: np.ndarray, window: int) -> np.ndarray:
    total = np.zeros(values.shape, dtype=np.float64)
    valid = np.ones(values.shape, dtype=bool)
    for offset in range(window):
        shifted = train.lag(values, offset)
        finite = np.isfinite(shifted)
        valid &= finite
        total[finite] += shifted[finite]
    total[~valid] = np.nan
    return total.astype(np.float32)


def metric_summary(observed: np.ndarray, predicted: np.ndarray) -> dict[str, float | int | None]:
    observed = np.asarray(observed, dtype=np.float64)
    predicted = np.asarray(predicted, dtype=np.float64)
    residual = predicted - observed
    denominator = float(np.sum((observed - observed.mean()) ** 2))
    return {
        "rmse_mm_day": float(np.sqrt(np.mean(residual**2))),
        "mae_mm_day": float(np.mean(np.abs(residual))),
        "r2_nse_pooled": float(1.0 - np.sum(residual**2) / denominator) if denominator else None,
        "bias_mm_day": float(np.mean(residual)),
        "rows": int(observed.size),
    }


def probability_summary(labels: np.ndarray, probabilities: np.ndarray) -> dict:
    labels = np.asarray(labels, dtype=np.int8)
    probabilities = np.clip(np.asarray(probabilities, dtype=np.float64), 1e-7, 1 - 1e-7)
    predicted = probabilities >= 0.5
    has_both_classes = np.unique(labels).size == 2
    return {
        "prevalence": float(labels.mean()),
        "brier_score": float(np.mean((probabilities - labels) ** 2)),
        "log_loss": float(log_loss(labels, probabilities, labels=[0, 1])),
        "roc_auc": float(roc_auc_score(labels, probabilities)) if has_both_classes else None,
        "accuracy_at_0_5": float(accuracy_score(labels, predicted)),
        "precision_at_0_5": float(precision_score(labels, predicted, zero_division=0)),
        "recall_at_0_5": float(recall_score(labels, predicted, zero_division=0)),
        "f1_at_0_5": float(f1_score(labels, predicted, zero_division=0)),
        "rows": int(labels.size),
    }


def main() -> None:
    if not ARCHIVE.is_file() or ARCHIVE.stat().st_size != train.EXPECTED_ARCHIVE_SIZE:
        raise SystemExit("The complete Caravan-nc.tar.gz archive is required for evaluation")

    split = pd.read_csv(SPLIT)
    train_ids = set(zip(split.loc[split.partition == "train", "source"], split.loc[split.partition == "train", "gauge_id"]))
    validation_rows = split.loc[split.partition == "public_validation"]
    validation_ids = set(zip(validation_rows.source, validation_rows.gauge_id))
    suite = FimoModelSuite()

    matrices: dict[int, list[np.ndarray]] = {h: [] for h in HORIZONS}
    targets: dict[int, list[np.ndarray]] = {h: [] for h in HORIZONS}
    persistence: dict[int, list[np.ndarray]] = {h: [] for h in HORIZONS}
    groups: dict[int, list[tuple[str, str]]] = {h: [] for h in HORIZONS}
    per_basin_thresholds: dict[int, dict[str, list[float]]] = {
        h: {source: [] for source in split.source.unique()} for h in HORIZONS
    }
    extreme_thresholds = {
        h: {source: [] for source in split.source.unique()} for h in HORIZONS
    }
    processed = 0

    for source, gauge_id, dataset in iter_netcdf(ARCHIVE, gauge_filter=train_ids | validation_ids):
        processed += 1
        if processed % 500 == 0:
            print(f"Read {processed:,} of {len(train_ids) + len(validation_ids):,} selected catchments", flush=True)
        dates, units = train.validate_daily_axis(dataset, source, gauge_id)
        row_count = len(dates)
        flow = train.read_variable(dataset, "streamflow", row_count)
        precipitation = train.read_variable(dataset, "total_precipitation_sum", row_count)
        temperature = train.read_variable(dataset, "temperature_2m_mean", row_count)
        day_sin, day_cos, _ = train.seasonal_features(dates, units)
        flow_mean7, flow_max7 = rolling_sum(flow, 7) / 7.0, rolling_sum(flow, 7)
        flow_mean30, flow_max30 = rolling_sum(flow, 30) / 30.0, rolling_sum(flow, 30)
        precip_sum7 = rolling_sum(precipitation, 7)
        precip_sum30 = rolling_sum(precipitation, 30)

        features = {
            "sf_lag1": train.lag(flow, 0),
            "sf_lag3": train.lag(flow, 2),
            "sf_lag7": train.lag(flow, 6),
            "sf_rollmean7": flow_mean7,
            "sf_rollmax7": flow_max7,
            "sf_rollmean30": flow_mean30,
            "sf_rollmax30": flow_max30,
            "pr_lag1": train.lag(precipitation, 0),
            "pr_lag3": train.lag(precipitation, 2),
            "pr_rollsum7": precip_sum7,
            "pr_rollsum30": precip_sum30,
            "t2m_lag1": train.lag(temperature, 0),
            "doy_sin": day_sin,
            "doy_cos": day_cos,
        }

        if (source, gauge_id) in train_ids:
            for h in HORIZONS:
                usable = max(0, row_count - h)
                origin = flow[:usable]
                target = flow[h : h + usable]
                valid = np.isfinite(origin) & (origin >= 0) & np.isfinite(target) & (target >= 0)
                values = target[valid]
                if values.size >= MIN_THRESHOLD_ROWS:
                    per_basin_thresholds[h][source].append(float(np.quantile(values, 0.90)))
                # Extreme thresholds use the same training-only target sample.
                # Retained below in a separate quantile collection.
                if values.size >= MIN_THRESHOLD_ROWS:
                    extreme_thresholds[h][source].append(float(np.quantile(values, 0.99)))
            continue

        usable = max(0, row_count - max(HORIZONS))
        valid_origin = np.isfinite(flow[:usable]) & (flow[:usable] >= 0)
        candidates = np.flatnonzero(valid_origin)
        indices = train.sample_rows(source, gauge_id, candidates, ROW_CAP, "public_validation", 2026)
        if not indices.size:
            continue
        feature_matrix = np.column_stack([features[name][indices] for name in suite.features]).astype(np.float32)
        for h in HORIZONS:
            y = flow[indices + h]
            keep = np.isfinite(y) & (y >= 0)
            selected = indices[keep]
            if not selected.size:
                continue
            x_h = np.column_stack((feature_matrix[keep], np.full(int(keep.sum()), h, dtype=np.float32)))
            matrices[h].append(x_h.astype(np.float32, copy=False))
            targets[h].append(y[keep].astype(np.float32, copy=False))
            persistence[h].append(flow[selected].astype(np.float32, copy=False))
            groups[h].extend([(source, gauge_id)] * len(selected))

    if processed != len(train_ids) + len(validation_ids):
        raise RuntimeError(f"Archive scan found {processed} selected catchments; split lists {len(train_ids) + len(validation_ids)}")

    high_thresholds_by_h = {
        h: {source: float(np.median(values)) for source, values in per_basin_thresholds[h].items() if values}
        for h in HORIZONS
    }
    extreme_thresholds_by_h = {h: {source: float(np.median(values)) for source, values in extreme_thresholds[h].items() if values} for h in HORIZONS}

    results = {}
    for h in HORIZONS:
        x = np.concatenate(matrices[h])
        y = np.concatenate(targets[h]).astype(np.float64)
        persist = np.concatenate(persistence[h]).astype(np.float64)
        fimo_mean = np.maximum(0.0, suite.heads["mean"].predict(x)).astype(np.float64)
        q05 = np.maximum(0.0, suite.heads["q05"].predict(x)).astype(np.float64)
        q95 = np.maximum(q05, suite.heads["q95"].predict(x)).astype(np.float64)
        p_high = suite.heads["clf_high"].predict_proba(x)[:, 1]
        p_extreme = suite.heads["clf_ext"].predict_proba(x)[:, 1]
        group_frame = pd.DataFrame(groups[h], columns=["source", "gauge_id"])
        high_thresholds = high_thresholds_by_h[h]
        labels_high = np.asarray([target > high_thresholds[src] for src, target in zip(group_frame.source, y)], dtype=np.int8)
        ext_thresholds = extreme_thresholds_by_h[h]
        labels_extreme = np.asarray([target > ext_thresholds[src] for src, target in zip(group_frame.source, y)], dtype=np.int8)
        coverage = (y >= q05) & (y <= q95)
        results[str(h)] = {
            "rows_scored": int(y.size),
            "validation_catchments_scored": int(group_frame[["source", "gauge_id"]].drop_duplicates().shape[0]),
            "fimo_mean": metric_summary(y, fimo_mean),
            "persistence": metric_summary(y, persist),
            "quantile_05_95_interval": {
                "nominal_coverage": 0.90,
                "observed_coverage": float(coverage.mean()),
                "mean_width_mm_day": float(np.mean(q95 - q05)),
                "q05_pinball_loss": float(np.mean(np.maximum(0.05 * (y - q05), -0.95 * (y - q05)))),
                "q95_pinball_loss": float(np.mean(np.maximum(0.95 * (y - q95), -0.05 * (y - q95)))),
            },
            "high_flow_classifier": probability_summary(labels_high, p_high),
            "extreme_flow_classifier": probability_summary(labels_extreme, p_extreme),
        }

    result = {
        "evaluation": {
            "dataset": "Caravan-nc.tar.gz",
            "split": "public_catchment_split.csv",
            "split_seed": 2026,
            "validation_catchments_in_split": len(validation_ids),
            "row_cap_per_catchment": ROW_CAP,
            "horizons_days": list(HORIZONS),
            "target_unit": "mm/day",
            "thresholds": "per-source medians of training-catchment target-flow p90/p99; validation targets are not used to set thresholds",
            "model_training_split_note": "The FIMO manifest says it trained on 12,469 basins with seed 42 but does not include those basin IDs. This local split uses seed 2026; overlap cannot be ruled out, so scores are diagnostic rather than guaranteed leakage-free.",
            "features_note": "Feature values are rebuilt from complete observed time series in the Caravan archive, not the API's rainfall-total approximation.",
            "created_utc": datetime.now(timezone.utc).isoformat(),
        },
        "horizons": results,
    }
    OUTPUT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT}")
    for h, scores in results.items():
        print(h, "days:", json.dumps({key: scores[key] for key in ("fimo_mean", "persistence", "quantile_05_95_interval", "high_flow_classifier", "extreme_flow_classifier")}, separators=(",", ":")))


if __name__ == "__main__":
    main()
