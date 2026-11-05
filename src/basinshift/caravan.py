"""Streaming reader for Caravan's compressed NetCDF archive."""

from __future__ import annotations

import io
import re
import sys
import tarfile
from pathlib import Path, PurePosixPath
from typing import Iterator

import numpy as np
from netCDF4 import Dataset as HDF5Dataset
from scipy.io import netcdf_file

MEMBER_PATTERN = re.compile(
    r"^Caravan-nc/timeseries/netcdf/" r"(?P<source>[^/]+)/(?P<gauge_id>[^/]+)\.nc$"
)
METADATA_PREFIXES = ("Caravan-nc/attributes/", "Caravan-nc/licenses/")


class HDF5Variable:
    """Expose NetCDF4 variables through the NetCDF3 reader interface."""

    def __init__(self, variable) -> None:
        self.variable = variable
        self._attributes = {
            name: variable.getncattr(name) for name in variable.ncattrs()
        }

    def __getitem__(self, key):
        values = self.variable[key]
        if np.ma.isMaskedArray(values) and np.any(np.ma.getmaskarray(values)):
            values = np.ma.asarray(values, dtype=np.float64).filled(np.nan)
        return np.asarray(values)


class HDF5DatasetAdapter:
    """Match the small subset of SciPy's NetCDF3 API used by this project."""

    def __init__(self, dataset) -> None:
        self.dataset = dataset
        self.variables = {
            name: HDF5Variable(variable) for name, variable in dataset.variables.items()
        }
        self._attributes = {name: dataset.getncattr(name) for name in dataset.ncattrs()}

    def close(self) -> None:
        self.dataset.close()


def open_netcdf(raw: bytes, member_name: str):
    """Open a NetCDF3 or NetCDF4 member, preserving a useful error on failure."""
    try:
        return netcdf_file(io.BytesIO(raw), mmap=False)
    except (TypeError, OSError, ValueError) as netcdf3_error:
        try:
            return HDF5DatasetAdapter(HDF5Dataset("inmemory.nc", memory=raw))
        except Exception as netcdf4_error:
            raise OSError(
                f"Could not parse NetCDF member {member_name}: "
                f"NetCDF3: {netcdf3_error}; NetCDF4: {netcdf4_error}"
            ) from netcdf4_error


def iter_netcdf(
    archive_path: str | Path,
    source_filter: set[str] | None = None,
    metadata_directory: str | Path | None = None,
    gauge_filter: set[tuple[str, str]] | None = None,
    allow_partial: bool = False,
) -> Iterator[tuple[str, str, object]]:
    """Yield one opened NetCDF member at a time from a `.tar.gz` archive.

    The caller must consume or copy variable arrays before advancing the
    iterator. The NetCDF handle closes when iteration advances. A truncated
    archive raises by default; `allow_partial=True` accepts only complete
    members before the truncated tail.
    """
    metadata_root = Path(metadata_directory) if metadata_directory else None

    try:
        with tarfile.open(archive_path, mode="r|gz") as archive:
            for member in archive:
                if (
                    metadata_root is not None
                    and member.isfile()
                    and member.name.startswith(METADATA_PREFIXES)
                ):
                    relative_path = PurePosixPath(member.name)
                    if ".." in relative_path.parts:
                        raise OSError(f"Unsafe archive member path: {member.name}")
                    destination = metadata_root.joinpath(*relative_path.parts)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    handle = archive.extractfile(member)
                    if handle is None:
                        raise OSError(f"Could not read archive member {member.name}")
                    raw = handle.read()
                    if len(raw) != member.size:
                        raise OSError(
                            f"Truncated metadata {member.name}: "
                            f"got {len(raw)} of {member.size} bytes"
                        )
                    destination.write_bytes(raw)
                    continue

                match = MEMBER_PATTERN.match(member.name)
                if not member.isfile() or match is None:
                    continue

                source = match.group("source")
                gauge_id = match.group("gauge_id")
                if source_filter is not None and source not in source_filter:
                    continue
                if gauge_filter is not None and (source, gauge_id) not in gauge_filter:
                    continue

                handle = archive.extractfile(member)
                if handle is None:
                    raise OSError(f"Could not read archive member {member.name}")
                raw = handle.read()
                if len(raw) != member.size:
                    raise OSError(
                        f"Truncated member {member.name}: "
                        f"got {len(raw)} of {member.size} bytes"
                    )

                dataset = open_netcdf(raw, member.name)
                try:
                    yield source, gauge_id, dataset
                finally:
                    dataset.close()
    except (EOFError, OSError, tarfile.ReadError) as error:
        if not allow_partial:
            raise
        print(f"Stopped at available archive prefix: {error}", file=sys.stderr)
