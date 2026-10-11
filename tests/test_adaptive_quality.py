import json
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

from opencam.engine.closed_polyline.offset import quad_segs_for_tolerance
from opencam.engine.pocketing.adaptive import (
    STEPUNDER_FRACTION,
    build_adaptive_pocket_layers,
)
from opencam.engine.pocketing.linking import build_tool_center_region

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
    signed_areas = [
        _signed_area(path) for path in paths if path.shape[0] >= 4
    ]
    assert signed_areas
    assert all(np.sign(area) == expected_sign for area in signed_areas if abs(area) > 1e-9)
