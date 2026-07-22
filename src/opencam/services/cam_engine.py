from __future__ import annotations

from opencam.engine.clearance import compute_clearance_height, validate_clearance_height
from opencam.engine.parallel_finishing.operation import build_parallel_finishing_operation_records
from opencam.engine.pocketing.toolpath import build_pocketing_records, pocketing_max_cut_z
from opencam.engine.profiling.toolpath import build_profiling_records, profiling_max_cut_z
from opencam.schemas.cl_data import OperationRecord3D
from opencam.schemas.mesh import CachedMeshLoader, resolve_part_mesh
from opencam.schemas.operations.base import (
    AutomaticClearance,
    BaseCAMOperation,
    PartMaxZPlusOffsetClearance,
)
from opencam.schemas.operations.parallel_finishing import ParallelFinishingOp
from opencam.schemas.operations.pocketing import Pocketing2dOp
from opencam.schemas.operations.profiling import Profiling2dOp
from opencam.schemas.setup import CAMSetup


def cam_engine(
    setup: CAMSetup,
    operation: BaseCAMOperation,
    *,
    cached_mesh_loader: CachedMeshLoader | None = None,
) -> OperationRecord3D:
    if isinstance(operation, ParallelFinishingOp) and setup.part_mesh is None:
        raise ValueError("Parallel finishing requires a part mesh in the CAM setup.")

    resolved_mesh = None
    if setup.part_mesh is not None and (
        isinstance(operation, ParallelFinishingOp)
        or isinstance(operation.clearance, (AutomaticClearance, PartMaxZPlusOffsetClearance))
    ):
        resolved_mesh = resolve_part_mesh(
            setup.part_mesh,
            cached_mesh_loader=cached_mesh_loader,
        )

    if isinstance(operation, ParallelFinishingOp):
        operation_max_z = max(vertex[2] for vertex in resolved_mesh.vertices)
        clearance_plane_height = compute_clearance_height(
            setup,
            operation,
            operation_max_z=operation_max_z,
            part_max_z=operation_max_z,
        )
        validate_clearance_height(clearance_plane_height, operation_max_z)
        records = build_parallel_finishing_operation_records(
            operation,
            mesh=resolved_mesh,
            clearance_plane_height=clearance_plane_height,
        )
        return OperationRecord3D(
            tool=operation.tool,
            clearance_plane_height=clearance_plane_height,
            records=records,
        )

    if isinstance(operation, Pocketing2dOp):
        operation_max_z = pocketing_max_cut_z(operation)
        clearance_plane_height = compute_clearance_height(
            setup,
            operation,
            operation_max_z=operation_max_z,
            part_max_z=max(vertex[2] for vertex in resolved_mesh.vertices) if resolved_mesh is not None else None,
        )
        validate_clearance_height(clearance_plane_height, operation_max_z)
        records = build_pocketing_records(
            operation,
            clearance_plane_height=clearance_plane_height,
        )
        return OperationRecord3D(
            tool=operation.tool,
            clearance_plane_height=clearance_plane_height,
            records=records,
        )

    if isinstance(operation, Profiling2dOp):
        operation_max_z = profiling_max_cut_z(operation)
        clearance_plane_height = compute_clearance_height(
            setup,
            operation,
            operation_max_z=operation_max_z,
            part_max_z=max(vertex[2] for vertex in resolved_mesh.vertices) if resolved_mesh is not None else None,
        )
        validate_clearance_height(clearance_plane_height, operation_max_z)
        records = build_profiling_records(
            operation,
            clearance_plane_height=clearance_plane_height,
        )
        return OperationRecord3D(
            tool=operation.tool,
            clearance_plane_height=clearance_plane_height,
            records=records,
        )

    raise NotImplementedError(f"Operation type {operation.type!r} is not supported.")
