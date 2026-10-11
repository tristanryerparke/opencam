from __future__ import annotations

import json
import logging
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from uuid import uuid4
from zipfile import BadZipFile, ZipFile

import trimesh

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.mesh import Mesh

MESH_FILE_URL = "/cam/mesh/file"
DEFAULT_CACHE_DIR = Path(__file__).resolve().parents[3] / "mesh-cache"
logger = logging.getLogger(__name__)


class CachedMeshMetadata(CamelBaseModel):
    name: str
    mesh_url: str
    max_z: float
    version: str


@dataclass(frozen=True)
class CachedMeshRecord:
    name: str
    step_bytes: bytes
    mesh: Mesh
    mesh_bytes: bytes
    max_z: float
    version: str


class MeshCache:
    def __init__(self, directory: Path | None = None) -> None:
        self._lock = Lock()
        self._cache_file = (directory or DEFAULT_CACHE_DIR) / "current.zip"
        self._current: CachedMeshRecord | None = self._load()

    def _load(self) -> CachedMeshRecord | None:
        try:
            with ZipFile(self._cache_file) as archive:
                metadata = json.loads(archive.read("metadata.json"))
                mesh = Mesh.model_validate_json(archive.read("mesh.json"))
                return CachedMeshRecord(
                    name=metadata["name"],
                    step_bytes=archive.read("part.step"),
                    mesh=mesh,
                    mesh_bytes=archive.read("mesh.stl"),
                    max_z=max(vertex[2] for vertex in mesh.vertices),
                    version=metadata["version"],
                )
        except FileNotFoundError:
            return None
        except (BadZipFile, OSError, ValueError, KeyError, TypeError):
            logger.exception("Unable to restore cached STEP mesh from %s", self._cache_file)
            return None

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

    def set_step(self, name: str, step_bytes: bytes, mesh: Mesh) -> CachedMeshMetadata:
        if not step_bytes:
            raise ValueError("STEP upload is empty.")

        mesh_bytes = trimesh.Trimesh(
            vertices=mesh.vertices,
            faces=mesh.faces,
            process=False,
        ).export(file_type="stl")
        record = CachedMeshRecord(
            name=name or "mesh.step",
            step_bytes=step_bytes,
            mesh=mesh,
            mesh_bytes=mesh_bytes,
            max_z=max(vertex[2] for vertex in mesh.vertices),
            version=uuid4().hex,
        )

        with self._lock:
            self._cache_file.parent.mkdir(parents=True, exist_ok=True)
            temporary_path: Path | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    dir=self._cache_file.parent, suffix=".zip", delete=False
                ) as temporary:
                    temporary_path = Path(temporary.name)
                with ZipFile(temporary_path, "w") as archive:
                    archive.writestr(
                        "metadata.json",
                        json.dumps({"name": record.name, "version": record.version}),
                    )
                    archive.writestr("part.step", record.step_bytes)
                    archive.writestr("mesh.json", record.mesh.model_dump_json(by_alias=True))
                    archive.writestr("mesh.stl", record.mesh_bytes)
                os.replace(temporary_path, self._cache_file)
            finally:
                if temporary_path is not None:
                    temporary_path.unlink(missing_ok=True)
            self._current = record

        return CachedMeshMetadata(
            name=record.name,
            mesh_url=f"{MESH_FILE_URL}?v={record.version}",
            max_z=record.max_z,
            version=record.version,
        )

    def clear(self) -> None:
        with self._lock:
            self._cache_file.unlink(missing_ok=True)
            self._current = None


_MESH_CACHE: MeshCache | None = None
_MESH_CACHE_LOCK = Lock()


def get_mesh_cache() -> MeshCache:
    global _MESH_CACHE
    with _MESH_CACHE_LOCK:
        if _MESH_CACHE is None:
            _MESH_CACHE = MeshCache()
        return _MESH_CACHE
