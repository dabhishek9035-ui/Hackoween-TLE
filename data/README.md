# Data sources

The challenge document describes BASINSHIFT as a proposal. It does not choose an exact release, region, date range, resolution, or license for each optional source. Dataset selection and download status are recorded in [MANIFEST.csv](MANIFEST.csv).

## Primary data

**Caravan v1.6** is the selected primary source. The official release is available from [Zenodo record 15529786](https://zenodo.org/records/15529786). Its compressed NetCDF archive is 24,775,734,275 bytes with MD5 `ad3a7767db059f218380e9cce5f72452`; the expanded release is about 50.71 GB. The archive is kept under `data/Caravan/` and read member by member to avoid storing a second expanded copy. The downloaded code bundle is also stored there.

The [CSV release](https://zenodo.org/records/15530021) is an alternate encoding of the same data, not an additional dataset. Caravan v1.6 includes forcing data through 2023 and updates CAMELS-AUS. Check source-specific licenses and attribution before redistribution or competition use.

## Optional sources in the proposal

These are product catalogs or resource repositories. No unrequested region, product, or time range is selected automatically.

- **GloFAS:** choose a historical reanalysis, forecast, or reforecast product through the [Copernicus Climate Data Store](https://cds.climate.copernicus.eu/datasets); account access and an exact query may be required.
- **Copernicus Emergency Management Service:** choose a flood event or mapping product and event area at [Copernicus EMS](https://emergency.copernicus.eu/). Flood extent is not discharge.
- **WeatherBench 2:** choose a dataset family, resolution, and period from the [data guide](https://weatherbench2.readthedocs.io/en/latest/data-guide.html); check the license for the chosen bucket.
- **NASA POWER:** an API query needs locations, parameters, cadence, and dates; see the [API documentation](https://power.larc.nasa.gov/docs/services/api/).
- **HydroShare:** select individual resources and inspect their metadata and licenses at [HydroShare](https://www.hydroshare.org/).

Discharge observations, weather forcing, flood extent, and operational forecasts represent different quantities. Use them only with an explicit task definition and documented alignment.
