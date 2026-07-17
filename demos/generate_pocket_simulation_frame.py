#!/usr/bin/env python3
from pathlib import Path
from time import perf_counter

from opencam.simulation.swept_volume import DEFAULT_STRAIGHT_LINE_TOLERANCE_DEGREES

MAX_SIM_DISTANCE = 40.0
CHUNK_PADDING = (5.0, 5.0, 1.0)
FRAME_STEP_DISTANCE = 5.0
CHUNK_INDEX = 10
FRAME_POINT_INDEX = -1
STRAIGHT_LINE_TOLERANCE_DEGREES = DEFAULT_STRAIGHT_LINE_TOLERANCE_DEGREES
INCLUDE_CORNER_ROTATION_SWEEPS = True
OUTPUT_PATH = Path("pocket-simulation-frame-result.stl")


if __name__ == "__main__":
    import trimesh

    import generate_pocket_cl

    total_started_at = perf_counter()

    started_at = perf_counter()
    from opencam.simulation.swept_volume import (
        coalesce_straight_tool_positions,
        manifold_to_mesh,
        prepare_simulation_chunks,
        record_to_position,
        resample_chunk_cl_data,
        simulate_chunk_focus_mesh,
    )

    simulation_import_seconds = perf_counter() - started_at

    stock_path = generate_pocket_cl.asset_dir / "pocketing_A_stock.stl"

    started_at = perf_counter()
    stock_bytes = stock_path.read_bytes()
    stock_read_seconds = perf_counter() - started_at

    started_at = perf_counter()
    chunks = prepare_simulation_chunks(
        stock_bytes,
        generate_pocket_cl.cl_data,
        max_sim_distance=MAX_SIM_DISTANCE,
        chunk_padding=CHUNK_PADDING,
    )
    chunk_generation_seconds = perf_counter() - started_at

    if not chunks:
        raise RuntimeError("No simulation chunks were generated.")
    if CHUNK_INDEX < 0 or CHUNK_INDEX >= len(chunks):
        raise IndexError(f"CHUNK_INDEX {CHUNK_INDEX} is out of range for {len(chunks)} chunks.")

    chunk = chunks[CHUNK_INDEX]

    started_at = perf_counter()
    sampled_points = resample_chunk_cl_data(chunk.cl_data, FRAME_STEP_DISTANCE)
    resample_seconds = perf_counter() - started_at

    if not sampled_points:
        raise RuntimeError("No sampled frame points were generated for the selected chunk.")

    frame_point_index = len(sampled_points) - 1 if FRAME_POINT_INDEX < 0 else FRAME_POINT_INDEX
    if frame_point_index < 0 or frame_point_index >= len(sampled_points):
        raise IndexError(
            f"FRAME_POINT_INDEX {FRAME_POINT_INDEX} resolves to {frame_point_index}, "
            f"out of range for {len(sampled_points)} sampled points."
        )

    coalesced_positions = coalesce_straight_tool_positions(
        [record_to_position(point) for point in sampled_points[: frame_point_index + 1]],
        STRAIGHT_LINE_TOLERANCE_DEGREES,
    )

    started_at = perf_counter()
    frame_focus_mesh = simulate_chunk_focus_mesh(
        chunk.focus_mesh,
        chunk.cl_data,
        sampled_points,
        frame_point_index,
        context=f"demo chunk {CHUNK_INDEX} frame {frame_point_index}",
        straight_line_tolerance_degrees=STRAIGHT_LINE_TOLERANCE_DEGREES,
        include_corner_rotation_sweeps=INCLUDE_CORNER_ROTATION_SWEEPS,
    )
    frame_seconds = perf_counter() - started_at

    started_at = perf_counter()
    mesh_parts = []
    for manifold, context in (
        (chunk.rest_mesh, f"extracting rest mesh for chunk {CHUNK_INDEX}"),
        (frame_focus_mesh, f"extracting frame mesh for chunk {CHUNK_INDEX}"),
    ):
        vertices, faces = manifold_to_mesh(manifold, context=context)
        if len(faces) == 0:
            continue
        mesh_parts.append(trimesh.Trimesh(vertices=vertices, faces=faces, process=False))

    if not mesh_parts:
        raise RuntimeError("Selected frame produced no mesh to export.")

    full_mesh = mesh_parts[0] if len(mesh_parts) == 1 else trimesh.util.concatenate(mesh_parts)
    OUTPUT_PATH.write_bytes(full_mesh.export(file_type="stl"))
    write_seconds = perf_counter() - started_at

    total_seconds = perf_counter() - total_started_at

    print(f"Saved {OUTPUT_PATH}")
    print(f"Chunk count: {len(chunks)}")
    print(f"Selected chunk: {CHUNK_INDEX}")
    print(f"Chunk CL points: {len(chunk.cl_data.points)}")
    print(f"Resampled points: {len(sampled_points)}")
    print(f"Selected frame point index: {frame_point_index}")
    print(f"Coalesced points up to frame: {len(coalesced_positions)}")
    print(f"Corner rotation sweeps: {INCLUDE_CORNER_ROTATION_SWEEPS}")
    print(f"Simulation import: {simulation_import_seconds:.3f}s")
    print(f"Stock STL read: {stock_read_seconds:.3f}s")
    print(f"Chunk generation: {chunk_generation_seconds:.3f}s")
    print(f"Frame resample: {resample_seconds:.3f}s")
    print(f"Frame simulation: {frame_seconds:.3f}s")
    print(f"Output STL write: {write_seconds:.3f}s")
    print(f"Total: {total_seconds:.3f}s")
