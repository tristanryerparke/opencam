import numpy as np

from opencam.schemas.cl_data import FeedRatePositionRecord3D, OperationRecord3D, PositionRecord3D, RapidPositionRecord3D
from opencam.schemas.tools import CylindricalTool
from opencam.services.tool_mesh import build_tool, build_tool_mesh_vertices_faces
from opencam.simulation.swept_volume import (
    ChunkClData,
    build_position_chunks,
    coalesce_straight_tool_positions,
    march_tool_positions,
    sample_operation_points_with_progress,
    simulate_chunk_focus_mesh,
)


def cylindrical_tool():
    return build_tool(
        CylindricalTool(
            name="Test Tool",
            tool_number=1,
            diameter=1.0,
            cutting_height=1.0,
            shoulder_height=1.0,
        )
    )


def test_march_tool_positions_downsamples_dense_straight_runs():
    positions = [
        np.array([float(index), 0.0, 0.0])
        for index in range(11)
    ]

    marched = march_tool_positions(positions, 5.0)

    assert len(marched) == 3
    np.testing.assert_allclose(marched[0], positions[0])
    np.testing.assert_allclose(marched[1], np.array([5.0, 0.0, 0.0]))
    np.testing.assert_allclose(marched[2], positions[-1])


def test_march_tool_positions_keeps_sharp_turns_even_with_large_step_distance():
    positions = [
        np.array([0.0, 0.0, 0.0]),
        np.array([4.0, 0.0, 0.0]),
        np.array([4.0, 4.0, 0.0]),
    ]

    marched = march_tool_positions(positions, 10.0)

    assert len(marched) == 3
    np.testing.assert_allclose(marched[0], positions[0])
    np.testing.assert_allclose(marched[1], positions[1])
    np.testing.assert_allclose(marched[2], positions[2])


def test_build_position_chunks_merges_collinear_samples_but_respects_max_distance():
    positions = [np.array([index / 10.0, 0.0, 0.0]) for index in range(21)]

    chunks, seed_count = build_position_chunks([positions], 1.0, 0.5)

    assert seed_count == 3
    np.testing.assert_allclose(chunks[0], [positions[0], np.array([1.0, 0.0, 0.0])])
    np.testing.assert_allclose(chunks[1], [np.array([1.0, 0.0, 0.0]), positions[-1]])


def test_march_tool_positions_downsamples_dense_curves():
    angles = np.linspace(0.0, np.pi / 2.0, 101)
    positions = [
        np.array([50.0 * np.cos(angle), 50.0 * np.sin(angle), 0.0])
        for angle in angles
    ]

    marched = march_tool_positions(positions, 5.0)

    assert len(marched) < len(positions) / 2
    np.testing.assert_allclose(marched[0], positions[0])
    np.testing.assert_allclose(marched[-1], positions[-1])


def test_sample_operation_points_with_progress_keeps_segment_endpoints():
    operation = OperationRecord3D(
        tool=cylindrical_tool(),
        clearance_plane_height=10.0,
        records=[
            FeedRatePositionRecord3D(x=0.0, y=0.0, z=0.0, feedrate=100.0),
            FeedRatePositionRecord3D(x=4.0, y=0.0, z=0.0, feedrate=100.0),
            FeedRatePositionRecord3D(x=8.0, y=0.0, z=0.0, feedrate=100.0),
        ],
    )

    sampled_points = sample_operation_points_with_progress(operation, 5.0)
    sampled_x = [point.x for _progress, point in sampled_points]

    assert sampled_x[-1] == 8.0
    assert 4.0 in sampled_x


def test_sample_operation_points_with_progress_uses_larger_step_for_rapid_moves():
    operation = OperationRecord3D(
        tool=cylindrical_tool(),
        clearance_plane_height=10.0,
        records=[
            RapidPositionRecord3D(x=0.0, y=0.0, z=0.0),
            RapidPositionRecord3D(x=10.0, y=0.0, z=0.0),
            FeedRatePositionRecord3D(x=20.0, y=0.0, z=0.0, feedrate=100.0),
        ],
    )

    sampled_points = sample_operation_points_with_progress(operation, 4.0, rapid_frame_step_scale=2.0)

    assert [point.x for _progress, point in sampled_points] == [0.0, 8.0, 10.0, 12.0, 16.0, 20.0]


def test_coalesce_straight_tool_positions_merges_straight_runs():
    positions = [
        np.array([0.0, 0.0, 0.0]),
        np.array([1.0, 0.0, 0.0]),
        np.array([2.0, 0.0, 0.0]),
        np.array([3.0, 0.0, 0.0]),
    ]

    coalesced = coalesce_straight_tool_positions(positions, 0.1)

    assert len(coalesced) == 2
    np.testing.assert_allclose(coalesced[0], positions[0])
    np.testing.assert_allclose(coalesced[1], positions[-1])


def test_simulate_chunk_focus_mesh_adds_rotational_sweep_for_turns(monkeypatch):
    tool = cylindrical_tool()
    contexts: list[str] = []

    def record_sweep(_start, *, end_verts, context):
        contexts.append(context)
        return context

    monkeypatch.setattr(
        "opencam.simulation.swept_volume.swept_volume_manifold",
        record_sweep,
    )
    monkeypatch.setattr(
        "opencam.simulation.swept_volume.boolean_manifolds",
        lambda manifolds, _operation, *, context: manifolds,
    )

    result = simulate_chunk_focus_mesh(
        "focus",
        ChunkClData(
            tool_vertices=build_tool_mesh_vertices_faces(tool)[0],
            tool_axis=(0.0, 0.0, 1.0),
            clearance_plane_height=1.0,
            points=[],
        ),
        [
            PositionRecord3D(x=0.0, y=0.0, z=0.0),
            PositionRecord3D(x=5.0, y=0.0, z=0.0),
            PositionRecord3D(x=5.0, y=5.0, z=0.0),
        ],
        2,
        straight_line_tolerance_degrees=0.1,
        rotate_tool_with_path=True,
        include_corner_rotation_sweeps=True,
    )

    assert any("rotational sweep at corner" in context for context in contexts)
    assert result[0] == "focus"
    assert len(result) == 4


def test_simulate_chunk_focus_mesh_skips_rotational_sweep_when_rotation_disabled(monkeypatch):
    tool = cylindrical_tool()
    contexts: list[str] = []

    def record_sweep(_start, *, end_verts, context):
        contexts.append(context)
        return context

    monkeypatch.setattr(
        "opencam.simulation.swept_volume.swept_volume_manifold",
        record_sweep,
    )
    monkeypatch.setattr(
        "opencam.simulation.swept_volume.boolean_manifolds",
        lambda manifolds, _operation, *, context: manifolds,
    )

    simulate_chunk_focus_mesh(
        "focus",
        ChunkClData(
            tool_vertices=build_tool_mesh_vertices_faces(tool)[0],
            tool_axis=(0.0, 0.0, 1.0),
            clearance_plane_height=1.0,
            points=[],
        ),
        [
            PositionRecord3D(x=0.0, y=0.0, z=0.0),
            PositionRecord3D(x=5.0, y=0.0, z=0.0),
            PositionRecord3D(x=5.0, y=5.0, z=0.0),
        ],
        2,
        straight_line_tolerance_degrees=0.1,
        rotate_tool_with_path=False,
        include_corner_rotation_sweeps=True,
    )

    assert not any("rotational sweep at corner" in context for context in contexts)


def test_coalesce_straight_tool_positions_keeps_turns_and_reversals():
    turned = [
        np.array([0.0, 0.0, 0.0]),
        np.array([1.0, 0.0, 0.0]),
        np.array([1.0, 1.0, 0.0]),
    ]
    reversed_path = [
        np.array([0.0, 0.0, 0.0]),
        np.array([1.0, 0.0, 0.0]),
        np.array([0.5, 0.0, 0.0]),
    ]

    assert len(coalesce_straight_tool_positions(turned, 0.1)) == 3
    assert len(coalesce_straight_tool_positions(reversed_path, 0.1)) == 3
