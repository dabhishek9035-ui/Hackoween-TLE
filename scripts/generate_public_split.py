"""Build the public catchment split from the verified archive scan."""

from __future__ import annotations

import csv
import hashlib
from collections import Counter
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_DIR = PROJECT_ROOT / "data" / "Caravan" / "manifests"
SOURCE_REPORT = PROJECT_ROOT / "reports" / "missingness_by_catchment.csv"
INVENTORY_PATH = MANIFEST_DIR / "catchment_inventory.csv"
SPLIT_PATH = MANIFEST_DIR / "public_catchment_split.csv"
SEED_PREFIX = b"basinshift-caravan-v1:2026:"
VALIDATION_FRACTION = 0.20


def main() -> None:
    catchments: dict[tuple[str, str], dict[str, str]] = {}
    with SOURCE_REPORT.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            key = (row["source"], row["gauge_id"])
            catchments[key] = row

    if not catchments:
        raise SystemExit(f"No catchments found in {SOURCE_REPORT}")

    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    with INVENTORY_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["source", "gauge_id", "netcdf_path", "date_rows", "timezone"])
        for source, gauge_id in sorted(catchments):
            record = catchments[(source, gauge_id)]
            writer.writerow(
                [
                    source,
                    gauge_id,
                    f"Caravan-nc/timeseries/netcdf/{source}/{gauge_id}.nc",
                    record["date_rows"],
                    record["timezone"],
                ]
            )

    counts: Counter[tuple[str, str]] = Counter()
    with SPLIT_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["source", "gauge_id", "partition", "split_seed"])
        for source, gauge_id in sorted(catchments):
            digest = hashlib.sha256(SEED_PREFIX + gauge_id.encode("utf-8")).digest()
            value = int.from_bytes(digest[:8], "big") / 2**64
            partition = "public_validation" if value < VALIDATION_FRACTION else "train"
            writer.writerow([source, gauge_id, partition, 2026])
            counts[(source, partition)] += 1

    print(f"Wrote {len(catchments):,} catchments to {INVENTORY_PATH}")
    print(f"Wrote public split to {SPLIT_PATH}")
    for (source, partition), count in sorted(counts.items()):
        print(f"{source},{partition},{count}")


if __name__ == "__main__":
    main()
