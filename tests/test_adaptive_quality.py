import json
from itertools import pairwise
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import orient, unary_union

from opencam.engine.closed_polyline.offset import quad_segs_for_tolerance
from opencam.engine.pocketing.adaptive import (
    STEPUNDER_FRACTION,
    build_adaptive_pocket_layers,
)
from opencam.engine.pocketing.linking import (
    ArcLinkMove2D,
    _arc_sweep,
    _sample_arc,
    build_keep_down_links,
    build_tool_center_region,
)

ASSET_DIR = Path(__file__).resolve().parents[1] / "assets/operations/pocketing"
TOOL_DIAMETER = 6.35
CHORD_TOLERANCE = 0.01


def _drive_curve(name: str) -> np.ndarray:
    return np.asarray(
        json.loads((ASSET_DIR / f"pocketing_{name}_drive_curve.json").read_text()),
        dtype=np.float64,
    )[:, :2]


def _reachable_target(polyline: np.ndarray, quad_segs: int) -> Polygon:
    tool_radius = TOOL_DIAMETER / 2
    center_region = build_tool_center_region(
        polyline,
        tool_diameter=TOOL_DIAMETER,
        stock_to_leave=0,
        chord_tolerance=CHORD_TOLERANCE,
    )
    return center_region.buffer(tool_radius, quad_segs=quad_segs).intersection(
        Polygon(polyline)
    )


@pytest.mark.parametrize("pocket", ["A", "B"])
@pytest.mark.parametrize("stepover_percent", [25, 30, 50])
def test_adaptive_coverage_never_exceeds_requested_stepover(
    pocket: str,
    stepover_percent: int,
) -> None:
    polyline = _drive_curve(pocket)
    tool_radius = TOOL_DIAMETER / 2
    quad_segs = quad_segs_for_tolerance(tool_radius, CHORD_TOLERANCE / 4)
    requested_cut_width = TOOL_DIAMETER * stepover_percent / 100
    coverage_tolerance = (
        requested_cut_width * (1 - STEPUNDER_FRACTION) + CHORD_TOLERANCE
    )

    paths = build_adaptive_pocket_layers(
        polyline,
        tool_diameter=TOOL_DIAMETER,
        stepover_percent=stepover_percent,
        stock_to_leave=0,
        chord_tolerance=CHORD_TOLERANCE,
    )
    assert paths

    coverage = unary_union(
        [
            LineString(path).buffer(tool_radius, quad_segs=quad_segs)
            for path in paths
        ]
    )
    residual = _reachable_target(polyline, quad_segs).difference(coverage)
    assert residual.buffer(-coverage_tolerance).is_empty


@pytest.mark.parametrize("pocket", ["A", "B"])
@pytest.mark.parametrize("stepover_percent", [25, 30, 50])
def test_adaptive_has_no_short_poke_paths(pocket: str, stepover_percent: int) -> None:
    polyline = _drive_curve(pocket)
    paths = build_adaptive_pocket_layers(
        polyline,
        tool_diameter=TOOL_DIAMETER,
        stepover_percent=stepover_percent,
        stock_to_leave=0,
        chord_tolerance=CHORD_TOLERANCE,
    )
    shortest = min(LineString(path).length for path in paths)
    assert shortest >= TOOL_DIAMETER * stepover_percent / 100 * 0.9


def _signed_area(path: np.ndarray) -> float:
    x, y = path[:, 0], path[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


@pytest.mark.parametrize("pocket", ["A", "B"])
@pytest.mark.parametrize("stepover_percent", [25, 30])
@pytest.mark.parametrize("cut_direction,expected_sign", [("climb", 1), ("conventional", -1)])
def test_adaptive_cut_direction_is_consistent(
    pocket: str,
    stepover_percent: int,
    cut_direction: str,
    expected_sign: int,
) -> None:
    polyline = _drive_curve(pocket)
    paths = build_adaptive_pocket_layers(
        polyline,
        tool_diameter=TOOL_DIAMETER,
        stepover_percent=stepover_percent,
        stock_to_leave=0,
        chord_tolerance=CHORD_TOLERANCE,
        cut_direction=cut_direction,
    )
    center_region = build_tool_center_region(
        polyline, tool_diameter=TOOL_DIAMETER, stock_to_leave=0,
        chord_tolerance=CHORD_TOLERANCE,
    )
    boundary = LineString(orient(center_region, sign=expected_sign).exterior.coords)
    border_band = boundary.buffer(TOOL_DIAMETER * stepover_percent / 100)
    assert paths
    for path in paths:
        area = _signed_area(path)
        if abs(area) <= 1e-9 or np.sign(area) == expected_sign:
            continue
        # Open concave border intervals need not have the scoop's signed area.
        # They must instead stay near the wall and follow its oriented tangent.
        assert border_band.covers(LineString(path))
        for start, end in pairwise(path):
            station = boundary.project(Point((start + end) / 2))
            before = np.asarray(boundary.interpolate(
                (station - CHORD_TOLERANCE) % boundary.length,
            ).coords[0])
            after = np.asarray(boundary.interpolate(
                (station + CHORD_TOLERANCE) % boundary.length,
            ).coords[0])
            assert np.dot(end - start, after - before) >= -1e-9


def _link_centerline(link, start: np.ndarray) -> LineString:
    points = [start]
    for move in link.moves:
        end = np.asarray(move.target)
        if isinstance(move, ArcLinkMove2D):
            center = np.asarray(move.center)
            points.extend(
                _sample_arc(
                    points[-1],
                    end,
                    center,
                    sweep=_arc_sweep(
                        points[-1], end, center, clockwise=move.clockwise
                    ),
                    chord_tolerance=CHORD_TOLERANCE / 10,
                )[1:]
            )
        else:
            points.append(end)
    return LineString(points)


@pytest.mark.parametrize("stepover_percent", [25, 50])
@pytest.mark.parametrize("cut_direction", ["climb", "conventional"])
def test_adaptive_concave_scoops_are_constructively_safe(
    stepover_percent: int,
    cut_direction: str,
) -> None:
    polyline = _drive_curve("D")
    tool_radius = TOOL_DIAMETER / 2
    requested_cut_width = TOOL_DIAMETER * stepover_percent / 100
    quad_segs = quad_segs_for_tolerance(tool_radius, CHORD_TOLERANCE / 4)
    center_region = build_tool_center_region(
        polyline,
        tool_diameter=TOOL_DIAMETER,
        stock_to_leave=0,
        chord_tolerance=CHORD_TOLERANCE,
    )
    safe = center_region.buffer(CHORD_TOLERANCE * 1e-6)

    paths = build_adaptive_pocket_layers(
        polyline,
        tool_diameter=TOOL_DIAMETER,
        stepover_percent=stepover_percent,
        stock_to_leave=0,
        chord_tolerance=CHORD_TOLERANCE,
        cut_direction=cut_direction,
    )

    assert paths
    assert all(safe.covers(LineString(path)) for path in paths)
    assert not any(
        np.linalg.norm(path[0] - path[-1]) <= CHORD_TOLERANCE
        and LineString(path).length > 4 * TOOL_DIAMETER
        for path in paths
    )

    prior_reach = None
    prior_centerlines = None
    for path in paths:
        line = LineString(path)
        if prior_reach is not None:
            assert prior_reach.covers(line)
        sweep = line.buffer(
            requested_cut_width + CHORD_TOLERANCE,
            quad_segs=quad_segs,
        )
        prior_reach = sweep if prior_reach is None else prior_reach.union(sweep)
        prior_centerlines = (
            line if prior_centerlines is None else prior_centerlines.union(line)
        )

    coverage = prior_centerlines.buffer(tool_radius, quad_segs=quad_segs)
    target = _reachable_target(polyline, quad_segs)
    assert coverage.covers(center_region)
    coverage_tolerance = (
        requested_cut_width * (1 - STEPUNDER_FRACTION) + CHORD_TOLERANCE
    )
    assert target.difference(coverage).buffer(-coverage_tolerance).is_empty

    links = build_keep_down_links(
        paths,
        polyline,
        tool_diameter=TOOL_DIAMETER,
        stock_to_leave=0,
        chord_tolerance=CHORD_TOLERANCE,
    )
    assert all(
        link is None or safe.covers(_link_centerline(link, paths[index][-1]))
        for index, link in enumerate(links)
    )
    link_roles = {
        move.motion_role
        for link in links
        if link is not None
        for move in link.moves
    }
    assert link_roles == {"cutting", "linking"}
    arc_links = [
        move
        for link in links
        if link is not None
        for move in link.moves
        if isinstance(move, ArcLinkMove2D)
    ]
    assert arc_links
    assert {move.motion_role for move in arc_links} == {"cutting"}
    for index, link in enumerate(links):
        if link is None:
            continue
        start_radius = paths.link_support_radii.get(index, (None, None))[1]
        end_radius = paths.link_support_radii.get(index + 1, (None, None))[0]
        support_radii = [
            radius for radius in (start_radius, end_radius) if radius is not None
        ]
        if not support_radii:
            continue
        maximum_radius = 0.9 * min(support_radii)
        move_start = paths[index][-1]
        for move in link.moves:
            if isinstance(move, ArcLinkMove2D):
                assert np.linalg.norm(np.asarray(move.center) - move_start) <= (
                    maximum_radius + CHORD_TOLERANCE
                )
            move_start = np.asarray(move.target)
