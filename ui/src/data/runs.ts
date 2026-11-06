import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RunRecord } from './types';

/* Every forecast run from the workbench is logged here (localStorage via
   zustand persist) and listed on the History page. Benchmark records
   are seeded on first visit so the ledger is initialized with Caravan evaluations. */

const SAMPLE_RUNS: RunRecord[] = [
  {
    id: 'run-carrabassett-01047000',
    savedAt: '2026-10-27T18:04:00.000Z',
    sample: true,
    catchmentId: 'camels_01047000',
    catchmentCode: 'CRV_01047000',
    catchmentName: 'Carrabassett River Catchment',
    river: 'Carrabassett River basin',
    origin: '2026-10-27',
    horizon: 7,
    inputs: { antecedentRainMm: 48, forecastRainMm: 52, tempC: 14, gapDays: 0, quality: 'good' },
    output: {
      catchment_id: 'CRV_01047000',
      forecast_origin: '2026-10-27T00:00:00Z',
      forecast_horizons_days: [1, 3, 7],
      predicted_discharge: [32.4, 48.6, 55.2],
      high_flow_probability: [0.38, 0.49, 0.58],
      extreme_flow_probability: [0.06, 0.11, 0.16],
      prediction_intervals: { lower: [24.1, 36.8, 41.5], upper: [40.7, 60.4, 68.9] },
    },
    risk: 'high',
    predictedQ: 55.2,
    pHigh: 0.58,
    pExt: 0.16,
    lowerAtH: 41.5,
    upperAtH: 68.9,
  },
  {
    id: 'run-danube-10039802',
    savedAt: '2026-10-22T09:41:00.000Z',
    sample: true,
    catchmentId: 'lamah_10039802',
    catchmentCode: 'CRV_10039802',
    catchmentName: 'Danube River (Donauwoerth)',
    river: 'Danube River basin',
    origin: '2026-10-22',
    horizon: 3,
    inputs: { antecedentRainMm: 60, forecastRainMm: 75, tempC: 15, gapDays: 0, quality: 'good' },
    output: {
      catchment_id: 'CRV_10039802',
      forecast_origin: '2026-10-22T00:00:00Z',
      forecast_horizons_days: [1, 3, 7],
      predicted_discharge: [480.5, 620.0, 710.2],
      high_flow_probability: [0.32, 0.45, 0.51],
      extreme_flow_probability: [0.05, 0.08, 0.12],
      prediction_intervals: { lower: [410.2, 520.4, 590.1], upper: [550.8, 719.6, 830.3] },
    },
    risk: 'watch',
    predictedQ: 620.0,
    pHigh: 0.45,
    pExt: 0.08,
    lowerAtH: 520.4,
    upperAtH: 719.6,
  },
  {
    id: 'run-dee-12002',
    savedAt: '2026-10-19T15:12:00.000Z',
    sample: true,
    catchmentId: 'camelsgb_12002',
    catchmentCode: 'CRV_12002',
    catchmentName: 'River Dee Catchment (Park)',
    river: 'River Dee basin',
    origin: '2026-10-19',
    horizon: 7,
    inputs: { antecedentRainMm: 35, forecastRainMm: 38, tempC: 11, gapDays: 0, quality: 'good' },
    output: {
      catchment_id: 'CRV_12002',
      forecast_origin: '2026-10-19T00:00:00Z',
      forecast_horizons_days: [1, 3, 7],
      predicted_discharge: [42.1, 46.5, 49.8],
      high_flow_probability: [0.08, 0.09, 0.11],
      extreme_flow_probability: [0.01, 0.02, 0.02],
      prediction_intervals: { lower: [34.5, 37.2, 39.0], upper: [49.7, 55.8, 60.6] },
    },
    risk: 'low',
    predictedQ: 49.8,
    pHigh: 0.11,
    pExt: 0.02,
    lowerAtH: 39.0,
    upperAtH: 60.6,
  },
];

type RunsState = {
  runs: RunRecord[];
  addRun: (record: RunRecord) => void;
  removeRun: (id: string) => void;
  clearAll: () => void;
};

export const useRunsStore = create<RunsState>()(
  persist(
    (set) => ({
      runs: SAMPLE_RUNS,
      addRun: (record) => set((state) => ({ runs: [record, ...state.runs].slice(0, 100) })),
      removeRun: (id) => set((state) => ({ runs: state.runs.filter((run) => run.id !== id) })),
      clearAll: () => set({ runs: [] }),
    }),
    { name: 'basinshift-runs', version: 2 },
  ),
);
