from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np
from shapely.geometry import LineString, Polygon
from shapely.geometry.base import BaseGeometry

from opencam.engine.closed_polyline.offset import offset, quad_segs_for_tolerance
from opencam.engine.closed_polyline.validation import validate_closed_polyline
from opencam.schemas.cam import CAMSetup
from opencam.schemas.cl_data import FeedRatePositionRecord3D, OperationRecord3D, PositionRecord, PositionRecord3D, RapidPositionRecord3D
from opencam.schemas.geometry_2_5d import ClosedPolyline25D, Polyline25D
from opencam.schemas.operations.base import BaseCAMOperation
from opencam.schemas.operations.pocketing import Pocketing2dOp
from opencam.schemas.operations.profiling import Profiling2dOp
from opencam.schemas.tools import CylindricalTool
from opencam.services.operations.base import BaseOperation
from opencam.services.operations.pocketing.geometry import PocketGeometryMixin
from opencam.services.operations.pocketing.paths import PocketPathMixin
from opencam.services.operations.pocketing.seams import PocketSeamMixin
from opencam.services.operations.pocketing.tree import PocketTreeMixin


@dataclass
class _PocketingContext(
    PocketGeometryMixin,
    PocketSeamMixin,
    PocketTreeMixin,
    PocketPathMixin,
):
    tool: CylindricalTool
    stepover: float
    stock_to_leave: float
    chord_tolerance: float


class _ProfilingContext(PocketGeometryMixin, PocketSeamMixin):
    pass


def cam_engine(
    setup: CAMSetup,
    operation: BaseCAMOperation,
) -> OperationRecord3D:
    tool, feedrate, rpm = _tool_and_feeds(operation)
    clearance_plane_height = setup.clearance_height(operation)

    if isinstance(operation, Pocketing2dOp):
        records = _geometry_records(
            operation.drive_geometry.cut_areas,
            lambda geometry: _pocket_records(
                geometry,
                operation,
                tool=tool,
                feedrate=feedrate,
                rpm=rpm,
                clearance_plane_height=clearance_plane_height,
            ),
        )
    elif isinstance(operation, Profiling2dOp):
        records = _geometry_records(
            operation.drive_geometry.profiles,
            lambda geometry: _profile_records(
                geometry,
                operation,
                tool=tool,
                feedrate=feedrate,
                rpm=rpm,
                clearance_plane_height=clearance_plane_height,
            ),
        )
    else:
        raise NotImplementedError(f"Operation type {operation.type!r} is not supported.")

    return OperationRecord3D(
        tool=tool,
        clearance_plane_height=clearance_plane_height,
        records=records,
    )


def _geometry_records(
    geometries,
    build_records: Callable[[object], list[PositionRecord]],
) -> list[PositionRecord]:
    records: list[PositionRecord] = []

    for geometry in geometries:
        geometry_records = build_records(geometry)
        if records and geometry_records:
            travel = _xy_travel_record(records[-1], geometry_records[0])
            if travel is not None:
                records.append(travel)
            if _positions_match(records[-1], geometry_records[0]):
                geometry_records = geometry_records[1:]
        records.extend(geometry_records)

    return records


def _tool_and_feeds(operation: BaseCAMOperation) -> tuple[CylindricalTool, float, int]:
    if not isinstance(operation.tool, CylindricalTool):
        raise NotImplementedError(f"Tool type {operation.tool.type!r} is not supported for operation generation.")
    return (
        operation.tool,
        operation.feeds_and_speeds.cut_feedrate,
        operation.feeds_and_speeds.spindle_rpm,
    )


def _record_builder(
    *,
    tool: CylindricalTool,
    feedrate: float,
    rpm: int,
    clearance_plane_height: float,
) -> BaseOperation:
    return BaseOperation(
        tool=tool,
        feedrate=feedrate,
        rpm=rpm,
        clearance_plane_height=clearance_plane_height,
    )


def _pocket_records(
    geometry: ClosedPolyline25D,
    operation: Pocketing2dOp,
    *,
    tool: CylindricalTool,
    feedrate: float,
    rpm: int,
    clearance_plane_height: float,
) -> list[PositionRecord]:
    if operation.cut_parameters.stepover.mode == "percentage_of_tool_diameter":
        stepover = operation.cut_parameters.stepover.value
    else:
        stepover = operation.cut_parameters.stepover.value / tool.diameter * 100
    if not 0 < stepover <= 100:
        raise ValueError("Stepover must be greater than 0% and no more than 100%.")

    context = _PocketingContext(
        tool=tool,
        stepover=stepover,
        stock_to_leave=operation.cut_parameters.stock_to_leave,
        chord_tolerance=operation.advanced.chordal_tolerance,
    )
    record_builder = _record_builder(
        tool=tool,
        feedrate=feedrate,
        rpm=rpm,
        clearance_plane_height=clearance_plane_height,
    )
    base_polyline = context.shift_seam_to_longest_straight_edge_near_initial_seam(
        validate_closed_polyline(geometry.to_numpy())
    )
    ordered_nodes = context.build_ordered_pocket_nodes(base_polyline)
    if not ordered_nodes:
        raise ValueError("Pocketing geometry is too small for the selected tool diameter and stock to leave.")

    templates = context.build_cut_path_templates(
        ordered_nodes,
        pocket_center=context.polygon_center(Polygon(base_polyline)),
    )
    cut_records = [
        [FeedRatePositionRecord3D(x=float(x), y=float(y), z=height, feedrate=feedrate) for x, y in template.coordinates]
        for height in record_builder.compute_layer_heights(operation.levels.z_bounds(geometry.z), operation.levels.max_stepdown)
        for template in templates
    ]
    return record_builder.build_cut_record_sequence(cut_records)


def _profile_records(
    geometry: ClosedPolyline25D | Polyline25D,
    operation: Profiling2dOp,
    *,
    tool: CylindricalTool,
    feedrate: float,
    rpm: int,
    clearance_plane_height: float,
) -> list[PositionRecord]:
    context = _ProfilingContext()
    record_builder = _record_builder(
        tool=tool,
        feedrate=feedrate,
        rpm=rpm,
        clearance_plane_height=clearance_plane_height,
    )
    profiles = _profile_templates(
        geometry,
        distance=_profile_offset_distance(tool, operation),
        chord_tolerance=operation.advanced.chordal_tolerance,
        context=context,
    )
    if not profiles:
        raise ValueError("Profiling geometry is too small for the selected tool diameter and stock to leave.")

    cut_records = [
        [FeedRatePositionRecord3D(x=float(x), y=float(y), z=height, feedrate=feedrate) for x, y in profile]
        for height in record_builder.compute_layer_heights(operation.levels.z_bounds(geometry.z), operation.levels.max_stepdown)
        for profile in profiles
    ]
    return record_builder.build_cut_record_sequence(cut_records)


def _profile_offset_distance(tool: CylindricalTool, operation: Profiling2dOp) -> float:
    distance = tool.diameter / 2 + operation.cut_parameters.stock_to_leave
    return -distance if operation.cut_parameters.side == "inside" else distance


def _profile_templates(
    geometry: ClosedPolyline25D | Polyline25D,
    *,
    distance: float,
    chord_tolerance: float,
    context: _ProfilingContext,
) -> list[np.ndarray]:
    if isinstance(geometry, ClosedPolyline25D):
        polylines = offset(
            context.shift_seam_to_longest_straight_edge_near_initial_seam(
                validate_closed_polyline(geometry.to_numpy())
            ),
            distance,
            chord_tolerance=chord_tolerance,
        )
        return [
            context.shift_seam_to_longest_straight_edge_near_initial_seam(polyline)
            for polyline in polylines
        ]

    polyline = _validate_open_polyline(geometry)
    shifted = LineString(polyline).offset_curve(
        distance,
        quad_segs=quad_segs_for_tolerance(distance, chord_tolerance),
    )
    return _linear_geometry_to_polylines(shifted)


def _validate_open_polyline(geometry: Polyline25D) -> np.ndarray:
    polyline = geometry.to_numpy()
    if polyline.ndim != 2 or polyline.shape[1] != 2 or polyline.shape[0] < 2:
        raise ValueError("Expected a polyline with at least two vertices.")

    deltas = polyline[1:] - polyline[:-1]
    total_length = float(np.sqrt(deltas[:, 0] * deltas[:, 0] + deltas[:, 1] * deltas[:, 1]).sum())
    if total_length <= 0.0:
        raise ValueError("Expected a polyline with positive total length.")
    return polyline


def _linear_geometry_to_polylines(geometry: BaseGeometry) -> list[np.ndarray]:
    if geometry.is_empty:
        return []
    if hasattr(geometry, "geoms"):
        polylines: list[np.ndarray] = []
        for part in geometry.geoms:
            polylines.extend(_linear_geometry_to_polylines(part))
        return polylines
    if not hasattr(geometry, "coords"):
        return []

    coordinates = np.asarray(geometry.coords, dtype=np.float64)
    if coordinates.ndim != 2 or coordinates.shape[0] < 2:
        return []
    return [np.ascontiguousarray(coordinates[:, :2])]


def _positions_match(left: PositionRecord3D, right: PositionRecord3D) -> bool:
    return left.x == right.x and left.y == right.y and left.z == right.z


def _xy_travel_record(start: PositionRecord3D, end: PositionRecord3D) -> RapidPositionRecord3D | None:
    if _positions_match(start, end):
        return None
    return RapidPositionRecord3D(
        x=end.x,
        y=end.y,
        z=start.z,
        comment="travel to next pocket",
    )
