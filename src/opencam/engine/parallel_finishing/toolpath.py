"""Parallel-finishing lane planning with OpenCAMLib drop-cutter projection."""

from __future__ import annotations

import math

import numpy as np
from shapely.geometry import LineString, Polygon
from shapely.geometry.base import BaseGeometry

from opencam.engine.closed_polyline.validation import validate_closed_polyline
from opencam.engine.levels.layers import build_cut_record_sequence
from opencam.engine.parallel_finishing.ocl_backend import OpenCAMLibDropCutter
from opencam.schemas.cl_data import FeedRatePositionRecord3D, PositionRecord
from opencam.schemas.mesh import Mesh
from opencam.schemas.tools import Tool


def _lane_segments_in_polygon(
    polygon_uv: Polygon,
    u_bounds: tuple[float, float],
    v_values: list[float],
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Straight lane segments (in u,v) at each v, clipped to the polygon."""
    u_min, u_max = u_bounds
    margin = max(u_max - u_min, 1.0) * 1e-6 + 1.0
    segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for v in v_values:
        line = LineString([(u_min - margin, v), (u_max + margin, v)])
        intersection = polygon_uv.intersection(line)
        for start, end in _line_geometry_endpoints(intersection):
            segments.append(((start[0], v), (end[0], v)))
    return segments


def _line_geometry_endpoints(geometry: BaseGeometry) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    if geometry.is_empty:
        return []
    if hasattr(geometry, "geoms"):
        endpoints: list[tuple[tuple[float, float], tuple[float, float]]] = []
        for part in geometry.geoms:
            endpoints.extend(_line_geometry_endpoints(part))
        return endpoints
    coords = getattr(geometry, "coords", None)
    if coords is None or len(coords) < 2:
        return []
    coords = list(coords)
    return [((coords[0][0], coords[0][1]), (coords[-1][0], coords[-1][1]))]


def _to_xy(u: float, v: float, cos_t: float, sin_t: float) -> tuple[float, float]:
    return (u * cos_t - v * sin_t, u * sin_t + v * cos_t)


def _distance(ax: float, ay: float, bx: float, by: float) -> float:
    return math.hypot(bx - ax, by - ay)


def _link_segments_zigzag(
    xy_segments: list[tuple[tuple[float, float], tuple[float, float]]],
    link_distance: float,
) -> list[list[tuple[float, float]]]:
    """Order segments into continuous polylines, linking adjacent ones by feed."""
    polylines: list[list[tuple[float, float]]] = []
    for segment in xy_segments:
        start, end = segment
        if polylines:
            previous_end = polylines[-1][-1]
            if _distance(previous_end[0], previous_end[1], end[0], end[1]) < _distance(
                previous_end[0], previous_end[1], start[0], start[1]
            ):
                start, end = end, start
            if _distance(previous_end[0], previous_end[1], start[0], start[1]) <= link_distance:
                current = polylines[-1]
                if _distance(previous_end[0], previous_end[1], start[0], start[1]) > 1e-9:
                    current.append(start)
                current.append(end)
                continue
        polylines.append([start, end])
    return polylines


def build_parallel_finishing_area_layers(
    backend: OpenCAMLibDropCutter,
    cut_area_xy: np.ndarray,
    *,
    direction_degrees: float,
    stepover: float,
    stock_to_leave: float,
    chord_tolerance: float,
    feedrate: float,
) -> list[list[FeedRatePositionRecord3D]]:
    theta = math.radians(direction_degrees)
    cos_t = math.cos(theta)
    sin_t = math.sin(theta)

    base_polyline = validate_closed_polyline(cut_area_xy)
    u = base_polyline[:, 0] * cos_t + base_polyline[:, 1] * sin_t
    v = -base_polyline[:, 0] * sin_t + base_polyline[:, 1] * cos_t
    polygon_uv = Polygon(np.column_stack([u, v]))
    if not polygon_uv.is_valid:
        polygon_uv = polygon_uv.buffer(0.0)
    if polygon_uv.is_empty or polygon_uv.area <= 0.0:
        return []

    v_min = float(v.min())
    v_max = float(v.max())
    u_min = float(u.min())
    u_max = float(u.max())
    if v_max - v_min < stepover:
        v_values = [0.5 * (v_min + v_max)]
    else:
        v_values = []
        index = 0
        while v_min + index * stepover <= v_max + 1e-9:
            v_values.append(v_min + index * stepover)
            index += 1

    lane_segments_uv = _lane_segments_in_polygon(polygon_uv, (u_min, u_max), v_values)
    xy_segments = [
        (
            _to_xy(start[0], start[1], cos_t, sin_t),
            _to_xy(end[0], end[1], cos_t, sin_t),
        )
        for start, end in sorted(
            lane_segments_uv,
            key=lambda segment: (round(segment[0][1], 9), min(segment[0][0], segment[1][0])),
        )
    ]

    # ponytail: link_distance is a heuristic 1.5x stepover; if a future polygon
    # shape puts genuinely-adjacent lanes farther apart, raise this factor.
    polylines = _link_segments_zigzag(xy_segments, link_distance=1.5 * stepover + 1e-9)

    layers: list[list[FeedRatePositionRecord3D]] = []
    for polyline in polylines:
        for run in backend.project_runs(
            polyline,
            chord_tolerance=chord_tolerance,
            stock_to_leave=stock_to_leave,
        ):
            if len(run) < 2:
                continue
            layers.append(
                [
                    FeedRatePositionRecord3D(
                        x=float(x),
                        y=float(y),
                        z=float(z),
                        feedrate=feedrate,
                    )
                    for x, y, z in run
                ]
            )
    return layers


def build_parallel_finishing_records(
    mesh: Mesh,
    *,
    cut_areas: list[np.ndarray],
    tool: Tool,
    direction_degrees: float,
    stepover: float,
    stock_to_leave: float,
    chord_tolerance: float,
    feedrate: float,
    clearance_plane_height: float,
) -> list[PositionRecord]:
    if stepover <= 0.0:
        raise ValueError("Stepover must be greater than zero.")

    backend = OpenCAMLibDropCutter(mesh, tool)

    cut_layers: list[list[FeedRatePositionRecord3D]] = []
    for cut_area in cut_areas:
        cut_layers.extend(
            build_parallel_finishing_area_layers(
                backend,
                cut_area,
                direction_degrees=direction_degrees,
                stepover=stepover,
                stock_to_leave=stock_to_leave,
                chord_tolerance=chord_tolerance,
                feedrate=feedrate,
            )
        )

    if not cut_layers:
        raise ValueError(
            "No parallel finishing lanes could be generated. The cut area may be "
            "smaller than the stepover, or it does not overlap the part surface."
        )

    records = build_cut_record_sequence(cut_layers, clearance_plane_height=clearance_plane_height)

    max_path_z = max(
        (record.z for record in records if record.feed_type == "feed_rate"),
        default=clearance_plane_height,
    )
    if clearance_plane_height <= max_path_z:
        raise ValueError("Clearance height must be above the highest parallel finishing point.")

    return records
