from __future__ import annotations

import math

import numpy as np

from opencam.schemas.cl_data import (
    ArcPositionRecord3D,
    FeedRatePositionRecord3D,
    PositionRecord,
    PositionRecord3D,
)

ARC_RADIUS_TOLERANCE = 1e-6


def arc_center(
    start: PositionRecord3D,
    arc: ArcPositionRecord3D,
) -> tuple[float, float]:
    return (
        start.x + arc.center_offset_x,
        start.y + arc.center_offset_y,
    )


def arc_sweep_angle(
    start: PositionRecord3D,
    arc: ArcPositionRecord3D,
) -> float:
    center_x, center_y = arc_center(start, arc)
    start_angle = math.atan2(start.y - center_y, start.x - center_x)
    end_angle = math.atan2(arc.y - center_y, arc.x - center_x)
    if arc.clockwise:
        sweep = -((start_angle - end_angle) % math.tau)
        return -math.tau if math.isclose(sweep, 0.0, abs_tol=1e-12) else sweep
    sweep = (end_angle - start_angle) % math.tau
    return math.tau if math.isclose(sweep, 0.0, abs_tol=1e-12) else sweep


def xy_arc_bounds(
    start: PositionRecord3D,
    arc: ArcPositionRecord3D,
) -> tuple[float, float, float, float]:
    center_x, center_y = arc_center(start, arc)
    radius = math.hypot(start.x - center_x, start.y - center_y)
    start_angle = math.atan2(start.y - center_y, start.x - center_x)
    sweep = arc_sweep_angle(start, arc)
    points = [(start.x, start.y), (arc.x, arc.y)]

    for angle in (0.0, math.pi / 2, math.pi, 3 * math.pi / 2):
        if _angle_is_on_sweep(start_angle, sweep, angle):
            points.append(
                (
                    center_x + radius * math.cos(angle),
                    center_y + radius * math.sin(angle),
                )
            )

    return (
        min(point[0] for point in points),
        min(point[1] for point in points),
        max(point[0] for point in points),
        max(point[1] for point in points),
    )


def _angle_is_on_sweep(start_angle: float, sweep: float, angle: float) -> bool:
    if sweep > 0:
        return (angle - start_angle) % math.tau <= sweep + 1e-12
    return (start_angle - angle) % math.tau <= -sweep + 1e-12


def validate_xy_arc(
    start: PositionRecord3D,
    arc: ArcPositionRecord3D,
    *,
    tolerance: float = ARC_RADIUS_TOLERANCE,
) -> None:
    if not math.isclose(start.z, arc.z, abs_tol=tolerance):
        raise ValueError("XY arc start and end must have the same Z coordinate.")

    center_x, center_y = arc_center(start, arc)
    start_radius = math.hypot(start.x - center_x, start.y - center_y)
    end_radius = math.hypot(arc.x - center_x, arc.y - center_y)
    if start_radius <= tolerance:
        raise ValueError("Arc radius must be greater than zero.")
    if not math.isclose(start_radius, end_radius, rel_tol=1e-6, abs_tol=tolerance):
        raise ValueError("Arc start and end radii must match.")


def sample_xy_arc(
    start: PositionRecord3D,
    arc: ArcPositionRecord3D,
    *,
    chord_tolerance: float,
) -> np.ndarray:
    if chord_tolerance <= 0:
        raise ValueError("Arc chord tolerance must be greater than zero.")
    validate_xy_arc(start, arc)

    center_x, center_y = arc_center(start, arc)
    radius = math.hypot(start.x - center_x, start.y - center_y)
    start_angle = math.atan2(start.y - center_y, start.x - center_x)
    sweep = arc_sweep_angle(start, arc)
    if chord_tolerance >= radius:
        angle_step = math.pi / 8
    else:
        angle_step = min(
            math.pi / 8,
            2 * math.acos(max(-1.0, 1 - chord_tolerance / radius)),
        )
    sample_count = max(2, math.ceil(abs(sweep) / angle_step))
    angles = np.linspace(start_angle, start_angle + sweep, sample_count + 1)
    return np.ascontiguousarray(
        np.column_stack(
            (
                center_x + radius * np.cos(angles),
                center_y + radius * np.sin(angles),
            )
        ),
        dtype=np.float64,
    )


def linearize_arc_records(
    records: list[PositionRecord],
    *,
    chord_tolerance: float,
) -> list[PositionRecord]:
    return [
        position
        for position, _source_index in linearize_arc_records_with_indices(
            records, chord_tolerance=chord_tolerance
        )
    ]


def linearize_arc_records_with_indices(
    records: list[PositionRecord],
    *,
    chord_tolerance: float,
) -> list[tuple[PositionRecord, int]]:
    if not records:
        return []

    output: list[tuple[PositionRecord, int]] = [(records[0], 0)]
    for source_index, record in enumerate(records[1:], start=1):
        if not isinstance(record, ArcPositionRecord3D):
            output.append((record, source_index))
            continue

        start = output[-1][0]
        points = sample_xy_arc(start, record, chord_tolerance=chord_tolerance)
        for index, (x, y) in enumerate(points[1:], start=1):
            output.append(
                (
                    FeedRatePositionRecord3D(
                        x=float(x),
                        y=float(y),
                        z=record.z,
                        feedrate=record.feedrate,
                        comment=record.comment
                        if index == points.shape[0] - 1
                        else None,
                        motion_role=record.motion_role,
                    ),
                    source_index,
                )
            )

    return output
