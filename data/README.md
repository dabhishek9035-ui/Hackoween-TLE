# BASINSHIFT source data

This folder records the data sources named in the challenge document. The document is a proposal and does not freeze a benchmark release, geographic subset, variables, periods, or licensing decisions.

## Primary source

- **Caravan v1.6** — official Zenodo record: <https://zenodo.org/records/15529786>. Code bundle is saved in `Caravan/` and its MD5 matches Zenodo. The NetCDF transfer is running resumably into `Caravan-nc.tar.gz.partial`; do not extract/use until the expected 24,775,734,275 bytes arrive and the MD5 (`ad3a7767db059f218380e9cce5f72452`) matches. The CSV release is an alternative encoding, not additional unique data: <https://zenodo.org/records/15530021>.
- Release details: forcing spans 1950–2023; v1.6 updates CAMELS-AUS. Inspect source dataset licenses and release notes before redistribution or competition use.

## Additional sources named in the proposal

These are catalogs or product families, not single downloadable dataset files. No region, variable set, date range, resolution, or product version was specified, so this directory does not silently choose a potentially enormous or mismatched product.

- **GloFAS** — select historical reanalysis, forecast, or reforecast through the Copernicus Climate Data Store; account/API credentials and exact query are required: <https://cds.climate.copernicus.eu/datasets>.
- **Copernicus Emergency Management Service** — select a flood event/mapping product and event area: <https://emergency.copernicus.eu/>
- **WeatherBench 2** — public Google Cloud bucket `gs://weatherbench2/datasets`; choose dataset family, resolution, and period, and check the per-bucket license: <https://weatherbench2.readthedocs.io/en/latest/data-guide.html>.
- **NASA POWER** — API requires point/area, parameters, temporal cadence, and date range: <https://power.larc.nasa.gov/docs/services/api/>.
- **HydroShare** — repository of individual resources, not one dataset; choose resource IDs and check each resource's metadata/license: <https://www.hydroshare.org/>.

The challenge document also cautions that discharge, weather forcing, flood extent, and operational forecasts have different meanings and must not be mixed without an explicit task definition. See `MANIFEST.csv` for source status.
