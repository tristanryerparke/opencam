"""
Standalone example: swept volume of a cylinder under a ramping translation.

Creates a 16-segment cylinder (radius=5, height=30), sweeps it along a
3D vector with X, Y, and Z components (simulating a ramping motion), and
saves the result as an STL file.

Requirements:
    pip install numpy trimesh manifold3d scipy
"""

import numpy as np
import trimesh
import trimesh.repair
from scipy.spatial import ConvexHull, Delaunay


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def convex_mesh_from_points(points: np.ndarray) -> trimesh.Trimesh:
    hull = ConvexHull(points)
    mesh = trimesh.Trimesh(
        vertices=points,
        faces=hull.simplices,
        process=True,
        validate=True,
    )
    trimesh.repair.fix_normals(mesh)
    return mesh


def swept_tetrahedron(tet_vertices: np.ndarray, translation: np.ndarray) -> trimesh.Trimesh:
    pts = np.vstack([tet_vertices, tet_vertices + translation[None, :]])
    return convex_mesh_from_points(pts)


def tetrahedralize_interior(mesh: trimesh.Trimesh) -> np.ndarray:
    """
    Return (n_tets, 4) array of vertex-index tetrahedra filling the mesh
    interior.  Uses scipy Delaunay — correct for convex meshes.
    """
    tri = Delaunay(mesh.vertices)
    return tri.simplices  # (n_tets, 4)


def chunked_boolean_union(meshes, chunk_size=16) -> trimesh.Trimesh:
    meshes = [m for m in meshes if m.is_volume]
    if not meshes:
        raise ValueError("No volumetric meshes to union.")

    current = meshes
    while len(current) > 1:
        nxt = []
        for i in range(0, len(current), chunk_size):
            batch = current[i : i + chunk_size]
            if len(batch) == 1:
                nxt.append(batch[0])
            else:
                merged = trimesh.boolean.union(batch, engine="manifold")
                if merged is None:
                    raise RuntimeError("Boolean union failed on a batch.")
                nxt.append(merged)
        current = nxt
    return current[0]


# ---------------------------------------------------------------------------
# Core algorithm
# ---------------------------------------------------------------------------

def swept_volume_from_translation(
    input_mesh: trimesh.Trimesh,
    translation,
    union_chunk_size=16,
) -> trimesh.Trimesh:
    translation = np.asarray(translation, dtype=float)
    if translation.shape != (3,):
        raise ValueError("translation must be a length-3 vector")

    mesh = input_mesh.copy()
    mesh.process(validate=True)
    trimesh.repair.fix_normals(mesh)

    if not mesh.is_watertight:
        raise ValueError("Input mesh must be watertight.")
    if len(mesh.faces) == 0:
        raise ValueError("Input mesh has no faces.")

    # Tetrahedralize interior (works for convex shapes)
    elems = tetrahedralize_interior(mesh)

    # Build swept volume for every tetrahedron
    swept_parts = []
    for tet in elems:
        tet_vertices = mesh.vertices[tet]
        swept_parts.append(swept_tetrahedron(tet_vertices, translation))

    result = chunked_boolean_union(swept_parts, chunk_size=union_chunk_size)

    result.process(validate=True)
    trimesh.repair.fix_normals(result)

    if not result.is_watertight:
        raise RuntimeError("Result is not watertight.")

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # --- Create an upright cylinder: width (diameter) = 10, height = 30, 16 segments ---
    RADIUS = 5.0          # width 10 → radius 5
    HEIGHT = 30.0
    SECTIONS = 16         # 16 segments around the circumference

    cylinder = trimesh.creation.cylinder(
        radius=RADIUS,
        height=HEIGHT,
        sections=SECTIONS,
    )

    # Centre it so the base sits on z = 0
    cylinder.apply_translation([0, 0, HEIGHT / 2])

    print(
        f"Cylinder – vertices: {len(cylinder.vertices)}, "
        f"faces: {len(cylinder.faces)}, "
        f"watertight: {cylinder.is_watertight}"
    )

    # --- Translation vector with X, Y, Z (ramping motion) ---
    translation = np.array([15.0, 10.0, 8.0])

    print(f"Translation vector: {translation}")
    print("Computing swept volume …")

    swept = swept_volume_from_translation(cylinder, translation)

    # --- Save results as STL ---
    cylinder.export("cylinder_input.stl")
    swept.export("swept_result.stl")

    print(f"\nInput  → cylinder_input.stl  ({len(cylinder.faces)} faces)")
    print(f"Result → swept_result.stl    ({len(swept.faces)} faces)")
    print(f"Result watertight: {swept.is_watertight}")
    print(f"Result volume:     {swept.volume:.2f}")
