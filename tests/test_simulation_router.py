import io

import numpy as np
import trimesh

from opencam.schemas.cl_data import OperationRecord3D, PositionRecord3D, RapidPositionRecord3D
from opencam.schemas.tools import CylindricalTool
from opencam.simulation import router
from opencam.simulation.swept_volume import ChunkClData, PreparedSimulationChunk


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


def test_resample_buffered_simulation_rebuilds_frames_and_clears_active_cache(monkeypatch):
    operation = build_operation((0.0, 0.0, 10.0), (0.0, 0.0, 0.0), (4.0, 0.0, 0.0), (4.0, 0.0, 10.0))
    points = [
        PositionRecord3D(x=0.0, y=0.0, z=0.0),
        PositionRecord3D(x=4.0, y=0.0, z=0.0),
    ]
    simulation = router.BufferedSimulationResult(
        tool_mesh_bytes=b"",
        chunks=[],
        prepared_chunks=[
            PreparedSimulationChunk(
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
        ],
        operation=operation,
        frames=[],
        frame_step_distance=5.0,
        active_mesh_cache={0: b"cached"},
    )

    monkeypatch.setattr(router, "resample_chunk_cl_data", lambda *_args, **_kwargs: points)

    router._resample_buffered_simulation(simulation, 2.5)

    assert simulation.frame_step_distance == 2.5
    assert [frame.point_index for frame in simulation.frames] == [-1, -1, -1, -1, 0, 0, 1, 1, 1, 1, 1]
    assert [(frame.tool_position.x, frame.tool_position.z) for frame in simulation.frames] == [
        (0.0, 10.0),
        (0.0, 7.5),
        (0.0, 5.0),
        (0.0, 2.5),
        (0.0, 0.0),
        (2.5, 0.0),
        (4.0, 1.0),
        (4.0, 3.5),
        (4.0, 6.0),
        (4.0, 8.5),
        (4.0, 10.0),
    ]
    assert simulation.active_mesh_cache == {}


def test_build_animation_frames_samples_operation_by_step_distance():
    operation = build_operation(
        (0.0, 0.0, 0.0),
        (1.0, 0.0, 0.0),
        (2.0, 0.0, 0.0),
        (3.0, 0.0, 0.0),
        (4.0, 0.0, 0.0),
    )
    mesh_frames = [
        router.PreparedSimulationFrame(
            chunk_index=0,
            point_index=0,
            tool_position=PositionRecord3D(x=0.0, y=0.0, z=0.0),
            chunk_step_count=2,
        ),
        router.PreparedSimulationFrame(
            chunk_index=0,
            point_index=1,
            tool_position=PositionRecord3D(x=4.0, y=0.0, z=0.0),
            chunk_step_count=2,
        ),
    ]

    frames = router._build_animation_frames(mesh_frames, operation, 2.0)

    assert [frame.tool_position.x for frame in frames] == [0.0, 2.0, 4.0]
    assert [frame.point_index for frame in frames] == [0, 0, 1]
    assert [frame.chunk_step_count for frame in frames] == [2, 2, 2]


def test_active_frame_mesh_uses_rotation_flags(monkeypatch):
    monkeypatch.setattr(router, "DISPLAY_REMESH_FRAMES", False)

    simulation = router.BufferedSimulationResult(
        tool_mesh_bytes=b"",
        chunks=[],
        prepared_chunks=[
            PreparedSimulationChunk(
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
        ],
        operation=build_operation((0.0, 0.0, 0.0), (1.0, 1.0, 0.0), (2.0, 1.0, 0.0)),
        frames=[
            router.PreparedSimulationFrame(
                chunk_index=0,
                point_index=1,
                tool_position=PositionRecord3D(x=1.0, y=1.0, z=0.0),
            )
        ],
        frame_step_distance=5.0,
        include_corner_rotation_sweeps=False,
    )
    captured_corner_rotation_flag = None
    captured_tool_rotation_flag = None

    def simulate(*_args, **kwargs):
        nonlocal captured_corner_rotation_flag, captured_tool_rotation_flag
        captured_corner_rotation_flag = kwargs.get("include_corner_rotation_sweeps")
        captured_tool_rotation_flag = kwargs.get("rotate_tool_with_path")
        return object()

    monkeypatch.setattr(router, "resample_chunk_cl_data", lambda *_args, **_kwargs: [PositionRecord3D(x=0.0, y=0.0, z=0.0)])
    monkeypatch.setattr(router, "simulate_chunk_focus_mesh", simulate)
    monkeypatch.setattr(router, "manifold_to_simplified_glb", lambda *_args, **_kwargs: b"frame")

    assert router._active_mesh_bytes(simulation, 0) == b"frame"
    assert captured_corner_rotation_flag is False
    assert captured_tool_rotation_flag is False


def test_active_frame_mesh_is_cached(monkeypatch):
    monkeypatch.setattr(router, "DISPLAY_REMESH_FRAMES", False)

    simulation = router.BufferedSimulationResult(
        tool_mesh_bytes=b"",
        chunks=[],
        prepared_chunks=[
            PreparedSimulationChunk(
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
        ],
        operation=build_operation((0.0, 0.0, 0.0), (1.0, 0.0, 0.0)),
        frames=[
            router.PreparedSimulationFrame(
                chunk_index=0,
                point_index=0,
                tool_position=PositionRecord3D(x=0.0, y=0.0, z=0.0),
            )
        ],
        frame_step_distance=5.0,
    )
    calls = 0

    def simulate(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return object()

    monkeypatch.setattr(router, "resample_chunk_cl_data", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(router, "simulate_chunk_focus_mesh", simulate)
    monkeypatch.setattr(router, "manifold_to_simplified_glb", lambda *_args, **_kwargs: b"frame")

    assert router._active_mesh_bytes(simulation, 0) == b"frame"
    assert router._active_mesh_bytes(simulation, 0) == b"frame"
    assert calls == 1


def test_part_proximity_colors_mark_extra_stock_and_gouge():
    part_mesh = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
    stock_mesh = trimesh.Trimesh(
        vertices=np.array([[0.5, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 0.25]], dtype=np.float64),
        faces=np.array([[0, 1, 2]], dtype=np.int64),
        process=False,
    )
    stock_mesh.visual.vertex_colors = np.tile(np.array([1, 2, 3, 255], dtype=np.uint8), (3, 1))

    colored_bytes = router._apply_part_proximity_colors(
        stock_mesh.export(file_type="glb"),
        part_mesh,
        router.ProximityQuery(part_mesh),
        tolerance=0.05,
    )
    colored_mesh = trimesh.load(io.BytesIO(colored_bytes), file_type="glb", force="mesh")
    colors = np.asarray(colored_mesh.visual.vertex_colors, dtype=np.uint8)

    assert colors[0].tolist() == [1, 2, 3, 255]
    assert colors[1, 0] >= router.EXTRA_STOCK_COLOR_RGBA[0]
    assert colors[1, 1] <= router.EXTRA_STOCK_COLOR_RGBA[1]
    assert colors[1, 2] <= router.EXTRA_STOCK_COLOR_RGBA[2]
    assert colors[2, 0] >= router.GOUGE_COLOR_RGBA[0]
    assert colors[2, 1] <= router.GOUGE_COLOR_RGBA[1]
    assert colors[2, 2] <= router.GOUGE_COLOR_RGBA[2]


def test_active_frame_mesh_remeshes_when_enabled(monkeypatch):
    simulation = router.BufferedSimulationResult(
        tool_mesh_bytes=b"",
        chunks=[],
        prepared_chunks=[
            PreparedSimulationChunk(
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
        ],
        operation=build_operation((0.0, 0.0, 0.0), (1.0, 0.0, 0.0)),
        frames=[
            router.PreparedSimulationFrame(
                chunk_index=0,
                point_index=0,
                tool_position=PositionRecord3D(x=0.0, y=0.0, z=0.0),
            )
        ],
        frame_step_distance=5.0,
    )
    remesh_calls = 0

    def remesh(mesh_bytes, *_args, **_kwargs):
        nonlocal remesh_calls
        remesh_calls += 1
        assert mesh_bytes == b"frame"
        return b"frame:remeshed"

    monkeypatch.setattr(router, "DISPLAY_REMESH_FRAMES", True)
    monkeypatch.setattr(router, "resample_chunk_cl_data", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(router, "simulate_chunk_focus_mesh", lambda *_args, **_kwargs: object())
    monkeypatch.setattr(router, "manifold_to_simplified_glb", lambda *_args, **_kwargs: b"frame")
    monkeypatch.setattr(router, "_remesh_visualization_mesh", remesh)

    assert router._active_mesh_bytes(simulation, 0) == b"frame:remeshed"
    assert router._active_mesh_bytes(simulation, 0) == b"frame:remeshed"
    assert remesh_calls == 1


def test_build_buffered_simulation_remeshes_chunk_meshes_when_enabled(monkeypatch):
    prepared_chunk = PreparedSimulationChunk(
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
    remesh_calls = 0
    color_inputs: list[bytes] = []

    def remesh(mesh_bytes, *_args, **_kwargs):
        nonlocal remesh_calls
        remesh_calls += 1
        assert mesh_bytes == b"chunk"
        return b"chunk:remeshed"

    def colorize(mesh_bytes, *_args, **_kwargs):
        color_inputs.append(mesh_bytes)
        return mesh_bytes + b":colored"

    monkeypatch.setattr(router, "DISPLAY_REMESH_CHUNKS", True)
    monkeypatch.setattr(router, "_build_part_proximity", lambda *_args, **_kwargs: (None, None))
    monkeypatch.setattr(router, "prepare_simulation_chunks", lambda *_args, **_kwargs: [prepared_chunk])
    monkeypatch.setattr(
        router,
        "build_cylinder_mesh",
        lambda *_args, **_kwargs: (
            np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], dtype=np.float64),
            np.array([[0, 1, 2]], dtype=np.int64),
        ),
    )
    monkeypatch.setattr(router, "manifold_to_simplified_glb", lambda *_args, **_kwargs: b"chunk")
    monkeypatch.setattr(router, "_build_contact_frames", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(router, "_build_animation_frames", lambda mesh_frames, *_args, **_kwargs: mesh_frames)
    monkeypatch.setattr(router, "_remesh_visualization_mesh", remesh)
    monkeypatch.setattr(router, "_apply_part_proximity_colors", colorize)

    simulation = router._build_buffered_simulation(
        b"mesh",
        build_operation((0.0, 0.0, 0.0), (1.0, 0.0, 0.0)),
        chunk_padding=(0.0, 0.0, 0.0),
        chunk_step_distance=1.0,
        frame_step_distance=1.0,
        rotate_tool_with_path=False,
        include_corner_rotation_sweeps=False,
        should_cancel=None,
    )

    assert remesh_calls == 1
    assert simulation.chunks[0].cached_mesh_bytes == b"chunk:remeshed"
    assert simulation.chunks[0].proximity_cached_mesh_bytes == b"chunk:remeshed:colored"
    assert color_inputs == [b"chunk:remeshed"]


def test_active_frame_proximity_mesh_uses_its_own_cache(monkeypatch):
    monkeypatch.setattr(router, "DISPLAY_REMESH_FRAMES", False)

    simulation = router.BufferedSimulationResult(
        tool_mesh_bytes=b"",
        chunks=[],
        prepared_chunks=[
            PreparedSimulationChunk(
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
        ],
        operation=build_operation((0.0, 0.0, 0.0), (1.0, 0.0, 0.0)),
        frames=[
            router.PreparedSimulationFrame(
                chunk_index=0,
                point_index=0,
                tool_position=PositionRecord3D(x=0.0, y=0.0, z=0.0),
            )
        ],
        frame_step_distance=5.0,
        part_mesh=object(),
        part_proximity_query=object(),
    )
    color_calls = 0

    def colorize(*_args, **_kwargs):
        nonlocal color_calls
        color_calls += 1
        return b"proximity"

    monkeypatch.setattr(router, "resample_chunk_cl_data", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(router, "simulate_chunk_focus_mesh", lambda *_args, **_kwargs: object())
    monkeypatch.setattr(router, "manifold_to_simplified_glb", lambda *_args, **_kwargs: b"frame")
    monkeypatch.setattr(router, "_apply_part_proximity_colors", colorize)

    assert router._active_mesh_bytes(simulation, 0, proximity_colors=True) == b"proximity"
    assert router._active_mesh_bytes(simulation, 0, proximity_colors=True) == b"proximity"
    assert router._active_mesh_bytes(simulation, 0) == b"frame"
    assert color_calls == 1
