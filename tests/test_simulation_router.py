from opencam.schemas.cl_data import PositionRecord3D
from opencam.simulation import router
from opencam.simulation.swept_volume import PreparedSimulationChunk


def test_active_frame_mesh_is_cached(monkeypatch):
    simulation = router.BufferedSimulationResult(
        tool_mesh_bytes=b"",
        chunks=[],
        prepared_chunks=[
            PreparedSimulationChunk(
                chunk_index=0,
                focus_mesh=object(),
                rest_mesh=object(),
                cl_data=None,  # type: ignore[arg-type]
                stock_like_original_ids=set(),
            )
        ],
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
