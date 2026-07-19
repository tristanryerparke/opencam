import numpy as np

from opencam.schemas.cl_data import OperationRecord3D, PositionRecord3D, RapidPositionRecord3D
from opencam.schemas.tools import CylindricalTool
from opencam.simulation import router
from opencam.simulation.swept_volume import ChunkClData, PreparedSimulationChunk, SimulatedChunk


TOOL = CylindricalTool(
    name="Test Tool",
    tool_number=1,
    diameter=1.0,
    cutting_height=1.0,
    shoulder_height=1.0,
)


def build_operation(*points: tuple[float, float, float]) -> OperationRecord3D:
    return OperationRecord3D(
        tool=TOOL,
        clearance_plane_height=10.0,
        records=[RapidPositionRecord3D(x=x, y=y, z=z) for x, y, z in points],
    )


def prepared_chunk() -> PreparedSimulationChunk:
    return PreparedSimulationChunk(
        chunk_index=0,
        focus_mesh=object(),
        rest_mesh=object(),
        cl_data=ChunkClData(
            tool=TOOL,
            tool_axis=(0.0, 0.0, 1.0),
            clearance_plane_height=10.0,
            points=[],
        ),
        stock_like_original_ids=set(),
    )


def test_resample_buffered_simulation_rebuilds_frames_and_clears_display_caches(monkeypatch):
    simulation = router.BufferedSimulationResult(
        tool_mesh_bytes=b"",
        chunks=[],
        prepared_chunks=[prepared_chunk()],
        operation=build_operation((0.0, 0.0, 10.0), (0.0, 0.0, 0.0), (4.0, 0.0, 0.0), (4.0, 0.0, 10.0)),
        frames=[],
        frame_step_distance=5.0,
        active_mesh_cache={0: b"cached"},
        comparison_meshes=(b"comparison-cached", b"comparison-active"),
    )
    points = [
        PositionRecord3D(x=0.0, y=0.0, z=0.0),
        PositionRecord3D(x=4.0, y=0.0, z=0.0),
    ]
    monkeypatch.setattr(router, "resample_chunk_cl_data", lambda *_args, **_kwargs: points)

    router._resample_buffered_simulation(simulation, 2.5)

    assert simulation.frame_step_distance == 2.5
    assert [frame.point_index for frame in simulation.frames] == [-1, -1, -1, -1, 0, 0, 1, 1, 1, 1, 1]
    assert simulation.active_mesh_cache == {}
    assert simulation.comparison_meshes is None


def test_build_animation_frames_samples_operation_by_step_distance():
    operation = build_operation(
        (0.0, 0.0, 0.0),
        (1.0, 0.0, 0.0),
        (2.0, 0.0, 0.0),
        (3.0, 0.0, 0.0),
        (4.0, 0.0, 0.0),
    )
    mesh_frames = [
        router.PreparedSimulationFrame(0, 0, PositionRecord3D(x=0.0, y=0.0, z=0.0), 2),
        router.PreparedSimulationFrame(0, 1, PositionRecord3D(x=4.0, y=0.0, z=0.0), 2),
    ]

    frames = router._build_animation_frames(mesh_frames, operation, 2.0)

    assert [frame.tool_position.x for frame in frames] == [0.0, 2.0, 4.0]
    assert [frame.point_index for frame in frames] == [0, 0, 1]


def test_active_frame_mesh_uses_rotation_flags_and_is_cached(monkeypatch):
    simulation = router.BufferedSimulationResult(
        tool_mesh_bytes=b"",
        chunks=[],
        prepared_chunks=[prepared_chunk()],
        operation=build_operation((0.0, 0.0, 0.0), (1.0, 1.0, 0.0)),
        frames=[router.PreparedSimulationFrame(0, 1, PositionRecord3D(x=1.0, y=1.0, z=0.0))],
        frame_step_distance=5.0,
        include_corner_rotation_sweeps=False,
    )
    calls = 0

    def simulate(*_args, **kwargs):
        nonlocal calls
        calls += 1
        assert kwargs["include_corner_rotation_sweeps"] is False
        assert kwargs["rotate_tool_with_path"] is False
        return object()

    monkeypatch.setattr(router, "resample_chunk_cl_data", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(router, "simulate_chunk_focus_mesh", simulate)
    monkeypatch.setattr(router, "manifold_to_simplified_glb", lambda *_args, **_kwargs: b"frame")

    assert router._active_mesh_bytes(simulation, 0) == b"frame"
    assert router._active_mesh_bytes(simulation, 0) == b"frame"
    assert calls == 1


def test_comparison_vertex_colors_follow_requested_thresholds():
    colors = router._comparison_vertex_colors(np.array([0.05, 0.1, 0.175, 0.25, 1.0]))

    assert colors[0].tolist() == router.COMPARISON_GREEN_RGBA.tolist()
    assert colors[1].tolist() == router.COMPARISON_GREEN_RGBA.tolist()
    assert colors[2].tolist() == [46, 164, 170, 255]
    assert colors[3].tolist() == router.COMPARISON_BLUE_RGBA.tolist()
    assert colors[4].tolist() == router.COMPARISON_BLUE_RGBA.tolist()


def test_simulation_generation_keeps_raw_display_meshes(monkeypatch):
    chunk = prepared_chunk()
    monkeypatch.setattr(router, "prepare_simulation_chunks", lambda *_args, **_kwargs: [chunk])
    monkeypatch.setattr(
        router,
        "build_cylinder_mesh",
        lambda *_args, **_kwargs: (
            np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]),
            np.array([[0, 1, 2]]),
        ),
    )
    monkeypatch.setattr(router, "manifold_to_simplified_glb", lambda *_args, **_kwargs: b"chunk")
    monkeypatch.setattr(router, "_build_contact_frames", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(router, "_build_animation_frames", lambda frames, *_args, **_kwargs: frames)
    monkeypatch.setattr(router, "_remesh_visualization_mesh", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError()))

    simulation = router._build_buffered_simulation(
        b"stock",
        build_operation((0.0, 0.0, 0.0), (1.0, 0.0, 0.0)),
        chunk_padding=(0.0, 0.0, 0.0),
        chunk_step_distance=1.0,
        frame_step_distance=1.0,
        rotate_tool_with_path=False,
        include_corner_rotation_sweeps=False,
        should_cancel=None,
    )

    assert simulation.chunks[0].cached_mesh_bytes == b"chunk"
    assert simulation.stock_mesh_bytes == b"stock"


def test_comparison_meshes_are_remeshed_colored_and_cached(monkeypatch):
    simulation = router.BufferedSimulationResult(
        tool_mesh_bytes=b"",
        chunks=[SimulatedChunk(cached_mesh_bytes=b"cached", frame_start_index=0, frame_end_index=0)],
        prepared_chunks=[prepared_chunk()],
        operation=build_operation((0.0, 0.0, 0.0)),
        frames=[router.PreparedSimulationFrame(0, 0, PositionRecord3D(x=0.0, y=0.0, z=0.0))],
        frame_step_distance=1.0,
        stock_mesh_bytes=b"stock",
    )
    remesh_calls: list[bytes] = []
    color_calls: list[tuple[bytes, bytes]] = []

    monkeypatch.setattr(router, "_active_mesh_bytes", lambda *_args: b"active")
    monkeypatch.setattr(router, "_remesh_visualization_mesh", lambda mesh: remesh_calls.append(mesh) or mesh + b":remeshed")
    monkeypatch.setattr(
        router,
        "_apply_comparison_distance_colors",
        lambda mesh, stock: color_calls.append((mesh, stock)) or mesh + b":colored",
    )

    assert router._comparison_meshes(simulation) == (
        b"cached:remeshed:colored",
        b"active:remeshed:colored",
    )
    assert router._comparison_meshes(simulation) == (
        b"cached:remeshed:colored",
        b"active:remeshed:colored",
    )
    assert remesh_calls == [b"cached", b"active"]
    assert color_calls == [(b"cached:remeshed", b"stock"), (b"active:remeshed", b"stock")]


def test_comparison_endpoint_reports_final_mesh_urls(monkeypatch):
    simulation = router.BufferedSimulationResult(
        tool_mesh_bytes=b"",
        chunks=[],
        prepared_chunks=[],
        operation=build_operation((0.0, 0.0, 0.0)),
        frames=[router.PreparedSimulationFrame(0, 0, PositionRecord3D(x=0.0, y=0.0, z=0.0))],
        frame_step_distance=1.0,
    )
    simulation_id = "comparison-test"
    monkeypatch.setattr(router, "_comparison_meshes", lambda *_args: (b"cached", b"active"))
    router.SIMULATION_FRAME_BUFFER[simulation_id] = simulation

    try:
        response = router.simulate_swept_comparison(simulation_id)
    finally:
        router.SIMULATION_FRAME_BUFFER.pop(simulation_id, None)

    assert response.cached_mesh_url == f"/simulate/{simulation_id}/comparison/cached-mesh.glb"
    assert response.active_mesh_url == f"/simulate/{simulation_id}/comparison/active-mesh.glb"
