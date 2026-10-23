from __future__ import annotations

from typing import Literal

import numpy as np
from shapely.geometry import LineString
from shapely.geometry.base import BaseGeometry

from opencam.engine.closed_polyline.offset import offset, quad_segs_for_tolerance
from opencam.engine.closed_polyline.seam_shift import seam_shift
from opencam.engine.closed_polyline.validation import validate_closed_polyline
from opencam.engine.pocketing.seams import (
    longest_straight_edge_midpoint_length_near_initial_seam,
)
from opencam.schemas.geometry_2_5d import ClosedPolyline25D, Polyline25D


def build_profile_layers(
    geometry: ClosedPolyline25D | Polyline25D,
    *,
    tool_diameter: float,
    stock_to_leave: float,
    side: Literal["outside", "inside"],
    cut_direction: Literal["climb", "conventional"],
    chord_tolerance: float,
) -> list[np.ndarray]:
    offset_distance = tool_diameter / 2 + stock_to_leave
    if side == "inside":
        offset_distance = -offset_distance

    if isinstance(geometry, ClosedPolyline25D):
        layers = build_closed_profile_layers(
            geometry.to_numpy(),
            offset_distance=offset_distance,
            chord_tolerance=chord_tolerance,
        )
        counterclockwise = (side == "inside") == (cut_direction == "climb")
        return [
            _orient_closed_profile(layer, counterclockwise=counterclockwise)
            for layer in layers
        ]

    layers = build_open_profile_layers(
        geometry.to_numpy(),
        offset_distance=offset_distance,
        chord_tolerance=chord_tolerance,
    )
    reverse = (side == "inside") == (cut_direction == "climb")
    if reverse:
        return [np.ascontiguousarray(layer[::-1]) for layer in layers]
    return layers


def _orient_closed_profile(
    polyline: np.ndarray, *, counterclockwise: bool
) -> np.ndarray:
    signed_area = float(
        np.sum(polyline[:-1, 0] * polyline[1:, 1] - polyline[1:, 0] * polyline[:-1, 1])
    )
    if (signed_area > 0) == counterclockwise:
        return polyline
    return np.ascontiguousarray(polyline[::-1])


def build_closed_profile_layers(
    polyline: np.ndarray,
    *,
    offset_distance: float,
    chord_tolerance: float,
) -> list[np.ndarray]:
    base_polyline = validate_closed_polyline(polyline)
    base_polyline = seam_shift(
        base_polyline,
        longest_straight_edge_midpoint_length_near_initial_seam(base_polyline),
    )
    polylines = offset(
        base_polyline,
        offset_distance,
        chord_tolerance=chord_tolerance,
    )
    # trust Shapely to keep seam stable here; re-run seam_shift per output loop if offset starts drifting.
    return polylines


def build_open_profile_layers(
    polyline: np.ndarray,
    *,
    offset_distance: float,
    chord_tolerance: float,
) -> list[np.ndarray]:
    validated = validate_open_polyline(polyline)
    shifted = LineString(validated).offset_curve(
        offset_distance,
        quad_segs=quad_segs_for_tolerance(offset_distance, chord_tolerance),
    )
    return linear_geometry_to_polylines(shifted)


def validate_open_polyline(polyline: np.ndarray) -> np.ndarray:
    vertices = np.asarray(polyline, dtype=np.float64)
    if vertices.ndim != 2 or vertices.shape[1] != 2 or vertices.shape[0] < 2:
        raise ValueError("Expected a polyline with at least two vertices.")

    deltas = vertices[1:] - vertices[:-1]
    total_length = float(np.sqrt(deltas[:, 0] * deltas[:, 0] + deltas[:, 1] * deltas[:, 1]).sum())
    if total_length <= 0.0:
        raise ValueError("Expected a polyline with positive total length.")
    return np.ascontiguousarray(vertices)


def linear_geometry_to_polylines(geometry: BaseGeometry) -> list[np.ndarray]:
    if geometry.is_empty:
        return []
    if hasattr(geometry, "geoms"):
        polylines: list[np.ndarray] = []
        for part in geometry.geoms:
            polylines.extend(linear_geometry_to_polylines(part))
        return polylines
    if not hasattr(geometry, "coords"):
        return []

    coordinates = np.asarray(geometry.coords, dtype=np.float64)
    if coordinates.ndim != 2 or coordinates.shape[0] < 2:
        return []
    return [np.ascontiguousarray(coordinates[:, :2])]
