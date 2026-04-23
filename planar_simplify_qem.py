#!/usr/bin/env python3
"""CLI wrapper for planar QEM mesh simplification."""
from __future__ import annotations

import time

import trimesh

from mesh_reduction import simplify_mesh


def main() -> int:
    input_path = "milling-simulation-swept.stl"
    output_path = "milling-simulation-swept-simplified.stl"

    mesh = trimesh.load(input_path)
    assert isinstance(mesh, trimesh.Trimesh)
    print(f"Loaded: {input_path}")
    print(f"  Faces: {len(mesh.faces)}, Verts: {len(mesh.vertices)}")
    print(f"  Bounds: {mesh.bounds}")
    print()

    max_iterations = len(mesh.faces)
    print(f"Simplifying until no valid collapses remain (max {max_iterations} collapses)")
    print()

    t0 = time.perf_counter()
    simplified = simplify_mesh(mesh, max_iterations=max_iterations, verbose=True, planar_angle_degrees=0.1)
    elapsed = time.perf_counter() - t0
    print(f"  Time:           {elapsed:.3f}s")

    simplified.export(output_path)
    print(f"  Output:         {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
