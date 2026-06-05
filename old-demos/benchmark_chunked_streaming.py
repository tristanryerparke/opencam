from __future__ import annotations

import io
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh

from app.schemas.models import Path as Toolpath
from app.schemas.models import Tool
from app.schemas.models import ToolpathOperation
from app.services.simulation.swept_volume import combine_glb_meshes
from app.services.simulation.swept_volume import load_tool_positions
from app.services.simulation.swept_volume import simulate_swept_milling_frames

ROOT = Path(__file__).resolve().parent
STOCK_STL_PATH = ROOT / "assets" / "2.5D_Part.stl"
TOOLPATH_JSON_PATH = ROOT / "paths-rounded-pocket.json"

DEFAULT_TOOL_DIAMETER = 6.35
DEFAULT_CUTTING_HEIGHT = 12.0
DEFAULT_MAX_DEPTH_OF_CUT = 1.5
DEFAULT_FEEDRATE = 500.0
DEFAULT_RPM = 12000
DEFAULT_MAX_SIM_DISTANCE = 30.0
DEFAULT_CHUNK_PADDING = (5.0, 5.0, 1.0)
POSITION_LIMITS = [18, 30, 36]


@dataclass
class BenchmarkResult:
    position_limit: int
    actual_positions: int
    chunk_count: int
    frame_count: int
    baseline_total_bytes: int
    chunked_total_bytes: int
    cached_total_bytes: int
    active_total_bytes: int
    first_frame_total_bytes: int
    first_chunk_initial_bytes: int

    @property
    def reduction_percent(self) -> float:
        if self.baseline_total_bytes == 0:
            return 0.0
        return (1.0 - (self.chunked_total_bytes / self.baseline_total_bytes)) * 100.0


def load_logged_paths(path: Path) -> list[Toolpath]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    operations = payload if isinstance(payload, list) else [payload]
    if not operations:
        raise ValueError("No logged operations found")

    first_operation = operations[0]
    return [Toolpath.model_validate(item) for item in first_operation.get("paths", [])]


def truncate_paths_to_unique_position_limit(paths: list[Toolpath], position_limit: int) -> list[Toolpath]:
    truncated_paths: list[Toolpath] = []
    previous: np.ndarray | None = None
    unique_position_count = 0
    should_stop = False

    for path in paths:
        truncated_locations = []
        for location in path.locations:
            position = np.array([location.x, location.y, location.z], dtype=np.float64)
            if previous is None or not np.allclose(position, previous, atol=1e-9, rtol=0.0):
                unique_position_count += 1
                previous = position
            truncated_locations.append(location)
            if unique_position_count >= position_limit:
                should_stop = True
                break

        if truncated_locations:
            truncated_paths.append(
                Toolpath(
                    id=path.id,
                    name=path.name,
                    kind=path.kind,
                    locations=truncated_locations,
                )
            )

        if should_stop:
            break

    return truncated_paths


def bytes_to_mib(byte_count: int) -> float:
    return byte_count / (1024 * 1024)


def benchmark_position_limit(stock_bytes: bytes, all_paths: list[Toolpath], position_limit: int) -> BenchmarkResult:
    truncated_paths = truncate_paths_to_unique_position_limit(all_paths, position_limit)
    operation = ToolpathOperation(
        tool=Tool(
            diameter=DEFAULT_TOOL_DIAMETER,
            cutting_height=DEFAULT_CUTTING_HEIGHT,
            max_depth_of_cut=DEFAULT_MAX_DEPTH_OF_CUT,
        ),
        paths=truncated_paths,
    )

    actual_positions = len(load_tool_positions(operation))
    tool_mesh_bytes, chunks, frames = simulate_swept_milling_frames(
        stock_bytes,
        operation,
        max_sim_distance=DEFAULT_MAX_SIM_DISTANCE,
        chunk_padding=DEFAULT_CHUNK_PADDING,
    )
    _ = tool_mesh_bytes

    baseline_full_frame_sizes: list[int] = []
    active_frame_sizes: list[int] = []

    for frame in frames:
        chunk = chunks[frame.chunk_index]
        full_mesh = combine_glb_meshes([chunk.cached_mesh_bytes, frame.active_mesh_bytes])
        full_mesh_bytes = full_mesh.export(file_type="glb")
        baseline_full_frame_sizes.append(len(full_mesh_bytes))
        active_frame_sizes.append(len(frame.active_mesh_bytes))

    cached_chunk_sizes = [len(chunk.cached_mesh_bytes) for chunk in chunks]

    return BenchmarkResult(
        position_limit=position_limit,
        actual_positions=actual_positions,
        chunk_count=len(chunks),
        frame_count=len(frames),
        baseline_total_bytes=sum(baseline_full_frame_sizes),
        chunked_total_bytes=sum(active_frame_sizes) + sum(cached_chunk_sizes),
        cached_total_bytes=sum(cached_chunk_sizes),
        active_total_bytes=sum(active_frame_sizes),
        first_frame_total_bytes=baseline_full_frame_sizes[0],
        first_chunk_initial_bytes=cached_chunk_sizes[0] + active_frame_sizes[0],
    )


def main() -> None:
    stock_bytes = STOCK_STL_PATH.read_bytes()
    all_paths = load_logged_paths(TOOLPATH_JSON_PATH)

    print("Chunked streaming benchmark")
    print(f"stock: {STOCK_STL_PATH}")
    print(f"toolpath source: {TOOLPATH_JSON_PATH}")
    print(
        "tool defaults: "
        f"diameter={DEFAULT_TOOL_DIAMETER} "
        f"height={DEFAULT_CUTTING_HEIGHT} "
        f"max_depth_of_cut={DEFAULT_MAX_DEPTH_OF_CUT} "
        f"feedrate={DEFAULT_FEEDRATE} rpm={DEFAULT_RPM}"
    )
    print(
        "chunk settings: "
        f"max_sim_distance={DEFAULT_MAX_SIM_DISTANCE} "
        f"padding={DEFAULT_CHUNK_PADDING}"
    )
    print()

    results = [benchmark_position_limit(stock_bytes, all_paths, limit) for limit in POSITION_LIMITS]

    print("limit | pos | chunks | frames | full scrub MiB | chunked MiB | reduction")
    for result in results:
        print(
            f"{result.position_limit:>5} | "
            f"{result.actual_positions:>3} | "
            f"{result.chunk_count:>6} | "
            f"{result.frame_count:>6} | "
            f"{bytes_to_mib(result.baseline_total_bytes):>13.3f} | "
            f"{bytes_to_mib(result.chunked_total_bytes):>11.3f} | "
            f"{result.reduction_percent:>8.2f}%"
        )

    print()
    for result in results:
        print(f"Position limit {result.position_limit} ({result.actual_positions} actual positions)")
        print(
            f"  full scrub total: {result.baseline_total_bytes} bytes "
            f"({bytes_to_mib(result.baseline_total_bytes):.3f} MiB)"
        )
        print(
            f"  chunked cached total: {result.cached_total_bytes} bytes "
            f"({bytes_to_mib(result.cached_total_bytes):.3f} MiB)"
        )
        print(
            f"  chunked active total: {result.active_total_bytes} bytes "
            f"({bytes_to_mib(result.active_total_bytes):.3f} MiB)"
        )
        print(
            f"  chunked full scrub total: {result.chunked_total_bytes} bytes "
            f"({bytes_to_mib(result.chunked_total_bytes):.3f} MiB)"
        )
        print(f"  reduction: {result.reduction_percent:.2f}%")
        print(
            f"  first frame full payload: {result.first_frame_total_bytes} bytes | "
            f"first chunk initial payload: {result.first_chunk_initial_bytes} bytes"
        )
        print()


if __name__ == "__main__":
    main()
