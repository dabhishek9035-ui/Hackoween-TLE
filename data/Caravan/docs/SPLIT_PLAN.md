# Proposed Caravan split and evaluation plan

This is a development split proposal based on the BASINSHIFT challenge document. It is not an official challenge split or leaderboard. Hidden catchments, labels, and periods should remain in a protected evaluator.

## Public catchment split

- `data/Caravan/manifests/public_catchment_split.csv` assigns about 80% of catchments overall to training and 20% to public validation. See the manifest for exact source counts.
- Every date from a catchment remains in one partition; split catchments before creating forecast windows.
- The assignment is deterministic from SHA-256 of `basinshift-caravan-v1:2026:<gauge_id>`.
- Public validation is for model iteration. Do not use it to claim hidden-test performance.

The regenerated manifest contains 13,043 training and 3,256 public-validation catchments:

| Source | Train | Public validation |
|---|---:|---:|
| `camels` | 552 | 119 |
| `camelsaus` | 460 | 101 |
| `camelsbr` | 710 | 160 |
| `camelscl` | 400 | 105 |
| `camelsgb` | 519 | 152 |
| `hysets` | 9,704 | 2,458 |
| `lamah` | 698 | 161 |
| **Total** | **13,043** | **3,256** |

## Forecast protocol

The current model trains separate one-, three-, and five-day forecasts. For horizon `h`, the target is `streamflow(t+h)`, using predictors available through day `t`. Persistence predicts `streamflow(t)` for every horizon. Scores compare both predictors on identical rows and report pooled and per-catchment metrics.

Potential temporal periods from the proposal are training through 2005, temporal validation during 2006-2015, and a hidden test during 2016-2023. Confirm discharge coverage and event counts before freezing those periods. Derive dates from each file's coordinate and timezone.

## Before a benchmark release

1. Freeze target units, forecast horizons, origin, and high-flow definitions.
2. Compute thresholds from an approved training reference period only.
3. Publish public validation IDs and ranges while protecting hidden labels and metadata.
4. Report data coverage and exclusions by source, split, horizon, and event class.
5. Audit catchment, time-window, attribute, and external-data leakage.
6. Version the split, dataset checksum, and model configuration.
