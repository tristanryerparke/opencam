from opencam.schemas.cam import CAMSetup
from opencam.schemas.cl_data import FeedRatePositionRecord3D, RapidPositionRecord3D
from opencam.schemas.geometry_2_5d import ClosedPolyline25D
from opencam.schemas.geometry_2d import Point2D
from opencam.schemas.operations.base import AbsoluteClearance, CAMLevels, FeedsAndSpeeds
from opencam.schemas.operations.pocketing import Pocketing2dOp, PocketingCutSettings, PocketingDriveGeometry, StepoverMode
from opencam.schemas.tools import CylindricalTool
from opencam.services.cam_engine import cam_engine


def rectangle_vertices() -> list[Point2D]:
    return [
        Point2D(x=0.0, y=0.0),
        Point2D(x=10.0, y=0.0),
        Point2D(x=10.0, y=6.0),
        Point2D(x=0.0, y=6.0),
    ]


def generate_pocket(*, tmp_path, depth_of_cut: float):
    tool = CylindricalTool(
        id="tool-1",
        name="2mm flat end mill",
        tool_number=1,
        diameter=2.0,
        cutting_height=10.0,
        shoulder_height=10.0,
    )
    operation = Pocketing2dOp(
        tool=tool,
        feeds_and_speeds=FeedsAndSpeeds(cut_feedrate=100.0, spindle_rpm=1000),
        clearance=AbsoluteClearance(absolute_height=25.4),
        levels=CAMLevels(drive_geometry_position="at_top", depth_of_cut=depth_of_cut, max_stepdown=1.0),
        drive_geometry=PocketingDriveGeometry(
            cut_areas=[ClosedPolyline25D(z=0.0, vertices=rectangle_vertices())]
        ),
        cut_parameters=PocketingCutSettings(
            stepover=StepoverMode(mode="percentage_of_tool_diameter", value=50.0),
        ),
    )
    return cam_engine(CAMSetup(), operation)


def test_pocketing_reuses_cut_geometry_across_layers(tmp_path):
    records = generate_pocket(tmp_path=tmp_path, depth_of_cut=2.0).records
    cuts = [record for record in records if isinstance(record, FeedRatePositionRecord3D)]

    expected_xy = [
        (5.0, 2.0),
        (2.0, 2.0),
        (2.0, 4.0),
        (8.0, 4.0),
        (8.0, 2.0),
        (5.0, 2.0),
        (5.0, 1.0),
        (1.0, 1.0),
        (1.0, 5.0),
        (9.0, 5.0),
        (9.0, 1.0),
        (5.0, 1.0),
    ]

    first_layer = [record for record in cuts if record.z == -1.0]
    second_layer = [record for record in cuts if record.z == -2.0]

    assert [(record.x, record.y) for record in first_layer] == expected_xy
    assert [(record.x, record.y) for record in second_layer] == expected_xy
    assert {record.feedrate for record in cuts} == {100.0}
    assert isinstance(records[0], RapidPositionRecord3D)
    assert isinstance(records[-1], RapidPositionRecord3D)


def test_pocketing_starts_first_loop_at_midpoint_of_longest_nearby_edge(tmp_path):
    records = generate_pocket(tmp_path=tmp_path, depth_of_cut=1.0).records
    cuts = [record for record in records if isinstance(record, FeedRatePositionRecord3D)]

    assert [(record.x, record.y, record.z) for record in cuts] == [
        (5.0, 2.0, -1.0),
        (2.0, 2.0, -1.0),
        (2.0, 4.0, -1.0),
        (8.0, 4.0, -1.0),
        (8.0, 2.0, -1.0),
        (5.0, 2.0, -1.0),
        (5.0, 1.0, -1.0),
        (1.0, 1.0, -1.0),
        (1.0, 5.0, -1.0),
        (9.0, 5.0, -1.0),
        (9.0, 1.0, -1.0),
        (5.0, 1.0, -1.0),
    ]
