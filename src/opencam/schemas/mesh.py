from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from pydantic import Field, model_validator

from opencam.schemas.base import CamelBaseModel


class Mesh(CamelBaseModel):
    """Inline triangle-mesh part data."""

    source: Literal["inline"] = Field(default="inline", frozen=True)
    vertices: list[tuple[float, float, float]] = Field(min_length=3, title="Vertices")
    faces: list[tuple[int, int, int]] = Field(min_length=1, title="Faces")

    @model_validator(mode="after")
    def validate_face_indices(self) -> "Mesh":
        vertex_count = len(self.vertices)
        for face in self.faces:
            for index in face:
                if index < 0 or index >= vertex_count:
                    raise ValueError(
                        f"Mesh face index {index} is out of range for {vertex_count} vertices."
                    )
        return self


class CachedMesh(CamelBaseModel):
    """A reference to a mesh cached in the server mesh cache."""

    source: Literal["cached"] = Field(default="cached", frozen=True)
    cache_id: str = Field(min_length=1, title="Cache ID")


CachedMeshLoader = Callable[[str], Mesh | None]


def resolve_part_mesh(
    part_mesh: Mesh | CachedMesh,
    *,
    cached_mesh_loader: CachedMeshLoader | None = None,
) -> Mesh:
    """Resolve a part mesh reference to inline mesh data.

    Inline meshes resolve directly; cached meshes require a loader supplied by
    the host context (the server). This keeps operation generation usable both
    inside and outside the server/caching context.
    """
    if isinstance(part_mesh, Mesh):
        return part_mesh

    if cached_mesh_loader is None:
        raise ValueError("A cached mesh loader is required to resolve a cached part mesh.")

    resolved = cached_mesh_loader(part_mesh.cache_id)
    if resolved is None:
        raise ValueError(f"Cached mesh {part_mesh.cache_id!r} was not found.")
    return resolved
