from opencam.schemas.cl_data import FeedRatePositionRecord3D, RapidPositionRecord3D
from opencam.schemas.models import ClosedPolyline, Point2D, Tool
from opencam.services.operations.pocketing.operation import ClosedPocketingEngine


def rectangle_ring() -> ClosedPolyline:
    return ClosedPolyline(
        vertices=[
            Point2D(x=0.0, y=0.0),
            Point2D(x=10.0, y=0.0),
            Point2D(x=10.0, y=6.0),
            Point2D(x=0.0, y=6.0),
        ]
    )


def build_engine(*, z_bounds: tuple[float, float]) -> ClosedPocketingEngine:
    return ClosedPocketingEngine(
        ring=rectangle_ring(),
        z_bounds=z_bounds,
        z_step_height=1.0,
        stepover=50.0,
        stock_to_leave=0.0,
        tool=Tool(diameter=2.0, cutting_height=10.0),
        tool_id="tool-1",
        feedrate=100.0,
        rpm=1000,
    )


def test_pocketing_reuses_cut_geometry_across_layers():
    records = build_engine(z_bounds=(0.0, -2.0)).process()
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


def test_pocketing_starts_first_loop_at_midpoint_of_longest_nearby_edge():
    records = build_engine(z_bounds=(0.0, -1.0)).process()
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
