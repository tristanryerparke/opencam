from __future__ import annotations

import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from opencam.engine.parallel_finishing.surface import TriangleSurface
from opencam.engine.parallel_finishing.toolpath import build_parallel_finishing_records
from opencam.schemas.mesh import Mesh
from opencam.schemas.tools import BallTool, CylindricalTool
from opencam.services.tool_mesh import build_tool
from server.main import app

client = TestClient(app)


def flat_plane_mesh(size: float = 10.0) -> Mesh:
    return Mesh(
        vertices=[
            [0.0, 0.0, 0.0],
            [size, 0.0, 0.0],
            [0.0, size, 0.0],
            [size, size, 0.0],
        ],
        faces=[[0, 1, 2], [1, 3, 2]],
    )


def tilted_plane_mesh(slope_x: float = 0.5, slope_y: float = 0.25, size: float = 10.0) -> Mesh:
    z = lambda x, y: slope_x * x + slope_y * y
    return Mesh(
        vertices=[
            [0.0, 0.0, z(0, 0)],
            [size, 0.0, z(size, 0)],
            [0.0, size, z(0, size)],
            [size, size, z(size, size)],
        ],
        faces=[[0, 1, 2], [1, 3, 2]],
    )


def step_wall_mesh(height: float = 5.0, size: float = 10.0) -> Mesh:
    """A flat floor at z=0 with a vertical wall at x=size and a top at z=height."""
    return Mesh(
        vertices=[
            [0.0, 0.0, 0.0],  # 0 floor
            [size, 0.0, 0.0],  # 1 floor/wall base
            [0.0, size, 0.0],  # 2 floor
            [size, size, 0.0],  # 3 floor/wall base
            [size, 0.0, height],  # 4 wall top
            [size, size, height],  # 5 wall top
        ],
        faces=[
            [0, 1, 2],
            [1, 3, 2],
            [1, 4, 3],
            [3, 4, 5],
        ],
    )


def cut_area(z: float = 0.0, size: float = 10.0) -> np.ndarray:
    return np.array(
        [
            [0.0, 0.0],
            [size, 0.0],
            [size, size],
            [0.0, size],
            [0.0, 0.0],
        ],
        dtype=np.float64,
    )


def test_flat_tool_height_follows_flat_surface():
    surface = TriangleSurface.from_mesh(flat_plane_mesh())
    # On a flat z=0 plane, the flat tool tip sits at z=0 everywhere.
    assert abs(surface.flat_tool_height(5.0, 5.0, 1.0) - 0.0) < 1e-9
    assert abs(surface.flat_tool_height(0.5, 0.5, 1.0) - 0.0) < 1e-9


def test_flat_tool_height_lies_above_highest_footprint_point():
    surface = TriangleSurface.from_mesh(tilted_plane_mesh())
    radius = 1.0
    center = (5.0, 5.0)
    z_tip = surface.flat_tool_height(center[0], center[1], radius)
    # The tip must clear every surface point under the disk.
    for offset_x in np.linspace(-radius, radius, 41):
        remaining = radius * radius - offset_x * offset_x
        if remaining < 0:
            continue
        offset_y_span = math.sqrt(remaining)
        for offset_y in np.linspace(-offset_y_span, offset_y_span, 41):
            surface_z = 0.5 * (center[0] + offset_x) + 0.25 * (center[1] + offset_y)
            assert z_tip >= surface_z - 1e-6


def test_ball_tool_reaches_lower_than_flat_on_slope():
    surface = TriangleSurface.from_mesh(tilted_plane_mesh())
    radius = 1.0
    flat = surface.flat_tool_height(5.0, 5.0, radius)
    ball = surface.ball_tool_height(5.0, 5.0, radius)
    assert ball < flat


def test_ball_tool_height_keeps_ball_above_surface():
    surface = TriangleSurface.from_mesh(tilted_plane_mesh())
    radius = 1.0
    center = (5.0, 5.0)
    z_tip = surface.ball_tool_height(center[0], center[1], radius)
    z_center = z_tip + radius
    # The ball (center z_center, radius r) must enclose no surface point above it.
    for offset_x in np.linspace(-radius, radius, 41):
        remaining = radius * radius - offset_x * offset_x
        if remaining < 0:
            continue
        offset_y_span = math.sqrt(remaining)
        for offset_y in np.linspace(-offset_y_span, offset_y_span, 41):
            qx = center[0] + offset_x
            qy = center[1] + offset_y
            surface_z = 0.5 * qx + 0.25 * qy
            distance_to_center = math.sqrt(offset_x * offset_x + offset_y * offset_y)
            ball_bottom_here = z_center - math.sqrt(max(radius * radius - distance_to_center**2, 0.0))
            assert ball_bottom_here >= surface_z - 1e-6


def test_vertical_wall_raises_flat_tool_tip_near_boundary():
    """The cutter must lift to clear a wall it approaches, even though the floor under its center is flat."""
    surface = TriangleSurface.from_mesh(step_wall_mesh(height=5.0))
    radius = 1.0
    far_from_wall = surface.flat_tool_height(5.0, 5.0, radius)
    near_wall = surface.flat_tool_height(9.5, 5.0, radius)
    assert abs(far_from_wall - 0.0) < 1e-9
    assert near_wall >= 5.0 - 1e-6, near_wall


def test_parallel_finishing_emits_following_path_on_flat_plane():
    mesh = flat_plane_mesh()
    tool = CylindricalTool(
        id="tool-2mm",
        name="2mm flat end mill",
        tool_number=1,
        diameter=2.0,
        cutting_height=10.0,
        shoulder_height=12.0,
    )
    records = build_parallel_finishing_records(
        mesh,
        cut_areas=[cut_area()],
        tool=tool,
        direction_degrees=0.0,
        stepover=2.0,
        stock_to_leave=0.0,
        chord_tolerance=0.01,
        feedrate=500.0,
        clearance_plane_height=5.0,
    )
    feed_records = [record for record in records if record.feed_type == "feed_rate"]
    assert len(feed_records) > 2
    # Every feed point follows the flat z=0 surface.
    assert all(abs(record.z - 0.0) < 1e-6 for record in feed_records)


@pytest.mark.parametrize(
    ("cut_direction", "expected_dx"),
    [("climb", 1.0), ("conventional", -1.0)],
)
def test_parallel_finishing_one_way_directions_retract_between_lanes(cut_direction: str, expected_dx: float):
    records = build_parallel_finishing_records(
        flat_plane_mesh(),
        cut_areas=[cut_area()],
        tool=CylindricalTool(
            id="tool-2mm",
            name="2mm flat end mill",
            tool_number=1,
            diameter=2.0,
            cutting_height=10.0,
            shoulder_height=12.0,
        ),
        cut_direction=cut_direction,
        direction_degrees=0.0,
        stepover=2.0,
        stock_to_leave=0.0,
        chord_tolerance=0.01,
        feedrate=500.0,
        clearance_plane_height=5.0,
    )

    feed_deltas = [
        right.x - left.x
        for left, right in zip(records, records[1:], strict=False)
        if left.feed_type == right.feed_type == "feed_rate"
    ]
    assert all(delta * expected_dx >= -1e-9 for delta in feed_deltas if abs(delta) > 1e-9)
    assert sum(record.comment == "move up to clearance plane" for record in records) >= 1
    assert sum(record.comment == "move in clearance plane" for record in records) >= 1


def test_parallel_finishing_mixed_direction_stays_at_cut_height_between_lanes():
    records = build_parallel_finishing_records(
        flat_plane_mesh(),
        cut_areas=[cut_area()],
        tool=CylindricalTool(
            id="tool-2mm",
            name="2mm flat end mill",
            tool_number=1,
            diameter=2.0,
            cutting_height=10.0,
            shoulder_height=12.0,
        ),
        cut_direction="mixed",
        direction_degrees=0.0,
        stepover=2.0,
        stock_to_leave=0.0,
        chord_tolerance=0.01,
        feedrate=500.0,
        clearance_plane_height=5.0,
    )

    assert not any(record.comment == "move in clearance plane" for record in records)


def test_parallel_finishing_stock_to_leave_raises_path():
    mesh = flat_plane_mesh()
    tool = CylindricalTool(
        id="tool-2mm",
        name="2mm flat end mill",
        tool_number=1,
        diameter=2.0,
        cutting_height=10.0,
        shoulder_height=12.0,
    )
    records = build_parallel_finishing_records(
        mesh,
        cut_areas=[cut_area()],
        tool=tool,
        direction_degrees=0.0,
        stepover=2.0,
        stock_to_leave=0.5,
        chord_tolerance=0.01,
        feedrate=500.0,
        clearance_plane_height=5.0,
    )
    feed_records = [record for record in records if record.feed_type == "feed_rate"]
    assert all(abs(record.z - 0.5) < 1e-6 for record in feed_records)


def test_parallel_finishing_supports_ball_tool():
    mesh = tilted_plane_mesh()
    tool = BallTool(
        id="tool-2mm-ball",
        name="2mm ball end mill",
        tool_number=1,
        diameter=2.0,
        cutting_height=10.0,
        shoulder_height=12.0,
    )
    records = build_parallel_finishing_records(
        mesh,
        cut_areas=[cut_area()],
        tool=tool,
        direction_degrees=0.0,
        stepover=2.0,
        stock_to_leave=0.0,
        chord_tolerance=0.01,
        feedrate=500.0,
        clearance_plane_height=20.0,
    )
    assert any(record.feed_type == "feed_rate" for record in records)


def test_parallel_finishing_skips_uncovered_cut_area_gaps():
    mesh = flat_plane_mesh(size=4.0)
    tool = CylindricalTool(
        id="tool-2mm",
        name="2mm flat end mill",
        tool_number=1,
        diameter=2.0,
        cutting_height=10.0,
        shoulder_height=12.0,
    )
    records = build_parallel_finishing_records(
        mesh,
        cut_areas=[cut_area(size=10.0)],
        tool=tool,
        direction_degrees=0.0,
        stepover=2.0,
        stock_to_leave=0.0,
        chord_tolerance=0.01,
        feedrate=500.0,
        clearance_plane_height=5.0,
    )
    feed_records = [record for record in records if record.feed_type == "feed_rate"]
    assert feed_records
    # The cutter centre may overhang the surface by its radius, but not cross
    # an uncovered gap farther than that.
    assert all(-1e-6 <= record.x <= 5.0 + 1e-6 for record in feed_records)
    assert all(-1e-6 <= record.y <= 5.0 + 1e-6 for record in feed_records)


def test_parallel_finishing_rejects_zero_stepover():
    mesh = flat_plane_mesh()
    tool = CylindricalTool(
        id="tool-2mm",
        name="2mm flat end mill",
        tool_number=1,
        diameter=2.0,
        cutting_height=10.0,
        shoulder_height=12.0,
    )
    with pytest.raises(ValueError, match="Stepover must be greater than zero"):
        build_parallel_finishing_records(
            mesh,
            cut_areas=[cut_area()],
            tool=tool,
            direction_degrees=0.0,
            stepover=0.0,
            stock_to_leave=0.0,
            chord_tolerance=0.01,
            feedrate=500.0,
            clearance_plane_height=5.0,
        )


def test_endpoint_generates_parallel_finishing_from_inline_mesh():
    mesh = flat_plane_mesh()
    tool = build_tool(
        CylindricalTool(
            id="tool-2mm",
            name="2mm flat end mill",
            tool_number=1,
            diameter=2.0,
            cutting_height=10.0,
            shoulder_height=12.0,
        )
    ).model_dump(mode="json", by_alias=True)
    payload = {
        "setup": {
            "stock": {"maxZ": 0.0},
            "partMesh": {
                "source": "inline",
                "vertices": [list(vertex) for vertex in mesh.vertices],
                "faces": [list(face) for face in mesh.faces],
            },
        },
        "operation": {
            "type": "parallel_finishing",
            "tool": tool,
            "clearance": {"clearanceHeightType": "absolute", "absoluteHeight": 5.0},
            "advanced": {"chordalTolerance": 0.01},
            "driveGeometry": [
                {
                    "vertices": [
                        {"x": 0.0, "y": 0.0},
                        {"x": 10.0, "y": 0.0},
                        {"x": 10.0, "y": 10.0},
                        {"x": 0.0, "y": 10.0},
                        {"x": 0.0, "y": 0.0},
                    ],
                }
            ],
            "cutParameters": {
                "directionDegrees": 0.0,
                "stepover": {"mode": "percentage_of_tool_diameter", "value": 100.0},
                "stockToLeave": 0.0,
            },
        },
    }
    response = client.post("/cam/toolpath", json=payload)
    assert response.status_code == 200, response.text
    feed_records = [record for record in response.json()["records"] if record["feedType"] == "feed_rate"]
    assert len(feed_records) > 2
    assert all(abs(record["z"] - 0.0) < 1e-6 for record in feed_records)
