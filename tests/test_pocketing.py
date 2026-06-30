from opencam.schemas.models import ClosedPolyline, Point2D, Tool
from opencam.services.toolpath.pocketing import ClosedPocketingEngine


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
        feedrate=100.0,
        rpm=1000,
    )


def test_pocketing_reuses_cut_geometry_across_layers():
    paths = build_engine(z_bounds=(0.0, -2.0)).process()

    cut_paths = [path for path in paths if path.kind == "cut"]
    assert [path.name for path in cut_paths] == ["Pocket path L1 B1", "Pocket path L2 B1"]

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

    first_xy = [(location.x, location.y) for location in cut_paths[0].locations]
    second_xy = [(location.x, location.y) for location in cut_paths[1].locations]

    assert first_xy == expected_xy
    assert second_xy == expected_xy
    assert {location.z for location in cut_paths[0].locations} == {-1.0}
    assert {location.z for location in cut_paths[1].locations} == {-2.0}


def test_pocketing_starts_first_loop_at_midpoint_of_longest_nearby_edge():
    paths = build_engine(z_bounds=(0.0, -1.0)).process()

    cut_paths = [path for path in paths if path.kind == "cut"]
    assert len(cut_paths) == 1
    assert cut_paths[0].name == "Pocket path L1 B1"

    assert [(location.x, location.y, location.z) for location in cut_paths[0].locations] == [
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
