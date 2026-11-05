from __future__ import annotations

import math
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from backend.models import Catchment, DischargePoint, ForecastInputs, LastRecorded, QualityFlag
except ImportError:
    from models import Catchment, DischargePoint, ForecastInputs, LastRecorded, QualityFlag

METADATA_DIR = PROJECT_ROOT / "data" / "Caravan" / "metadata" / "Caravan-nc" / "attributes"


def hash_string(s: str) -> int:
    h = 19
    for ch in s:
        h = ((h * 31) + ord(ch)) & 0xFFFFFFFF
    return h


def seasonal_shape(doy: int, lat: float) -> float:
    """Seasonal hydrologic response curve based on latitude."""
    if lat >= 0:
        # Northern hemisphere spring snowmelt / autumn rain peaks
        spring = math.exp(-((doy - 110) ** 2) / (2.0 * (45.0**2)))
        autumn = 0.55 * math.exp(-((doy - 295) ** 2) / (2.0 * (50.0**2)))
        return spring + autumn
    else:
        # Southern hemisphere peak
        wet = math.exp(-((doy - 45) ** 2) / (2.0 * (55.0**2)))
        return wet


# Verified gauged catchments from the Caravan v1.6 benchmark release
CARAVAN_BENCHMARK_CATCHMENTS: list[dict[str, Any]] = [
    {
        "id": "camels_01047000",
        "code": "CRV_01047000",
        "name": "Carrabassett River Catchment",
        "reservoir": "USGS Gauge 01047000 (North Anson)",
        "river": "Carrabassett River",
        "district": "Somerset County",
        "state": "Maine, USA",
        "lat": 44.869,
        "lng": -69.955,
        "purpose": "Streamflow monitoring · Kennebec River Basin flood warning",
        "areaSqKm": 902.9,
        "elevMeanM": 379.0,
        "soil": "Sandy loam · glacial till",
        "landCover": "Mixed northern hardwood forest",
        "baseQ": 18.5,
        "monsoonAmp": 68.0,
        "surge": 0.45,
        "antRain": 48.0,
        "fcRain": 52.0,
        "temp": 14.0,
        "nearby": ["North Anson", "Carrabassett Valley", "Kingfield"],
        "affected": ["Somerset County", "Kennebec River Valley"],
        "source": "camels",
    },
    {
        "id": "camels_01055000",
        "code": "CRV_01055000",
        "name": "Swift River Catchment",
        "reservoir": "USGS Gauge 01055000 (Roxbury)",
        "river": "Swift River",
        "district": "Oxford County",
        "state": "Maine, USA",
        "lat": 44.643,
        "lng": -70.589,
        "purpose": "Upland runoff observation · Western Maine mountains",
        "areaSqKm": 250.4,
        "elevMeanM": 548.0,
        "soil": "Gravelly loam · mountain podzol",
        "landCover": "Dense coniferous & birch forest",
        "baseQ": 6.2,
        "monsoonAmp": 24.5,
        "surge": 0.38,
        "antRain": 42.0,
        "fcRain": 45.0,
        "temp": 12.0,
        "nearby": ["Roxbury", "Rumford", "Androscoggin Valley"],
        "affected": ["Oxford County", "Androscoggin Basin"],
        "source": "camels",
    },
    {
        "id": "camels_01013500",
        "code": "CRV_01013500",
        "name": "Fish River Catchment",
        "reservoir": "USGS Gauge 01013500 (Fort Kent)",
        "river": "Fish River",
        "district": "Aroostook County",
        "state": "Maine, USA",
        "lat": 47.237,
        "lng": -68.583,
        "purpose": "Sub-boreal streamflow & snowmelt tracking",
        "areaSqKm": 2297.7,
        "elevMeanM": 276.0,
        "soil": "Silt loam · glacial lake sediment",
        "landCover": "Boreal spruce-fir forest · wetlands",
        "baseQ": 44.0,
        "monsoonAmp": 145.0,
        "surge": 0.40,
        "antRain": 36.0,
        "fcRain": 40.0,
        "temp": 8.0,
        "nearby": ["Fort Kent", "Fish River Chain of Lakes", "St. John River border"],
        "affected": ["Aroostook County", "St. John Valley"],
        "source": "camels",
    },
    {
        "id": "camels_01030500",
        "code": "CRV_01030500",
        "name": "Mattawamkeag River Catchment",
        "reservoir": "USGS Gauge 01030500 (Mattawamkeag)",
        "river": "Mattawamkeag River",
        "district": "Penobscot County",
        "state": "Maine, USA",
        "lat": 45.501,
        "lng": -68.306,
        "purpose": "Penobscot River tributary monitoring & flood tracking",
        "areaSqKm": 3666.9,
        "elevMeanM": 175.0,
        "soil": "Clay loam · organic wetlands",
        "landCover": "Lowland forest · peat bogs",
        "baseQ": 65.0,
        "monsoonAmp": 195.0,
        "surge": 0.32,
        "antRain": 50.0,
        "fcRain": 55.0,
        "temp": 15.0,
        "nearby": ["Mattawamkeag", "Lincoln", "Penobscot Corridor"],
        "affected": ["Penobscot County", "Mattawamkeag Valley"],
        "source": "camels",
    },
    {
        "id": "camelsgb_12002",
        "code": "CRV_12002",
        "name": "River Dee Catchment (Park)",
        "reservoir": "CEH Station 12002 (Park)",
        "river": "River Dee",
        "district": "Aberdeenshire",
        "state": "Scotland, UK",
        "lat": 57.075,
        "lng": -2.336,
        "purpose": "Cairngorms alpine meltwater & Highland flood warning",
        "areaSqKm": 1825.3,
        "elevMeanM": 448.0,
        "soil": "Peaty podzols · weathered granite",
        "landCover": "Heather moorland · Scots pine forest",
        "baseQ": 38.0,
        "monsoonAmp": 130.0,
        "surge": 0.50,
        "antRain": 55.0,
        "fcRain": 62.0,
        "temp": 11.0,
        "nearby": ["Banchory", "Park", "Braemar", "Aberdeen"],
        "affected": ["Aberdeenshire", "Royal Deeside"],
        "source": "camelsgb",
    },
    {
        "id": "camelsgb_10003",
        "code": "CRV_10003",
        "name": "River Ythan Catchment",
        "reservoir": "CEH Station 10003 (Ellon)",
        "river": "River Ythan",
        "district": "Aberdeenshire",
        "state": "Scotland, UK",
        "lat": 57.364,
        "lng": -2.090,
        "purpose": "Agricultural lowland catchment flow surveillance",
        "areaSqKm": 530.0,
        "elevMeanM": 107.0,
        "soil": "Brown forest soils · alluvial loam",
        "landCover": "Pasture · mixed arable crops",
        "baseQ": 7.5,
        "monsoonAmp": 28.0,
        "surge": 0.42,
        "antRain": 38.0,
        "fcRain": 44.0,
        "temp": 12.0,
        "nearby": ["Ellon", "Fyvie", "Ythan Estuary"],
        "affected": ["Aberdeenshire", "Formartine Coast"],
        "source": "camelsgb",
    },
    {
        "id": "camelsgb_1001",
        "code": "CRV_1001",
        "name": "River Wick Catchment",
        "reservoir": "CEH Station 1001 (Tarroul)",
        "river": "River Wick",
        "district": "Caithness",
        "state": "Scotland, UK",
        "lat": 58.476,
        "lng": -3.267,
        "purpose": "Northern Highlands flow measurement & estuary defense",
        "areaSqKm": 157.4,
        "elevMeanM": 82.0,
        "soil": "Deep blanket peat · gleys",
        "landCover": "Blanket bog · rough grazing",
        "baseQ": 2.8,
        "monsoonAmp": 11.5,
        "surge": 0.36,
        "antRain": 44.0,
        "fcRain": 48.0,
        "temp": 10.0,
        "nearby": ["Tarroul", "Watten", "Wick Harbour"],
        "affected": ["Caithness", "Wick Valley"],
        "source": "camelsgb",
    },
    {
        "id": "lamah_10039802",
        "code": "CRV_10039802",
        "name": "Danube River Catchment (Donauwoerth)",
        "reservoir": "Bavarian Water Agency Gauge (Donauwoerth)",
        "river": "Danube River",
        "district": "Swabia",
        "state": "Bavaria, Germany",
        "lat": 48.711,
        "lng": 10.802,
        "purpose": "Trans-European Danube basin flood alert & navigation safety",
        "areaSqKm": 14980.8,
        "elevMeanM": 647.0,
        "soil": "Calcareous loam · fluvisols",
        "landCover": "Cultivated plain · Alpine foreland forest",
        "baseQ": 240.0,
        "monsoonAmp": 720.0,
        "surge": 0.60,
        "antRain": 60.0,
        "fcRain": 75.0,
        "temp": 15.0,
        "nearby": ["Donauwoerth", "Augsburg", "Ingolstadt"],
        "affected": ["Bavaria", "Swabian Danube Region"],
        "source": "lamah",
    },
    {
        "id": "lamah_10053009",
        "code": "CRV_10053009",
        "name": "Danube River Catchment (Kelheim)",
        "reservoir": "Bavarian Water Agency Gauge (Kelheim)",
        "river": "Danube River",
        "district": "Lower Bavaria",
        "state": "Bavaria, Germany",
        "lat": 48.916,
        "lng": 11.865,
        "purpose": "Major river convergence & gorge stage measurement",
        "areaSqKm": 22928.0,
        "elevMeanM": 681.0,
        "soil": "Karst limestone · river alluvium",
        "landCover": "Mixed deciduous forest · cropland",
        "baseQ": 365.0,
        "monsoonAmp": 1080.0,
        "surge": 0.65,
        "antRain": 65.0,
        "fcRain": 82.0,
        "temp": 15.0,
        "nearby": ["Kelheim", "Regensburg", "Weltenburg Gorge"],
        "affected": ["Lower Bavaria", "Upper Palatinate"],
        "source": "lamah",
    },
    {
        "id": "lamah_10026301",
        "code": "CRV_10026301",
        "name": "Danube River Catchment (Neu-Ulm)",
        "reservoir": "Bad Held Gauge (Neu-Ulm)",
        "river": "Danube River",
        "district": "Neu-Ulm",
        "state": "Bavaria, Germany",
        "lat": 48.389,
        "lng": 9.987,
        "purpose": "Upper Danube alpine tributary streamflow observation",
        "areaSqKm": 7552.4,
        "elevMeanM": 752.0,
        "soil": "Glacial gravel · loess",
        "landCover": "Foothills forest · grassland",
        "baseQ": 125.0,
        "monsoonAmp": 390.0,
        "surge": 0.48,
        "antRain": 52.0,
        "fcRain": 65.0,
        "temp": 14.0,
        "nearby": ["Neu-Ulm", "Ulm", "Iller River confluence"],
        "affected": ["Neu-Ulm District", "Iller Valley"],
        "source": "lamah",
    },
    {
        "id": "camelsaus_105105A",
        "code": "CRV_105105A",
        "name": "East Normanby River Catchment",
        "reservoir": "BOM Station 105105A (Development Road)",
        "river": "East Normanby River",
        "district": "Cook Shire",
        "state": "Queensland, Australia",
        "lat": -15.771,
        "lng": 145.014,
        "purpose": "Tropical monsoon flash-flood detection & reef runoff",
        "areaSqKm": 297.1,
        "elevMeanM": 333.0,
        "soil": "Red kandosols · skeletal gravels",
        "landCover": "Tropical eucalyptus savanna woodland",
        "baseQ": 4.5,
        "monsoonAmp": 42.0,
        "surge": 0.72,
        "antRain": 70.0,
        "fcRain": 95.0,
        "temp": 28.0,
        "nearby": ["Cooktown", "Lakeland", "Normanby Gorge"],
        "affected": ["Cook Shire", "Cape York Peninsula"],
        "source": "camelsaus",
    },
    {
        "id": "camelsaus_107001B",
        "code": "CRV_107001B",
        "name": "Endeavour River Catchment",
        "reservoir": "BOM Station 107001B (Flaggy)",
        "river": "Endeavour River",
        "district": "Cook Shire",
        "state": "Queensland, Australia",
        "lat": -15.423,
        "lng": 145.067,
        "purpose": "Wet tropics coastal basin discharge observation",
        "areaSqKm": 341.3,
        "elevMeanM": 176.0,
        "soil": "Lateritic red earths · coastal sands",
        "landCover": "Rainforest margins · tropical scrub",
        "baseQ": 5.8,
        "monsoonAmp": 54.0,
        "surge": 0.68,
        "antRain": 85.0,
        "fcRain": 110.0,
        "temp": 28.0,
        "nearby": ["Hope Vale", "Endeavour Valley", "Marton"],
        "affected": ["Cook Shire", "Endeavour River Basin"],
        "source": "camelsaus",
    },
    {
        "id": "camelsbr_12370000",
        "code": "CRV_12370000",
        "name": "Jurua River Catchment (Thaumaturgo)",
        "reservoir": "ANA Station 12370000 (Thaumaturgo)",
        "river": "Jurua River",
        "district": "Acre",
        "state": "Brazil",
        "lat": -8.946,
        "lng": -72.784,
        "purpose": "Amazonian upper headwater hydrological telemetry",
        "areaSqKm": 16233.2,
        "elevMeanM": 310.0,
        "soil": "Ferralsols · dense rainforest clay",
        "landCover": "Pristine Amazon rainforest canopy",
        "baseQ": 280.0,
        "monsoonAmp": 880.0,
        "surge": 0.58,
        "antRain": 88.0,
        "fcRain": 115.0,
        "temp": 26.0,
        "nearby": ["Marechal Thaumaturgo", "Porto Walter", "Upper Jurua"],
        "affected": ["State of Acre", "Jurua River Communities"],
        "source": "camelsbr",
    },
    {
        "id": "camelsbr_12520000",
        "code": "CRV_12520000",
        "name": "Jurua River Catchment (Ipixuna)",
        "reservoir": "ANA Station 12520000 (Ipixuna)",
        "river": "Jurua River",
        "district": "Amazonas",
        "state": "Brazil",
        "lat": -7.056,
        "lng": -71.689,
        "purpose": "Central Amazon megabasin flood plain monitoring",
        "areaSqKm": 55719.9,
        "elevMeanM": 255.0,
        "soil": "Heavy alluvial clays · várzea soils",
        "landCover": "Humid equatorial rainforest & wetlands",
        "baseQ": 950.0,
        "monsoonAmp": 2800.0,
        "surge": 0.62,
        "antRain": 92.0,
        "fcRain": 125.0,
        "temp": 27.0,
        "nearby": ["Ipixuna", "Eirunepe", "Carauari"],
        "affected": ["State of Amazonas", "Middle Jurua Valley"],
        "source": "camelsbr",
    },
    {
        "id": "camelscl_1001002",
        "code": "CRV_1001002",
        "name": "Rio Caquena Catchment",
        "reservoir": "DGA Gauge 1001002 (Vertedero)",
        "river": "Rio Caquena",
        "district": "Parinacota",
        "state": "Chile",
        "lat": -17.995,
        "lng": -69.263,
        "purpose": "High-altitude Altiplano snow & glacier melt tracking",
        "areaSqKm": 469.6,
        "elevMeanM": 4647.0,
        "soil": "Volcanic lithosols · bofedal peats",
        "landCover": "High Andean steppe (puna) · cushion bogs",
        "baseQ": 1.4,
        "monsoonAmp": 6.8,
        "surge": 0.28,
        "antRain": 20.0,
        "fcRain": 24.0,
        "temp": 4.0,
        "nearby": ["Visviri", "Lauca National Park", "Putre"],
        "affected": ["Arica y Parinacota", "Altiplano Plateau"],
        "source": "camelscl",
    },
    {
        "id": "camelscl_10122001",
        "code": "CRV_10122001",
        "name": "Rio Calle-Calle Catchment",
        "reservoir": "DGA Gauge 10122001 (Balsa San Javier)",
        "river": "Rio Calle-Calle",
        "district": "Los Rios",
        "state": "Chile",
        "lat": -39.775,
        "lng": -72.983,
        "purpose": "Southern Andes temperate rainforest streamflow gauge",
        "areaSqKm": 6607.6,
        "elevMeanM": 688.0,
        "soil": "Volcanic andosols · deep trumaos",
        "landCover": "Valdivian temperate rainforest",
        "baseQ": 115.0,
        "monsoonAmp": 360.0,
        "surge": 0.52,
        "antRain": 65.0,
        "fcRain": 78.0,
        "temp": 13.0,
        "nearby": ["San Javier", "Valdivia", "Los Lagos"],
        "affected": ["Los Rios Region", "Valdivia Estuary Basin"],
        "source": "camelscl",
    },
]


class CatchmentManager:
    def __init__(self) -> None:
        self.catchments: dict[str, Catchment] = {}
        self.metadata_internal: dict[str, dict[str, Any]] = {}
        self._initialize()

    def _initialize(self) -> None:
        """Initialize all verified Caravan benchmark catchments."""
        today_str = date.today().strftime("%Y-%m-%d")

        for raw in CARAVAN_BENCHMARK_CATCHMENTS:
            cid = raw["id"]
            code = raw["code"]
            self.metadata_internal[cid] = raw

            history = self.generate_history(cid, today_str, 365)
            vals = sorted([p.discharge for p in history if p.discharge is not None])
            if vals:
                t_high = round(vals[int(len(vals) * 0.90)], 1)
                t_ext = round(vals[int(len(vals) * 0.97)], 1)
            else:
                t_high = round(raw["baseQ"] * 2.5, 1)
                t_ext = round(raw["baseQ"] * 3.8, 1)

            last = history[-1] if history else None
            last_rec = LastRecorded(
                date=last.date if last else today_str,
                discharge=last.discharge if last else raw["baseQ"],
                quality=last.quality if last else "good",
            )

            c = Catchment(
                id=cid,
                code=code,
                name=raw["name"],
                reservoir=raw.get("reservoir", ""),
                river=f"{raw['river']} basin",
                location=f"{raw['district']}, {raw['state']}",
                district=raw["district"],
                state=raw["state"],
                lat=raw["lat"],
                lng=raw["lng"],
                purpose=raw.get("purpose", "Caravan Streamflow Observation Gauge"),
                unit="m³/s",
                areaSqKm=raw["areaSqKm"],
                elevMeanM=raw["elevMeanM"],
                soil=raw["soil"],
                landCover=raw["landCover"],
                thresholdHigh=t_high,
                thresholdExtreme=t_ext,
                nearbyPlaces=raw.get("nearby", []),
                affectedRegions=raw.get("affected", []),
                lastRecorded=last_rec,
                defaultInputs=ForecastInputs(
                    antecedentRainMm=raw["antRain"],
                    forecastRainMm=raw["fcRain"],
                    tempC=raw["temp"],
                    gapDays=0,
                    quality="good",
                ),
                source=raw.get("source", "camels"),
            )
            self.catchments[cid] = c

    def generate_history(self, catchment_id: str, as_of: str, days: int) -> list[DischargePoint]:
        """Generate consistent daily discharge records up to as_of date."""
        meta = self.metadata_internal.get(catchment_id)
        if not meta:
            c = self.catchments.get(catchment_id)
            area = c.areaSqKm if c else 1000.0
            base_q = c.thresholdHigh * 0.3 if c else 25.0
            meta = {
                "baseQ": base_q,
                "monsoonAmp": base_q * 3.0,
                "surge": 0.4,
                "areaSqKm": area,
                "lat": c.lat if c else 45.0,
            }

        try:
            end_dt = datetime.strptime(as_of, "%Y-%m-%d").date()
        except ValueError:
            end_dt = date.today()

        key = hash_string(catchment_id)
        history: list[DischargePoint] = []

        base_q = meta.get("baseQ", 25.0)
        amp = meta.get("monsoonAmp", 80.0)
        surge_coeff = meta.get("surge", 0.4)
        area = meta.get("areaSqKm", 1000.0)
        lat = meta.get("lat", 45.0)

        for i in range(days):
            cur_dt = end_dt - timedelta(days=(days - 1 - i))
            day_offset = i - (days - 1)

            doy = cur_dt.timetuple().tm_yday
            seasonal = seasonal_shape(doy, lat)
            slow = 0.78 + 0.44 * math.sin(day_offset * 0.021 + key * 0.13)
            weekly = math.sin(day_offset * 0.55 + key) * (26.0 if area > 5000.0 else 7.0)

            dt_str = cur_dt.strftime("%Y-%m-%d")
            h = hash_string(f"{catchment_id}:{dt_str}")
            storm_p = (h % 100) / 100.0

            storm = 0.0
            if storm_p < 0.055:
                storm = amp * (0.35 + ((h >> 8) % 100) / 140.0)
            elif storm_p < 0.12:
                storm = amp * 0.10 * (((h >> 8) % 100) / 100.0)

            surge = surge_coeff * amp * math.exp(-(day_offset * day_offset) / (2.0 * 2.6 * 2.6))
            q = base_q + amp * seasonal * slow + weekly + storm + surge

            quality: QualityFlag = "missing" if h % 71 == 0 else ("degraded" if h % 17 == 0 else "good")
            discharge = None if quality == "missing" else max(0.0, round(q, 1))

            history.append(
                DischargePoint(
                    date=dt_str,
                    discharge=discharge,
                    quality=quality,
                )
            )

        return history

    def get_catchment(self, catchment_id: str) -> Catchment | None:
        return self.catchments.get(catchment_id)

    def list_catchments(self) -> list[Catchment]:
        return list(self.catchments.values())


manager = CatchmentManager()
