#!/usr/bin/env python3
"""Send an OpenCAM swept-volume cutting animation to the Rhino C# plugin.

Run from the OpenCAM repository while Rhino is open, the RhinoCode pipe is running,
and the RhinoRendererPlugin is loaded:

    uv run demos/rhino_cutting_animation.py

By default this uses ``assets/2.5D_Part.stl`` as stock and the latest
frontend-generated cutter-location paths from ``frontend-paths.json``. Pass
``--ignore-frontend-path-log`` only when you explicitly want a synthetic raster cut.
"""

from __future__ import annotations

import argparse
import io
import json
import math
from collections.abc import Iterable
from pathlib import Path

import numpy as np
import rhino3dm
import trimesh

from opencam.schemas.cl_data import (
    FeedRatePositionRecord3D,
    OperationRecord3D,
    PositionRecord3D,
    RapidPositionRecord3D,
)
from opencam.schemas.tools import CylindricalTool
from opencam.simulation.swept_volume import SimulatedMeshFrame, load_stl_bounds, simulate_swept_milling_frames
from rhino_renderer.action import ConduitAction
from rhino_renderer.action import MeshObjectStyle
from rhino_renderer.action import ObjectStyle
from rhino_renderer.action import RGBColor
from rhino_renderer.file_client import FileClient
from rhino_renderer.file_client import current_document_path
from rhino_renderer.file_client import reset_rhino_environment

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MESH_PATH = REPO_ROOT / "assets" / "2.5D_Part.stl"
DEFAULT_FRONTEND_PATH_LOG = REPO_ROOT / "frontend-paths.json"
TOOLPATH_GROUP_ID = "opencam-rhino-toolpaths"
CUT_PATH_COLOR = RGBColor(red=29, green=78, blue=216)
CLEARANCE_PATH_COLOR = RGBColor(red=220, green=38, blue=38)
CUT_PATH_LINE_WIDTH = 3.0
CLEARANCE_PATH_LINE_WIDTH = 2.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate an OpenCAM swept-volume animation and send it to RhinoRendererPlugin.",
    )
    parser.add_argument("--mesh", type=Path, default=DEFAULT_MESH_PATH, help="Input STL stock mesh.")
    parser.add_argument(
        "--operation-json",
        type=Path,
        default=None,
        help="JSON file containing a full OperationRecord3D payload.",
    )
    parser.add_argument(
        "--frontend-path-log",
        type=Path,
        default=DEFAULT_FRONTEND_PATH_LOG,
        help="frontend-paths.json file to reuse when --operation-json is not provided.",
    )
    parser.add_argument(
        "--ignore-frontend-path-log",
        action="store_true",
        help="Ignore frontend-paths.json and generate a synthetic raster operation instead of using frontend CL data.",
    )
    parser.add_argument("--tool-number", type=int, default=1)
    parser.add_argument("--tool-diameter", type=float, default=12.0)
    parser.add_argument("--cutting-height", type=float, default=30.0)
    parser.add_argument("--max-sim-distance", type=float, default=40.0)
    parser.add_argument("--chunk-padding-x", type=float, default=5.0)
    parser.add_argument("--chunk-padding-y", type=float, default=5.0)
    parser.add_argument("--chunk-padding-z", type=float, default=1.0)
    parser.add_argument(
        "--max-frames",
        type=int,
        default=60,
        help="Maximum Rhino animation frames to send after simulation resampling. Use 0 for no cap.",
    )
    parser.add_argument(
        "--frame-stride",
        type=int,
        default=1,
        help="Keep every Nth simulation frame before applying --max-frames.",
    )
    parser.add_argument("--animation-id", default="opencam-cutting")
    parser.add_argument("--animation-name", default="OpenCAM cutting simulation")
    parser.add_argument("--timeout", type=float, default=120.0, help="Rhino action timeout in seconds.")
    parser.add_argument(
        "--reset-rhino-environment",
        action="store_true",
        help="Reset the Python-side Rhino renderer environment before sending.",
    )
    parser.add_argument(
        "--delete-existing-animation",
        action="store_true",
        help="Delete the target animation ID in Rhino before sending. Upsert already replaces this ID, but this clears it first.",
    )
    parser.add_argument(
        "--delete-all-animations",
        action="store_true",
        help="Delete all animations currently held by the Rhino plugin before sending this one.",
    )
    parser.add_argument(
        "--no-tool",
        action="store_true",
        help="Do not include the cutter mesh in each animation frame.",
    )
    parser.add_argument(
        "--no-toolpaths",
        action="store_true",
        help="Do not display frontend-style toolpath polylines in Rhino.",
    )
    parser.add_argument(
        "--toolpath-z-lift",
        type=float,
        default=0.0,
        help="Optional Z offset added only to Rhino toolpath display polylines.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Generate and encode Rhino animation frames without sending them to Rhino.",
    )
    return parser.parse_args()


def positive_float(value: float, name: str) -> float:
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be greater than 0.")
    return float(value)


def load_operation_from_json(path: Path) -> OperationRecord3D:
    return OperationRecord3D.model_validate_json(path.read_text())


def load_latest_frontend_operation(path_log: Path) -> OperationRecord3D | None:
    if not path_log.exists():
        return None

    payload = json.loads(path_log.read_text())
    if not isinstance(payload, list):
        return None

    for entry in reversed(payload):
        if isinstance(entry, dict) and isinstance(entry.get("operation"), dict):
            return OperationRecord3D.model_validate(entry["operation"])
    return None


def operation_overlaps_stock(operation: OperationRecord3D, mesh_bytes: bytes) -> bool:
    if not operation.records:
        return False

    stock_min, stock_max = load_stl_bounds(mesh_bytes)
    radius = float(operation.tool.diameter) / 2.0
    x_values = [float(record.x) for record in operation.records]
    y_values = [float(record.y) for record in operation.records]
    z_values = [float(record.z) for record in operation.records]

    return not (
        max(x_values) < stock_min[0] - radius
        or min(x_values) > stock_max[0] + radius
        or max(y_values) < stock_min[1] - radius
        or min(y_values) > stock_max[1] + radius
        or max(z_values) < stock_min[2] - float(operation.tool.cutting_height)
        or min(z_values) > stock_max[2] + float(operation.tool.cutting_height)
    )


def build_synthetic_raster_operation(mesh_bytes: bytes, tool: CylindricalTool) -> OperationRecord3D:
    stock_min, stock_max = load_stl_bounds(mesh_bytes)
    x_min, y_min, z_min = stock_min.tolist()
    x_max, y_max, z_max = stock_max.tolist()

    margin = max(tool.diameter * 0.75, 0.1)
    x0 = x_min + margin
    x1 = x_max - margin
    y0 = y_min + margin
    y1 = y_max - margin
    if x0 >= x1:
        x0, x1 = x_min, x_max
    if y0 >= y1:
        y0, y1 = y_min, y_max

    clearance_z = z_max + max(tool.diameter * 2.0, 10.0)
    cut_z = z_min
    stepover = max(tool.diameter * 0.8, 1.0)
    y_values = np.arange(y0, y1 + stepover * 0.5, stepover, dtype=np.float64)
    if len(y_values) == 0:
        y_values = np.array([(y0 + y1) * 0.5], dtype=np.float64)
    y_values[-1] = min(float(y_values[-1]), y1)

    records: list[RapidPositionRecord3D | FeedRatePositionRecord3D] = [
        RapidPositionRecord3D(x=float(x0), y=float(y_values[0]), z=float(clearance_z), comment="start at clearance"),
        RapidPositionRecord3D(x=float(x0), y=float(y_values[0]), z=float(cut_z), comment="plunge"),
    ]

    for row_index, y in enumerate(y_values):
        left_to_right = row_index % 2 == 0
        first_x = x0 if left_to_right else x1
        second_x = x1 if left_to_right else x0
        if row_index > 0:
            records.append(FeedRatePositionRecord3D(x=float(first_x), y=float(y), z=float(cut_z), feedrate=1000))
        records.append(FeedRatePositionRecord3D(x=float(second_x), y=float(y), z=float(cut_z), feedrate=1000))

    records.append(RapidPositionRecord3D(x=float(records[-1].x), y=float(records[-1].y), z=float(clearance_z), comment="retract"))
    return OperationRecord3D(
        tool=tool,
        clearance_plane_height=float(clearance_z),
        records=records,
    )


def load_operation(args: argparse.Namespace, mesh_bytes: bytes) -> OperationRecord3D:
    if args.operation_json is not None:
        print(f"Loading operation from {args.operation_json}")
        return load_operation_from_json(args.operation_json)

    if not args.ignore_frontend_path_log:
        operation = load_latest_frontend_operation(args.frontend_path_log)
        if operation is None:
            raise FileNotFoundError(
                "No frontend operation records found in "
                f"{args.frontend_path_log}. Run the frontend operation generation first, "
                "or pass --ignore-frontend-path-log to use a synthetic raster cut."
            )
        if not operation_overlaps_stock(operation, mesh_bytes):
            raise ValueError(
                "Latest frontend operation records do not overlap the selected STL bounds. "
                "Use --mesh assets/2.5D_Part.stl, regenerate frontend-paths.json for this mesh, "
                "or pass --ignore-frontend-path-log to use a synthetic raster cut."
            )
        print(f"Using latest frontend operation records from {args.frontend_path_log}")
        return operation

    cutting_height = positive_float(args.cutting_height, "cutting height")
    tool = CylindricalTool(
        name="Rhino demo tool",
        tool_number=args.tool_number,
        diameter=positive_float(args.tool_diameter, "tool diameter"),
        cutting_height=cutting_height,
        shoulder_height=cutting_height,
    )
    print("Using synthetic raster operation over the STL bounds")
    return build_synthetic_raster_operation(mesh_bytes, tool)


def load_trimesh_from_bytes(mesh_bytes: bytes, file_type: str) -> trimesh.Trimesh | None:
    loaded = trimesh.load(io.BytesIO(mesh_bytes), file_type=file_type, force="mesh")
    if loaded is None or getattr(loaded, "is_empty", False):
        return None
    if not isinstance(loaded, trimesh.Trimesh):
        loaded = trimesh.util.concatenate(tuple(loaded.dump()))
    if len(loaded.vertices) == 0 or len(loaded.faces) == 0:
        return None
    return loaded


def trimesh_to_rhino_mesh(mesh: trimesh.Trimesh) -> rhino3dm.Mesh | None:
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    if vertices.size == 0 or faces.size == 0:
        return None

    vertex_colors = None
    visual = getattr(mesh, "visual", None)
    if visual is not None and hasattr(visual, "vertex_colors"):
        candidate_colors = np.asarray(visual.vertex_colors, dtype=np.uint8)
        if candidate_colors.ndim == 2 and candidate_colors.shape[0] == len(vertices) and candidate_colors.shape[1] >= 3:
            vertex_colors = candidate_colors[:, :3]

    rhino_mesh = rhino3dm.Mesh()
    for vertex_index, (x, y, z) in enumerate(vertices[:, :3]):
        rhino_mesh.Vertices.Add(float(x), float(y), float(z))
        if vertex_colors is not None:
            red, green, blue = vertex_colors[vertex_index]
            rhino_mesh.VertexColors.Add(int(red), int(green), int(blue))

    for face in faces:
        if len(face) == 3:
            rhino_mesh.Faces.AddFace(int(face[0]), int(face[1]), int(face[2]))
        elif len(face) == 4:
            rhino_mesh.Faces.AddFace(int(face[0]), int(face[1]), int(face[2]), int(face[3]))

    if rhino_mesh.Faces.Count == 0:
        return None

    rhino_mesh.Normals.ComputeNormals()
    rhino_mesh.Compact()
    if not rhino_mesh.IsValid:
        return None
    return rhino_mesh


def rhino_mesh_from_bytes(mesh_bytes: bytes, file_type: str) -> rhino3dm.Mesh | None:
    mesh = load_trimesh_from_bytes(mesh_bytes, file_type=file_type)
    if mesh is None:
        return None
    return trimesh_to_rhino_mesh(mesh)


def location_to_array(location: PositionRecord3D) -> np.ndarray:
    return np.array([location.x, location.y, location.z], dtype=np.float64)


def tool_rotation_for_frame(frames: list[SimulatedMeshFrame], frame_index: int) -> float:
    current = location_to_array(frames[frame_index].tool_position)
    candidates: list[np.ndarray] = []
    if frame_index > 0:
        candidates.append(current - location_to_array(frames[frame_index - 1].tool_position))
    if frame_index + 1 < len(frames):
        candidates.append(location_to_array(frames[frame_index + 1].tool_position) - current)

    for vector in candidates:
        if float(np.linalg.norm(vector[:2])) > 1e-6:
            return float(math.atan2(vector[1], vector[0]))
    return 0.0


def transformed_tool_mesh(
    base_tool_mesh: rhino3dm.Mesh,
    frames: list[SimulatedMeshFrame],
    frame_index: int,
) -> rhino3dm.Mesh:
    frame = frames[frame_index]
    mesh = base_tool_mesh.Duplicate()
    mesh.Rotate(
        tool_rotation_for_frame(frames, frame_index),
        rhino3dm.Vector3d(0.0, 0.0, 1.0),
        rhino3dm.Point3d(0.0, 0.0, 0.0),
    )
    mesh.Translate(
        rhino3dm.Vector3d(
            float(frame.tool_position.x),
            float(frame.tool_position.y),
            float(frame.tool_position.z),
        )
    )
    return mesh


def selected_frame_indices(frame_count: int, frame_stride: int, max_frames: int) -> list[int]:
    if frame_count <= 0:
        return []

    stride = max(int(frame_stride), 1)
    indices = list(range(0, frame_count, stride))
    final_index = frame_count - 1
    if final_index not in indices:
        indices.append(final_index)

    if max_frames > 0 and len(indices) > max_frames:
        indices = sorted({int(round(value)) for value in np.linspace(0, final_index, max_frames)})
        if final_index not in indices:
            indices.append(final_index)

    return sorted(set(indices))


def location_point(location: PositionRecord3D, z_lift: float) -> tuple[float, float, float]:
    return (float(location.x), float(location.y), float(location.z) + float(z_lift))


def frontend_style_toolpath_polylines(
    operation: OperationRecord3D,
    *,
    z_lift: float = 0.0,
) -> list[dict[str, object]]:
    polylines: list[dict[str, object]] = []
    current_points: list[tuple[float, float, float]] = []
    feed_type: str | None = None

    for index in range(1, len(operation.records)):
        start = operation.records[index - 1]
        end = operation.records[index]
        if feed_type != end.feed_type:
            feed_type = end.feed_type
            current_points = [location_point(start, z_lift), location_point(end, z_lift)]
            polylines.append(
                {
                    "id": f"record-{index}",
                    "name": "Rapid moves" if feed_type == "rapid" else "Feed moves",
                    "color": CLEARANCE_PATH_COLOR if feed_type == "rapid" else CUT_PATH_COLOR,
                    "line_width": CLEARANCE_PATH_LINE_WIDTH if feed_type == "rapid" else CUT_PATH_LINE_WIDTH,
                    "points": current_points,
                }
            )
        else:
            current_points.append(location_point(end, z_lift))

    return polylines


def animation_toolpaths_payload(
    operation: OperationRecord3D,
    *,
    z_lift: float = 0.0,
) -> list[dict[str, object]]:
    payload: list[dict[str, object]] = []
    for index, polyline in enumerate(frontend_style_toolpath_polylines(operation, z_lift=z_lift)):
        payload.append(
            {
                "object_id": f"toolpath-{index}-{polyline['id']}",
                "points": polyline["points"],
                "style": ObjectStyle(
                    color=polyline["color"],
                    opacity=1.0,
                    line_width=float(polyline["line_width"]),
                ),
            }
        )
    return payload


def build_rhino_chunked_animation_payload(
    tool_mesh_bytes: bytes,
    chunk_mesh_bytes: dict[int, bytes],
    frames: list[SimulatedMeshFrame],
    frame_indices: Iterable[int],
    *,
    include_tool: bool,
) -> tuple[list[dict[str, object]], dict[str, object] | None, list[dict[str, object]]]:
    cached_style = MeshObjectStyle(
        # Frontend GLB simulation meshes carry per-vertex stock/cut colors:
        # stock #fb923c and cut surfaces #9ca3af.
        color=RGBColor(red=251, green=146, blue=60),
        opacity=1.0,
        line_width=1,
        display="shaded",
        show_edges=False,
        sharp_edge_angle_degrees=35.0,
        use_vertex_colors=True,
    )
    active_style = MeshObjectStyle(
        color=RGBColor(red=156, green=163, blue=175),
        opacity=1.0,
        line_width=1,
        display="shaded",
        show_edges=False,
        sharp_edge_angle_degrees=35.0,
        use_vertex_colors=True,
    )
    tool_style = MeshObjectStyle(
        # Matches TOOL_PREVIEW_COLOR in frontend/src/components/polyline-viewer/constants.ts.
        color=RGBColor(red=107, green=114, blue=128),
        opacity=1.0,
        line_width=1,
        display="shaded",
        show_edges=False,
        sharp_edge_angle_degrees=35.0,
    )

    selected_indices = list(frame_indices)
    used_chunk_indices = sorted({frames[frame_index].chunk_index for frame_index in selected_indices})
    cached_mesh_entries: list[dict[str, object]] = []
    for chunk_index in used_chunk_indices:
        mesh_bytes = chunk_mesh_bytes.get(chunk_index)
        if mesh_bytes is None:
            continue
        mesh = rhino_mesh_from_bytes(mesh_bytes, file_type="glb")
        if mesh is not None:
            cached_mesh_entries.append(
                {
                    "chunk_index": chunk_index,
                    "object_id": f"cached-chunk-{chunk_index}",
                    "mesh": mesh,
                    "style": cached_style,
                }
            )

    tool_base_mesh = rhino_mesh_from_bytes(tool_mesh_bytes, file_type="glb") if include_tool else None
    tool_base_entry = (
        {
            "object_id": "tool-base",
            "mesh": tool_base_mesh,
            "style": tool_style,
        }
        if tool_base_mesh is not None
        else None
    )

    chunked_frames: list[dict[str, object]] = []
    for frame_index in selected_indices:
        frame = frames[frame_index]
        active_mesh = rhino_mesh_from_bytes(frame.active_mesh_bytes, file_type="glb")
        frame_entry: dict[str, object] = {
            "chunk_index": frame.chunk_index,
        }
        if active_mesh is not None:
            frame_entry["active_mesh"] = {
                "object_id": f"active-frame-{frame_index}",
                "mesh": active_mesh,
                "style": active_style,
            }
        if include_tool:
            frame_entry["tool_transform"] = {
                "translation": [
                    float(frame.tool_position.x),
                    float(frame.tool_position.y),
                    float(frame.tool_position.z),
                ],
                "rotation_z": tool_rotation_for_frame(frames, frame_index),
            }
        chunked_frames.append(frame_entry)

    return cached_mesh_entries, tool_base_entry, chunked_frames


def main() -> None:
    args = parse_args()
    mesh_path = args.mesh.resolve()
    if not mesh_path.exists():
        raise FileNotFoundError(mesh_path)

    mesh_bytes = mesh_path.read_bytes()
    operation = load_operation(args, mesh_bytes)
    tool = operation.tool
    if not operation.records:
        raise ValueError("Operation has no records.")

    print(
        "Operation: "
        f"tool Ø{tool.diameter:g}, cutting height {tool.cutting_height:g}, "
        f"{len(operation.records)} records"
    )

    def progress_callback(current: int, total: int, message: str) -> None:
        percent = 100.0 * current / max(total, 1)
        print(f"\rSimulating: {percent:5.1f}%  {message:<72}", end="", flush=True)

    tool_mesh_bytes, chunks, frames = simulate_swept_milling_frames(
        mesh_bytes,
        operation,
        max_sim_distance=positive_float(args.max_sim_distance, "max sim distance"),
        chunk_padding=(
            max(float(args.chunk_padding_x), 0.0),
            max(float(args.chunk_padding_y), 0.0),
            max(float(args.chunk_padding_z), 0.0),
        ),
        progress_callback=progress_callback,
    )
    print()

    frame_indices = selected_frame_indices(
        len(frames),
        frame_stride=args.frame_stride,
        max_frames=max(int(args.max_frames), 0),
    )
    print(
        f"Simulation produced {len(frames)} frame(s) across {len(chunks)} chunk(s); "
        f"sending {len(frame_indices)} Rhino frame(s)."
    )

    chunk_mesh_bytes = {chunk_index: chunk.cached_mesh_bytes for chunk_index, chunk in enumerate(chunks)}
    cached_meshes, tool_base_mesh, chunked_frames = build_rhino_chunked_animation_payload(
        tool_mesh_bytes,
        chunk_mesh_bytes,
        frames,
        frame_indices,
        include_tool=not args.no_tool,
    )
    animation_toolpaths = [] if args.no_toolpaths else animation_toolpaths_payload(
        operation,
        z_lift=args.toolpath_z_lift,
    )
    toolpath_polyline_count = len(animation_toolpaths)
    if args.dry_run:
        active_mesh_count = sum(1 for frame in chunked_frames if frame.get("active_mesh") is not None)
        tool_mesh_count = 1 if tool_base_mesh is not None else 0
        print(
            f"Dry run complete: built {len(chunked_frames)} Rhino frame(s), "
            f"{len(cached_meshes)} cached chunk mesh(es), {active_mesh_count} active mesh(es), "
            f"{tool_mesh_count} shared tool mesh(es), and {toolpath_polyline_count} toolpath polyline(s)."
        )
        return

    file_path = current_document_path()
    if not file_path:
        raise RuntimeError(
            "Could not determine active Rhino document path. "
            "Open or save a Rhino document, make it active, then run StartScriptServer."
        )

    if args.reset_rhino_environment:
        reset_rhino_environment()

    client = FileClient(file_path=file_path, timeout_seconds=args.timeout, group_ids=["opencam-rhino"])
    client.run_action(ConduitAction(group_id=TOOLPATH_GROUP_ID, action="delete"), expire_seconds=300)
    if args.no_toolpaths:
        print("Toolpath display disabled; deleted any legacy standalone Rhino toolpath polylines.")
    else:
        print(f"Prepared {toolpath_polyline_count} frontend-style toolpath polyline(s) as part of the animation.")

    if args.delete_all_animations:
        delete_result = client.delete_all_animations(expire_seconds=600)
        print(delete_result.output or "Deleted all existing Rhino plugin animations.")
    elif args.delete_existing_animation:
        delete_result = client.delete_animation(args.animation_id, expire_seconds=600)
        print(delete_result.output or f"Deleted existing animation {args.animation_id}.")

    print(f"Sending chunk-aware animation to Rhino document: {file_path}")
    result = client.send_chunked_animation(
        animation_id=args.animation_id,
        name=args.animation_name,
        cached_meshes=cached_meshes,
        tool_base_mesh=tool_base_mesh,
        frames=chunked_frames,
        toolpaths=animation_toolpaths,
        expire_seconds=600,
    )
    print(result.output or f"Sent animation {args.animation_id}.")
    print("Open the Rhino Renderer panel, then use the animation slider or Play button.")


if __name__ == "__main__":
    main()
