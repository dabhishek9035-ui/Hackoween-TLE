export const projectInfo = {
  name: 'BASINSHIFT',
  eyebrow: 'BASINSHIFT · GLOBAL FLOOD INTELLIGENCE',
  tagline: 'See the flood signal before it crests.',
  highlight:
    'A research workbench for extreme river events. Explore gauge observations, run 1-, 3-, and 7-day discharge forecasts with high-flow odds, and see which basins are drifting toward danger.',
  description:
    'BASINSHIFT pairs gauge observations, meteorological forcing and catchment attributes with sequence-residual CatBoost models trained on Caravan v1.6 records to transfer to unseen river basins. Every run forecasts discharge at official horizons, estimates high-flow threshold exceedance odds, and reports calibrated uncertainty intervals.',
  dataSummary: 'Gauged river basins · daily discharge · 1-, 3-, and 7-day multi-horizon forecast',
  modelSummary:
    'Powered by pooled FIMO gradient-boosting models, producing streamflow predictions with quantile intervals and high-flow exceedance probabilities.',
};

export const DISCLAIMER =
  'Research forecasting system trained on the Caravan streamflow benchmark. For scientific evaluation and hydrological research.';
