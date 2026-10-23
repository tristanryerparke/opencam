from __future__ import annotations

import math

import numpy as np
from shapely.affinity import rotate
from shapely.geometry import LineString, Polygon

from opencam.engine.levels.heights import compute_layer_heights
from opencam.engine.levels.layers import build_cut_record_sequence
from opencam_contracts.cl_data import FeedRatePositionRecord3D, PositionRecord
from opencam_contracts.operations.facing import Facing2dOp
from opencam_contracts.tools import CylindricalTool


def facing_max_cut_z(operation: Facing2dOp) -> float:
    return operation.levels.max_cut_z(boundary.z for boundary in operation.drive_geometry)


def _stepover(operation: Facing2dOp) -> float:
    model = operation.cut_parameters.stepover
    value = model.value / 100.0 * operation.tool.diameter if model.mode == "percentage_of_tool_diameter" else model.value
    if value <= 0 or value > operation.tool.diameter:
        raise ValueError("Facing stepover must be greater than 0 and no greater than the tool diameter.")
    return value


def _polygon(operation: Facing2dOp) -> tuple[Polygon, float]:
    boundary = operation.drive_geometry[0]
    points = boundary.to_numpy()
    if points.shape[0] > 1 and np.allclose(points[0], points[-1]):
        points = points[:-1]
    polygon = Polygon(points)
    if not polygon.is_valid or polygon.area <= 0:
        raise ValueError("Facing drive geometry must be a valid, non-empty polygon.")
    return polygon, boundary.z


def _lane_coordinates(start: float, end: float, stepover: float) -> list[float]:
    span = end - start
    lane_count = max(1, math.ceil(span / stepover))
    lane_spacing = span / lane_count
    return [start + (index + 0.5) * lane_spacing for index in range(lane_count)]


def _facing_lanes(
    operation: Facing2dOp,
) -> tuple[list[tuple[tuple[float, float], tuple[float, float]]], Polygon]:
    polygon, _ = _polygon(operation)
    extension = operation.cut_parameters.edge_overtravel
    coverage = polygon.buffer(extension, join_style="mitre")
    angle = operation.cut_parameters.direction_degrees
    local = rotate(coverage, -angle, origin=coverage.centroid, use_radians=False)
    min_x, min_y, max_x, max_y = local.bounds
    lanes = []
    for y in _lane_coordinates(min_y, max_y, _stepover(operation)):
        intersection = local.intersection(LineString([(min_x - extension, y), (max_x + extension, y)]))
        parts = list(intersection.geoms) if hasattr(intersection, "geoms") else [intersection]
        for part in parts:
            if part.is_empty or not hasattr(part, "coords"):
                continue
            coords = list(part.coords)
            if len(coords) >= 2:
                local_start, local_end = sorted(
                    (coords[0], coords[-1]),
                    key=lambda point: (point[0], point[1]),
                )
                world = rotate(
                    LineString([local_start, local_end]),
                    angle,
                    origin=coverage.centroid,
                    use_radians=False,
                )
                start, end = list(world.coords)
                lanes.append(((float(start[0]), float(start[1])), (float(end[0]), float(end[1]))))
    if not lanes:
        raise ValueError("Facing generated no cutting passes.")
    return lanes, coverage


def build_facing_records(operation: Facing2dOp, *, clearance_plane_height: float) -> list[PositionRecord]:
    if not isinstance(operation.tool, CylindricalTool):
        raise NotImplementedError("Facing currently supports cylindrical flat-end tools only.")

    _, geometry_z = _polygon(operation)
    lanes, coverage = _facing_lanes(operation)
    direction = operation.cut_parameters.cut_direction
    heights = compute_layer_heights(operation.levels.z_bounds(geometry_z), operation.levels.max_stepdown)
    cut_layers: list[list[FeedRatePositionRecord3D]] = []

    for z in heights:
        if direction == "mixed":
            paths: list[list[tuple[float, float]]] = []
            for index, lane in enumerate(lanes):
                start, end = lane if index % 2 == 0 else (lane[1], lane[0])
                if paths and coverage.covers(LineString([paths[-1][-1], start])):
                    paths[-1].extend([start, end])
                else:
                    paths.append([start, end])
        else:
            # Lanes advance to the left of their canonical travel direction,
            # so clockwise-spindle climb cutting travels the opposite way.
            paths = [
                list(lane if direction == "conventional" else (lane[1], lane[0]))
                for lane in lanes
            ]
        for points in paths:
            cut_layers.append([
                FeedRatePositionRecord3D(x=x, y=y, z=z, feedrate=operation.feeds_and_speeds.cut_feedrate)
                for x, y in points
            ])

    return build_cut_record_sequence(
        cut_layers,
        clearance_plane_height=clearance_plane_height,
        plunge_feedrate=operation.feeds_and_speeds.plunge_feedrate,
    )
