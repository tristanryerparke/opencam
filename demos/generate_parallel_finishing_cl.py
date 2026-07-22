#!/usr/bin/env python3
from pathlib import Path

from opencam.schemas.cam import CAMSetup
from opencam.schemas.geometry_2d import ClosedPolyline2D
from opencam.schemas.operations.base import FeedsAndSpeeds
from opencam.schemas.operations.parallel_finishing import (
    ParallelFinishingCutSettings,
    ParallelFinishingDriveGeometry,
    ParallelFinishingOp,
)
from opencam.schemas.operations.pocketing import StepoverMode
from opencam.schemas.tools import BallTool
from opencam.services.cam_engine import cam_engine
from opencam.utilities.loader import load_step_mesh
from opencam.utilities.silhouette import silhouette

STEP_PATH = Path(__file__).resolve().parents[1] / "assets/operations/parallel-finishing/Parallel_Finishing_C.stp"


def build_operation(outline) -> ParallelFinishingOp:
    return ParallelFinishingOp(
        tool=BallTool(
            name='1/2" ball mill',
            tool_number=1,
            diameter=12.7,
            cutting_height=60.0,
            shoulder_height=60.0,
        ),
        feeds_and_speeds=FeedsAndSpeeds(cut_feedrate=800.0, spindle_rpm=18_000),
        drive_geometry=ParallelFinishingDriveGeometry(
            cut_areas=[
                ClosedPolyline2D(vertices=outline.vertices)
            ]
        ),
        cut_parameters=ParallelFinishingCutSettings(
            stepover=StepoverMode(mode="percentage_of_tool_diameter", value=25),
            stock_to_leave=0.0,
        ),
    )


part_mesh = load_step_mesh(STEP_PATH)
part_outline = silhouette(part_mesh)
operation = build_operation(part_outline)
cl_data = cam_engine(CAMSetup(part_mesh=part_mesh), operation)


if __name__ == "__main__":
    print(f"Part STEP: {STEP_PATH}")
    print(f"Mesh: {len(part_mesh.vertices)} vertices, {len(part_mesh.faces)} faces")
    print(f"CL records: {len(cl_data.records)}")
