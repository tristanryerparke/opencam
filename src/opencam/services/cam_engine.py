from __future__ import annotations

from dataclasses import dataclass

from shapely.geometry import Polygon

from opencam.engine.closed_polyline.validation import validate_closed_polyline
from opencam.schemas.cam import CAMSetup
from opencam.schemas.cl_data import FeedRatePositionRecord3D, OperationRecord3D, PositionRecord, PositionRecord3D, RapidPositionRecord3D
from opencam.schemas.geometry_2_5d import ClosedPolyline25D
from opencam.schemas.geometry_2d import ClosedPolyline2D
from opencam.schemas.operations.base import BaseCAMOperation
from opencam.schemas.operations.pocketing import Pocketing2dOp
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


def cam_engine(
    setup: CAMSetup,
    operation: BaseCAMOperation,
) -> OperationRecord3D:
    if operation.type != "pocketing_2d" or not isinstance(operation, Pocketing2dOp):
        raise NotImplementedError(f"Operation type {operation.type!r} is not supported.")

    tool, feedrate, rpm = _tool_and_feeds(operation)
    clearance_plane_height = setup.clearance_height(operation)
    records: list[PositionRecord] = []

    for geometry in operation.drive_geometry.cut_areas:
        pocket_records = _pocket_records(
            geometry,
            operation,
            tool=tool,
            feedrate=feedrate,
            rpm=rpm,
            clearance_plane_height=clearance_plane_height,
        )
        if records and pocket_records:
            travel = _xy_travel_record(records[-1], pocket_records[0])
            if travel is not None:
                records.append(travel)
            if _positions_match(records[-1], pocket_records[0]):
                pocket_records = pocket_records[1:]
        records.extend(pocket_records)

    return OperationRecord3D(
        tool=tool,
        clearance_plane_height=clearance_plane_height,
        records=records,
    )


def _tool_and_feeds(operation: Pocketing2dOp) -> tuple[CylindricalTool, float, int]:
    if not isinstance(operation.tool, CylindricalTool):
        raise NotImplementedError(f"Tool type {operation.tool.type!r} is not supported for operation generation.")
    return (
        operation.tool,
        operation.feeds_and_speeds.cut_feedrate,
        operation.feeds_and_speeds.spindle_rpm,
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
    )
    record_builder = BaseOperation(
        tool=tool,
        feedrate=feedrate,
        rpm=rpm,
        clearance_plane_height=clearance_plane_height,
    )
    base_polyline = context.shift_seam_to_longest_straight_edge_near_initial_seam(
        validate_closed_polyline(ClosedPolyline2D(vertices=geometry.vertices).to_numpy())
    )
    z_bounds = (
        (geometry.z, geometry.z - operation.levels.depth_of_cut)
        if operation.levels.drive_geometry_position == "at_top"
        else (geometry.z + operation.levels.depth_of_cut, geometry.z)
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
        for height in record_builder.compute_layer_heights(z_bounds, operation.levels.max_stepdown)
        for template in templates
    ]
    return record_builder.build_cut_record_sequence(cut_records)


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
