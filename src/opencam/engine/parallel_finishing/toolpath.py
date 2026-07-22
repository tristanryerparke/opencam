"""Parallel-finishing toolpath generation over a TriangleSurface.

Lanes are straight parallel raster lines at the chosen direction, clipped to
each selected cut area (treated as a tool-center boundary). Mixed cuts zig-zag
link consecutive lanes with short cross-feed moves; climb and conventional
cuts retract to clearance between lanes. Every straight segment is adaptively
subdivided until linear interpolation of the cutter-location height is within
chord tolerance, so the emitted path follows the surface exactly relative to
the mesh.
"""

from __future__ import annotations

import math

import numpy as np
from shapely.geometry import LineString, Polygon
from shapely.geometry.base import BaseGeometry

from opencam.engine.closed_polyline.validation import validate_closed_polyline
from opencam.engine.levels.layers import build_cut_record_sequence
from opencam.engine.parallel_finishing.surface import TriangleSurface
from opencam.schemas.cl_data import FeedRatePositionRecord3D, PositionRecord
from opencam.schemas.mesh import Mesh
from opencam.schemas.tools import BallTool, CylindricalTool, Tool

_MAX_SUBDIVISION_DEPTH = 18


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
    """Order segments into continuous polylines, linking adjacent ones by feed.

    Each segment is reoriented so it starts at the end of the previous polyline
    when they are within link_distance; otherwise a new polyline starts (later
    connected by a retract at clearance).
    """
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


def _segment_runs(
    ax: float,
    ay: float,
    bx: float,
    by: float,
    height,
    tolerance: float,
    depth: int = 0,
) -> list[list[tuple[float, float, float]]]:
    """Adaptively sample a straight segment into covered runs.

    Splits where the surface is absent (height None) and subdivides covered
    portions until linear Z interpolation is within tolerance. Returns a list
    of runs; each run is a list of (x, y, z). Gaps become run breaks.
    """
    za = height(ax, ay)
    zb = height(bx, by)
    mx = 0.5 * (ax + bx)
    my = 0.5 * (ay + by)

    # Uncovered at both ends: one midpoint probe avoids exponentially walking
    # a wholly empty segment, while still finding the usual covered island.
    if za is None and zb is None:
        if depth >= _MAX_SUBDIVISION_DEPTH or height(mx, my) is None:
            return []
        return _segment_runs(ax, ay, mx, my, height, tolerance, depth + 1) + _segment_runs(
            mx, my, bx, by, height, tolerance, depth + 1
        )

    # Coverage boundary (one end covered, one not): bisect to isolate the edge.
    if za is None or zb is None:
        if depth >= _MAX_SUBDIVISION_DEPTH:
            return [[(ax, ay, za), (bx, by, zb)]] if (za is not None and zb is not None) else []
        return _segment_runs(ax, ay, mx, my, height, tolerance, depth + 1) + _segment_runs(
            mx, my, bx, by, height, tolerance, depth + 1
        )

    # Both covered. Check for an interior hole between two covered points.
    zm = height(mx, my)
    if zm is None:
        if depth >= _MAX_SUBDIVISION_DEPTH:
            return [[(ax, ay, za), (bx, by, zb)]]
        return _segment_runs(ax, ay, mx, my, height, tolerance, depth + 1) + _segment_runs(
            mx, my, bx, by, height, tolerance, depth + 1
        )

    within_tolerance = abs(zm - 0.5 * (za + zb)) <= tolerance
    if within_tolerance or depth >= _MAX_SUBDIVISION_DEPTH:
        return [[(ax, ay, za), (bx, by, zb)]]
    left = _segment_runs(ax, ay, mx, my, height, tolerance, depth + 1)
    right = _segment_runs(mx, my, bx, by, height, tolerance, depth + 1)
    return _concat_runs(left, right)


def _concat_runs(
    left: list[list[tuple[float, float, float]]],
    right: list[list[tuple[float, float, float]]],
) -> list[list[tuple[float, float, float]]]:
    if not left:
        return right
    if not right:
        return left
    # Both halves meet at the covered midpoint, so their boundary runs are contiguous.
    return left[:-1] + [left[-1] + right[0][1:]] + right[1:]


def _same_point(a: tuple[float, float, float], b: tuple[float, float, float]) -> bool:
    return abs(a[0] - b[0]) <= 1e-9 and abs(a[1] - b[1]) <= 1e-9


def _sample_polyline(
    vertices: list[tuple[float, float]],
    height,
    tolerance: float,
) -> list[list[tuple[float, float, float]]]:
    """Sample a polyline into covered runs, merging contiguous ones across vertices."""
    runs: list[list[tuple[float, float, float]]] = []
    for (ax, ay), (bx, by) in zip(vertices, vertices[1:], strict=False):
        for run in _segment_runs(ax, ay, bx, by, height, tolerance):
            if runs and _same_point(runs[-1][-1], run[0]):
                runs[-1].extend(run[1:])
            else:
                runs.append(list(run))
    return runs


def _height_function(surface: TriangleSurface, tool: Tool, r: float, stock_to_leave: float):
    if isinstance(tool, BallTool):
        base = surface.ball_tool_height
    elif isinstance(tool, CylindricalTool):
        base = surface.flat_tool_height
    else:
        raise NotImplementedError(f"Tool type {tool.type!r} is not supported for parallel finishing.")

    def height(x: float, y: float) -> float | None:
        value = base(x, y, r)
        if not math.isfinite(value):
            return None
        return value + stock_to_leave

    return height


def build_parallel_finishing_area_layers(
    surface: TriangleSurface,
    cut_area_xy: np.ndarray,
    *,
    tool: Tool,
    cut_direction: str = "mixed",
    direction_degrees: float,
    stepover: float,
    stock_to_leave: float,
    chord_tolerance: float,
    feedrate: float,
) -> list[list[FeedRatePositionRecord3D]]:
    radius = tool.diameter / 2.0
    height = _height_function(surface, tool, radius, stock_to_leave)

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
    xy_segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for start, end in sorted(
        lane_segments_uv,
        key=lambda segment: (round(segment[0][1], 9), min(segment[0][0], segment[1][0])),
    ):
        if start[0] > end[0]:
            start, end = end, start
        start_xy = _to_xy(start[0], start[1], cos_t, sin_t)
        end_xy = _to_xy(end[0], end[1], cos_t, sin_t)
        xy_segments.append((start_xy, end_xy))

    if cut_direction == "mixed":
        # ponytail: link_distance is a heuristic 1.5x stepover; if a future polygon
        # shape puts genuinely-adjacent lanes farther apart, raise this factor.
        polylines = _link_segments_zigzag(xy_segments, link_distance=1.5 * stepover + 1e-9)
    elif cut_direction in {"climb", "conventional"}:
        if cut_direction == "conventional":
            xy_segments = [(end, start) for start, end in xy_segments]
        polylines = [[start, end] for start, end in xy_segments]
    else:
        raise ValueError(f"Unsupported parallel finishing cut direction: {cut_direction!r}.")

    layers: list[list[FeedRatePositionRecord3D]] = []
    for polyline in polylines:
        for run in _sample_polyline(polyline, height, chord_tolerance):
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
    cut_direction: str = "mixed",
    direction_degrees: float,
    stepover: float,
    stock_to_leave: float,
    chord_tolerance: float,
    feedrate: float,
    clearance_plane_height: float,
) -> list[PositionRecord]:
    if stepover <= 0.0:
        raise ValueError("Stepover must be greater than zero.")

    surface = TriangleSurface.from_mesh(mesh)

    cut_layers: list[list[FeedRatePositionRecord3D]] = []
    for cut_area in cut_areas:
        cut_layers.extend(
            build_parallel_finishing_area_layers(
                surface,
                cut_area,
                tool=tool,
                cut_direction=cut_direction,
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
