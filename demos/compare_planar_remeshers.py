#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from time import perf_counter

import numpy as np
import trimesh

from opencam._cgal_planar import remesh_planar_patches
from opencam.services.mesh.planar_region_2d_reduction import simplify_mesh_data_2d
from opencam.simulation.swept_volume import ensure_triangle_faces


MESH_PATH = Path("pocket-simulation-frame-result.stl")


def summarize(name: str, elapsed: float, vertices: np.ndarray, faces: np.ndarray, original_faces: int) -> None:
    reduction = 0.0 if original_faces == 0 else 100.0 * (original_faces - len(faces)) / original_faces
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    bounds = np.asarray(mesh.bounds, dtype=np.float64)
    print(f"{name}: {elapsed:.3f}s, {len(vertices)} verts, {len(faces)} faces, {reduction:.2f}% face reduction")
    print(f"  bounds min {bounds[0].tolist()}")
    print(f"  bounds max {bounds[1].tolist()}")
    print(f"  volume {float(mesh.volume):.6f}")


if __name__ == "__main__":
    mesh = trimesh.load(MESH_PATH, file_type="stl", force="mesh")
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = ensure_triangle_faces(np.asarray(mesh.faces, dtype=np.int64))

    started_at = perf_counter()
    current = simplify_mesh_data_2d(vertices, faces)
    current_elapsed = perf_counter() - started_at

    started_at = perf_counter()
    cgal_vertices, cgal_faces = remesh_planar_patches(vertices, faces)
    cgal_elapsed = perf_counter() - started_at

    print(f"mesh: {MESH_PATH}")
    print(f"original: {len(vertices)} verts, {len(faces)} faces")
    summarize(
        "current",
        current_elapsed,
        np.asarray(current.vertices, dtype=np.float64),
        ensure_triangle_faces(np.asarray(current.faces, dtype=np.int64)),
        len(faces),
    )
    summarize(
        "cgal",
        cgal_elapsed,
        np.asarray(cgal_vertices, dtype=np.float64),
        ensure_triangle_faces(np.asarray(cgal_faces, dtype=np.int64)),
        len(faces),
    )
