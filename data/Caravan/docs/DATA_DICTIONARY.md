# Caravan v1.6 data dictionary

Source release: [Zenodo record 15529786](https://zenodo.org/records/15529786), `Caravan-nc.tar.gz`. The archive is expected to be 24,775,734,275 bytes with MD5 `ad3a7767db059f218380e9cce5f72452`.

## Layout and keys

- One NetCDF time series per catchment under `Caravan-nc/timeseries/netcdf/<source>/<source>_<gauge_id>.nc`.
- Static and slow attributes are CSV files under `Caravan-nc/attributes/<source>/`; join them by `gauge_id`.
- Source license and attribution notes are under `Caravan-nc/licenses/`.
- Inspected series have a daily `date` coordinate and 40 single-precision variables. Use each file's time units, calendar, and `Timezone` metadata when aligning dates.

## Time-series variables

| Variable family | NetCDF fields | Meaning | Unit |
|---|---|---|---|
| `streamflow` | `streamflow` | Observed runoff depth | mm/day |
| `total_precipitation` | `total_precipitation_sum` | Daily precipitation sum | mm |
| `potential_evaporation` | `potential_evaporation_sum_ERA5_LAND`, `potential_evaporation_sum_FAO_PENMAN_MONTEITH` | Daily potential evaporation estimates | mm |
| `temperature_2m` | `_min`, `_mean`, `_max` | Near-surface air temperature | deg C |
| `dewpoint_temperature_2m` | `_min`, `_mean`, `_max` | Near-surface dew point | deg C |
| `snow_depth_water_equivalent` | `_min`, `_mean`, `_max` | Snow water equivalent | mm |
| `surface_net_solar_radiation` | `_min`, `_mean`, `_max` | Surface net solar radiation | W/m2 |
| `surface_net_thermal_radiation` | `_min`, `_mean`, `_max` | Surface net thermal radiation | W/m2 |
| `surface_pressure` | `_min`, `_mean`, `_max` | Surface pressure | kPa |
| `u_component_of_wind_10m`, `v_component_of_wind_10m` | each `_min`, `_mean`, `_max` | Wind at 10 m | m/s |
| `volumetric_soil_water_layer_1` through `_4` | each `_min`, `_mean`, `_max` | Soil water at increasing depths | m3/m3 |

Global `Units`, `Source`, and `Timezone` attributes describe each file. Streamflow is area-normalized in mm/day, not m3/s; catchment area is needed for volumetric discharge conversion. The Caravan paper describes the data organization and metadata: [Kratzert et al. (2023)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9887008/).

## Attributes and missing values

Attribute tables include `attributes_caravan_*` climate indices, `attributes_hydroatlas_*` catchment properties, and `attributes_other_*` source-specific data. Preserve `gauge_id` keys and check source-specific terms before redistribution.

Missing observations use NaN. Do not convert missing streamflow to zero. The training pipeline aligns forecast targets by each catchment's daily coordinate and only uses predictors through the forecast origin. Coverage summaries are written to `reports/missingness_by_catchment.csv` after the full archive scan.

See [INVENTORY.md](INVENTORY.md) for file counts and [SPLIT_PLAN.md](SPLIT_PLAN.md) for the proposed evaluation protocol.
