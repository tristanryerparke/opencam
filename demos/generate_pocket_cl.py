from pathlib import Path

from opencam.schemas.cam import CAMSetup
from opencam.schemas.operations.base import AbsoluteClearance, CAMLevels, FeedsAndSpeeds
from opencam.schemas.operations.pocketing import ClosedCurveSelection, Pocketing2dOp, PocketingCutSettings, PocketingDriveGeometry, StepoverMode
from opencam.schemas.geometry_2d import Point2D
from opencam.schemas.tools import CylindricalTool
from opencam.services.cam_engine import cam_engine


tool = CylindricalTool(
    name="6mm flat end mill",
    tool_number=1,
    diameter=6.0,
    cutting_height=20.0,
    shoulder_height=20.0,
)

operation = Pocketing2dOp(
    tool=tool,
    feeds_and_speeds=FeedsAndSpeeds(cut_feedrate=800.0, spindle_rpm=18_000),
    clearance=AbsoluteClearance(absolute_height=10.0),
    levels=CAMLevels(depth_of_cut=6.0, max_stepdown=2.0),
    drive_geometry=PocketingDriveGeometry(
        cut_areas=[
            ClosedCurveSelection(
                plane_z=0.0,
                vertices=[
                    Point2D(x=0.0, y=0.0),
                    Point2D(x=50.0, y=0.0),
                    Point2D(x=50.0, y=30.0),
                    Point2D(x=0.0, y=30.0),
                ],
            )
        ]
    ),
    cut_parameters=PocketingCutSettings(
        stepover=StepoverMode(mode="percentage_of_tool_diameter", value=40.0),
    ),
)

cl_data = cam_engine(CAMSetup(), operation)
Path("pocket-cl.json").write_text(cl_data.model_dump_json(indent=2) + "\n")
