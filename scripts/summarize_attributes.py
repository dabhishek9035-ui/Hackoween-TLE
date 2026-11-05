"""Inventory the schemas of extracted Caravan attribute CSV files."""

from __future__ import annotations

import csv
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ATTRIBUTES_DIR = (
    PROJECT_ROOT / "data" / "Caravan" / "metadata" / "Caravan-nc" / "attributes"
)
OUTPUT_PATH = PROJECT_ROOT / "reports" / "attribute_tables_inventory.csv"


def main() -> None:
    tables = sorted(ATTRIBUTES_DIR.rglob("*.csv"))
    if not tables:
        raise SystemExit(f"No attribute tables found under {ATTRIBUTES_DIR}")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", newline="", encoding="utf-8") as output:
        writer = csv.writer(output)
        writer.writerow(
            ["relative_path", "rows", "columns", "has_gauge_id", "column_names"]
        )
        for path in tables:
            with path.open(
                "r", newline="", encoding="utf-8-sig", errors="replace"
            ) as handle:
                reader = csv.DictReader(handle)
                fieldnames = reader.fieldnames or []
                row_count = sum(1 for _ in reader)
            writer.writerow(
                [
                    path.relative_to(ATTRIBUTES_DIR).as_posix(),
                    row_count,
                    len(fieldnames),
                    "gauge_id" in fieldnames,
                    "|".join(fieldnames),
                ]
            )

    print(f"Wrote {len(tables)} attribute table schemas to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
