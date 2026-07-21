from __future__ import annotations

import math

import numpy as np
from shapely.geometry import Polygon

from opencam.engine.pocketing.models import Coordinate2D


def point_side_score(
    point: Coordinate2D,
    pocket_center: Coordinate2D,
    branch_side_vector: Coordinate2D,
) -> float:
    return (
        (point[0] - pocket_center[0]) * branch_side_vector[0]
        + (point[1] - pocket_center[1]) * branch_side_vector[1]
    )


def distance_squared(
    first: Coordinate2D,
    second: Coordinate2D,
) -> float:
    dx = first[0] - second[0]
    dy = first[1] - second[1]
    return dx * dx + dy * dy


def polygon_center(polygon: Polygon) -> Coordinate2D:
    min_x, min_y, max_x, max_y = polygon.bounds
    return ((min_x + max_x) / 2, (min_y + max_y) / 2)


def project_point_onto_segment_distance(
    segment_start: Coordinate2D,
    segment_end: Coordinate2D,
    point: Coordinate2D,
) -> float:
    segment_dx = segment_end[0] - segment_start[0]
    segment_dy = segment_end[1] - segment_start[1]
    segment_length_squared = segment_dx * segment_dx + segment_dy * segment_dy
    if segment_length_squared <= 0.0:
        return 0.0

    point_dx = point[0] - segment_start[0]
    point_dy = point[1] - segment_start[1]
    projection = (
        point_dx * segment_dx + point_dy * segment_dy
    ) / segment_length_squared
    clamped_projection = max(0.0, min(1.0, projection))
    return math.sqrt(segment_length_squared) * clamped_projection


def closed_edge_lengths(polyline: np.ndarray) -> np.ndarray:
    if polyline.shape[0] < 2:
        return np.empty(0, dtype=np.float64)

    deltas = polyline[1:] - polyline[:-1]
    return np.sqrt(deltas[:, 0] * deltas[:, 0] + deltas[:, 1] * deltas[:, 1])
