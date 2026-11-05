'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  CloudRain,
  Compass,
  Copy,
  Cpu,
  Droplets,
  Layers,
  Play,
  RotateCcw,
  Sliders,
  Thermometer,
  Waves,
  Wind,
} from 'lucide-react';
import { fetchCustomForecast } from '@/data/api';
import type { CustomModelInputs, CustomForecastResult, RiskLevel } from '@/data/types';
import { Eyebrow, PageHeading, Reveal, RiskBadge, Meter, fmtP, fmtQ } from '@/components/Ui';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

const BASELINE_INPUTS: CustomModelInputs = {
  // Streamflow lags (mm/day)
  flow_lag_0: 2.5,
  flow_lag_1: 2.3,
  flow_lag_2: 2.1,
  flow_lag_3: 1.9,
  flow_lag_7: 1.6,
  flow_lag_14: 1.4,

  // Precipitation lags & sums (mm)
  precip_lag_0: 15.0,
  precip_lag_1: 10.0,
  precip_lag_2: 6.0,
  precip_lag_3: 4.0,
  precip_lag_7: 2.0,
  precip_lag_14: 0.5,
  precip_sum_3d: 31.0,
  precip_sum_7d: 48.0,
  precip_sum_14d: 65.0,

  // Meteorology
  temperature_2m_mean: 18.0,
  dewpoint_temperature_2m_mean: 14.5,
  potential_evaporation_sum_ERA5_LAND: 3.5,
  potential_evaporation_sum_FAO_PENMAN_MONTEITH: 3.2,
  snow_depth_water_equivalent_mean: 0.0,
  surface_net_solar_radiation_mean: 185.0,
  surface_net_thermal_radiation_mean: -42.0,
  surface_pressure_mean: 96.5,
  u_component_of_wind_10m_mean: 1.5,
  v_component_of_wind_10m_mean: 0.9,

  // Soil moisture
  volumetric_soil_water_layer_1_mean: 0.28,
  volumetric_soil_water_layer_2_mean: 0.30,
  volumetric_soil_water_layer_3_mean: 0.32,
  volumetric_soil_water_layer_4_mean: 0.34,

  // Seasonality & Context
  day_of_year_sin: 0.45,
  day_of_year_cos: 0.89,
  source: 'camels',

  // Scaling
  areaSqKm: 1000.0,
  thresholdHigh: 65.0,
  thresholdExtreme: 110.0,
  originDate: '2026-11-05',
  basinName: 'Custom Experimental Basin',
};

const PRESETS: Record<string, Partial<CustomModelInputs>> = {
  monsoon: {
    basinName: 'Monsoon Extreme Deluge',
    flow_lag_0: 5.8,
    flow_lag_1: 4.5,
    flow_lag_2: 3.2,
    flow_lag_3: 2.4,
    precip_lag_0: 45.0,
    precip_lag_1: 35.0,
    precip_lag_2: 20.0,
    precip_sum_3d: 100.0,
    precip_sum_7d: 160.0,
    precip_sum_14d: 220.0,
    volumetric_soil_water_layer_1_mean: 0.44,
    volumetric_soil_water_layer_2_mean: 0.42,
    temperature_2m_mean: 26.0,
    dewpoint_temperature_2m_mean: 24.0,
    source: 'camels',
    thresholdHigh: 65.0,
    thresholdExtreme: 110.0,
  },
  spring_melt: {
    basinName: 'Alpine Spring Snowmelt',
    flow_lag_0: 3.2,
    flow_lag_1: 2.8,
    flow_lag_2: 2.6,
    flow_lag_3: 2.3,
    precip_lag_0: 8.0,
    precip_sum_3d: 22.0,
    snow_depth_water_equivalent_mean: 35.0,
    temperature_2m_mean: 11.5,
    dewpoint_temperature_2m_mean: 7.0,
    volumetric_soil_water_layer_1_mean: 0.38,
    volumetric_soil_water_layer_2_mean: 0.36,
    day_of_year_sin: 0.85,
    day_of_year_cos: -0.52,
    source: 'lamah',
    thresholdHigh: 55.0,
    thresholdExtreme: 95.0,
  },
  recession: {
    basinName: 'Summer Baseflow Recession',
    flow_lag_0: 0.8,
    flow_lag_1: 0.9,
    flow_lag_2: 1.0,
    flow_lag_3: 1.1,
    flow_lag_7: 1.4,
    flow_lag_14: 1.8,
    precip_lag_0: 0.0,
    precip_lag_1: 0.0,
    precip_lag_2: 0.0,
    precip_sum_3d: 0.0,
    precip_sum_7d: 2.0,
    precip_sum_14d: 8.0,
    temperature_2m_mean: 28.0,
    dewpoint_temperature_2m_mean: 15.0,
    potential_evaporation_sum_ERA5_LAND: 5.8,
    volumetric_soil_water_layer_1_mean: 0.16,
    volumetric_soil_water_layer_2_mean: 0.19,
    source: 'camelsaus',
    thresholdHigh: 45.0,
    thresholdExtreme: 80.0,
  },
};

const CARAVAN_SOURCES = [
  { id: 'camels', label: 'CAMELS (USA - USGS)' },
  { id: 'camelsgb', label: 'CAMELS-GB (Great Britain - CEH)' },
  { id: 'lamah', label: 'LAMAH (Central Europe - Germany/Austria)' },
  { id: 'camelsaus', label: 'CAMELS-AUS (Australia - BOM)' },
  { id: 'camelsbr', label: 'CAMELS-BR (Brazil - ANA)' },
  { id: 'camelscl', label: 'CAMELS-CL (Chile - DGA)' },
  { id: 'hysets', label: 'HYSETS (North America)' },
];

const CUSTOM_CSS = `
.custom-lab-page { padding: 40px 0 70px; max-width: 1400px; margin: 0 auto; }
.custom-grid { display: grid; grid-template-columns: 1.25fr 1fr; gap: 24px; margin-top: 24px; }
.input-section { display: flex; flex-direction: column; gap: 20px; }
.output-section { display: flex; flex-direction: column; gap: 20px; position: sticky; top: 80px; }

.section-box { padding: 22px; border-radius: 14px; background: rgba(5,16,22,.85); border: 1px solid rgba(120,220,235,.14); display: flex; flex-direction: column; gap: 14px; }
.section-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(135,215,228,.1); padding-bottom: 10px; margin-bottom: 4px; }
.section-header h3 { font: 600 15px var(--display); color: #e4f6f8; display: flex; align-items: center; gap: 8px; margin: 0; }
.section-header span { font: 8px var(--mono); color: #72969e; letter-spacing: .08em; }

.field-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.field-grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.field-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }

.input-cell { display: flex; flex-direction: column; gap: 5px; background: rgba(2,10,14,.45); padding: 9px 12px; border-radius: 9px; border: 1px solid rgba(115,200,215,.09); transition: border-color .2s; }
.input-cell:focus-within { border-color: rgba(93,225,238,.5); box-shadow: 0 0 0 3px rgba(93,225,238,.07); }
.cell-top { display: flex; justify-content: space-between; align-items: center; }
.cell-label { font: 8px var(--mono); color: #87a7ae; letter-spacing: .06em; text-transform: uppercase; }
.cell-unit { font: 8px var(--mono); color: #5d838b; }
.cell-input { background: transparent; border: 0; outline: none; font: 500 15px var(--mono); color: #eaf8f9; width: 100%; padding: 2px 0; }
.cell-select { background: rgba(2,10,14,.9); border: 1px solid rgba(115,200,215,.2); border-radius: 6px; padding: 6px 8px; font: 500 12px var(--mono); color: #eaf8f9; outline: none; width: 100%; }

.presets-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 14px; }
.preset-pill { background: rgba(10,30,40,.6); border: 1px solid rgba(120,220,235,.2); color: #a4dbe2; padding: 6px 12px; border-radius: 20px; font: 500 11px var(--mono); cursor: pointer; transition: .2s; display: flex; align-items: center; gap: 6px; }
.preset-pill:hover { background: rgba(93,225,238,.15); border-color: rgba(93,225,238,.45); color: #d4f8fc; }

.output-hero { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.output-card { padding: 14px; border-radius: 11px; background: rgba(2,12,18,.65); border: 1px solid rgba(125,215,230,.12); text-align: left; }
.output-card small { font: 8px var(--mono); color: #72969e; display: block; margin-bottom: 4px; }
.output-card strong { font: 600 20px var(--display); color: #cbf5f7; display: block; }
.output-card span { font: 9px var(--mono); color: #8ea7ad; }

.chart-card { padding: 18px; border-radius: 14px; background: rgba(5,16,22,.85); border: 1px solid rgba(120,220,235,.14); min-height: 280px; }
.raw-json-box { background: rgba(1,7,10,.8); border: 1px solid rgba(120,220,235,.12); border-radius: 8px; padding: 12px; font: 10px/1.6 var(--mono); color: #8ec3cb; max-height: 220px; overflow: auto; white-space: pre-wrap; }

@media (max-width: 980px) {
  .custom-grid { grid-template-columns: 1fr; }
  .field-grid-3, .field-grid-4 { grid-template-columns: repeat(2, 1fr); }
  .output-section { position: static; }
}
`;

export default function CustomForecastLabPage() {
  const [inputs, setInputs] = useState<CustomModelInputs>(BASELINE_INPUTS);
  const [copied, setCopied] = useState(false);

  // Direct inference query
  const query = useQuery({
    queryKey: ['custom-forecast', inputs],
    queryFn: ({ signal }) => fetchCustomForecast(inputs, signal),
    staleTime: 500,
  });

  const result: CustomForecastResult | undefined = query.data;

  const updateField = (key: keyof CustomModelInputs, value: any) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const applyPreset = (presetKey: string) => {
    if (PRESETS[presetKey]) {
      setInputs((prev) => ({ ...prev, ...PRESETS[presetKey] }));
    }
  };

  const resetBaseline = () => {
    setInputs(BASELINE_INPUTS);
  };

  const copyJson = () => {
    if (result) {
      navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Trajectory chart series
  const chartData = useMemo(() => {
    if (!result?.series) return [];
    return result.series.map((p, idx) => ({
      day: `Day ${idx + 1}`,
      date: p.date,
      discharge: p.discharge,
      lower: p.lower,
      upper: p.upper,
      band: p.lower !== null && p.upper !== null ? p.upper - p.lower : 0,
      thresholdHigh: inputs.thresholdHigh,
      thresholdExtreme: inputs.thresholdExtreme,
    }));
  }, [result, inputs]);

  return (
    <section className="catalog-page custom-lab-page">
      <style dangerouslySetInnerHTML={{ __html: CUSTOM_CSS }} />

      <div className="catalog-top">
        <PageHeading
          label="DIRECT MODEL INFERENCE LAB"
          title={
            <>
              User Input Matrix,<br />
              <span>Full Model Features.</span>
            </>
          }
          description="Feed all 32 CatBoost inputs directly into the neural residual engine. Customize flow lags, precipitation series, temperature, soil water layers, and atmospheric forcing with full precision."
          count="32 features"
        />
        <div className="catalog-mark">
          <Cpu size={16} />
          <span>
            CATBOOST MULTI-HORIZON<br />· DIRECT VECTOR INFERENCE
          </span>
        </div>
      </div>

      {/* Preset Scenarios */}
      <div className="presets-bar">
        <span style={{ font: '600 10px var(--mono)', color: '#88a6ad', textTransform: 'uppercase' }}>
          Quick Test Scenarios:
        </span>
        <button type="button" className="preset-pill" onClick={() => applyPreset('monsoon')}>
          <CloudRain size={12} /> Extreme Deluge
        </button>
        <button type="button" className="preset-pill" onClick={() => applyPreset('spring_melt')}>
          <Droplets size={12} /> Snowmelt Influx
        </button>
        <button type="button" className="preset-pill" onClick={() => applyPreset('recession')}>
          <Wind size={12} /> Baseflow Recession
        </button>
        <button type="button" className="preset-pill" onClick={resetBaseline}>
          <RotateCcw size={12} /> Reset Caravan Baseline
        </button>
      </div>

      <div className="custom-grid">
        {/* ── Left Column: User Input Matrix ── */}
        <div className="input-section">
          {/* Section 1: Catchment Scale & Source */}
          <div className="section-box">
            <div className="section-header">
              <h3>
                <Compass size={16} /> 1. Basin Context &amp; Dataset Source
              </h3>
              <span>REGION &amp; SCALE</span>
            </div>
            <div className="field-grid-2">
              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">Caravan Source Dataset (source)</span>
                  <span className="cell-unit">categorical</span>
                </div>
                <select
                  className="cell-select"
                  value={inputs.source}
                  onChange={(e) => updateField('source', e.target.value)}
                >
                  {CARAVAN_SOURCES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">Catchment Area</span>
                  <span className="cell-unit">km²</span>
                </div>
                <input
                  type="number"
                  step="10"
                  className="cell-input"
                  value={inputs.areaSqKm}
                  onChange={(e) => updateField('areaSqKm', parseFloat(e.target.value) || 100)}
                />
              </div>

              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">High-Flow Alert Threshold T(c)</span>
                  <span className="cell-unit">m³/s</span>
                </div>
                <input
                  type="number"
                  step="5"
                  className="cell-input"
                  value={inputs.thresholdHigh}
                  onChange={(e) => updateField('thresholdHigh', parseFloat(e.target.value) || 10)}
                />
              </div>

              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">Extreme Flood Threshold T(c)</span>
                  <span className="cell-unit">m³/s</span>
                </div>
                <input
                  type="number"
                  step="5"
                  className="cell-input"
                  value={inputs.thresholdExtreme}
                  onChange={(e) => updateField('thresholdExtreme', parseFloat(e.target.value) || 20)}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Flow Lags */}
          <div className="section-box">
            <div className="section-header">
              <h3>
                <Waves size={16} /> 2. Hydrologic State — Streamflow Lags (mm/day)
              </h3>
              <span>DAY t THROUGH t-14</span>
            </div>
            <p style={{ font: '11px var(--display)', color: '#8aa6ad', margin: 0 }}>
              Area-normalized runoff depth: 1 mm/day on {inputs.areaSqKm} km² ={' '}
              {((inputs.areaSqKm / 86.4)).toFixed(1)} m³/s.
            </p>
            <div className="field-grid-3">
              {[
                { key: 'flow_lag_0', label: 'flow_lag_0 (Origin t)' },
                { key: 'flow_lag_1', label: 'flow_lag_1 (t - 1)' },
                { key: 'flow_lag_2', label: 'flow_lag_2 (t - 2)' },
                { key: 'flow_lag_3', label: 'flow_lag_3 (t - 3)' },
                { key: 'flow_lag_7', label: 'flow_lag_7 (t - 7)' },
                { key: 'flow_lag_14', label: 'flow_lag_14 (t - 14)' },
              ].map((f) => (
                <div key={f.key} className="input-cell">
                  <div className="cell-top">
                    <span className="cell-label">{f.label}</span>
                    <span className="cell-unit">mm/d</span>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    className="cell-input"
                    value={(inputs as any)[f.key]}
                    onChange={(e) => updateField(f.key as any, parseFloat(e.target.value) || 0)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Precipitation Forcing */}
          <div className="section-box">
            <div className="section-header">
              <h3>
                <CloudRain size={16} /> 3. Meteorological Forcing — Precipitation Lags &amp; Sums
              </h3>
              <span>DAILY &amp; CUMULATIVE (mm)</span>
            </div>
            <div className="field-grid-3">
              {[
                { key: 'precip_lag_0', label: 'precip_lag_0 (Day t)' },
                { key: 'precip_lag_1', label: 'precip_lag_1 (t - 1)' },
                { key: 'precip_lag_2', label: 'precip_lag_2 (t - 2)' },
                { key: 'precip_lag_3', label: 'precip_lag_3 (t - 3)' },
                { key: 'precip_lag_7', label: 'precip_lag_7 (t - 7)' },
                { key: 'precip_lag_14', label: 'precip_lag_14 (t - 14)' },
                { key: 'precip_sum_3d', label: 'precip_sum_3d (3-Day Sum)' },
                { key: 'precip_sum_7d', label: 'precip_sum_7d (7-Day Sum)' },
                { key: 'precip_sum_14d', label: 'precip_sum_14d (14-Day Sum)' },
              ].map((f) => (
                <div key={f.key} className="input-cell">
                  <div className="cell-top">
                    <span className="cell-label">{f.label}</span>
                    <span className="cell-unit">mm</span>
                  </div>
                  <input
                    type="number"
                    step="0.5"
                    className="cell-input"
                    value={(inputs as any)[f.key]}
                    onChange={(e) => updateField(f.key as any, parseFloat(e.target.value) || 0)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: Atmospheric & Evaporation */}
          <div className="section-box">
            <div className="section-header">
              <h3>
                <Thermometer size={16} /> 4. Air Temperature, PET &amp; Atmospheric Dynamics
              </h3>
              <span>METEOROLOGY FEATURES</span>
            </div>
            <div className="field-grid-2">
              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">temperature_2m_mean</span>
                  <span className="cell-unit">°C</span>
                </div>
                <input
                  type="number"
                  step="0.5"
                  className="cell-input"
                  value={inputs.temperature_2m_mean}
                  onChange={(e) => updateField('temperature_2m_mean', parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">dewpoint_temperature_2m_mean</span>
                  <span className="cell-unit">°C</span>
                </div>
                <input
                  type="number"
                  step="0.5"
                  className="cell-input"
                  value={inputs.dewpoint_temperature_2m_mean}
                  onChange={(e) => updateField('dewpoint_temperature_2m_mean', parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">potential_evaporation_ERA5</span>
                  <span className="cell-unit">mm/day</span>
                </div>
                <input
                  type="number"
                  step="0.1"
                  className="cell-input"
                  value={inputs.potential_evaporation_sum_ERA5_LAND}
                  onChange={(e) => updateField('potential_evaporation_sum_ERA5_LAND', parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">potential_evaporation_FAO_PM</span>
                  <span className="cell-unit">mm/day</span>
                </div>
                <input
                  type="number"
                  step="0.1"
                  className="cell-input"
                  value={inputs.potential_evaporation_sum_FAO_PENMAN_MONTEITH}
                  onChange={(e) =>
                    updateField('potential_evaporation_sum_FAO_PENMAN_MONTEITH', parseFloat(e.target.value) || 0)
                  }
                />
              </div>

              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">surface_pressure_mean</span>
                  <span className="cell-unit">kPa</span>
                </div>
                <input
                  type="number"
                  step="0.5"
                  className="cell-input"
                  value={inputs.surface_pressure_mean}
                  onChange={(e) => updateField('surface_pressure_mean', parseFloat(e.target.value) || 95)}
                />
              </div>

              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">snow_depth_water_equivalent</span>
                  <span className="cell-unit">mm</span>
                </div>
                <input
                  type="number"
                  step="1"
                  className="cell-input"
                  value={inputs.snow_depth_water_equivalent_mean}
                  onChange={(e) => updateField('snow_depth_water_equivalent_mean', parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">surface_net_solar_radiation</span>
                  <span className="cell-unit">W/m²</span>
                </div>
                <input
                  type="number"
                  step="5"
                  className="cell-input"
                  value={inputs.surface_net_solar_radiation_mean}
                  onChange={(e) => updateField('surface_net_solar_radiation_mean', parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">surface_net_thermal_radiation</span>
                  <span className="cell-unit">W/m²</span>
                </div>
                <input
                  type="number"
                  step="2"
                  className="cell-input"
                  value={inputs.surface_net_thermal_radiation_mean}
                  onChange={(e) => updateField('surface_net_thermal_radiation_mean', parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">u_component_of_wind_10m</span>
                  <span className="cell-unit">m/s</span>
                </div>
                <input
                  type="number"
                  step="0.1"
                  className="cell-input"
                  value={inputs.u_component_of_wind_10m_mean}
                  onChange={(e) => updateField('u_component_of_wind_10m_mean', parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">v_component_of_wind_10m</span>
                  <span className="cell-unit">m/s</span>
                </div>
                <input
                  type="number"
                  step="0.1"
                  className="cell-input"
                  value={inputs.v_component_of_wind_10m_mean}
                  onChange={(e) => updateField('v_component_of_wind_10m_mean', parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>

          {/* Section 5: Soil Water Profile & Seasonality */}
          <div className="section-box">
            <div className="section-header">
              <h3>
                <Layers size={16} /> 5. Soil Moisture Profile &amp; Seasonality Angles
              </h3>
              <span>4-LAYER COLUMN + SINE/COSINE</span>
            </div>
            <div className="field-grid-4">
              {[
                { key: 'volumetric_soil_water_layer_1_mean', label: 'Layer 1 (0-7cm)' },
                { key: 'volumetric_soil_water_layer_2_mean', label: 'Layer 2 (7-28cm)' },
                { key: 'volumetric_soil_water_layer_3_mean', label: 'Layer 3 (28-100cm)' },
                { key: 'volumetric_soil_water_layer_4_mean', label: 'Layer 4 (100-289cm)' },
              ].map((f) => (
                <div key={f.key} className="input-cell">
                  <div className="cell-top">
                    <span className="cell-label">{f.label}</span>
                    <span className="cell-unit">m³/m³</span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="0.6"
                    className="cell-input"
                    value={(inputs as any)[f.key]}
                    onChange={(e) => updateField(f.key as any, parseFloat(e.target.value) || 0)}
                  />
                </div>
              ))}
            </div>

            <div className="field-grid-2" style={{ marginTop: 12 }}>
              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">day_of_year_sin</span>
                  <span className="cell-unit">[-1..1]</span>
                </div>
                <input
                  type="number"
                  step="0.05"
                  className="cell-input"
                  value={inputs.day_of_year_sin}
                  onChange={(e) => updateField('day_of_year_sin', parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="input-cell">
                <div className="cell-top">
                  <span className="cell-label">day_of_year_cos</span>
                  <span className="cell-unit">[-1..1]</span>
                </div>
                <input
                  type="number"
                  step="0.05"
                  className="cell-input"
                  value={inputs.day_of_year_cos}
                  onChange={(e) => updateField('day_of_year_cos', parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Right Column: Live Model Output ── */}
        <div className="output-section">
          {/* Header Status Card */}
          <div className="section-box" style={{ borderColor: 'rgba(93,225,238,.35)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Eyebrow>LIVE CATBOOST INFERENCE</Eyebrow>
                <h2 style={{ font: '600 22px var(--display)', color: '#d8f6f8', margin: '4px 0' }}>
                  {inputs.basinName}
                </h2>
                <span style={{ font: '9px var(--mono)', color: '#7ea1a8' }}>
                  Source: {inputs.source.toUpperCase()} · Area: {inputs.areaSqKm} km²
                </span>
              </div>
              <RiskBadge level={result?.risk ?? 'low'} />
            </div>

            {/* Horizons Grid */}
            <div className="output-hero" style={{ marginTop: 12 }}>
              {(result?.horizons ?? [1, 3, 5]).map((h, i) => {
                const q = result?.predictedDischargeM3s[i];
                const runoff = result?.predictedRunoffMm[i];
                const res = result?.residualsMm[i];
                return (
                  <div key={h} className="output-card">
                    <small>{h}-DAY HORIZON</small>
                    <strong>{q !== undefined ? fmtQ(q) : '—'} <span style={{ fontSize: 11 }}>m³/s</span></strong>
                    <span>{runoff !== undefined ? `${runoff} mm/d` : '—'}</span>
                    <span style={{ display: 'block', fontSize: 8, color: res && res > 0 ? '#62e08a' : '#8fa9af' }}>
                      {res && res > 0 ? `+${res}` : res} mm Δq
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Hydrograph Chart */}
          <div className="chart-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ font: '600 11px var(--mono)', color: '#88a6ad', textTransform: 'uppercase' }}>
                5-Day Projected Hydrograph (m³/s)
              </span>
              <span style={{ font: '9px var(--mono)', color: '#688c94' }}>
                Shaded band = 80% confidence interval
              </span>
            </div>

            <div style={{ width: '100%', height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(125,225,240,.07)" />
                  <XAxis dataKey="day" stroke="#5d838b" tick={{ fill: '#7da1a8', fontSize: 10 }} />
                  <YAxis stroke="#5d838b" tick={{ fill: '#7da1a8', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(3,12,18,.95)',
                      border: '1px solid rgba(120,220,235,.3)',
                      borderRadius: 8,
                      fontSize: 11,
                      fontFamily: 'var(--mono)',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="upper"
                    stroke="none"
                    fill="rgba(93,225,238,.12)"
                    name="Upper Bound (80%)"
                  />
                  <Line
                    type="monotone"
                    dataKey="discharge"
                    stroke="#5de1ee"
                    strokeWidth={2.5}
                    dot={{ fill: '#031218', stroke: '#5de1ee', strokeWidth: 2, r: 4 }}
                    name="Predicted Q (m³/s)"
                  />
                  <Line
                    type="monotone"
                    dataKey="lower"
                    stroke="rgba(93,225,238,.4)"
                    strokeDasharray="2 2"
                    dot={false}
                    name="Lower Bound"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Exceedance Probabilities Card */}
          <div className="section-box">
            <div className="section-header">
              <h3>
                <AlertTriangle size={15} /> Threshold Exceedance Odds
              </h3>
              <span>STATISTICAL PROBABILITY</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {(result?.horizons ?? [1, 3, 5]).map((h, i) => {
                const pH = result?.highFlowProbability[i] ?? 0;
                const pE = result?.extremeFlowProbability[i] ?? 0;
                return (
                  <div key={h} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ font: '9px var(--mono)', color: '#88a6ad' }}>{h}-Day P(High)</span>
                    <strong style={{ font: '600 16px var(--mono)', color: pH >= 0.5 ? '#f87171' : '#38bdf8' }}>
                      {fmtP(pH)}
                    </strong>
                    <Meter value={pH * 100} max={100} />
                    <span style={{ font: '8px var(--mono)', color: '#66838a', marginTop: 2 }}>
                      P(Ext): {fmtP(pE)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Raw JSON Payload */}
          <div className="section-box">
            <div className="section-header">
              <h3>
                <Activity size={15} /> Model Response Payload (JSON)
              </h3>
              <button
                type="button"
                className="button button-ghost"
                style={{ padding: '4px 10px', fontSize: 10 }}
                onClick={copyJson}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="raw-json-box">
              {result ? JSON.stringify(result, null, 2) : 'Awaiting inference execution...'}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
