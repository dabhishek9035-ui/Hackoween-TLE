import type { Catchment, CustomForecastResult, CustomModelInputs, DischargePoint, ForecastInputs, ForecastResult, Horizon, RiskBoardEntry } from './types';
import { buildRiskBoard as mockRiskBoard, catchments as mockCatchments, makeHistory as mockHistory, runForecast as mockForecast } from './mock';

/* BASINSHIFT Live Backend API Client.
   Directly integrates the Next.js UI with the FastAPI CatBoost inference service. */

const API_BASE = typeof window !== 'undefined'
  ? ''
  : (process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000');

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API error ${res.status}: ${errorText || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchCatchments(signal?: AbortSignal): Promise<Catchment[]> {
  try {
    const res = await fetch(`${API_BASE}/api/catchments`, {
      signal,
      headers: { Accept: 'application/json' },
    });
    return await handleResponse<Catchment[]>(res);
  } catch (err: any) {
    if (signal?.aborted) throw err;
    console.warn('Backend unavailable, using local register fallback:', err.message);
    return mockCatchments;
  }
}

export async function fetchHistory(
  c: Catchment,
  asOf: string,
  days: number,
  signal?: AbortSignal,
): Promise<DischargePoint[]> {
  try {
    const params = new URLSearchParams({
      catchmentId: c.id,
      asOf,
      days: String(days),
    });
    const res = await fetch(`${API_BASE}/api/history?${params.toString()}`, {
      signal,
      headers: { Accept: 'application/json' },
    });
    return await handleResponse<DischargePoint[]>(res);
  } catch (err: any) {
    if (signal?.aborted) throw err;
    console.warn('Backend unavailable, using local history fallback:', err.message);
    return mockHistory(c, asOf, days);
  }
}

export async function fetchForecast(
  c: Catchment,
  asOf: string,
  inputs: ForecastInputs,
  horizon: Horizon,
  signal?: AbortSignal,
): Promise<ForecastResult> {
  try {
    const res = await fetch(`${API_BASE}/api/forecast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        catchmentId: c.id,
        catchment: c,
        asOf,
        inputs,
        horizon,
      }),
      signal,
    });
    return await handleResponse<ForecastResult>(res);
  } catch (err: any) {
    if (signal?.aborted) throw err;
    console.warn('Backend unavailable, using local inference fallback:', err.message);
    return mockForecast(c, asOf, inputs, horizon);
  }
}

export async function fetchRiskBoard(signal?: AbortSignal): Promise<RiskBoardEntry[]> {
  try {
    const res = await fetch(`${API_BASE}/api/risk-board`, {
      signal,
      headers: { Accept: 'application/json' },
    });
    return await handleResponse<RiskBoardEntry[]>(res);
  } catch (err: any) {
    if (signal?.aborted) throw err;
    console.warn('Backend unavailable, using local risk board fallback:', err.message);
    return mockRiskBoard();
  }
}

export async function fetchCustomForecast(
  inputs: CustomModelInputs,
  signal?: AbortSignal,
): Promise<CustomForecastResult> {
  try {
    const res = await fetch(`${API_BASE}/api/predict/custom`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(inputs),
      signal,
    });
    return await handleResponse<CustomForecastResult>(res);
  } catch (err: any) {
    if (signal?.aborted) throw err;
    console.warn('Backend unavailable, using local custom forecast fallback:', err.message);

    // Fallback response matching the contract
    const q0 = inputs.flow_lag_0;
    const area = inputs.areaSqKm || 1000;
    const mmToM3s = area / 86.4;
    const res1 = 0.45 * inputs.precip_lag_0 * 0.15;
    const res3 = 0.35 * inputs.precip_sum_3d * 0.12;
    const res7 = 0.15 * inputs.precip_sum_14d * 0.05;

    const q1 = Math.max(0, q0 + res1);
    const q3 = Math.max(0, q0 + res3);
    const q7 = Math.max(0, q0 + res7);

    const horizons = [1, 3, 7];
    const runoff = [q1, q3, q7].map((v) => Math.round(v * 100) / 100);
    const discharges = [q1 * mmToM3s, q3 * mmToM3s, q7 * mmToM3s].map((v) => Math.round(v * 10) / 10);
    const residuals = [res1, res3, res7].map((v) => Math.round(v * 100) / 100);

    const baseDate = inputs.originDate || new Date().toISOString().slice(0, 10);
    const baseDt = new Date(baseDate);

    const series = [1, 2, 3, 4, 5, 6, 7].map((d) => {
      const target = new Date(baseDt);
      target.setDate(target.getDate() + d);
      const val = d <= 1 ? discharges[0] : d <= 3 ? discharges[1] : discharges[1] + ((discharges[2] - discharges[1]) * (d - 3)) / 4;
      return {
        date: target.toISOString().slice(0, 10),
        discharge: val,
        lower: Math.max(0, Math.round((val * 0.8) * 10) / 10),
        upper: Math.round((val * 1.25) * 10) / 10,
      };
    });

    const tHigh = inputs.thresholdHigh || 70;
    const tExt = inputs.thresholdExtreme || 120;
    const pHigh = discharges.map((q) => Math.min(0.99, Math.max(0.01, Math.round((q / tHigh) * 0.5 * 100) / 100)));
    const pExt = discharges.map((q) => Math.min(0.98, Math.max(0.01, Math.round((q / tExt) * 0.3 * 100) / 100)));

    const risk = pHigh[2] >= 0.55 || discharges[2] >= tHigh ? 'high' : pHigh[2] >= 0.25 ? 'watch' : 'low';

    return {
      basinName: inputs.basinName || 'Custom River Basin',
      originDate: baseDate,
      horizons,
      predictedRunoffMm: runoff,
      predictedDischargeM3s: discharges,
      residualsMm: residuals,
      predictionIntervals: {
        lower: discharges.map((q) => Math.max(0, Math.round((q * 0.8) * 10) / 10)),
        upper: discharges.map((q) => Math.round((q * 1.25) * 10) / 10),
      },
      highFlowProbability: pHigh,
      extremeFlowProbability: pExt,
      risk,
      series,
      featureNames: Object.keys(inputs),
      inputFeatures: inputs as any,
      generatedAt: new Date().toISOString(),
    };
  }
}
