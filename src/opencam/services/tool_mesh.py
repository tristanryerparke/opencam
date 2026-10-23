from __future__ import annotations

import math

import numpy as np
import trimesh

from opencam_contracts.tools import BallTool, CylindricalTool, Tool

TOOL_SEGMENTS = 16


def _ring(radius: float, z: float, segments: int) -> np.ndarray:
    angles = np.linspace(0.0, math.tau, segments, endpoint=False, dtype=np.float64)
    return np.column_stack(
        [
            radius * np.cos(angles),
            radius * np.sin(angles),
            np.full(segments, z, dtype=np.float64),
        ]
    )


def build_cylindrical_tool(
    tool: CylindricalTool,
    segments: int = TOOL_SEGMENTS,
) -> tuple[np.ndarray, np.ndarray]:
    radius = tool.diameter / 2.0
    height = tool.cutting_height

    bottom_ring = _ring(radius, 0.0, segments)
    top_ring = _ring(radius, height, segments)
    vertices = np.vstack(
        [
            np.array([[0.0, 0.0, 0.0]], dtype=np.float64),
            np.array([[0.0, 0.0, height]], dtype=np.float64),
            bottom_ring,
            top_ring,
        ]
    )

    bottom_center = 0
    top_center = 1
    bottom_start = 2
    top_start = 2 + segments

    faces: list[list[int]] = []
    for index in range(segments):
        next_index = (index + 1) % segments
        bottom_i = bottom_start + index
        bottom_j = bottom_start + next_index
        top_i = top_start + index
        top_j = top_start + next_index
        faces.append([bottom_center, bottom_j, bottom_i])
        faces.append([top_center, top_i, top_j])
        faces.append([bottom_i, bottom_j, top_j])
        faces.append([bottom_i, top_j, top_i])

    return vertices, np.asarray(faces, dtype=np.int32)


def build_ball_tool(
    tool: BallTool,
    segments: int = TOOL_SEGMENTS,
) -> tuple[np.ndarray, np.ndarray]:
    radius = tool.diameter / 2.0
    top_z = tool.cutting_height
    sphere_top_z = min(radius, top_z)
    hemisphere_bands = max(1, segments // 4)

    ring_specs: list[tuple[float, float]] = []
    for band in range(1, hemisphere_bands + 1):
        alpha = (band / hemisphere_bands) * (math.pi / 2.0)
        z = radius - (radius * math.cos(alpha))
        if z < sphere_top_z - 1e-9:
            ring_specs.append((z, radius * math.sin(alpha)))
            continue
        break

    sphere_slice_radius = math.sqrt(max(radius * radius - (sphere_top_z - radius) ** 2, 0.0))
    ring_specs.append((sphere_top_z, sphere_slice_radius))
    if top_z > radius + 1e-9:
        ring_specs.append((top_z, radius))

    vertices = [np.array([0.0, 0.0, 0.0], dtype=np.float64), np.array([0.0, 0.0, top_z], dtype=np.float64)]
    ring_starts: list[int] = []
    for z, ring_radius in ring_specs:
        ring_starts.append(len(vertices))
        vertices.extend(_ring(ring_radius, z, segments))

    faces: list[list[int]] = []
    first_ring_start = ring_starts[0]
    for index in range(segments):
        next_index = (index + 1) % segments
        faces.append([0, first_ring_start + next_index, first_ring_start + index])

    for lower_ring_start, upper_ring_start in zip(ring_starts, ring_starts[1:], strict=False):
        for index in range(segments):
            next_index = (index + 1) % segments
            lower_i = lower_ring_start + index
            lower_j = lower_ring_start + next_index
            upper_i = upper_ring_start + index
            upper_j = upper_ring_start + next_index
            faces.append([lower_i, lower_j, upper_j])
            faces.append([lower_i, upper_j, upper_i])

    top_center = 1
    top_ring_start = ring_starts[-1]
    for index in range(segments):
        next_index = (index + 1) % segments
        faces.append([top_center, top_ring_start + index, top_ring_start + next_index])

    return np.asarray(vertices, dtype=np.float64), np.asarray(faces, dtype=np.int32)


def build_tool_mesh_vertices_faces(tool: Tool) -> tuple[np.ndarray, np.ndarray]:
    if isinstance(tool, CylindricalTool):
        return build_cylindrical_tool(tool)
    if isinstance(tool, BallTool):
        return build_ball_tool(tool)
    raise NotImplementedError(f"Tool type {tool.type!r} is not supported.")


def build_tool_mesh_glb(vertices: np.ndarray, faces: np.ndarray) -> bytes:
    mesh = trimesh.Trimesh(vertices=np.asarray(vertices, dtype=np.float64), faces=np.asarray(faces, dtype=np.int32), process=False)
    mesh.fix_normals()
    return mesh.export(file_type="glb")


def build_tool(tool: Tool, *, tool_id: str | None = None) -> Tool:
    return tool if tool_id is None else tool.model_copy(update={"id": tool_id})


def build_tool_mesh_glb_from_tool(tool: Tool) -> bytes:
    vertices, faces = build_tool_mesh_vertices_faces(tool)
    return build_tool_mesh_glb(vertices, faces)
