#!/usr/bin/env python3
from pathlib import Path

from opencam.schemas.cam import CAMSetup
from opencam.schemas.geometry_2_5d import ClosedPolyline25D
from opencam.schemas.geometry_2d import Point2D
from opencam.schemas.operations.base import AbsoluteClearance, FeedsAndSpeeds
from opencam.schemas.operations.parallel_finishing import (
    ParallelFinishingCutSettings,
    ParallelFinishingDriveGeometry,
    ParallelFinishingOp,
)
from opencam.schemas.operations.pocketing import StepoverMode
from opencam.schemas.tools import BallTool
from opencam.services.cam_engine import cam_engine
from opencam.utilities.loader import load_step_mesh

STEP_PATH = Path(__file__).resolve().parents[1] / "assets/operations/parallel-finishing/Parallel_Finishing_C.stp"
CLEARANCE_HEIGHT = 60.0


def build_operation(bounds_min, bounds_max) -> ParallelFinishingOp:
    min_x, min_y = bounds_min[:2]
    max_x, max_y, max_z = bounds_max
    return ParallelFinishingOp(
        tool=BallTool(
            name='1/2" ball mill',
            tool_number=1,
            diameter=12.7,
            cutting_height=60.0,
            shoulder_height=60.0,
        ),
        feeds_and_speeds=FeedsAndSpeeds(cut_feedrate=800.0, spindle_rpm=18_000),
        clearance=AbsoluteClearance(absolute_height=CLEARANCE_HEIGHT),
        drive_geometry=ParallelFinishingDriveGeometry(
            cut_areas=[
                ClosedPolyline25D(
                    z=max_z,
                    vertices=[
                        Point2D(x=min_x, y=min_y),
                        Point2D(x=max_x, y=min_y),
                        Point2D(x=max_x, y=max_y),
                        Point2D(x=min_x, y=max_y),
                        Point2D(x=min_x, y=min_y),
                    ],
                )
            ]
        ),
        cut_parameters=ParallelFinishingCutSettings(
            direction_degrees=0.0,
            stepover=StepoverMode(mode="percentage_of_tool_diameter", value=25),
            stock_to_leave=0.0,
        ),
    )


part_mesh = load_step_mesh(STEP_PATH)
part_bounds = list(zip(*part_mesh.vertices))
bounds_min = [min(axis) for axis in part_bounds]
bounds_max = [max(axis) for axis in part_bounds]
operation = build_operation(bounds_min, bounds_max)
cl_data = cam_engine(CAMSetup(part_mesh=part_mesh), operation)


if __name__ == "__main__":
    print(f"Part STEP: {STEP_PATH}")
    print(f"Mesh: {len(part_mesh.vertices)} vertices, {len(part_mesh.faces)} faces")
    print(f"CL records: {len(cl_data.records)}")
