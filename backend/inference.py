from __future__ import annotations

import math
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

os.environ.setdefault("LOKY_MAX_CPU_COUNT", str(os.cpu_count() or 1))

import numpy as np
import pandas as pd
from catboost import CatBoostRegressor
from backend.fimo_models import FimoModelSuite, build_fimo_custom_features, build_fimo_features

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from backend.models import (
        Catchment,
        CustomForecastResult,
        CustomModelInputs,
        ForecastInputs,
        ForecastOutput,
        ForecastPoint,
        ForecastResult,
        PredictionIntervals,
        RiskLevel,
    )
except ImportError:
    from models import (
        Catchment,
        CustomForecastResult,
        CustomModelInputs,
        ForecastInputs,
        ForecastOutput,
        ForecastPoint,
        ForecastResult,
        PredictionIntervals,
        RiskLevel,
    )

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = PROJECT_ROOT / "models"

# Forecast horizons supported
HORIZONS = [1, 3, 7]


class CatBoostForecastEngine:
    def __init__(self) -> None:
        self.models: dict[int, CatBoostRegressor] = {}
        self.feature_names: list[str] = []
        try:
            self.fimo = FimoModelSuite()
            print(f"Loaded FIMO bundle from {self.fimo_bundle_path}")
        except Exception as exc:
            self.fimo = None
            print(f"Warning: Failed to load FIMO bundle: {exc}")
        self.load_models()

    @property
    def fimo_bundle_path(self) -> Path:
        return PROJECT_ROOT / "fimo" / "fimo_bundle.joblib"

    def load_models(self) -> None:
        """Load trained CatBoost models for available horizons."""
        for h in [1, 3, 5]:
            path = MODEL_DIR / f"caravan_streamflow_h{h}d.cbm"
            if path.exists():
                try:
                    model = CatBoostRegressor()
                    model.load_model(str(path))
                    self.models[h] = model
                    if not self.feature_names and hasattr(model, "feature_names_") and model.feature_names_:
                        self.feature_names = list(model.feature_names_)
                    print(f"Loaded CatBoost model for {h}-day horizon from {path}")
                except Exception as e:
                    print(f"Warning: Failed to load model for {h}-day horizon: {e}")
            else:
                print(f"Warning: Model file not found: {path}")

    def is_ready(self) -> bool:
        return self.fimo is not None or len(self.models) > 0

    def build_features(
        self,
        catchment: Catchment,
        as_of_dt: date,
        inputs: ForecastInputs,
        history_flows: list[float],
    ) -> pd.DataFrame:
        """Build the exact 32 features required by the Caravan CatBoost models.

        Flows are converted to area-normalized runoff (mm/day) using catchment area:
        runoff (mm/day) = discharge (m3/s) * 86.4 / area (km2).
        """
        area = max(1.0, float(catchment.areaSqKm))
        m3s_to_mm = 86.4 / area

        # Normalized flows in mm/day
        flows_mm = [f * m3s_to_mm for f in history_flows] if history_flows else [2.0]
        q0 = flows_mm[-1] if flows_mm else 2.0

        def get_lag(arr: list[float], lag_days: int) -> float:
            idx = len(arr) - 1 - lag_days
            return arr[idx] if idx >= 0 else arr[0]

        flow_lags = {
            "flow_lag_0": q0,
            "flow_lag_1": get_lag(flows_mm, 1),
            "flow_lag_2": get_lag(flows_mm, 2),
            "flow_lag_3": get_lag(flows_mm, 3),
            "flow_lag_7": get_lag(flows_mm, 7),
            "flow_lag_14": get_lag(flows_mm, 14),
        }

        # Antecedent precip distributed across lags
        ant_rain = float(inputs.antecedentRainMm)
        precip_lags = {
            "precip_lag_0": ant_rain * 0.28,
            "precip_lag_1": ant_rain * 0.22,
            "precip_lag_2": ant_rain * 0.16,
            "precip_lag_3": ant_rain * 0.12,
            "precip_lag_7": ant_rain * 0.08,
            "precip_lag_14": ant_rain * 0.04,
            "precip_sum_3d": ant_rain * 0.66,
            "precip_sum_7d": ant_rain,
            "precip_sum_14d": ant_rain * 1.35,
        }

        # Meteorology features
        temp = float(inputs.tempC)
        dewpoint = temp - 3.5
        pet = max(0.5, 0.0023 * (temp + 17.8) * 15.0)

        # Day of year sine & cosine
        doy = as_of_dt.timetuple().tm_yday
        angle = 2.0 * math.pi * (doy - 1.0) / 365.2425
        doy_sin = math.sin(angle)
        doy_cos = math.cos(angle)

        # Source catchment group
        source = catchment.source if catchment.source else "camels"

        features: dict[str, Any] = {
            **flow_lags,
            **precip_lags,
            "potential_evaporation_sum_ERA5_LAND": pet,
            "potential_evaporation_sum_FAO_PENMAN_MONTEITH": pet * 0.95,
            "temperature_2m_mean": temp,
            "dewpoint_temperature_2m_mean": dewpoint,
            "snow_depth_water_equivalent_mean": 0.0,
            "surface_net_solar_radiation_mean": 180.0,
            "surface_net_thermal_radiation_mean": -45.0,
            "surface_pressure_mean": 95.0,
            "u_component_of_wind_10m_mean": 1.2,
            "v_component_of_wind_10m_mean": 0.8,
            "volumetric_soil_water_layer_1_mean": min(0.45, 0.18 + ant_rain * 0.0015),
            "volumetric_soil_water_layer_2_mean": min(0.45, 0.22 + ant_rain * 0.0012),
            "volumetric_soil_water_layer_3_mean": min(0.45, 0.25 + ant_rain * 0.0008),
            "volumetric_soil_water_layer_4_mean": min(0.45, 0.27 + ant_rain * 0.0005),
            "day_of_year_sin": doy_sin,
            "day_of_year_cos": doy_cos,
            "day_of_year": float(doy),
            "static_other_area": area,
            "static_other_gauge_lat": float(catchment.lat),
            "static_other_gauge_lon": float(catchment.lng),
            "static_hydroatlas_ele_mt_sav": float(catchment.elevMeanM),
            "static_hydroatlas_ele_mt_smn": max(0.0, float(catchment.elevMeanM) - 50.0),
            "static_hydroatlas_ele_mt_smx": float(catchment.elevMeanM) + 100.0,
            "source": source,
        }

        # Ensure all model features exist
        if self.feature_names:
            for col in self.feature_names:
                if col not in features:
                    features[col] = 0.0 if col != "source" else source
            return pd.DataFrame([features])[self.feature_names]

        return pd.DataFrame([features])

    def predict(
        self,
        catchment: Catchment,
        as_of: str,
        inputs: ForecastInputs,
        target_horizon: int,
        history_flows: list[float],
    ) -> ForecastResult:
        """Run ML inference for 1, 3, 7 days and build a complete ForecastResult."""
        try:
            as_of_dt = datetime.strptime(as_of, "%Y-%m-%d").date()
        except ValueError:
            as_of_dt = date.today()

        area = max(1.0, float(catchment.areaSqKm))
        mm_to_m3s = area / 86.4
        m3s_to_mm = 86.4 / area

        # Base observed flow (m3/s)
        q0_m3s = history_flows[-1] if history_flows else (catchment.thresholdHigh * 0.35)
        q0_mm = q0_m3s * m3s_to_mm

        # Build feature DataFrame
        features_df = self.build_features(catchment, as_of_dt, inputs, history_flows)

        # Base uncertainty multiplier from missingness & gaps
        gap_factor = 1.0 + 0.09 * inputs.gapDays
        quality_factor = 1.8 if inputs.quality == "missing" else (1.32 if inputs.quality == "degraded" else 1.0)
        base_sigma = (q0_m3s * 0.08 + catchment.thresholdHigh * 0.05) * gap_factor * quality_factor

        # Rain runoff response term: mm rainfall * runoff coefficient converted to m3/s
        runoff_coeff = 0.45
        rain_total_m3s = (float(inputs.forecastRainMm) * runoff_coeff) * mm_to_m3s

        # FIMO heads predict discharge directly in mm/day at the trained horizons.
        flow_history_mm = [flow * m3s_to_mm for flow in history_flows]
        fimo_features = build_fimo_features(flow_history_mm, inputs.antecedentRainMm, inputs.tempC, as_of_dt)
        fimo_predictions: dict[int, dict[str, float]] = {}
        if self.fimo is not None:
            for h in HORIZONS:
                try:
                    fimo_predictions[h] = self.fimo.predict(fimo_features, h)
                except Exception as err:
                    print(f"FIMO inference error on horizon {h}: {err}")

        predicted_q_by_h: dict[int, float] = {}
        for h in HORIZONS:
            if h in fimo_predictions:
                pred_m3s = fimo_predictions[h]["mean"] * mm_to_m3s
            elif {1: 1, 3: 3, 7: 5}[h] in self.models:
                try:
                    fallback_horizon = {1: 1, 3: 3, 7: 5}[h]
                    residual_mm = float(self.models[fallback_horizon].predict(features_df)[0])
                    pred_m3s = max(0.0, q0_mm + residual_mm) * mm_to_m3s
                except Exception as err:
                    print(f"Inference error on model h={h}: {err}")
                    pred_m3s = q0_m3s
            else:
                pred_m3s = q0_m3s
            predicted_q_by_h[h] = max(0.0, pred_m3s)

        target_horizons = list(HORIZONS)

        pred_discharges: list[float] = []
        p_high_list: list[float] = []
        p_ext_list: list[float] = []
        lowers: list[float] = []
        uppers: list[float] = []

        p_high_dict: dict[str, float] = {}
        p_ext_dict: dict[str, float] = {}

        t_high = max(1.0, float(catchment.thresholdHigh))
        t_ext = max(t_high * 1.15, float(catchment.thresholdExtreme))

        for h in target_horizons:
            qh = round(predicted_q_by_h.get(h, q0_m3s), 1)
            pred_discharges.append(qh)

            if h in fimo_predictions:
                model_result = fimo_predictions[h]
                lower = max(0.0, round(model_result["lower"] * mm_to_m3s, 1))
                upper = max(lower, round(model_result["upper"] * mm_to_m3s, 1))
                p_h = model_result["p_high"]
                p_e = model_result["p_ext"]
            else:
                band = base_sigma * math.sqrt(1.0 + h / 3.0)
                lower = max(0.0, round(qh - 1.28 * band, 1))
                upper = round(qh + 1.28 * band, 1)
                z_high = (qh - t_high) / (0.72 * max(1.0, band))
                z_ext = (qh - t_ext) / (0.72 * max(1.0, band))
                p_h = 1.0 / (1.0 + math.exp(-max(-8.0, min(8.0, z_high))))
                p_e = 1.0 / (1.0 + math.exp(-max(-8.0, min(8.0, z_ext))))
            lowers.append(lower)
            uppers.append(upper)
            p_h = round(float(np.clip(p_h, 0.005, 0.995)), 2)
            p_e = round(float(np.clip(p_e, 0.003, 0.985)), 2)

            p_high_list.append(p_h)
            p_ext_list.append(p_e)
            p_high_dict[str(h)] = p_h
            p_ext_dict[str(h)] = p_e

        # Daily trajectory (days 1..7), interpolated between trained horizons.
        series: list[ForecastPoint] = []
        for d in range(1, 8):
            dt = as_of_dt + timedelta(days=d)
            if d == 1:
                qd = predicted_q_by_h[1]
            elif d == 2:
                qd = (predicted_q_by_h[1] + predicted_q_by_h[3]) * 0.5
            elif d == 3:
                qd = predicted_q_by_h[3]
            elif d in (4, 5, 6):
                qd = predicted_q_by_h[3] + (predicted_q_by_h[7] - predicted_q_by_h[3]) * (d - 3) / 4
            else:
                qd = predicted_q_by_h[7]

            day_band = base_sigma * math.sqrt(1.0 + d / 3.0)
            d_low = max(0.0, round(qd - 1.28 * day_band, 1))
            d_up = round(qd + 1.28 * day_band, 1)
            series.append(
                ForecastPoint(
                    date=dt.strftime("%Y-%m-%d"),
                    discharge=round(qd, 1),
                    lower=d_low,
                    upper=d_up,
                )
            )

        # Risk classification based on the 7-day outlook.
        p7_high = p_high_dict["7"]
        q7_val = pred_discharges[-1]
        if p7_high >= 0.55 or q7_val >= t_high:
            risk: RiskLevel = "high"
        elif p7_high >= 0.25:
            risk = "watch"
        else:
            risk = "low"

        output = ForecastOutput(
            catchment_id=catchment.code,
            forecast_origin=f"{as_of}T00:00:00Z",
            forecast_horizons_days=target_horizons,
            predicted_discharge=pred_discharges,
            high_flow_probability=p_high_list,
            extreme_flow_probability=p_ext_list,
            prediction_intervals=PredictionIntervals(lower=lowers, upper=uppers),
        )

        return ForecastResult(
            catchmentId=catchment.id,
            asOf=as_of,
            horizon=target_horizon,
            source="fimo_gbm" if self.fimo is not None else "catboost_caravan",
            generatedAt=datetime.utcnow().isoformat() + "Z",
            output=output,
            series=series,
            risk=risk,
            pHigh=p_high_dict,
            pExt=p_ext_dict,
        )

    def predict_custom(self, inputs: CustomModelInputs) -> CustomForecastResult:
        """Run direct CatBoost inference from all 32 explicit model features."""
        # Feature names in the exact order required by the models
        feature_keys = [
            "flow_lag_0",
            "flow_lag_1",
            "flow_lag_2",
            "flow_lag_3",
            "flow_lag_7",
            "flow_lag_14",
            "precip_lag_0",
            "precip_lag_1",
            "precip_lag_2",
            "precip_lag_3",
            "precip_lag_7",
            "precip_lag_14",
            "precip_sum_3d",
            "precip_sum_7d",
            "precip_sum_14d",
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
            "day_of_year_sin",
            "day_of_year_cos",
            "source",
        ]

        # Extract features dictionary
        inputs_dict = inputs.model_dump()
        features_dict: dict[str, Any] = {k: inputs_dict.get(k) for k in feature_keys}
        features_dict["day_of_year"] = float(inputs_dict.get("day_of_year", 180.0))
        features_dict["static_other_area"] = float(inputs.areaSqKm)
        features_dict["static_other_gauge_lat"] = 45.0
        features_dict["static_other_gauge_lon"] = -70.0
        features_dict["static_hydroatlas_ele_mt_sav"] = 400.0

        if self.feature_names:
            for col in self.feature_names:
                if col not in features_dict:
                    features_dict[col] = 0.0 if col != "source" else features_dict.get("source", "camels")
            features_df = pd.DataFrame([features_dict])[self.feature_names]
        else:
            features_df = pd.DataFrame([features_dict])

        q0_mm = float(inputs.flow_lag_0)
        area = max(1.0, float(inputs.areaSqKm))
        mm_to_m3s = area / 86.4
        horizons = list(HORIZONS)

        origin_str = inputs.originDate or date.today().strftime("%Y-%m-%d")
        try:
            origin_dt = datetime.strptime(origin_str, "%Y-%m-%d").date()
        except ValueError:
            origin_dt = date.today()

        fimo_custom_predictions: dict[int, dict[str, float]] = {}
        if self.fimo is not None:
            model_features = build_fimo_custom_features(inputs.model_dump(), origin_dt)
            for horizon in horizons:
                fimo_custom_predictions[horizon] = self.fimo.predict(model_features, horizon)

        if fimo_custom_predictions:
            predicted_runoff_mm = [round(fimo_custom_predictions[h]["mean"], 2) for h in horizons]
            residuals_mm = [round(value - q0_mm, 2) for value in predicted_runoff_mm]
            predicted_discharge_m3s = [round(value * mm_to_m3s, 1) for value in predicted_runoff_mm]
        else:
            residuals_by_h = {
                1: float(self.models[1].predict(features_df)[0]) if 1 in self.models else 0.0,
                3: float(self.models[3].predict(features_df)[0]) if 3 in self.models else 0.0,
                7: float(self.models[5].predict(features_df)[0]) if 5 in self.models else 0.0,
            }
            residuals_mm = [round(residuals_by_h[h], 2) for h in horizons]
            predicted_runoff_mm = [round(max(0.0, q0_mm + residuals_by_h[h]), 2) for h in horizons]
            predicted_discharge_m3s = [round(value * mm_to_m3s, 1) for value in predicted_runoff_mm]

        t_high = float(inputs.thresholdHigh)
        t_ext = float(inputs.thresholdExtreme)
        base_sigma_m3s = max(2.0, (q0_mm * mm_to_m3s) * 0.12)
        lowers: list[float] = []
        uppers: list[float] = []
        p_high_list: list[float] = []
        p_ext_list: list[float] = []

        for idx, h in enumerate(horizons):
            qh_m3s = predicted_discharge_m3s[idx]
            if h in fimo_custom_predictions:
                model_result = fimo_custom_predictions[h]
                lowers.append(max(0.0, round(model_result["lower"] * mm_to_m3s, 1)))
                uppers.append(max(lowers[-1], round(model_result["upper"] * mm_to_m3s, 1)))
                p_high_list.append(round(float(np.clip(model_result["p_high"], 0.005, 0.995)), 2))
                p_ext_list.append(round(float(np.clip(model_result["p_ext"], 0.003, 0.985)), 2))
            else:
                band = base_sigma_m3s * math.sqrt(1.0 + h / 2.8)
                lowers.append(max(0.0, round(qh_m3s - 1.28 * band, 1)))
                uppers.append(round(qh_m3s + 1.28 * band, 1))
                z_high = (qh_m3s - t_high) / (0.72 * max(1.0, band))
                z_ext = (qh_m3s - t_ext) / (0.72 * max(1.0, band))
                ph = 1.0 / (1.0 + math.exp(-max(-8.0, min(8.0, z_high))))
                pe = 1.0 / (1.0 + math.exp(-max(-8.0, min(8.0, z_ext))))
                p_high_list.append(round(float(np.clip(ph, 0.005, 0.995)), 2))
                p_ext_list.append(round(float(np.clip(pe, 0.003, 0.985)), 2))

        # Risk level
        p_high_max = max(p_high_list)
        q_max = max(predicted_discharge_m3s)
        if p_high_max >= 0.55 or q_max >= t_high:
            risk: RiskLevel = "high"
        elif p_high_max >= 0.25:
            risk = "watch"
        else:
            risk = "low"

        # Daily path is interpolated between the 1-, 3-, and 7-day model outputs.
        series: list[ForecastPoint] = []
        for d in range(1, 8):
            dt = origin_dt + timedelta(days=d)
            if d == 1:
                qd_m3s = predicted_discharge_m3s[0]
            elif d == 2:
                qd_m3s = (predicted_discharge_m3s[0] + predicted_discharge_m3s[1]) * 0.5
            elif d == 3:
                qd_m3s = predicted_discharge_m3s[1]
            elif d in (4, 5, 6):
                qd_m3s = predicted_discharge_m3s[1] + (predicted_discharge_m3s[2] - predicted_discharge_m3s[1]) * (d - 3) / 4
            else:
                qd_m3s = predicted_discharge_m3s[2]

            band = base_sigma_m3s * math.sqrt(1.0 + d / 2.8)
            series.append(
                ForecastPoint(
                    date=dt.strftime("%Y-%m-%d"),
                    discharge=round(qd_m3s, 1),
                    lower=max(0.0, round(qd_m3s - 1.28 * band, 1)),
                    upper=round(qd_m3s + 1.28 * band, 1),
                )
            )

        return CustomForecastResult(
            basinName=inputs.basinName,
            originDate=origin_str,
            horizons=horizons,
            predictedRunoffMm=predicted_runoff_mm,
            predictedDischargeM3s=predicted_discharge_m3s,
            residualsMm=residuals_mm,
            predictionIntervals=PredictionIntervals(lower=lowers, upper=uppers),
            highFlowProbability=p_high_list,
            extremeFlowProbability=p_ext_list,
            risk=risk,
            series=series,
            featureNames=feature_keys,
            inputFeatures=features_dict,
            generatedAt=datetime.utcnow().isoformat() + "Z",
        )


engine = CatBoostForecastEngine()
