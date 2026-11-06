from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field

QualityFlag = Literal["good", "degraded", "missing"]
RiskLevel = Literal["low", "watch", "high"]


class ForecastInputs(BaseModel):
    antecedentRainMm: float = Field(default=50.0, description="Rain over the 7 days before origin (mm)")
    forecastRainMm: float = Field(default=30.0, description="Forecast rain over the horizon (mm)")
    tempC: float = Field(default=22.0, description="Mean air temperature (deg C)")
    gapDays: int = Field(default=0, description="Observation gaps before origin (days)")
    quality: QualityFlag = Field(default="good", description="Observation quality flag")


class LastRecorded(BaseModel):
    date: str
    discharge: float | None = None
    quality: QualityFlag = "good"


class Catchment(BaseModel):
    id: str
    code: str
    name: str
    reservoir: str = ""
    river: str
    location: str
    district: str
    state: str
    lat: float
    lng: float
    yearBuilt: int | None = None
    purpose: str = "Hydrological monitoring"
    unit: Literal["m³/s"] = "m³/s"
    areaSqKm: float
    elevMeanM: float
    soil: str
    landCover: str
    thresholdHigh: float
    thresholdExtreme: float
    nearbyPlaces: list[str] = Field(default_factory=list)
    affectedRegions: list[str] = Field(default_factory=list)
    lastRecorded: LastRecorded
    defaultInputs: ForecastInputs
    source: str = "camels"


class DischargePoint(BaseModel):
    date: str
    discharge: float | None = None
    quality: QualityFlag = "good"


class PredictionIntervals(BaseModel):
    lower: list[float]
    upper: list[float]


class ForecastOutput(BaseModel):
    catchment_id: str
    forecast_origin: str
    forecast_horizons_days: list[int]
    predicted_discharge: list[float]
    high_flow_probability: list[float]
    extreme_flow_probability: list[float]
    prediction_intervals: PredictionIntervals


class ForecastPoint(BaseModel):
    date: str
    discharge: float
    lower: float | None = None
    upper: float | None = None


class ForecastResult(BaseModel):
    catchmentId: str
    asOf: str
    horizon: int
    source: str = "catboost_caravan"
    generatedAt: str
    output: ForecastOutput
    series: list[ForecastPoint]
    risk: RiskLevel
    pHigh: dict[str, float]
    pExt: dict[str, float]


class RiskBoardEntry(BaseModel):
    catchment: Catchment
    risk: RiskLevel
    current: float | None = None
    predicted5: float = 0.0
    pHigh5: float = 0.0
    pExt5: float = 0.0
    predicted7: float = 0.0
    pHigh7: float = 0.0
    pExt7: float = 0.0


class ForecastRequest(BaseModel):
    catchment_id: str | None = None
    catchment: Catchment | None = None
    as_of: str
    inputs: ForecastInputs
    horizon: int = 7


class CustomModelInputs(BaseModel):
    """Full parameterization of all 32 CatBoost model features with user-specific inputs."""

    # Streamflow lags (mm/day)
    flow_lag_0: float = Field(default=2.5, description="Current streamflow depth at day t (mm/day)")
    flow_lag_1: float = Field(default=2.3, description="Streamflow depth at day t-1 (mm/day)")
    flow_lag_2: float = Field(default=2.1, description="Streamflow depth at day t-2 (mm/day)")
    flow_lag_3: float = Field(default=1.9, description="Streamflow depth at day t-3 (mm/day)")
    flow_lag_7: float = Field(default=1.6, description="Streamflow depth at day t-7 (mm/day)")
    flow_lag_14: float = Field(default=1.4, description="Streamflow depth at day t-14 (mm/day)")

    # Precipitation lags and rolling sums (mm)
    precip_lag_0: float = Field(default=15.0, description="Precipitation at day t (mm)")
    precip_lag_1: float = Field(default=10.0, description="Precipitation at day t-1 (mm)")
    precip_lag_2: float = Field(default=6.0, description="Precipitation at day t-2 (mm)")
    precip_lag_3: float = Field(default=4.0, description="Precipitation at day t-3 (mm)")
    precip_lag_7: float = Field(default=2.0, description="Precipitation at day t-7 (mm)")
    precip_lag_14: float = Field(default=0.5, description="Precipitation at day t-14 (mm)")
    precip_sum_3d: float = Field(default=31.0, description="3-day cumulative precipitation sum (mm)")
    precip_sum_7d: float = Field(default=48.0, description="7-day cumulative precipitation sum (mm)")
    precip_sum_14d: float = Field(default=65.0, description="14-day cumulative precipitation sum (mm)")

    # Atmospheric & meteorology
    temperature_2m_mean: float = Field(default=18.0, description="Mean air temperature at 2m (°C)")
    dewpoint_temperature_2m_mean: float = Field(default=14.5, description="Mean dew point temperature at 2m (°C)")
    potential_evaporation_sum_ERA5_LAND: float = Field(default=3.5, description="Daily PET from ERA5-Land (mm)")
    potential_evaporation_sum_FAO_PENMAN_MONTEITH: float = Field(default=3.2, description="Daily PET FAO Penman-Monteith (mm)")
    snow_depth_water_equivalent_mean: float = Field(default=0.0, description="Snow depth water equivalent (mm)")
    surface_net_solar_radiation_mean: float = Field(default=185.0, description="Surface net solar radiation (W/m²)")
    surface_net_thermal_radiation_mean: float = Field(default=-42.0, description="Surface net thermal radiation (W/m²)")
    surface_pressure_mean: float = Field(default=96.5, description="Surface atmospheric pressure (kPa)")
    u_component_of_wind_10m_mean: float = Field(default=1.5, description="10m zonal wind component u (m/s)")
    v_component_of_wind_10m_mean: float = Field(default=0.9, description="10m meridional wind component v (m/s)")

    # Volumetric soil moisture layers (m³/m³)
    volumetric_soil_water_layer_1_mean: float = Field(default=0.28, description="Soil water Layer 1: 0-7 cm (m³/m³)")
    volumetric_soil_water_layer_2_mean: float = Field(default=0.30, description="Soil water Layer 2: 7-28 cm (m³/m³)")
    volumetric_soil_water_layer_3_mean: float = Field(default=0.32, description="Soil water Layer 3: 28-100 cm (m³/m³)")
    volumetric_soil_water_layer_4_mean: float = Field(default=0.34, description="Soil water Layer 4: 100-289 cm (m³/m³)")

    # Seasonality
    day_of_year_sin: float = Field(default=0.45, description="Sine of day of year")
    day_of_year_cos: float = Field(default=0.89, description="Cosine of day of year")
    source: str = Field(default="camels", description="Regional dataset source: camels, camelsgb, lamah, camelsaus, camelsbr, camelscl, hysets")

    # Catchment Scaling Context
    areaSqKm: float = Field(default=1000.0, description="Catchment drainage area (km²)")
    thresholdHigh: float = Field(default=65.0, description="High-flow threshold T(c) (m³/s)")
    thresholdExtreme: float = Field(default=110.0, description="Extreme threshold T(c) (m³/s)")
    originDate: str = Field(default="", description="Origin date for time-series display (YYYY-MM-DD)")
    basinName: str = Field(default="Custom River Basin", description="Descriptive basin name")


class CustomForecastResult(BaseModel):
    """Direct model forecast output across official horizons with intervals and exceedance odds."""

    basinName: str
    originDate: str
    horizons: list[int]
    predictedRunoffMm: list[float]
    predictedDischargeM3s: list[float]
    residualsMm: list[float]
    predictionIntervals: PredictionIntervals
    highFlowProbability: list[float]
    extremeFlowProbability: list[float]
    risk: RiskLevel
    series: list[ForecastPoint]
    featureNames: list[str]
    inputFeatures: dict[str, Any]
    generatedAt: str
