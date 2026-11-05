"""Train and benchmark 1-, 3-, and 5-day Caravan streamflow forecasts."""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from catboost import CatBoostClassifier, CatBoostRegressor

PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from basinshift.caravan import iter_netcdf  # noqa: E402

DATA_DIR = PROJECT_ROOT / "data" / "Caravan"
MANIFEST_DIR = DATA_DIR / "manifests"
CONFIG_PATH = PROJECT_ROOT / "configs" / "benchmark.json"
SPLIT_PATH = MANIFEST_DIR / "public_catchment_split.csv"
PARTIAL_ARCHIVE = DATA_DIR / "Caravan-nc.tar.gz.partial"
FINAL_ARCHIVE = DATA_DIR / "Caravan-nc.tar.gz"
MODEL_DIR = PROJECT_ROOT / "models"
REPORT_DIR = PROJECT_ROOT / "reports"
EXPECTED_ARCHIVE_SIZE = 24_775_734_275

FLOW_LAGS = (0, 1, 2, 3, 7, 14)
PRECIPITATION_LAGS = (0, 1, 2, 3, 7, 14)
PRECIPITATION_WINDOWS = (3, 7, 14)
MIN_CATCHMENT_METRIC_ROWS = 30
EVENT_QUANTILE = 0.90
EVENT_CLASSIFIER_ITERATIONS = 400
EVENT_CLASSIFIER_DEPTH = 6
CARAVAN_STATIC_FEATURES = (
    "aridity_ERA5_LAND",
    "frac_snow",
    "high_prec_freq",
    "low_prec_freq",
    "moisture_index_ERA5_LAND",
    "p_mean",
    "pet_mean_ERA5_LAND",
    "seasonality_ERA5_LAND",
)
HYDROATLAS_STATIC_FEATURES = (
    "ele_mt_sav",
    "ele_mt_smn",
    "ele_mt_smx",
    "slp_dg_sav",
    "pre_mm_syr",
    "pet_mm_syr",
    "aet_mm_syr",
    "tmp_dc_syr",
    "snw_pc_syr",
    "cmi_ix_syr",
    "ari_ix_sav",
    "gwt_cm_sav",
    "swc_pc_syr",
    "soc_th_sav",
)
OTHER_STATIC_FEATURES = ("area", "gauge_lat", "gauge_lon")
METEOROLOGY_FEATURES = (
    "potential_evaporation_sum_ERA5_LAND",
    "potential_evaporation_sum_FAO_PENMAN_MONTEITH",
    "temperature_2m_mean",
    "dewpoint_temperature_2m_mean",
    "snow_depth_water_equivalent_mean",
    "surface_net_solar_radiation_mean",
    "surface_net_thermal_radiation_mean",
    "surface_pressure_mean",
    "u_component_of_wind_10m_mean",
    "v_component_of_wind_10m_mean",
    "volumetric_soil_water_layer_1_mean",
    "volumetric_soil_water_layer_2_mean",
    "volumetric_soil_water_layer_3_mean",
    "volumetric_soil_water_layer_4_mean",
)


def load_config() -> dict:
    with CONFIG_PATH.open(encoding="utf-8") as handle:
        config = json.load(handle)
    config["horizons_days"] = sorted({int(value) for value in config["horizons_days"]})
    if not config["horizons_days"] or config["horizons_days"][0] <= 0:
        raise ValueError("Forecast horizons must be positive day counts")
    return config


def read_split() -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    training: dict[str, list[str]] = {}
    validation: dict[str, list[str]] = {}
    with SPLIT_PATH.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            destination = training if row["partition"] == "train" else validation
            destination.setdefault(row["source"], []).append(row["gauge_id"])
    return training, validation


def selected_catchments(
    assignments: dict[str, list[str]],
) -> set[tuple[str, str]]:
    return {
        (source, gauge_id)
        for source, gauge_ids in assignments.items()
        for gauge_id in gauge_ids
    }


def load_static_attributes() -> (
    tuple[dict[tuple[str, str], dict[str, float]], list[str]]
):
    attributes_root = DATA_DIR / "metadata" / "Caravan-nc" / "attributes"
    feature_groups = (
        ("caravan", CARAVAN_STATIC_FEATURES),
        ("hydroatlas", HYDROATLAS_STATIC_FEATURES),
        ("other", OTHER_STATIC_FEATURES),
    )
    attributes: dict[tuple[str, str], dict[str, float]] = {}
    feature_names: set[str] = set()

    if not attributes_root.exists():
        return attributes, []

    for source_directory in sorted(
        path for path in attributes_root.iterdir() if path.is_dir()
    ):
        source = source_directory.name
        merged: pd.DataFrame | None = None
        for group_name, selected_columns in feature_groups:
            path = source_directory / f"attributes_{group_name}_{source}.csv"
            if not path.exists():
                continue
            selected = set(selected_columns)
            table = pd.read_csv(
                path,
                usecols=lambda name: name == "gauge_id" or name in selected,
                dtype={"gauge_id": str},
            )
            if "gauge_id" not in table:
                continue
            table = table.drop_duplicates("gauge_id").copy()
            rename = {
                name: f"static_{group_name}_{name}"
                for name in table.columns
                if name != "gauge_id"
            }
            table = table.rename(columns=rename)
            for name in rename.values():
                table[name] = pd.to_numeric(table[name], errors="coerce")
            feature_names.update(rename.values())
            merged = (
                table
                if merged is None
                else merged.merge(
                    table, on="gauge_id", how="outer", validate="one_to_one"
                )
            )

        if merged is None:
            continue
        feature_columns = [name for name in merged.columns if name != "gauge_id"]
        for row in merged.itertuples(index=False, name=None):
            gauge_id = str(row[merged.columns.get_loc("gauge_id")])
            values = {}
            for column in feature_columns:
                value = row[merged.columns.get_loc(column)]
                values[column] = float(value) if pd.notna(value) else np.nan
            attributes[(source, gauge_id)] = values

    return attributes, sorted(feature_names)


def attach_static_attributes(
    features: pd.DataFrame,
    values: dict[str, float] | None,
    feature_names: list[str],
) -> pd.DataFrame:
    if not feature_names:
        return features
    values = values or {}
    static = pd.DataFrame(
        {
            name: np.full(len(features), values.get(name, np.nan), dtype=np.float32)
            for name in feature_names
        }
    )
    return pd.concat([features.reset_index(drop=True), static], axis=1)


def lag(values: np.ndarray, days: int) -> np.ndarray:
    result = np.full(values.shape, np.nan, dtype=np.float32)
    if days == 0:
        result[:] = values
    elif days < len(values):
        result[days:] = values[:-days]
    return result


def attribute_text(value) -> str:
    if isinstance(value, bytes):
        return value.decode("ascii", errors="ignore")
    return str(value)


def validate_daily_axis(dataset, source: str, gauge_id: str) -> tuple[np.ndarray, str]:
    date_variable = dataset.variables["date"]
    dates = np.asarray(date_variable[:], dtype=np.float64)
    units = attribute_text(date_variable._attributes.get("units", ""))
    calendar = attribute_text(
        date_variable._attributes.get("calendar", "standard")
    ).lower()
    if calendar not in {"standard", "gregorian", "proleptic_gregorian"}:
        raise ValueError(
            f"Unsupported date calendar for {source}/{gauge_id}: {calendar!r}"
        )
    if dates.ndim != 1 or not np.all(np.isfinite(dates)):
        raise ValueError(f"Invalid date coordinate for {source}/{gauge_id}")
    unit_name = units.lower().split(" since", maxsplit=1)[0].strip().rstrip("s")
    units_per_day = {"day": 1.0, "hour": 24.0, "minute": 1440.0, "second": 86400.0}
    expected_step = units_per_day.get(unit_name)
    if expected_step is None or not units:
        raise ValueError(f"Unsupported date units for {source}/{gauge_id}: {units!r}")
    differences = np.diff(dates)
    daily_steps = np.isclose(differences, expected_step, rtol=0.0, atol=1e-7)
    if differences.size and not np.all(daily_steps):
        bad = int(np.flatnonzero(~daily_steps)[0])
        raise ValueError(
            f"Non-daily or unordered dates for {source}/{gauge_id}: "
            f"rows {bad}/{bad + 1} differ by {differences[bad]} {unit_name}s"
        )
    return dates, units


def seasonal_features(
    dates: np.ndarray, units: str
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    match = re.search(r"since\s+(\d{4})-(\d{2})-(\d{2})", units)
    if match is None:
        raise ValueError(f"Could not parse date origin from units {units!r}")

    origin = date(*map(int, match.groups()))
    normalized_units = units.lower().split(" since", maxsplit=1)[0].strip()
    if normalized_units.startswith("hour"):
        offsets = np.floor(dates / 24).astype(np.int64)
    elif normalized_units.startswith("minute"):
        offsets = np.floor(dates / 1440).astype(np.int64)
    elif normalized_units.startswith("second"):
        offsets = np.floor(dates / 86400).astype(np.int64)
    else:
        offsets = np.floor(dates).astype(np.int64)

    date_values = np.datetime64(origin.isoformat(), "D") + offsets.astype(
        "timedelta64[D]"
    )
    year_starts = date_values.astype("datetime64[Y]").astype("datetime64[D]")
    day_of_year = (date_values - year_starts).astype("timedelta64[D]").astype(
        np.int16
    ) + 1

    angle = 2.0 * np.pi * (day_of_year - 1.0) / 365.2425
    return (
        np.sin(angle).astype(np.float32),
        np.cos(angle).astype(np.float32),
        day_of_year.astype(np.int16),
    )


def read_variable(dataset, name: str, row_count: int) -> np.ndarray:
    variable = dataset.variables.get(name)
    if variable is None:
        return np.full(row_count, np.nan, dtype=np.float32)
    return np.asarray(variable[:], dtype=np.float32).reshape(-1)


def build_features(
    dataset,
    source: str,
    gauge_id: str,
    horizons: tuple[int, ...],
) -> tuple[pd.DataFrame, dict[int, np.ndarray], dict[int, np.ndarray], np.ndarray]:
    date_values, date_units = validate_daily_axis(dataset, source, gauge_id)
    row_count = len(date_values)
    flow = read_variable(dataset, "streamflow", row_count)
    targets: dict[int, np.ndarray] = {}
    target_day_of_year: dict[int, np.ndarray] = {}
    day_sin, day_cos, day_of_year = seasonal_features(date_values, date_units)
    for horizon in horizons:
        target = np.full(row_count, np.nan, dtype=np.float32)
        target_doy = np.full(row_count, -1, dtype=np.int16)
        if horizon < row_count:
            target[:-horizon] = flow[horizon:]
            target_doy[:-horizon] = day_of_year[horizon:]
        targets[horizon] = target
        target_day_of_year[horizon] = target_doy

    columns: dict[str, np.ndarray] = {
        f"flow_lag_{days}": lag(flow, days) for days in FLOW_LAGS
    }
    precipitation = read_variable(dataset, "total_precipitation_sum", row_count)
    columns.update(
        {f"precip_lag_{days}": lag(precipitation, days) for days in PRECIPITATION_LAGS}
    )
    for window in PRECIPITATION_WINDOWS:
        rolling_sum = np.zeros(row_count, dtype=np.float32)
        rolling_valid = np.ones(row_count, dtype=bool)
        for offset in range(window):
            values = lag(precipitation, offset)
            valid = np.isfinite(values)
            rolling_valid &= valid
            rolling_sum[valid] += values[valid]
        rolling_sum[~rolling_valid] = np.nan
        columns[f"precip_sum_{window}d"] = rolling_sum

    for name in METEOROLOGY_FEATURES:
        if name in dataset.variables:
            columns[name] = read_variable(dataset, name, row_count)

    columns["day_of_year_sin"] = day_sin
    columns["day_of_year_cos"] = day_cos
    columns["day_of_year"] = day_of_year.astype(np.float32)
    return pd.DataFrame(columns), targets, target_day_of_year, flow


def sample_rows(
    source: str,
    gauge_id: str,
    candidates: np.ndarray,
    row_cap: int,
    partition: str,
    seed: int,
) -> np.ndarray:
    digest = hashlib.sha256(
        f"{seed}:{partition}:{source}:{gauge_id}".encode("utf-8")
    ).digest()
    rng = np.random.default_rng(int.from_bytes(digest[:8], "little"))
    candidates = np.asarray(candidates, dtype=np.int32)
    if candidates.size > row_cap:
        return np.sort(rng.choice(candidates, size=row_cap, replace=False))
    return candidates


def basin_scores(target: np.ndarray, prediction: np.ndarray) -> dict:
    residual = target - prediction
    denominator = float(np.sum((target - np.mean(target)) ** 2))
    target_std = float(np.std(target))
    prediction_std = float(np.std(prediction))
    target_mean = float(np.mean(target))
    prediction_mean = float(np.mean(prediction))
    correlation = None
    kge = None
    if target_std > 0.0 and prediction_std > 0.0:
        correlation = float(
            np.mean((target - target_mean) * (prediction - prediction_mean))
            / (target_std * prediction_std)
        )
    if correlation is not None and target_std > 0.0 and abs(target_mean) > 1e-8:
        variability_ratio = prediction_std / target_std
        mean_ratio = prediction_mean / target_mean
        kge = float(
            1.0
            - np.sqrt(
                (correlation - 1.0) ** 2
                + (variability_ratio - 1.0) ** 2
                + (mean_ratio - 1.0) ** 2
            )
        )
    return {
        "rmse": float(np.sqrt(np.mean(residual**2))),
        "mae": float(np.mean(np.abs(residual))),
        "nse": (
            float(1.0 - np.sum(residual**2) / denominator) if denominator > 0 else None
        ),
        "nse_denominator_sst": denominator,
        "kge": kge,
    }


def aggregate_metrics(
    frame: pd.DataFrame,
    prediction: np.ndarray,
    label: str,
    minimum_catchment_rows: int = MIN_CATCHMENT_METRIC_ROWS,
) -> tuple[dict, list[dict]]:
    target = frame["target"].to_numpy(dtype=np.float64)
    metrics = basin_scores(target, prediction)
    by_catchment: list[dict] = []
    paired = frame.assign(prediction=prediction)
    for (source, gauge_id), group in paired.groupby(["source", "gauge_id"], sort=True):
        basin_target = group["target"].to_numpy(dtype=np.float64)
        basin_prediction = group["prediction"].to_numpy(dtype=np.float64)
        if basin_target.size == 0:
            continue
        by_catchment.append(
            {
                "source": source,
                "gauge_id": gauge_id,
                "rows": int(basin_target.size),
                **basin_scores(basin_target, basin_prediction),
            }
        )

    all_nse = [row["nse"] for row in by_catchment if row["nse"] is not None]
    all_kge = [row["kge"] for row in by_catchment if row["kge"] is not None]
    supported = [
        row
        for row in by_catchment
        if row["rows"] >= minimum_catchment_rows and row["nse"] is not None
    ]
    nse_values = [row["nse"] for row in supported]
    kge_values = [row["kge"] for row in supported if row["kge"] is not None]

    def quantiles(values: list[float]) -> dict[str, float | None]:
        if not values:
            return {"p10": None, "p25": None, "p50": None, "p75": None, "p90": None}
        return {
            key: float(np.quantile(values, quantile))
            for key, quantile in (
                ("p10", 0.10),
                ("p25", 0.25),
                ("p50", 0.50),
                ("p75", 0.75),
                ("p90", 0.90),
            )
        }

    supported_sse = 0.0
    supported_sst = 0.0
    within_sst = 0.0
    for _, group in paired.groupby(["source", "gauge_id"], sort=False):
        basin_target = group["target"].to_numpy(dtype=np.float64)
        basin_prediction = group["prediction"].to_numpy(dtype=np.float64)
        basin_sst = float(np.sum((basin_target - np.mean(basin_target)) ** 2))
        within_sst += basin_sst
        if basin_target.size >= minimum_catchment_rows and basin_sst > 0.0:
            supported_sse += float(np.sum((basin_target - basin_prediction) ** 2))
            supported_sst += basin_sst

    global_sst = float(np.sum((target - np.mean(target)) ** 2))
    between_sst = max(0.0, global_sst - within_sst)
    metrics.update(
        {
            "pooled_nse_global_mean": metrics["nse"],
            "pooled_kge_global_rows": metrics["kge"],
            "median_catchment_nse": (
                float(np.median(nse_values)) if nse_values else None
            ),
            "mean_catchment_nse": (float(np.mean(nse_values)) if nse_values else None),
            "median_catchment_kge": (
                float(np.median(kge_values)) if kge_values else None
            ),
            "mean_catchment_kge": (float(np.mean(kge_values)) if kge_values else None),
            "catchment_nse_quantiles": quantiles(nse_values),
            "catchment_kge_quantiles": quantiles(kge_values),
            "negative_nse_catchments": sum(value < 0 for value in nse_values),
            "negative_nse_catchment_fraction": (
                float(np.mean(np.asarray(nse_values) < 0)) if nse_values else None
            ),
            "median_catchment_nse_all": (
                float(np.median(all_nse)) if all_nse else None
            ),
            "median_catchment_kge_all": (
                float(np.median(all_kge)) if all_kge else None
            ),
            "basin_centered_nse": (
                float(1.0 - supported_sse / supported_sst)
                if supported_sst > 0.0
                else None
            ),
            "basin_centered_catchments": len(supported),
            "minimum_rows_for_catchment_metrics": minimum_catchment_rows,
            "catchments_scored": len(supported),
            "catchments_scored_all_rows": len(by_catchment),
            "catchments_with_valid_nse": len(nse_values),
            "catchments_with_valid_kge": len(kge_values),
            "catchments_below_minimum_rows": sum(
                row["rows"] < minimum_catchment_rows for row in by_catchment
            ),
            "global_sst": global_sst,
            "within_catchment_sst": within_sst,
            "between_catchment_sst": between_sst,
            "between_catchment_sst_fraction": (
                float(between_sst / global_sst) if global_sst > 0 else None
            ),
            "rows_scored": int(target.size),
            "prediction": label,
        }
    )
    return metrics, by_catchment


def fit_source_climatology(train_frame: pd.DataFrame) -> dict[str, np.ndarray]:
    daily_means = train_frame.groupby(["source", "target_day_of_year"], observed=True)[
        "target"
    ].mean()
    climatology: dict[str, np.ndarray] = {}
    days = np.arange(1, 367, dtype=np.float64)
    for source in train_frame["source"].unique():
        values = np.full(366, np.nan, dtype=np.float64)
        if source in daily_means.index.get_level_values("source"):
            source_values = daily_means.xs(source, level="source")
            for day, value in source_values.items():
                if 1 <= int(day) <= 366:
                    values[int(day) - 1] = float(value)
        valid = np.flatnonzero(np.isfinite(values))
        if not valid.size:
            fallback = float(
                train_frame.loc[train_frame.source == source, "target"].mean()
            )
            values.fill(fallback)
        else:
            known_days = valid.astype(np.float64) + 1.0
            known_values = values[valid]
            extended_days = np.concatenate(
                [known_days - 366.0, known_days, known_days + 366.0]
            )
            extended_values = np.tile(known_values, 3)
            values = np.interp(days, extended_days, extended_values)
            extended = np.concatenate([values[-15:], values, values[:15]])
            values = np.convolve(extended, np.ones(31) / 31.0, mode="valid")
        climatology[source] = values.astype(np.float32)
    return climatology


def predict_source_climatology(
    frame: pd.DataFrame, climatology: dict[str, np.ndarray]
) -> np.ndarray:
    prediction = np.empty(len(frame), dtype=np.float32)
    sources = frame["source"].to_numpy()
    days = frame["target_day_of_year"].to_numpy(dtype=np.int16)
    for source in np.unique(sources):
        mask = sources == source
        values = climatology.get(source)
        if values is None:
            prediction[mask] = 0.0
        else:
            indices = np.clip(days[mask] - 1, 0, 365)
            prediction[mask] = values[indices]
    return np.maximum(prediction, 0.0)


def source_event_thresholds(train_frame: pd.DataFrame) -> dict[str, float]:
    groups = train_frame.groupby(["source", "gauge_id"], observed=True)["target"]
    counts = groups.size()
    eligible = counts[counts >= MIN_CATCHMENT_METRIC_ROWS].index
    per_catchment = groups.quantile(EVENT_QUANTILE).loc[eligible]
    per_source = per_catchment.groupby(level="source", observed=True).median()
    thresholds = {str(source): float(value) for source, value in per_source.items()}
    for source in train_frame["source"].unique():
        if source not in thresholds:
            source_values = train_frame.loc[train_frame["source"] == source, "target"]
            thresholds[str(source)] = float(source_values.quantile(EVENT_QUANTILE))
    return thresholds


def equal_catchment_weights(frame: pd.DataFrame) -> np.ndarray:
    counts = (
        frame.groupby(["source", "gauge_id"], observed=True)["target"]
        .transform("count")
        .to_numpy(dtype=np.float64)
    )
    weights = 1.0 / np.maximum(counts, 1.0)
    weights *= weights.size / np.sum(weights)
    return weights.astype(np.float32)


def event_labels(frame: pd.DataFrame, thresholds: dict[str, float]) -> np.ndarray:
    limits = frame["source"].map(thresholds).to_numpy(dtype=np.float64)
    if not np.all(np.isfinite(limits)):
        raise ValueError("Missing training-derived event threshold for a source")
    return (frame["target"].to_numpy(dtype=np.float64) > limits).astype(np.int8)


def contingency_metrics(labels: np.ndarray, predicted: np.ndarray) -> dict:
    labels = np.asarray(labels, dtype=bool)
    predicted = np.asarray(predicted, dtype=bool)
    hits = int(np.count_nonzero(labels & predicted))
    misses = int(np.count_nonzero(labels & ~predicted))
    false_alarms = int(np.count_nonzero(~labels & predicted))
    correct_negatives = int(np.count_nonzero(~labels & ~predicted))
    precision_denominator = hits + false_alarms
    event_denominator = hits + misses
    union = hits + misses + false_alarms
    f1_denominator = 2 * hits + misses + false_alarms
    return {
        "hits": hits,
        "misses": misses,
        "false_alarms": false_alarms,
        "correct_negatives": correct_negatives,
        "precision": hits / precision_denominator if precision_denominator else None,
        "probability_of_detection": (
            hits / event_denominator if event_denominator else None
        ),
        "false_alarm_ratio": (
            false_alarms / precision_denominator if precision_denominator else None
        ),
        "critical_success_index": hits / union if union else None,
        "f1": 2 * hits / f1_denominator if f1_denominator else None,
        "event_prevalence": float(np.mean(labels)) if labels.size else None,
        "predicted_event_rate": float(np.mean(predicted)) if predicted.size else None,
    }


def ranking_metrics(
    labels: np.ndarray, probabilities: np.ndarray
) -> tuple[float | None, float | None]:
    positives = int(np.sum(labels))
    negatives = len(labels) - positives
    if positives == 0 or negatives == 0:
        return None, None
    ranks = pd.Series(probabilities).rank(method="average").to_numpy(dtype=np.float64)
    auc = float(
        (np.sum(ranks[labels == 1]) - positives * (positives + 1) / 2)
        / (positives * negatives)
    )
    order = np.argsort(-probabilities, kind="mergesort")
    sorted_labels = labels[order]
    precision = np.cumsum(sorted_labels) / np.arange(1, len(labels) + 1)
    average_precision = float(np.sum(precision[sorted_labels == 1]) / positives)
    return auc, average_precision


def probability_metrics(
    labels: np.ndarray,
    probabilities: np.ndarray,
    reference_probabilities: np.ndarray,
) -> dict:
    labels = np.asarray(labels, dtype=np.float64)
    probabilities = np.clip(np.asarray(probabilities, dtype=np.float64), 1e-7, 1 - 1e-7)
    reference_probabilities = np.clip(
        np.asarray(reference_probabilities, dtype=np.float64), 1e-7, 1 - 1e-7
    )
    brier = float(np.mean((probabilities - labels) ** 2))
    reference_brier = float(np.mean((reference_probabilities - labels) ** 2))
    logloss = float(
        -np.mean(
            labels * np.log(probabilities) + (1 - labels) * np.log(1 - probabilities)
        )
    )
    reference_logloss = float(
        -np.mean(
            labels * np.log(reference_probabilities)
            + (1 - labels) * np.log(1 - reference_probabilities)
        )
    )
    auc, average_precision = ranking_metrics(labels.astype(np.int8), probabilities)
    bin_ids = np.minimum((probabilities * 10).astype(int), 9)
    reliability_bins = []
    ece = 0.0
    for bin_id in range(10):
        mask = bin_ids == bin_id
        if not np.any(mask):
            continue
        mean_probability = float(np.mean(probabilities[mask]))
        observed_rate = float(np.mean(labels[mask]))
        ece += float(np.mean(mask)) * abs(mean_probability - observed_rate)
        reliability_bins.append(
            {
                "lower": bin_id / 10,
                "upper": (bin_id + 1) / 10,
                "count": int(np.sum(mask)),
                "mean_probability": mean_probability,
                "observed_rate": observed_rate,
            }
        )
    return {
        "brier_score": brier,
        "reference_brier_score": reference_brier,
        "brier_skill_score": (
            float(1.0 - brier / reference_brier) if reference_brier > 0 else None
        ),
        "log_loss": logloss,
        "reference_log_loss": reference_logloss,
        "roc_auc": auc,
        "average_precision": average_precision,
        "expected_calibration_error_10_bins": ece,
        "reliability_bins": reliability_bins,
        "rows_scored": int(labels.size),
    }


def compare_by_source(
    frame: pd.DataFrame,
    predictions: dict[str, np.ndarray],
) -> dict:
    result = {}
    sources = frame["source"].to_numpy()
    for source in sorted(set(sources)):
        mask = sources == source
        source_frame = frame.loc[mask].reset_index(drop=True)
        result[source] = {}
        for name, prediction in predictions.items():
            source_metrics, _ = aggregate_metrics(source_frame, prediction[mask], name)
            result[source][name] = source_metrics
    return result


def merge_catchment_scores(
    horizon: int,
    rows_by_prediction: dict[str, list[dict]],
) -> list[dict]:
    lookups = {
        name: {(row["source"], row["gauge_id"]): row for row in rows}
        for name, rows in rows_by_prediction.items()
    }
    merged = []
    keys = set().union(*(set(lookup) for lookup in lookups.values()))
    for key in sorted(keys):
        row = {"horizon_days": horizon, "source": key[0], "gauge_id": key[1]}
        basin_rows = [lookup[key] for lookup in lookups.values() if key in lookup]
        row["rows"] = basin_rows[0]["rows"] if basin_rows else 0
        for name, lookup in lookups.items():
            scores = lookup.get(key, {})
            prefix = {
                "persistence": "persistence",
                "source_doy_climatology": "climatology",
                "catboost_residual": "model",
            }.get(name, name)
            for metric in ("rmse", "mae", "nse", "kge", "nse_denominator_sst"):
                row[f"{prefix}_{metric}"] = scores.get(metric)
        merged.append(row)
    return merged


def main() -> None:
    config = load_config()
    horizons = tuple(config["horizons_days"])
    max_horizon = max(horizons)
    archive = FINAL_ARCHIVE if FINAL_ARCHIVE.exists() else PARTIAL_ARCHIVE
    if not archive.exists():
        raise SystemExit(f"Caravan archive not found: {archive}")
    partial = (
        archive == PARTIAL_ARCHIVE or archive.stat().st_size != EXPECTED_ARCHIVE_SIZE
    )

    train_assignments, validation_assignments = read_split()
    train_filter = selected_catchments(train_assignments)
    validation_filter = selected_catchments(validation_assignments)
    overlap = train_filter & validation_filter
    if overlap:
        raise SystemExit(f"Split leakage: {len(overlap)} catchments overlap")

    static_attributes, static_feature_names = load_static_attributes()
    print(
        f"Loaded static attributes for {len(static_attributes):,} catchments; "
        f"using {len(static_feature_names)} numeric fields",
        flush=True,
    )
    print(
        f"Archive: {archive.name} ({archive.stat().st_size:,} bytes; "
        f"{'partial' if partial else 'expected size'})",
        flush=True,
    )
    print(
        f"Selected {len(train_filter):,} train and "
        f"{len(validation_filter):,} public-validation catchments; "
        f"horizons={horizons}",
        flush=True,
    )

    train_feature_frames: list[pd.DataFrame] = []
    validation_feature_frames: list[pd.DataFrame] = []
    train_targets = {horizon: [] for horizon in horizons}
    validation_targets = {horizon: [] for horizon in horizons}
    train_target_days = {horizon: [] for horizon in horizons}
    validation_target_days = {horizon: [] for horizon in horizons}
    train_flows: list[np.ndarray] = []
    validation_flows: list[np.ndarray] = []
    train_sources: list[str] = []
    validation_sources: list[str] = []
    train_gauges: list[str] = []
    validation_gauges: list[str] = []
    found_train: set[tuple[str, str]] = set()
    found_validation: set[tuple[str, str]] = set()
    processed_catchments = 0

    for source, gauge_id, dataset in iter_netcdf(
        archive,
        gauge_filter=train_filter | validation_filter,
        allow_partial=partial,
    ):
        processed_catchments += 1
        if processed_catchments % 500 == 0:
            print(
                f"Read {processed_catchments:,} selected catchment files",
                flush=True,
            )
        key = (source, gauge_id)
        partition = "train" if key in train_filter else "public_validation"
        features, targets, target_days, flow = build_features(
            dataset, source, gauge_id, horizons
        )
        usable_count = max(0, flow.size - max_horizon)
        row_cap = (
            config["train_rows_per_catchment"]
            if partition == "train"
            else config["validation_rows_per_catchment"]
        )
        valid_origin = np.isfinite(flow[:usable_count]) & (flow[:usable_count] >= 0)
        candidates = np.flatnonzero(valid_origin)
        indices = sample_rows(
            source,
            gauge_id,
            candidates,
            row_cap,
            partition,
            config["seed"],
        )
        if not indices.size:
            continue
        selected_features = features.iloc[indices].reset_index(drop=True)
        selected_features = attach_static_attributes(
            selected_features, static_attributes.get(key), static_feature_names
        )

        if partition == "train":
            train_feature_frames.append(selected_features)
            train_flows.append(flow[indices])
            train_sources.extend([source] * len(indices))
            train_gauges.extend([gauge_id] * len(indices))
            for horizon in horizons:
                train_targets[horizon].append(targets[horizon][indices])
                train_target_days[horizon].append(target_days[horizon][indices])
            found_train.add(key)
        else:
            validation_feature_frames.append(selected_features)
            validation_flows.append(flow[indices])
            validation_sources.extend([source] * len(indices))
            validation_gauges.extend([gauge_id] * len(indices))
            for horizon in horizons:
                validation_targets[horizon].append(targets[horizon][indices])
                validation_target_days[horizon].append(target_days[horizon][indices])
            found_validation.add(key)

    if not train_feature_frames or not validation_feature_frames:
        raise SystemExit(
            "Insufficient catchments in available archive prefix: "
            f"train={len(found_train)}, validation={len(found_validation)}"
        )

    X_train = pd.concat(train_feature_frames, ignore_index=True)
    X_train["source"] = train_sources
    X_validation = pd.concat(validation_feature_frames, ignore_index=True)
    X_validation["source"] = validation_sources
    q_train = np.concatenate(train_flows).astype(np.float32)
    q_validation = np.concatenate(validation_flows).astype(np.float32)
    print(
        f"Loaded {len(found_train):,} train and "
        f"{len(found_validation):,} public-validation catchments",
        flush=True,
    )

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    model_config = config["model"]
    horizon_results: dict[str, dict] = {}
    catchment_results: list[dict] = []
    date_axis_catchments_validated = processed_catchments

    for horizon in horizons:
        y_train = np.concatenate(train_targets[horizon]).astype(np.float32)
        y_validation = np.concatenate(validation_targets[horizon]).astype(np.float32)
        doy_train = np.concatenate(train_target_days[horizon]).astype(np.int16)
        doy_validation = np.concatenate(validation_target_days[horizon]).astype(
            np.int16
        )
        train_mask = np.isfinite(y_train) & (y_train >= 0)
        validation_mask = np.isfinite(y_validation) & (y_validation >= 0)
        if not np.any(train_mask) or not np.any(validation_mask):
            raise SystemExit(f"No usable rows for the {horizon}-day horizon")

        X_train_horizon = X_train.loc[train_mask]
        X_validation_horizon = X_validation.loc[validation_mask]
        target_train = y_train[train_mask]
        flow_train = q_train[train_mask]
        target_validation = y_validation[validation_mask]
        flow_validation = q_validation[validation_mask]
        train_frame = pd.DataFrame(
            {
                "source": np.asarray(train_sources)[train_mask],
                "gauge_id": np.asarray(train_gauges)[train_mask],
                "target": target_train,
                "target_day_of_year": doy_train[train_mask],
            }
        )
        validation_frame = pd.DataFrame(
            {
                "source": np.asarray(validation_sources)[validation_mask],
                "gauge_id": np.asarray(validation_gauges)[validation_mask],
                "target": target_validation,
                "target_day_of_year": doy_validation[validation_mask],
            }
        )
        train_weights = equal_catchment_weights(train_frame)

        print(
            f"Training {horizon}-day model on {len(target_train):,} rows; "
            f"validating on {len(target_validation):,} rows",
            flush=True,
        )
        model = CatBoostRegressor(
            loss_function="RMSE",
            iterations=int(model_config["iterations"]),
            depth=int(model_config["depth"]),
            learning_rate=float(model_config["learning_rate"]),
            l2_leaf_reg=float(model_config["l2_leaf_reg"]),
            random_seed=int(config["seed"]),
            thread_count=int(model_config["thread_count"]),
            verbose=100,
            allow_writing_files=False,
        )
        model.fit(
            X_train_horizon,
            np.arcsinh(target_train) - np.arcsinh(flow_train),
            cat_features=["source"],
            sample_weight=train_weights,
        )
        transformed_prediction = np.arcsinh(flow_validation) + model.predict(
            X_validation_horizon
        )
        prediction = np.sinh(np.clip(transformed_prediction, -20.0, 20.0))
        prediction = np.maximum(0.0, prediction)
        climatology = fit_source_climatology(train_frame)
        climatology_prediction = predict_source_climatology(
            validation_frame, climatology
        )
        point_predictions = {
            "persistence": flow_validation,
            "climatology": climatology_prediction,
            "model": prediction,
        }
        point_metrics: dict[str, dict] = {}
        point_rows: dict[str, list[dict]] = {}
        for name, values in point_predictions.items():
            label = {
                "persistence": "persistence: streamflow(t)",
                "climatology": "source-level day-of-year climatology",
                "model": (
                    "equal-catchment-weighted asinh residual CatBoost "
                    "with static attributes"
                ),
            }[name]
            point_metrics[name], point_rows[name] = aggregate_metrics(
                validation_frame, values, label
            )
        source_metrics = compare_by_source(validation_frame, point_predictions)
        catchment_results.extend(merge_catchment_scores(horizon, point_rows))

        thresholds = source_event_thresholds(train_frame)
        train_event_labels = event_labels(train_frame, thresholds)
        validation_event_labels = event_labels(validation_frame, thresholds)
        event_train_frame = pd.DataFrame(
            {"source": train_frame["source"], "event": train_event_labels}
        )
        training_event_rates = {
            str(source): float(rate)
            for source, rate in event_train_frame.groupby("source", observed=True)[
                "event"
            ]
            .mean()
            .items()
        }
        reference_probabilities = (
            validation_frame["source"]
            .map(training_event_rates)
            .to_numpy(dtype=np.float64)
        )
        event_metrics: dict[str, dict] = {
            "definition": (
                "Source-specific high-flow event: target exceeds the median "
                "per-training-catchment 90th percentile; thresholds use training data only."
            ),
            "threshold_by_source_mm_day": thresholds,
            "training_event_rate_by_source": training_event_rates,
            "persistence_point_forecast": contingency_metrics(
                validation_event_labels,
                flow_validation > validation_frame["source"].map(thresholds).to_numpy(),
            ),
            "regression_point_forecast": contingency_metrics(
                validation_event_labels,
                prediction > validation_frame["source"].map(thresholds).to_numpy(),
            ),
            "by_source": {},
        }

        event_classifier = None
        classifier_probabilities = None
        if np.unique(train_event_labels).size == 2:
            event_classifier = CatBoostClassifier(
                loss_function="Logloss",
                iterations=min(
                    EVENT_CLASSIFIER_ITERATIONS, int(model_config["iterations"])
                ),
                depth=EVENT_CLASSIFIER_DEPTH,
                learning_rate=float(model_config["learning_rate"]),
                l2_leaf_reg=float(model_config["l2_leaf_reg"]),
                random_seed=int(config["seed"]),
                thread_count=int(model_config["thread_count"]),
                verbose=100,
                allow_writing_files=False,
            )
            print(
                f"Training {horizon}-day event classifier on "
                f"{len(train_event_labels):,} rows; "
                f"training prevalence={np.mean(train_event_labels):.3f}",
                flush=True,
            )
            event_classifier.fit(
                X_train_horizon,
                train_event_labels,
                cat_features=["source"],
                sample_weight=train_weights,
            )
            probability_columns = list(event_classifier.classes_)
            positive_column = probability_columns.index(1)
            classifier_probabilities = event_classifier.predict_proba(
                X_validation_horizon
            )[:, positive_column]
            event_metrics["classifier_probability"] = probability_metrics(
                validation_event_labels,
                classifier_probabilities,
                reference_probabilities,
            )
            event_metrics["classifier_at_probability_0_5"] = contingency_metrics(
                validation_event_labels, classifier_probabilities >= 0.5
            )
            event_model_path = MODEL_DIR / f"caravan_highflow_h{horizon}d.cbm"
            event_classifier.save_model(str(event_model_path))
        else:
            event_metrics["classifier_probability"] = None
            event_metrics["classifier_at_probability_0_5"] = None

        validation_limits = validation_frame["source"].map(thresholds).to_numpy()
        validation_reference = np.asarray(reference_probabilities)
        for source in sorted(validation_frame["source"].unique()):
            mask = validation_frame["source"].to_numpy() == source
            source_event = validation_event_labels[mask]
            source_result = {
                "persistence_point_forecast": contingency_metrics(
                    source_event, flow_validation[mask] > validation_limits[mask]
                ),
                "regression_point_forecast": contingency_metrics(
                    source_event, prediction[mask] > validation_limits[mask]
                ),
            }
            if classifier_probabilities is not None:
                source_result["classifier_at_probability_0_5"] = contingency_metrics(
                    source_event, classifier_probabilities[mask] >= 0.5
                )
                source_result["classifier_probability"] = probability_metrics(
                    source_event,
                    classifier_probabilities[mask],
                    validation_reference[mask],
                )
            event_metrics["by_source"][source] = source_result

        horizon_results[str(horizon)] = {
            "target": f"streamflow(t+{horizon})",
            "train_rows": int(target_train.size),
            "validation": point_metrics["model"]["rows_scored"],
            "baseline": point_metrics["persistence"],
            "baselines": {
                "persistence": point_metrics["persistence"],
                "source_doy_climatology": point_metrics["climatology"],
            },
            "model": point_metrics["model"],
            "by_source": source_metrics,
            "events_and_probabilities": event_metrics,
        }

        model_path = MODEL_DIR / f"caravan_streamflow_h{horizon}d.cbm"
        model.save_model(str(model_path))
        del model
        print(
            f"{horizon}-day RMSE: "
            f"persistence {point_metrics['persistence']['rmse']:.4f}; "
            f"climatology {point_metrics['climatology']['rmse']:.4f}; "
            f"CatBoost {point_metrics['model']['rmse']:.4f}; "
            f"median basin NSE/KGE="
            f"{point_metrics['model']['median_catchment_nse']}/"
            f"{point_metrics['model']['median_catchment_kge']}",
            flush=True,
        )
        if event_classifier is not None:
            print(
                f"{horizon}-day event Brier="
                f"{event_metrics['classifier_probability']['brier_score']:.4f}; "
                f"Brier skill="
                f"{event_metrics['classifier_probability']['brier_skill_score']}",
                flush=True,
            )

    pd.DataFrame(catchment_results).to_csv(
        REPORT_DIR / "per_catchment_metrics.csv", index=False
    )
    train_counts = Counter(train_sources)
    validation_counts = Counter(validation_sources)
    metrics = {
        "task": "multi-horizon streamflow forecast in mm/day",
        "forecast_origin": "end of day t; predictors only through day t",
        "horizons_days": list(horizons),
        "archive": archive.name,
        "archive_bytes_at_run": archive.stat().st_size,
        "archive_partial_at_run": partial,
        "expected_archive_bytes": EXPECTED_ARCHIVE_SIZE,
        "split_manifest": str(SPLIT_PATH.relative_to(PROJECT_ROOT)),
        "split_note": (
            "Organizer-proposed public catchment split; "
            "not an official challenge leaderboard."
        ),
        "train_catchments_used": len(found_train),
        "validation_catchments_used": len(found_validation),
        "train_catchments_in_manifest": len(train_filter),
        "validation_catchments_in_manifest": len(validation_filter),
        "date_axis_validation": (
            "Every selected catchment was required to have a strictly increasing, "
            "consecutive daily date coordinate before row-offset forecasting."
        ),
        "selected_date_axis_catchments_validated": date_axis_catchments_validated,
        "static_attribute_features": static_feature_names,
        "static_attribute_note": (
            "Uses Caravan climate attributes, selected HydroATLAS climate/terrain/soil "
            "fields, area, and coordinates. HydroATLAS discharge and runoff summaries "
            "are excluded to avoid target leakage."
        ),
        "training_target_transform": (
            "asinh(streamflow(t+h)) - asinh(streamflow(t)); inverse transform at inference"
        ),
        "training_row_weighting": (
            "Each catchment has equal total weight within each horizon, independent "
            "of how many valid rows it contributes."
        ),
        "train_rows_by_source": dict(sorted(train_counts.items())),
        "validation_rows_by_source": dict(sorted(validation_counts.items())),
        "row_sampling": (
            "Deterministic uniform sample from valid, nonnegative streamflow "
            "forecast origins; validity is applied before per-catchment caps."
        ),
        "train_rows_per_catchment_cap": config["train_rows_per_catchment"],
        "validation_rows_per_catchment_cap": config["validation_rows_per_catchment"],
        "catchment_metric_minimum_rows": MIN_CATCHMENT_METRIC_ROWS,
        "metric_notes": [
            "Pooled NSE/KGE use all scored rows and one global target mean.",
            "Basin-centered NSE sums within-catchment errors and variance, avoiding between-basin mean differences in its denominator.",
            "Median per-catchment NSE/KGE use basins with at least 30 scored rows; all-basin medians and excluded counts are reported too.",
            "Very negative per-catchment NSE values can occur when observed flow variance is near zero; they are retained in per-catchment outputs rather than clipped.",
        ],
        "event_classifier_config": {
            "iterations": min(
                EVENT_CLASSIFIER_ITERATIONS, int(model_config["iterations"])
            ),
            "depth": EVENT_CLASSIFIER_DEPTH,
            "probability_threshold_for_event_metrics": 0.5,
        },
        "validation_protocol": (
            "Catchments are held out by the provided manifest; no validation-based "
            "early stopping or threshold tuning is performed. Climatology and event "
            "thresholds are fit using training catchments only."
        ),
        "features": list(X_train.columns),
        "model_config": model_config,
        "seed": config["seed"],
        "horizons": horizon_results,
    }
    with (REPORT_DIR / "benchmark_metrics.json").open("w", encoding="utf-8") as handle:
        json.dump(metrics, handle, indent=2, allow_nan=False)

    print(f"Saved models under {MODEL_DIR}", flush=True)
    print(f"Saved metrics under {REPORT_DIR}", flush=True)
    if partial:
        print(
            "NOTE: archive is partial; the finalizer will rerun after checksum verification.",
            flush=True,
        )


if __name__ == "__main__":
    main()
