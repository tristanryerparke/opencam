#!/usr/bin/env python3
from pathlib import Path

from opencam_contracts.cam import CAMSetup
from opencam_contracts.operations.base import FeedsAndSpeeds
from opencam_contracts.operations.parallel_finishing import ParallelFinishingCutSettings, ParallelFinishingOp
from opencam_contracts.operations.pocketing import StepoverMode
from opencam_contracts.tools import BallTool
from opencam.services.cam_engine import cam_engine
from opencam.utilities.loader import step_to_mesh
from opencam.utilities.silhouette import silhouette

STEP_PATH = Path(__file__).resolve().parents[1] / "assets/operations/parallel-finishing/Parallel_Finishing_C.stp"

part_mesh = step_to_mesh(STEP_PATH)
operation = ParallelFinishingOp(
    tool=BallTool(
        name='1/2" ball mill',
        tool_number=1,
        diameter=12.7,
        cutting_height=60.0,
        shoulder_height=60.0,
    ),
    feeds_and_speeds=FeedsAndSpeeds(cut_feedrate=800.0, spindle_rpm=18_000),
    drive_geometry=[silhouette(part_mesh)],
    cut_parameters=ParallelFinishingCutSettings(
        stepover=StepoverMode(mode="percentage_of_tool_diameter", value=25),
    ),
)
cl_data = cam_engine(CAMSetup(part_mesh=part_mesh), operation)


if __name__ == "__main__":
    print(f"Part STEP: {STEP_PATH}")
    print(f"Mesh: {len(part_mesh.vertices)} vertices, {len(part_mesh.faces)} faces")
    print(f"CL records: {len(cl_data.records)}")
