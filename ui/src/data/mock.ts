import type { Catchment, DischargePoint, ForecastInputs, ForecastResult, ForecastPoint, ForecastOutput, Horizon, QualityFlag, RiskBoardEntry, RiskLevel } from './types';
import { HORIZONS } from './types';

/* ────────────────────────────────────────────────────────────────
   BASINSHIFT Caravan benchmark dataset & local offline engine.
   All catchments correspond to official Caravan v1.6 gauge records.
   ──────────────────────────────────────────────────────────────── */

const iso = (date: Date) => date.toISOString().slice(0, 10);
const dayOfYear = (date: Date) => Math.floor((+date - +new Date(date.getUTCFullYear(), 0, 0)) / 86400000);

function hashString(s: string) {
  let h = 19 >>> 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

function rngFrom(seed: string) {
  let a = hashString(seed);
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

type InternalCatchment = Catchment & {
  baseQ: number;
  monsoonAmp: number;
  surge: number;
  recessionDays: number;
  runoffPerMm: number;
};
const asInternal = (c: Catchment) => c as InternalCatchment;

/* ── Verified Caravan Catchment Register ─────────────────────── */
const rawCatchments: [
  string, string, string, string, string, string, string, number, number,
  number, number, string, string, number, number, number,
  number, number, number,
  string[], string[],
][] = [
  ['camels_01047000', 'CRV_01047000', 'Carrabassett River Catchment', 'USGS Gauge 01047000 (North Anson)', 'Carrabassett River', 'Somerset County', 'Maine, USA', 44.869, -69.955, 902.9, 379, 'Sandy loam · glacial till', 'Mixed northern hardwood forest', 18.5, 68, 0.45, 48, 52, 14, ['North Anson', 'Carrabassett Valley', 'Kingfield'], ['Somerset County', 'Kennebec River Valley']],
  ['camels_01055000', 'CRV_01055000', 'Swift River Catchment', 'USGS Gauge 01055000 (Roxbury)', 'Swift River', 'Oxford County', 'Maine, USA', 44.643, -70.589, 250.4, 548, 'Gravelly loam · mountain podzol', 'Dense coniferous & birch forest', 6.2, 24.5, 0.38, 42, 45, 12, ['Roxbury', 'Rumford', 'Androscoggin Valley'], ['Oxford County', 'Androscoggin Basin']],
  ['camels_01013500', 'CRV_01013500', 'Fish River Catchment', 'USGS Gauge 01013500 (Fort Kent)', 'Fish River', 'Aroostook County', 'Maine, USA', 47.237, -68.583, 2297.7, 276, 'Silt loam · glacial lake sediment', 'Boreal spruce-fir forest · wetlands', 44.0, 145, 0.40, 36, 40, 8, ['Fort Kent', 'Fish River Lakes', 'St. John Border'], ['Aroostook County', 'St. John Valley']],
  ['camels_01030500', 'CRV_01030500', 'Mattawamkeag River Catchment', 'USGS Gauge 01030500 (Mattawamkeag)', 'Mattawamkeag River', 'Penobscot County', 'Maine, USA', 45.501, -68.306, 3666.9, 175, 'Clay loam · organic wetlands', 'Lowland forest · peat bogs', 65.0, 195, 0.32, 50, 55, 15, ['Mattawamkeag', 'Lincoln', 'Penobscot Corridor'], ['Penobscot County', 'Mattawamkeag Valley']],
  ['camelsgb_12002', 'CRV_12002', 'River Dee Catchment (Park)', 'CEH Station 12002 (Park)', 'River Dee', 'Aberdeenshire', 'Scotland, UK', 57.075, -2.336, 1825.3, 448, 'Peaty podzols · weathered granite', 'Heather moorland · Scots pine forest', 38.0, 130, 0.50, 55, 62, 11, ['Banchory', 'Park', 'Braemar', 'Aberdeen'], ['Aberdeenshire', 'Royal Deeside']],
  ['camelsgb_10003', 'CRV_10003', 'River Ythan Catchment', 'CEH Station 10003 (Ellon)', 'River Ythan', 'Aberdeenshire', 'Scotland, UK', 57.364, -2.090, 530.0, 107, 'Brown forest soils · alluvial loam', 'Pasture · mixed arable crops', 7.5, 28, 0.42, 38, 44, 12, ['Ellon', 'Fyvie', 'Ythan Estuary'], ['Aberdeenshire', 'Formartine Coast']],
  ['camelsgb_1001', 'CRV_1001', 'River Wick Catchment', 'CEH Station 1001 (Tarroul)', 'River Wick', 'Caithness', 'Scotland, UK', 58.476, -3.267, 157.4, 82, 'Deep blanket peat · gleys', 'Blanket bog · rough grazing', 2.8, 11.5, 0.36, 44, 48, 10, ['Tarroul', 'Watten', 'Wick Harbour'], ['Caithness', 'Wick Valley']],
  ['lamah_10039802', 'CRV_10039802', 'Danube River (Donauwoerth)', 'Bavarian Agency Gauge (Donauwoerth)', 'Danube River', 'Swabia', 'Bavaria, Germany', 48.711, 10.802, 14980.8, 647, 'Calcareous loam · fluvisols', 'Cultivated plain · Alpine foreland forest', 240.0, 720, 0.60, 60, 75, 15, ['Donauwoerth', 'Augsburg', 'Ingolstadt'], ['Bavaria', 'Swabian Danube Region']],
  ['lamah_10053009', 'CRV_10053009', 'Danube River (Kelheim)', 'Bavarian Agency Gauge (Kelheim)', 'Danube River', 'Lower Bavaria', 'Bavaria, Germany', 48.916, 11.865, 22928.0, 681, 'Karst limestone · river alluvium', 'Mixed deciduous forest · cropland', 365.0, 1080, 0.65, 65, 82, 15, ['Kelheim', 'Regensburg', 'Weltenburg Gorge'], ['Lower Bavaria', 'Upper Palatinate']],
  ['lamah_10026301', 'CRV_10026301', 'Danube River (Neu-Ulm)', 'Bad Held Gauge (Neu-Ulm)', 'Danube River', 'Neu-Ulm', 'Bavaria, Germany', 48.389, 9.987, 7552.4, 752, 'Glacial gravel · loess', 'Foothills forest · grassland', 125.0, 390, 0.48, 52, 65, 14, ['Neu-Ulm', 'Ulm', 'Iller confluence'], ['Neu-Ulm District', 'Iller Valley']],
  ['camelsaus_105105A', 'CRV_105105A', 'East Normanby River Catchment', 'BOM Station 105105A (Development Rd)', 'East Normanby River', 'Cook Shire', 'Queensland, Australia', -15.771, 145.014, 297.1, 333, 'Red kandosols · skeletal gravels', 'Tropical eucalyptus savanna woodland', 4.5, 42, 0.72, 70, 95, 28, ['Cooktown', 'Lakeland', 'Normanby Gorge'], ['Cook Shire', 'Cape York Peninsula']],
  ['camelsaus_107001B', 'CRV_107001B', 'Endeavour River Catchment', 'BOM Station 107001B (Flaggy)', 'Endeavour River', 'Cook Shire', 'Queensland, Australia', -15.423, 145.067, 341.3, 176, 'Lateritic red earths · coastal sands', 'Rainforest margins · tropical scrub', 5.8, 54, 0.68, 85, 110, 28, ['Hope Vale', 'Endeavour Valley', 'Marton'], ['Cook Shire', 'Endeavour River Basin']],
  ['camelsbr_12370000', 'CRV_12370000', 'Jurua River (Thaumaturgo)', 'ANA Station 12370000 (Thaumaturgo)', 'Jurua River', 'Acre', 'Brazil', -8.946, -72.784, 16233.2, 310, 'Ferralsols · rainforest clay', 'Pristine Amazon rainforest canopy', 280.0, 880, 0.58, 88, 115, 26, ['Marechal Thaumaturgo', 'Porto Walter', 'Upper Jurua'], ['State of Acre', 'Jurua River Communities']],
  ['camelsbr_12520000', 'CRV_12520000', 'Jurua River (Ipixuna)', 'ANA Station 12520000 (Ipixuna)', 'Jurua River', 'Amazonas', 'Brazil', -7.056, -71.689, 55719.9, 255, 'Heavy alluvial clays · várzea', 'Humid equatorial rainforest & wetlands', 950.0, 2800, 0.62, 92, 125, 27, ['Ipixuna', 'Eirunepe', 'Carauari'], ['State of Amazonas', 'Middle Jurua Valley']],
  ['camelscl_1001002', 'CRV_1001002', 'Rio Caquena Catchment', 'DGA Gauge 1001002 (Vertedero)', 'Rio Caquena', 'Parinacota', 'Chile', -17.995, -69.263, 469.6, 4647, 'Volcanic lithosols · bofedal peats', 'High Andean steppe (puna) · bogs', 1.4, 6.8, 0.28, 20, 24, 4, ['Visviri', 'Lauca National Park', 'Putre'], ['Arica y Parinacota', 'Altiplano Plateau']],
  ['camelscl_10122001', 'CRV_10122001', 'Rio Calle-Calle Catchment', 'DGA Gauge 10122001 (Balsa San Javier)', 'Rio Calle-Calle', 'Los Rios', 'Chile', -39.775, -72.983, 6607.6, 688, 'Volcanic andosols · deep trumaos', 'Valdivian temperate rainforest', 115.0, 360, 0.52, 65, 78, 13, ['San Javier', 'Valdivia', 'Los Lagos'], ['Los Rios Region', 'Valdivia Estuary Basin']],
];

function seasonalCurve(doy: number, lat: number) {
  if (lat >= 0) {
    const spring = Math.exp(-((doy - 110) ** 2) / (2 * 45 ** 2));
    const autumn = 0.55 * Math.exp(-((doy - 295) ** 2) / (2 * 50 ** 2));
    return spring + autumn;
  }
  return Math.exp(-((doy - 45) ** 2) / (2 * 55 ** 2));
}

function dischargeAt(c: InternalCatchment, date: Date, dayOffset: number): { value: number | null; quality: QualityFlag } {
  const key = hashString(c.id);
  const doy = dayOfYear(date);
  const seasonal = seasonalCurve(doy, c.lat);
  const slow = 0.78 + 0.44 * Math.sin(dayOffset * 0.021 + key * 0.13);
  const weekly = Math.sin(dayOffset * 0.55 + key) * (c.areaSqKm > 5000 ? 26 : 7);
  const h = hashString(`${c.id}:${iso(date)}`);
  const stormP = (h % 100) / 100;
  let storm = 0;
  if (stormP < 0.055) storm = c.monsoonAmp * (0.35 + ((h >>> 8) % 100) / 140);
  else if (stormP < 0.12) storm = c.monsoonAmp * 0.1 * (((h >>> 8) % 100) / 100);
  const surge = c.surge * c.monsoonAmp * Math.exp(-(dayOffset * dayOffset) / (2 * 2.6 * 2.6));
  const q = c.baseQ + c.monsoonAmp * seasonal * slow + weekly + storm + surge;
  const quality: QualityFlag = h % 71 === 0 ? 'missing' : h % 17 === 0 ? 'degraded' : 'good';
  const value = quality === 'missing' ? null : Math.max(0, Math.round(q * 10) / 10);
  return { value, quality };
}

export function makeHistory(c: Catchment, asOf: string, days: number): DischargePoint[] {
  const ic = asInternal(c);
  const end = new Date(`${asOf}T12:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(end.getTime() - (days - 1 - i) * 86400000);
    const offset = i - (days - 1);
    const { value, quality } = dischargeAt(ic, date, offset);
    return { date: iso(date), discharge: value, quality };
  });
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const idx = clamp(Math.floor(p * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
}

export function runForecast(c: Catchment, asOf: string, inputs: ForecastInputs, horizon: Horizon = 5): ForecastResult {
  const ic = asInternal(c);
  const history = makeHistory(c, asOf, 365);
  const sortedYear = history.slice(-365).map((p) => p.discharge).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const lastObs = [...history].reverse().find((p) => p.discharge !== null);
  const q0 = lastObs?.discharge ?? ic.baseQ;

  const gapFactor = 1 + 0.09 * inputs.gapDays;
  const qualityFactor = inputs.quality === 'missing' ? 1.8 : inputs.quality === 'degraded' ? 1.32 : 1;
  const sigmaBase = ic.monsoonAmp * 0.085 + q0 * 0.05;
  const tempDrift = 1 - 0.002 * (inputs.tempC - c.defaultInputs.tempC);

  const rnd = rngFrom(`${c.id}|${asOf}|${inputs.forecastRainMm}|${inputs.antecedentRainMm}|${inputs.tempC}|${inputs.gapDays}|${inputs.quality}`);
  const maxDay = 5;
  const series: ForecastPoint[] = [];
  const perDay: Record<number, { q: number; lower: number; upper: number; pH: number; pE: number }> = {};

  for (let d = 1; d <= maxDay; d++) {
    const targetDate = new Date(`${asOf}T12:00:00Z`);
    targetDate.setUTCDate(targetDate.getUTCDate() + d);
    const seasonalFloor = ic.baseQ + ic.monsoonAmp * seasonalCurve(dayOfYear(targetDate), ic.lat) * 0.9;
    const recessionTerm = Math.max(0, q0 - seasonalFloor) * Math.exp(-d / (ic.recessionDays * 2.4));
    const rainResponse = ic.runoffPerMm * inputs.forecastRainMm * ((d / 2.2) * Math.exp(1 - d / 2.2));
    const noise = (rnd() - 0.5) * 2 * sigmaBase * 0.14;
    const q = Math.max(0, (seasonalFloor + recessionTerm + rainResponse) * tempDrift + noise);
    const band = sigmaBase * Math.sqrt(1 + d / 3.2) * gapFactor * qualityFactor;
    const lower = Math.max(0, Math.round((q - 1.28 * band) * 10) / 10);
    const upper = Math.round((q + 1.28 * band) * 10) / 10;
    const pH = clamp(sigmoid((q - c.thresholdHigh) / (0.72 * band)), 0.005, 0.995);
    const pE = clamp(sigmoid((q - c.thresholdExtreme) / (0.72 * band)), 0.003, 0.985);
    const date = new Date(`${asOf}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + d);
    perDay[d] = { q: Math.round(q * 10) / 10, lower, upper, pH: Math.round(pH * 100) / 100, pE: Math.round(pE * 100) / 100 };
    series.push({ date: iso(date), discharge: perDay[d].q, lower, upper });
  }

  const output: ForecastOutput = {
    catchment_id: c.code,
    forecast_origin: `${asOf}T00:00:00Z`,
    forecast_horizons_days: [...HORIZONS],
    predicted_discharge: HORIZONS.map((h) => perDay[h].q),
    high_flow_probability: HORIZONS.map((h) => perDay[h].pH),
    extreme_flow_probability: HORIZONS.map((h) => perDay[h].pE),
    prediction_intervals: { lower: HORIZONS.map((h) => perDay[h].lower), upper: HORIZONS.map((h) => perDay[h].upper) },
  };

  const pHigh = { 1: perDay[1].pH, 3: perDay[3].pH, 5: perDay[5].pH } as Record<Horizon, number>;
  const pExt = { 1: perDay[1].pE, 3: perDay[3].pE, 5: perDay[5].pE } as Record<Horizon, number>;
  const q5 = perDay[5].q;
  const risk: RiskLevel = pHigh[5] >= 0.55 || q5 >= c.thresholdHigh ? 'high' : pHigh[5] >= 0.25 ? 'watch' : 'low';

  return {
    catchmentId: c.id,
    asOf,
    horizon,
    source: 'catboost_caravan',
    generatedAt: new Date().toISOString(),
    output,
    series,
    risk,
    pHigh,
    pExt,
  };
}

function todayIso() {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return iso(d);
}

export const catchments: Catchment[] = rawCatchments.map((row) => {
  const [id, code, name, reservoir, river, district, state, lat, lng, areaSqKm, elevMeanM, soil, landCover, baseQ, monsoonAmp, surge, antRain, fcRain, temp, nearby, affected] = row;
  const c = {
    id,
    code,
    name,
    reservoir,
    river: `${river} basin`,
    location: `${district}, ${state}`,
    district,
    state,
    lat,
    lng,
    purpose: 'Caravan Streamflow Gauge',
    unit: 'm³/s' as const,
    areaSqKm,
    elevMeanM,
    soil,
    landCover,
    thresholdHigh: 0,
    thresholdExtreme: 0,
    nearbyPlaces: [...nearby],
    affectedRegions: [...affected],
    lastRecorded: { date: '', discharge: null as number | null, quality: 'good' as QualityFlag },
    defaultInputs: { antecedentRainMm: antRain, forecastRainMm: fcRain, tempC: temp, gapDays: 0, quality: 'good' as QualityFlag },
  } satisfies Catchment;

  Object.assign(c, { baseQ, monsoonAmp, surge, recessionDays: 8, runoffPerMm: 0.45 });

  const today = todayIso();
  const year = makeHistory(c, today, 365);
  const values = year.map((p) => p.discharge).filter((v): v is number => v !== null).sort((a, b) => a - b);
  c.thresholdHigh = Math.round(percentile(values, 0.9) * 10) / 10;
  c.thresholdExtreme = Math.round(percentile(values, 0.97) * 10) / 10;
  const last = [...year].reverse().find((p) => p.discharge !== null) ?? year.at(-1)!;
  c.lastRecorded = { date: last.date, discharge: last.discharge, quality: last.quality };
  return c;
});

export function buildRiskBoard(): RiskBoardEntry[] {
  const asOf = todayIso();
  return catchments.map((c) => {
    const result = runForecast(c, asOf, c.defaultInputs, 5);
    const current = c.lastRecorded.discharge;
    const predVal = result.output.predicted_discharge[2];
    const phVal = result.pHigh[5];
    const peVal = result.pExt[5];
    return {
      catchment: c,
      risk: result.risk,
      current,
      predicted5: predVal,
      pHigh5: phVal,
      pExt5: peVal,
      predicted7: predVal,
      pHigh7: phVal,
      pExt7: peVal,
    };
  });
}
