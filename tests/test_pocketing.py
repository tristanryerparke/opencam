import json
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import Polygon

from opencam.engine.closed_polyline.validation import validate_closed_polyline
from opencam.schemas.cam import CAMSetup
from opencam.schemas.cl_data import FeedRatePositionRecord3D, RapidPositionRecord3D
from opencam.schemas.geometry_2_5d import ClosedPolyline25D
from opencam.schemas.geometry_2d import Point2D
from opencam.schemas.operations.base import AbsoluteClearance, CAMLevels, FeedsAndSpeeds
from opencam.schemas.operations.pocketing import Pocketing2dOp, PocketingCutSettings, PocketingDriveGeometry, StepoverMode
from opencam.schemas.tools import CylindricalTool
from opencam.services.cam_engine import _PocketingContext, cam_engine


def rectangle_vertices() -> list[Point2D]:
    return [
        Point2D(x=0.0, y=0.0),
        Point2D(x=10.0, y=0.0),
        Point2D(x=10.0, y=6.0),
        Point2D(x=0.0, y=6.0),
        Point2D(x=0.0, y=0.0),
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


def test_pocketing_preserves_branch_seam_trajectory_between_rings():
    polyline = validate_closed_polyline(
        np.array(
            [
                vertex[:2]
                for vertex in json.loads(
                    Path("assets/operations/pocketing/pocketing_B_drive_curve.json").read_text()
                )
            ],
            dtype=float,
        )
    )
    context = _PocketingContext(
        tool=CylindricalTool(
            id="tool-1",
            name="1/4in flat end mill",
            tool_number=1,
            diameter=6.35,
            cutting_height=20.0,
            shoulder_height=10.0,
        ),
        stepover=25.0,
        stock_to_leave=0.0,
        chord_tolerance=0.01,
    )
    base_polyline = context.shift_seam_to_longest_straight_edge_near_initial_seam(polyline)
    pocket_center = context.polygon_center(Polygon(base_polyline))
    ordered_nodes = context.build_ordered_pocket_nodes(base_polyline)
    branch_starts: list[list[tuple[float, float]]] = []
    current_coordinates: np.ndarray | None = None
    current_node = None
    current_branch_side_vector = None
    current_branch_seam_guide = None
    current_branch_starts: list[tuple[float, float]] = []

    for node in ordered_nodes:
        connects_directly = current_node is not None and context.can_connect_directly(
            current_node,
            node,
        )
        if current_coordinates is not None and not connects_directly:
            branch_starts.append(current_branch_starts)
            current_coordinates = None
            current_node = None
            current_branch_side_vector = None
            current_branch_seam_guide = None
            current_branch_starts = []

        if current_coordinates is None:
            current_branch_side_vector = context.compute_branch_side_vector(
                node,
                pocket_center,
            )

        ring_coordinates = context.node_to_path_polyline(
            node,
            start_reference=context.last_coordinate(current_coordinates),
            is_branch_start=current_coordinates is None,
            branch_side_vector=current_branch_side_vector,
            pocket_center=pocket_center,
            seam_guide_reference=current_branch_seam_guide,
        )
        current_branch_starts.append(
            (float(ring_coordinates[0, 0]), float(ring_coordinates[0, 1]))
        )

        if current_coordinates is None:
            current_branch_seam_guide = context.last_coordinate(ring_coordinates)
            current_coordinates = ring_coordinates
            current_node = node
            continue

        current_coordinates = context.append_coordinates(
            current_coordinates,
            ring_coordinates,
        )
        current_node = node

    branch_starts.append(current_branch_starts)
    middle_branch_starts = next(
        starts
        for starts in branch_starts
        if starts[0][0] > pocket_center[0] and starts[0][1] > pocket_center[1]
    )

    assert len(middle_branch_starts) == 5
    assert [start[0] for start in middle_branch_starts] == pytest.approx(
        [middle_branch_starts[0][0]] * len(middle_branch_starts)
    )
