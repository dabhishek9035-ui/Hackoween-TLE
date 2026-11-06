/* BASINSHIFT data contracts.
   The prediction output mirrors the submission schema in
   section 8.3 of the challenge documentation; the input groups mirror
   section 8.2. Forecasts are produced by trained CatBoost multi-horizon
   models on Caravan streamflow records. */

export type Horizon = 1 | 3 | 7;
export const HORIZONS: Horizon[] = [1, 3, 7];

export type QualityFlag = 'good' | 'degraded' | 'missing';
export type RiskLevel = 'low' | 'watch' | 'high';

export const RISK_ORDER: Record<RiskLevel, number> = { high: 0, watch: 1, low: 2 };

export type DischargePoint = { date: string; discharge: number | null; quality: QualityFlag };

/* §8.2 input fields (model-facing subset the workbench exposes) */
export type ForecastInputs = {
  antecedentRainMm: number; // hydrology/meteorology: rain over the 7 days before origin
  forecastRainMm: number; // meteorology: permitted forecast rain over the horizon
  tempC: number; // meteorology: mean air temperature over the horizon
  gapDays: number; // missingness metadata: observation gaps before origin
  quality: QualityFlag; // missingness metadata: overall record quality flag
};

export type Catchment = {
  id: string;
  code: string; // BASIN_00X or CARAVAN_XXX, as used by the output schema
  name: string;
  reservoir: string;
  river: string;
  location: string;
  district: string;
  state: string;
  lat: number;
  lng: number;
  yearBuilt?: number;
  purpose: string;
  unit: 'm³/s';
  /* static catchment attributes (§8.2) */
  areaSqKm: number;
  elevMeanM: number;
  soil: string;
  landCover: string;
  /* pre-defined catchment-specific high-flow thresholds T(c) (§8.1) */
  thresholdHigh: number;
  thresholdExtreme: number;
  nearbyPlaces: string[];
  affectedRegions: string[];
  lastRecorded: { date: string; discharge: number | null; quality: QualityFlag };
  defaultInputs: ForecastInputs;
  source?: string;
};

export type ForecastPoint = { date: string; discharge: number; lower: number | null; upper: number | null };

/* §8.3 output schema (illustrative submission contract) */
export type ForecastOutput = {
  catchment_id: string;
  forecast_origin: string;
  forecast_horizons_days: Horizon[];
  predicted_discharge: number[];
  high_flow_probability: number[];
  extreme_flow_probability: number[];
  prediction_intervals: { lower: number[]; upper: number[] };
};

export type ForecastResult = {
  catchmentId: string;
  asOf: string;
  horizon: Horizon;
  source: string;
  generatedAt: string;
  output: ForecastOutput; // the trained [1, 3, 7] set
  series: ForecastPoint[]; // per-day path for the chart, 1..7 days
  risk: RiskLevel;
  pHigh: Record<Horizon, number>;
  pExt: Record<Horizon, number>;
};

export type RiskBoardEntry = {
  catchment: Catchment;
  risk: RiskLevel;
  current: number | null;
  predicted5: number;
  pHigh5: number;
  pExt5: number;
  predicted7?: number;
  pHigh7?: number;
  pExt7?: number;
};

export type CustomModelInputs = {
  // Streamflow lags (mm/day)
  flow_lag_0: number;
  flow_lag_1: number;
  flow_lag_2: number;
  flow_lag_3: number;
  flow_lag_7: number;
  flow_lag_14: number;

  // Precipitation lags & sums (mm)
  precip_lag_0: number;
  precip_lag_1: number;
  precip_lag_2: number;
  precip_lag_3: number;
  precip_lag_7: number;
  precip_lag_14: number;
  precip_sum_3d: number;
  precip_sum_7d: number;
  precip_sum_14d: number;

  // Atmospheric & Meteorology
  temperature_2m_mean: number;
  dewpoint_temperature_2m_mean: number;
  potential_evaporation_sum_ERA5_LAND: number;
  potential_evaporation_sum_FAO_PENMAN_MONTEITH: number;
  snow_depth_water_equivalent_mean: number;
  surface_net_solar_radiation_mean: number;
  surface_net_thermal_radiation_mean: number;
  surface_pressure_mean: number;
  u_component_of_wind_10m_mean: number;
  v_component_of_wind_10m_mean: number;

  // Soil Moisture Layers (m³/m³)
  volumetric_soil_water_layer_1_mean: number;
  volumetric_soil_water_layer_2_mean: number;
  volumetric_soil_water_layer_3_mean: number;
  volumetric_soil_water_layer_4_mean: number;

  // Seasonality
  day_of_year_sin: number;
  day_of_year_cos: number;
  source: string;

  // Catchment Context & Scaling
  areaSqKm: number;
  thresholdHigh: number;
  thresholdExtreme: number;
  originDate?: string;
  basinName?: string;
};

export type CustomForecastResult = {
  basinName: string;
  originDate: string;
  horizons: number[];
  predictedRunoffMm: number[];
  predictedDischargeM3s: number[];
  residualsMm: number[];
  predictionIntervals: { lower: number[]; upper: number[] };
  highFlowProbability: number[];
  extremeFlowProbability: number[];
  risk: RiskLevel;
  series: ForecastPoint[];
  featureNames: string[];
  inputFeatures: Record<string, number | string>;
  generatedAt: string;
};

/* one logged prediction (history page) */
export type RunRecord = {
  id: string;
  savedAt: string;
  sample?: boolean;
  catchmentId: string;
  catchmentCode: string;
  catchmentName: string;
  river: string;
  origin: string;
  horizon: Horizon;
  inputs: ForecastInputs;
  output: ForecastOutput;
  risk: RiskLevel;
  predictedQ: number;
  pHigh: number;
  pExt: number;
  lowerAtH: number | null;
  upperAtH: number | null;
};
