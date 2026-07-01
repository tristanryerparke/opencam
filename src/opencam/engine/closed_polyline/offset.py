import math

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

from opencam.engine.closed_polyline.cleanup import dedup, simplify

DEFAULT_BUFFER_CHORD_TOLERANCE = 0.01
MINIMUM_QUAD_SEGS = 8


def quad_segs_for_tolerance(
    radius: float,
    chord_tolerance: float = DEFAULT_BUFFER_CHORD_TOLERANCE,
    *,
    minimum: int = MINIMUM_QUAD_SEGS,
) -> int:
    """Return Shapely quad_segs needed to keep circular buffer error within tolerance."""
    radius = abs(radius)
    if radius <= 0.0:
        return minimum
    if chord_tolerance <= 0.0:
        raise ValueError("Expected a positive chord tolerance.")
    if minimum < 1:
        raise ValueError("Expected minimum quad_segs to be at least 1.")
    if chord_tolerance >= radius:
        return minimum

    angle = math.acos(1.0 - chord_tolerance / radius)
    return max(minimum, math.ceil(math.pi / (4.0 * angle)))


def offset(
    polyline: np.ndarray,
    distance: float,
    *,
    chord_tolerance: float = DEFAULT_BUFFER_CHORD_TOLERANCE,
    quad_segs: int | None = None,
) -> list[np.ndarray]:
    """Buffer a pre-validated closed 2D polyline."""
    vertices = polyline
    if vertices.shape[0] == 0:
        return []

    if quad_segs is None:
        quad_segs = quad_segs_for_tolerance(distance, chord_tolerance)
    elif quad_segs < 1:
        raise ValueError("Expected quad_segs to be at least 1.")

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
            result.append(simplify(dedup(ring)))

    return result
