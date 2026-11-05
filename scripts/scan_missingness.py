"""Verify the Caravan archive and summarize per-catchment coverage."""

from __future__ import annotations

import csv
import hashlib
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from basinshift.caravan import iter_netcdf  # noqa: E402

DATA_DIR = PROJECT_ROOT / "data" / "Caravan"
ARCHIVE_PATH = DATA_DIR / "Caravan-nc.tar.gz"
METADATA_DIR = DATA_DIR / "metadata"
OUTPUT_PATH = PROJECT_ROOT / "reports" / "missingness_by_catchment.csv"
EXPECTED_SIZE = 24_775_734_275
EXPECTED_MD5 = "ad3a7767db059f218380e9cce5f72452"


def percentage(missing: int, total: int) -> str:
    return f"{100 * missing / total:.6f}" if total else "NA"


def verify_archive() -> None:
    actual_size = ARCHIVE_PATH.stat().st_size
    if actual_size != EXPECTED_SIZE:
        raise SystemExit(f"Archive size mismatch: {actual_size} bytes")
    with ARCHIVE_PATH.open("rb") as handle:
        actual_md5 = hashlib.file_digest(handle, "md5").hexdigest()
    if actual_md5 != EXPECTED_MD5:
        raise SystemExit(f"Archive MD5 mismatch: {actual_md5}")
    print(f"Archive size and MD5 verified: {actual_md5}", flush=True)


def main() -> None:
    verify_archive()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    totals: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    scanned = 0

    with OUTPUT_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "source",
                "gauge_id",
                "date_rows",
                "timezone",
                "streamflow_missing_pct",
                "predictor_missing_pct",
                "all_series_missing_pct",
            ]
        )
        for source, gauge_id, dataset in iter_netcdf(
            ARCHIVE_PATH, metadata_directory=METADATA_DIR
        ):
            scanned += 1
            variables = dataset.variables
            date_rows = len(variables["date"][:])
            streamflow = np.asarray(variables["streamflow"][:])
            streamflow_missing = int(np.count_nonzero(~np.isfinite(streamflow)))
            predictor_count = 0
            predictor_missing = 0
            total_count = streamflow.size
            total_missing = streamflow_missing

            for name, variable in variables.items():
                if name in {"date", "streamflow"}:
                    continue
                values = np.asarray(variable[:])
                predictor_count += values.size
                predictor_missing += int(np.count_nonzero(~np.isfinite(values)))
                total_count += values.size
                total_missing += int(np.count_nonzero(~np.isfinite(values)))

            timezone = dataset._attributes.get("Timezone", b"")
            if isinstance(timezone, bytes):
                timezone = timezone.decode("utf-8", errors="replace")
            writer.writerow(
                [
                    source,
                    gauge_id,
                    date_rows,
                    timezone,
                    percentage(streamflow_missing, streamflow.size),
                    percentage(predictor_missing, predictor_count),
                    percentage(total_missing, total_count),
                ]
            )
            totals[source]["catchments"] += 1
            totals[source]["streamflow_values"] += streamflow.size
            totals[source]["streamflow_missing"] += streamflow_missing
            totals[source]["predictor_values"] += predictor_count
            totals[source]["predictor_missing"] += predictor_missing

            if scanned % 500 == 0:
                handle.flush()
                print(f"Scanned {scanned:,} catchments", flush=True)

    print(f"Wrote {scanned:,} catchments to {OUTPUT_PATH}", flush=True)
    for source, values in sorted(totals.items()):
        streamflow_pct = percentage(
            values["streamflow_missing"], values["streamflow_values"]
        )
        predictor_pct = percentage(
            values["predictor_missing"], values["predictor_values"]
        )
        print(
            f"{source}: {values['catchments']} catchments; "
            f"streamflow missing {streamflow_pct}%; "
            f"predictors missing {predictor_pct}%",
            flush=True,
        )


if __name__ == "__main__":
    main()
