from __future__ import annotations

from opencam.schemas.cam import ClosedCurveSelection, GenerateToolpathRequest, Pocket2DOperationConfig
from opencam.schemas.models import ClosedPolyline, CutterLocationData, Path, ToolpathOperation, Tool
from opencam.services.operations.pocketing.operation import ClosedPocketingEngine


def _transfer_height(request: GenerateToolpathRequest, operation: Pocket2DOperationConfig) -> float:
    if operation.clearance.transfer_height_mode == "stockTopPlusOffset":
        return request.setup.stock.max_z + operation.clearance.transfer_height_offset
    return operation.clearance.clearance_plane_height


def _build_pocket_engine(
    request: GenerateToolpathRequest,
    operation: Pocket2DOperationConfig,
    geometry: ClosedCurveSelection,
    z_bounds: tuple[float, float],
) -> ClosedPocketingEngine:
    return ClosedPocketingEngine(
        ring=ClosedPolyline(vertices=geometry.vertices),
        tool=Tool(
            diameter=operation.tool.diameter,
            cutting_height=operation.tool.flute_length,
        ),
        feedrate=operation.material.feedrate,
        rpm=operation.material.rpm,
        clearance_plane_height=_transfer_height(request, operation),
        z_bounds=z_bounds,
        z_step_height=operation.levels.max_cut_depth,
        stepover=operation.cut_parameters.stepover,
        stock_to_leave=operation.cut_parameters.stock_to_leave,
    )


def _xy_clearance_path(start: CutterLocationData, end: CutterLocationData) -> Path | None:
    if start.x == end.x and start.y == end.y and start.z == end.z:
        return None

    return Path(
        name="Travel between pockets",
        kind="clearance",
        locations=[
            start,
            CutterLocationData(x=end.x, y=end.y, z=start.z, comment="travel to next pocket"),
        ],
    )


def build_toolpath_operation_from_config(request: GenerateToolpathRequest) -> ToolpathOperation:
    operation = request.operation

    if operation.kind != "pocket2d":
        raise ValueError(f"Unsupported operation kind: {operation.kind}")

    tool = Tool(
        diameter=operation.tool.diameter,
        cutting_height=operation.tool.flute_length,
    )
    paths: list[Path] = []

    reference_plane_z = operation.control_geometry.drive_geometry[0].plane_z

    for geometry in operation.control_geometry.drive_geometry:
        z_shift = geometry.plane_z - reference_plane_z
        z_bounds = (
            operation.levels.top_z + z_shift,
            operation.levels.bottom_z + z_shift,
        )
        pocket_paths = _build_pocket_engine(request, operation, geometry, z_bounds).process()
        if paths and pocket_paths:
            connector = _xy_clearance_path(paths[-1].locations[-1], pocket_paths[0].locations[0])
            if connector is not None:
                paths.append(connector)
        paths.extend(pocket_paths)

    return ToolpathOperation(tool=tool, paths=paths)
