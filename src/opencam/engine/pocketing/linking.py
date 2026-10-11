from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import pairwise, product

import numpy as np
from shapely.geometry import LineString, Polygon
from shapely.geometry.base import BaseGeometry

from opencam.engine.closed_polyline.offset import quad_segs_for_tolerance
from opencam.engine.closed_polyline.validation import validate_closed_polyline
from opencam.schemas.cl_data import ArcPositionRecord3D, FeedRatePositionRecord3D

MINIMUM_DISTANCE = 1e-9


@dataclass(frozen=True)
class LinearLinkMove2D:
    target: tuple[float, float]


@dataclass(frozen=True)
class ArcLinkMove2D:
    target: tuple[float, float]
    center: tuple[float, float]
    clockwise: bool


@dataclass(frozen=True)
class KeepDownLink:
    moves: tuple[LinearLinkMove2D | ArcLinkMove2D, ...]


def build_tool_center_region(
    polyline: np.ndarray,
    *,
    tool_diameter: float,
    stock_to_leave: float,
    chord_tolerance: float,
) -> BaseGeometry:
    base_polyline = validate_closed_polyline(polyline)
    center_offset = tool_diameter / 2 + stock_to_leave
    return Polygon(base_polyline).buffer(
        -center_offset,
        quad_segs=quad_segs_for_tolerance(center_offset, chord_tolerance),
    )


def build_keep_down_links(
    paths: list[np.ndarray],
    polyline: np.ndarray,
    *,
    tool_diameter: float,
    stock_to_leave: float,
    chord_tolerance: float,
) -> list[KeepDownLink | None]:
    if len(paths) < 2:
        return []

    center_region = build_tool_center_region(
        polyline,
        tool_diameter=tool_diameter,
        stock_to_leave=stock_to_leave,
        chord_tolerance=chord_tolerance,
    )
    if center_region.is_empty:
        return [None] * (len(paths) - 1)

    safe_region = center_region.buffer(max(MINIMUM_DISTANCE, chord_tolerance * 1e-6))
    return [
        _build_keep_down_link(
            current,
            next_path,
            safe_region=safe_region,
            tool_diameter=tool_diameter,
            chord_tolerance=chord_tolerance,
        )
        for current, next_path in pairwise(paths)
    ]


def build_linked_cut_layers(
    paths: list[np.ndarray],
    links: list[KeepDownLink | None],
    heights: list[float],
    *,
    feedrate: float,
) -> list[list[FeedRatePositionRecord3D | ArcPositionRecord3D]]:
    if len(links) != max(0, len(paths) - 1):
        raise ValueError(
            "Expected one keep-down link decision between each pocket path."
        )

    layers: list[list[FeedRatePositionRecord3D | ArcPositionRecord3D]] = []
    for height in heights:
        current = _path_records(paths[0], height=height, feedrate=feedrate)
        for index, link in enumerate(links):
            next_records = _path_records(
                paths[index + 1],
                height=height,
                feedrate=feedrate,
            )
            if link is None:
                layers.append(current)
                current = next_records
                continue

            for move in link.moves:
                start = current[-1]
                if isinstance(move, ArcLinkMove2D):
                    current.append(
                        ArcPositionRecord3D(
                            x=move.target[0],
                            y=move.target[1],
                            z=height,
                            center_offset_x=move.center[0] - start.x,
                            center_offset_y=move.center[1] - start.y,
                            clockwise=move.clockwise,
                            feedrate=feedrate,
                            comment="keep tool down",
                            motion_role="linking",
                        )
                    )
                else:
                    current.append(
                        FeedRatePositionRecord3D(
                            x=move.target[0],
                            y=move.target[1],
                            z=height,
                            feedrate=feedrate,
                            comment="keep tool down",
                            motion_role="linking",
                        )
                    )

            current.extend(next_records[1:])

        layers.append(current)

    return layers


def _path_records(
    path: np.ndarray,
    *,
    height: float,
    feedrate: float,
) -> list[FeedRatePositionRecord3D | ArcPositionRecord3D]:
    return [
        FeedRatePositionRecord3D(
            x=float(x),
            y=float(y),
            z=height,
            feedrate=feedrate,
        )
        for x, y in path
    ]


def _build_keep_down_link(
    current: np.ndarray,
    next_path: np.ndarray,
    *,
    safe_region: BaseGeometry,
    tool_diameter: float,
    chord_tolerance: float,
) -> KeepDownLink | None:
    if current.shape[0] == 0 or next_path.shape[0] == 0:
        return None

    start = np.asarray(current[-1], dtype=np.float64)
    end = np.asarray(next_path[0], dtype=np.float64)
    distance = float(np.linalg.norm(end - start))
    if distance <= MINIMUM_DISTANCE:
        return KeepDownLink(moves=())

    start_tangent = _end_tangent(current)
    end_tangent = _start_tangent(next_path)
    if start_tangent is not None and end_tangent is not None:
        maximum_radius = min(distance / 3, tool_diameter * 0.15)
        for scale in (1.0, 0.5, 0.25, 0.125):
            radius = maximum_radius * scale
            candidates = [
                candidate
                for first_turn, second_turn in product((1, -1), repeat=2)
                if (
                    candidate := _arc_line_arc_candidate(
                        start,
                        end,
                        start_tangent,
                        end_tangent,
                        radius=radius,
                        first_turn=first_turn,
                        second_turn=second_turn,
                        safe_region=safe_region,
                        chord_tolerance=chord_tolerance,
                    )
                )
                is not None
            ]
            if candidates:
                return min(candidates, key=lambda item: item[0])[1]

    direct = LineString((start, end))
    if safe_region.covers(direct):
        return KeepDownLink(
            moves=(LinearLinkMove2D(target=(float(end[0]), float(end[1]))),)
        )
    return None


def _arc_line_arc_candidate(
    start: np.ndarray,
    end: np.ndarray,
    start_tangent: np.ndarray,
    end_tangent: np.ndarray,
    *,
    radius: float,
    first_turn: int,
    second_turn: int,
    safe_region: BaseGeometry,
    chord_tolerance: float,
) -> tuple[float, KeepDownLink] | None:
    first_center = start + first_turn * radius * _left_normal(start_tangent)
    second_center = end + second_turn * radius * _left_normal(end_tangent)
    center_delta = second_center - first_center
    center_distance_squared = float(np.dot(center_delta, center_delta))
    tangent_offset = (second_turn - first_turn) * radius
    if center_distance_squared <= tangent_offset * tangent_offset + MINIMUM_DISTANCE:
        return None

    tangent_length = math.sqrt(
        center_distance_squared - tangent_offset * tangent_offset
    )
    tangent = (
        tangent_length * center_delta - tangent_offset * _left_normal(center_delta)
    ) / center_distance_squared
    first_tangent_point = first_center - first_turn * radius * _left_normal(tangent)
    second_tangent_point = second_center - second_turn * radius * _left_normal(tangent)

    first_sweep = _arc_sweep(
        start,
        first_tangent_point,
        first_center,
        clockwise=first_turn < 0,
    )
    second_sweep = _arc_sweep(
        second_tangent_point,
        end,
        second_center,
        clockwise=second_turn < 0,
    )
    if abs(first_sweep) > math.pi or abs(second_sweep) > math.pi:
        return None

    moves: list[LinearLinkMove2D | ArcLinkMove2D] = []
    connector_points = [start]
    collision_chord_tolerance = min(chord_tolerance / 1000, 1e-5)
    if abs(first_sweep) > 1e-9:
        moves.append(
            ArcLinkMove2D(
                target=(float(first_tangent_point[0]), float(first_tangent_point[1])),
                center=(float(first_center[0]), float(first_center[1])),
                clockwise=first_turn < 0,
            )
        )
        connector_points.extend(
            _sample_arc(
                start,
                first_tangent_point,
                first_center,
                sweep=first_sweep,
                chord_tolerance=collision_chord_tolerance,
            )[1:]
        )

    straight_length = float(np.linalg.norm(second_tangent_point - first_tangent_point))
    if straight_length > MINIMUM_DISTANCE:
        moves.append(
            LinearLinkMove2D(
                target=(float(second_tangent_point[0]), float(second_tangent_point[1]))
            )
        )
        connector_points.append(second_tangent_point)

    if abs(second_sweep) > 1e-9:
        moves.append(
            ArcLinkMove2D(
                target=(float(end[0]), float(end[1])),
                center=(float(second_center[0]), float(second_center[1])),
                clockwise=second_turn < 0,
            )
        )
        connector_points.extend(
            _sample_arc(
                second_tangent_point,
                end,
                second_center,
                sweep=second_sweep,
                chord_tolerance=collision_chord_tolerance,
            )[1:]
        )

    if not moves or not safe_region.covers(LineString(connector_points)):
        return None

    length = radius * (abs(first_sweep) + abs(second_sweep)) + straight_length
    return length, KeepDownLink(moves=tuple(moves))


def _arc_sweep(
    start: np.ndarray,
    end: np.ndarray,
    center: np.ndarray,
    *,
    clockwise: bool,
) -> float:
    start_angle = math.atan2(start[1] - center[1], start[0] - center[0])
    end_angle = math.atan2(end[1] - center[1], end[0] - center[0])
    if clockwise:
        return -((start_angle - end_angle) % math.tau)
    return (end_angle - start_angle) % math.tau


def _sample_arc(
    start: np.ndarray,
    end: np.ndarray,
    center: np.ndarray,
    *,
    sweep: float,
    chord_tolerance: float,
) -> np.ndarray:
    radius = float(np.linalg.norm(start - center))
    start_angle = math.atan2(start[1] - center[1], start[0] - center[0])
    if chord_tolerance >= radius:
        angle_step = math.pi / 8
    else:
        angle_step = min(
            math.pi / 8,
            2 * math.acos(max(-1.0, 1 - chord_tolerance / radius)),
        )
    count = max(2, math.ceil(abs(sweep) / angle_step))
    angles = np.linspace(start_angle, start_angle + sweep, count + 1)
    points = np.column_stack(
        (
            center[0] + radius * np.cos(angles),
            center[1] + radius * np.sin(angles),
        )
    )
    points[-1] = end
    return np.ascontiguousarray(points, dtype=np.float64)


def _end_tangent(path: np.ndarray) -> np.ndarray | None:
    endpoint = path[-1]
    for index in range(path.shape[0] - 2, -1, -1):
        tangent = _unit_vector(endpoint - path[index])
        if tangent is not None:
            return tangent
    return None


def _start_tangent(path: np.ndarray) -> np.ndarray | None:
    start = path[0]
    for index in range(1, path.shape[0]):
        tangent = _unit_vector(path[index] - start)
        if tangent is not None:
            return tangent
    return None


def _unit_vector(vector: np.ndarray) -> np.ndarray | None:
    length = math.hypot(float(vector[0]), float(vector[1]))
    if length <= MINIMUM_DISTANCE:
        return None
    return vector / length


def _left_normal(vector: np.ndarray) -> np.ndarray:
    return np.asarray((-vector[1], vector[0]), dtype=np.float64)
