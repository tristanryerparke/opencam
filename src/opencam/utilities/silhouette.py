from __future__ import annotations

from shapely.geometry import Polygon
from shapely.ops import unary_union

from opencam.schemas.geometry_2d import ClosedPolyline2D, Point2D
from opencam.schemas.mesh import Mesh


def silhouette(mesh: Mesh) -> ClosedPolyline2D:
    """Return the outer outline of a mesh projected onto the XY plane."""
    triangles = [
        Polygon([(mesh.vertices[index][0], mesh.vertices[index][1]) for index in face])
        for face in mesh.faces
    ]
    triangles = [triangle for triangle in triangles if triangle.is_valid and triangle.area > 0.0]
    if not triangles:
        raise ValueError("Mesh has no non-degenerate faces in the XY projection.")

    projected = unary_union(triangles)
    if projected.geom_type != "Polygon":
        raise ValueError("Mesh projection must produce one connected silhouette.")

    return ClosedPolyline2D(
        vertices=[Point2D(x=float(x), y=float(y)) for x, y in projected.exterior.coords]
    )
