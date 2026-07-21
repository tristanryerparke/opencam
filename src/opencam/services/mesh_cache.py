from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from uuid import uuid4

from opencam.schemas.base import CamelBaseModel
from opencam.simulation.swept_volume import load_stl_bounds

MESH_FILE_URL = "/cam/mesh/file"


class CachedMeshMetadata(CamelBaseModel):
    name: str
    mesh_url: str
    max_z: float
    version: str


@dataclass(frozen=True)
class CachedMeshRecord:
    name: str
    content_type: str
    mesh_bytes: bytes
    max_z: float
    version: str


class MeshCache:
    def __init__(self) -> None:
        self._lock = Lock()
        self._current: CachedMeshRecord | None = None

    def get_metadata(self) -> CachedMeshMetadata | None:
        with self._lock:
            if self._current is None:
                return None
            return CachedMeshMetadata(
                name=self._current.name,
                mesh_url=f"{MESH_FILE_URL}?v={self._current.version}",
                max_z=self._current.max_z,
                version=self._current.version,
            )

    def get_mesh(self) -> CachedMeshRecord | None:
        with self._lock:
            return self._current

    def set_mesh(self, name: str, mesh_bytes: bytes, *, content_type: str | None = None) -> CachedMeshMetadata:
        if not mesh_bytes:
            raise ValueError("Mesh upload is empty.")

        _bounds_min, bounds_max = load_stl_bounds(mesh_bytes)
        record = CachedMeshRecord(
            name=name or "mesh.stl",
            content_type=content_type or "model/stl",
            mesh_bytes=mesh_bytes,
            max_z=float(bounds_max[2]),
            version=uuid4().hex,
        )

        metadata = CachedMeshMetadata(
            name=record.name,
            mesh_url=f"{MESH_FILE_URL}?v={record.version}",
            max_z=record.max_z,
            version=record.version,
        )


        with self._lock:
            self._current = record

        return metadata

    def clear(self) -> None:
        with self._lock:
            self._current = None


_MESH_CACHE: MeshCache | None = None
_MESH_CACHE_LOCK = Lock()


def get_mesh_cache() -> MeshCache:
    global _MESH_CACHE
    with _MESH_CACHE_LOCK:
        if _MESH_CACHE is None:
            _MESH_CACHE = MeshCache()
        return _MESH_CACHE
