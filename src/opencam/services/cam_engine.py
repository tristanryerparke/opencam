from __future__ import annotations

from opencam.schemas.cam import CAMSetup
from opencam.schemas.cl_data import OperationRecord3D
from opencam.schemas.mesh import CachedMeshLoader, resolve_part_mesh
from opencam.schemas.operations.base import BaseCAMOperation
from opencam.schemas.operations.parallel_finishing import ParallelFinishingOp
from opencam.schemas.operations.pocketing import Pocketing2dOp
from opencam.schemas.operations.profiling import Profiling2dOp


def cam_engine(
    setup: CAMSetup,
    operation: BaseCAMOperation,
    *,
    cached_mesh_loader: CachedMeshLoader | None = None,
) -> OperationRecord3D:
    clearance_plane_height = setup.clearance_height(operation)

    if isinstance(operation, ParallelFinishingOp):
        resolved_mesh = resolve_part_mesh(
            operation.part_mesh,
            cached_mesh_loader=cached_mesh_loader,
        )
        return OperationRecord3D(
            tool=operation.tool,
            clearance_plane_height=clearance_plane_height,
            records=operation.build_records(
                clearance_plane_height=clearance_plane_height,
                mesh=resolved_mesh,
            ),
        )

    if isinstance(operation, (Pocketing2dOp, Profiling2dOp)):
        return OperationRecord3D(
            tool=operation.tool,
            clearance_plane_height=clearance_plane_height,
            records=operation.build_records(clearance_plane_height=clearance_plane_height),
        )

    raise NotImplementedError(f"Operation type {operation.type!r} is not supported.")
