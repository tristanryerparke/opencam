from __future__ import annotations

from opencam_contracts.operations.base import (
    AbsoluteClearance,
    AutomaticClearance,
    BaseCAMOperation,
    PartMaxZPlusOffsetClearance,
    StockMaxZPlusOffsetClearance,
)
from opencam_contracts.setup import CAMSetup


def compute_clearance_height(
    setup: CAMSetup,
    operation: BaseCAMOperation,
    *,
    operation_max_z: float,
    part_max_z: float | None = None,
) -> float:
    clearance = operation.clearance
    if isinstance(clearance, AutomaticClearance):
        bounds = [setup.stock.max_z, operation_max_z]
        if part_max_z is not None:
            bounds.append(part_max_z)
        return max(bounds) + setup.clearance_offset
    if isinstance(clearance, AbsoluteClearance):
        return clearance.absolute_height
    if isinstance(clearance, StockMaxZPlusOffsetClearance):
        return setup.stock.max_z + clearance.offset
    if isinstance(clearance, PartMaxZPlusOffsetClearance):
        return (part_max_z if part_max_z is not None else operation_max_z) + clearance.offset
    raise ValueError("Unsupported clearance height type.")  # pragma: no cover


def validate_clearance_height(clearance_height: float, operation_max_z: float) -> None:
    if clearance_height <= operation_max_z:
        raise ValueError("Clearance height must be above the operation top Z.")
