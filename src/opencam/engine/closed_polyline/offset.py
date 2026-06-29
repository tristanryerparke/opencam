import numpy as np
from shapely import (
    GeometryType,
    boundary as shapely_boundary,
    buffer as shapely_buffer,
    get_coordinates,
    get_parts,
    get_type_id,
    linearrings,
    polygons,
)

from opencam.engine.closed_polyline.dedup import dedup


def offset(
    polyline: np.ndarray,
    distance: float,
    *,
    quad_segs: int = 32,
) -> list[np.ndarray]:
    """Buffer a pre-validated closed 2D polyline."""
    vertices = polyline
    if vertices.shape[0] == 0:
        return []

    # Build a polygon from the already-closed polyline using Shapely's vectorized constructors.
    polygon = polygons(linearrings(vertices))

    # Run the actual offset/buffer operation, then ask Shapely only for the boundary.
    # The boundary may be:
    # - a LineString / LinearRing for a single output loop
    # - a MultiLineString when the offset splits into multiple loops
    # - a GeometryCollection in some edge/degenerate cases
    boundary = shapely_boundary(shapely_buffer(polygon, distance, quad_segs=quad_segs))
    if boundary.is_empty:
        return []

    # Flatten any multipart boundary geometry into a plain Python list of closed Nx2 arrays.
    result: list[np.ndarray] = []
    pending = [boundary]

    while pending:
        geometry = pending.pop()
        geometry_type = GeometryType(get_type_id(geometry))

        if geometry_type in (GeometryType.MULTILINESTRING, GeometryType.GEOMETRYCOLLECTION):
            pending.extend(get_parts(geometry))
            continue

        if geometry_type not in (GeometryType.LINESTRING, GeometryType.LINEARRING):
            continue

        # Pull coordinates directly from Shapely and keep only x/y.
        coordinates = get_coordinates(geometry)
        if coordinates.ndim != 2 or coordinates.shape[0] < 2:
            continue

        ring = np.ascontiguousarray(coordinates[:, :2], dtype=np.float64)

        # Ensure the output is explicitly closed even if Shapely gives us an open line.
        if not np.array_equal(ring[0], ring[-1]):
            ring = np.vstack((ring, ring[0]))

        # A valid closed polyline needs at least 4 rows: A, B, C, A.
        if ring.shape[0] >= 4:
            result.append(dedup(ring))

    return result
