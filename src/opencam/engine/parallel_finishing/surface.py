"""Continuous cutter-location height over a triangulated part mesh.

For a tool-center position ``p = (x, y)`` and a tool of radius ``r``:

    flat-end tip:   z_tip(p) = max over q in disk(p, r) of z_mesh(q)
    ball-end tip:   z_tip(p) = max over q in disk(p, r) of
                                z_mesh(q) + sqrt(r^2 - |q - p|^2) - r

The mesh is piecewise linear. Inside each triangle ``z`` is affine
(``z(q) = gx*qx + gy*qy + off``), so the maximum over ``triangle ∩ disk`` is
found analytically from a finite candidate set rather than by grid sampling.

Flat-end candidates (affine over a convex-with-arcs region):
  * triangle vertices inside the disk
  * triangle-edge / circle intersections
  * the circle support point in the gradient direction (if inside the triangle)

Ball-end candidates (linear + concave sphere term, so concave overall):
  * interior critical point ``p + grad * r / sqrt(1 + |grad|^2)`` (if inside)
  * triangle vertices inside the disk
  * triangle-edge / circle intersections (sphere term is zero on the circle)
  * triangle-edge interior stationary points (closed-form quadratic in t)
  * the circle support point in the gradient direction (if inside)

Vertical walls (zero XY projected area) have no interior candidates; their
contribution is captured by their vertices and edge intersections, which is
exactly the wall-top clearance a finishing pass needs.

This is exact relative to the input triangle mesh and assumes a top-visible
height-field part (each vertical ray hits the top surface once). True
accessibility under overhangs/holders is deferred to a later 3D configuration
-space solver.
"""

from __future__ import annotations

import math

import numpy as np
from rtree import index as rtree_index

from opencam.schemas.mesh import Mesh

_EPS = 1e-9


def _quad_roots_in_range(a: float, b: float, c: float, lo: float, hi: float) -> list[float]:
    if abs(a) < 1e-18:
        if abs(b) < 1e-18:
            return []
        t = -c / b
        return [t] if lo - _EPS <= t <= hi + _EPS else []
    disc = b * b - 4.0 * a * c
    if disc < 0.0:
        return []
    sqrt_disc = math.sqrt(disc)
    candidates = [(-b - sqrt_disc) / (2.0 * a), (-b + sqrt_disc) / (2.0 * a)]
    return [min(max(t, lo), hi) for t in candidates if lo - _EPS <= t <= hi + _EPS]


def _segment_circle_intersections(
    ax: float,
    ay: float,
    bx: float,
    by: float,
    cx: float,
    cy: float,
    r: float,
) -> list[tuple[float, float, float]]:
    """Points where segment a-b meets circle (center c, radius r), as (x, y, t)."""
    dx = bx - ax
    dy = by - ay
    denom = dx * dx + dy * dy
    if denom < 1e-18:
        return []
    fx = ax - cx
    fy = ay - cy
    b = fx * dx + fy * dy
    c = fx * fx + fy * fy - r * r
    disc = b * b - denom * c
    if disc < 0.0:
        return []
    out: list[tuple[float, float, float]] = []
    if disc == 0.0:
        ts = [-b / denom]
    else:
        sqrt_disc = math.sqrt(disc)
        ts = [(-b - sqrt_disc) / denom, (-b + sqrt_disc) / denom]
    for t in ts:
        if -_EPS <= t <= 1.0 + _EPS:
            tc = min(max(t, 0.0), 1.0)
            out.append((ax + tc * dx, ay + tc * dy, tc))
    return out


def _edge_ball_stationary_t(
    ax: float,
    ay: float,
    bx: float,
    by: float,
    za: float,
    zb: float,
    cx: float,
    cy: float,
    r: float,
) -> list[float]:
    """Parameter t in [0, 1] where ball-tip height along edge a-b is stationary.

    Along the edge z(t) is linear in the edge's own vertices (no face plane
    needed), so this works for vertical walls too. Derived by setting the
    derivative of ``z(t) + sqrt(r^2 - |w(t)|^2) - r`` to zero and squaring,
    which yields a quadratic in t.
    """
    dx = bx - ax
    dy = by - ay
    d2 = dx * dx + dy * dy
    if d2 < 1e-18:
        return []
    slope = zb - za  # A in the quadratic
    fx = ax - cx
    fy = ay - cy
    b_dot = fx * dx + fy * dy  # B
    w0 = fx * fx + fy * fy
    a2 = slope * slope
    c2 = -d2 * (a2 + d2)
    c1 = -2.0 * b_dot * (a2 + d2)
    c0 = a2 * (r * r - w0) - b_dot * b_dot
    return _quad_roots_in_range(c2, c1, c0, 0.0, 1.0)


def _point_in_triangle(px: float, py: float, xy: np.ndarray) -> bool:
    ax, ay = xy[0, 0], xy[0, 1]
    bx, by = xy[1, 0], xy[1, 1]
    cx, cy = xy[2, 0], xy[2, 1]
    d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
    d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
    d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
    has_neg = d1 < -_EPS or d2 < -_EPS or d3 < -_EPS
    has_pos = d1 > _EPS or d2 > _EPS or d3 > _EPS
    return not (has_neg and has_pos)


class TriangleSurface:
    """Validated triangle mesh with a broad-phase XY index and analytic height queries."""

    def __init__(self, vertices: np.ndarray, faces: np.ndarray) -> None:
        vertex_array = np.asarray(vertices, dtype=np.float64).reshape(-1, 3)
        face_array = np.asarray(faces, dtype=np.int64).reshape(-1, 3)
        if vertex_array.shape[0] < 3 or face_array.shape[0] < 1:
            raise ValueError("Part mesh requires at least 3 vertices and 1 face.")
        if not np.all(np.isfinite(vertex_array)):
            raise ValueError("Part mesh vertices must all be finite.")

        triangles = vertex_array[face_array]  # (M, 3, 3)
        tri_xy = triangles[:, :, :2]
        tri_z = triangles[:, :, 2]

        ab = triangles[:, 1] - triangles[:, 0]
        ac = triangles[:, 2] - triangles[:, 0]
        normals = np.cross(ab, ac)
        nz = normals[:, 2]
        # nz == twice the signed XY projected area, so |nz|>eps means a
        # non-vertical, non-degenerate face with a usable plane equation.
        plane_valid = np.abs(nz) > 1e-12
        d = np.einsum("ij,ij->i", normals, triangles[:, 0])

        face_count = face_array.shape[0]
        gx = np.full(face_count, np.nan)
        gy = np.full(face_count, np.nan)
        off = np.full(face_count, np.nan)
        nz_safe = np.where(plane_valid, nz, 1.0)
        gx = np.where(plane_valid, -normals[:, 0] / nz_safe, np.nan)
        gy = np.where(plane_valid, -normals[:, 1] / nz_safe, np.nan)
        off = np.where(plane_valid, d / nz_safe, np.nan)

        bbox_min = tri_xy.min(axis=1)
        bbox_max = tri_xy.max(axis=1)

        spatial_index = rtree_index.Index()
        for face_index in range(face_count):
            spatial_index.insert(
                face_index,
                (
                    float(bbox_min[face_index, 0]),
                    float(bbox_min[face_index, 1]),
                    float(bbox_max[face_index, 0]),
                    float(bbox_max[face_index, 1]),
                ),
            )

        self.vertices = vertex_array
        self.faces = face_array
        self.triangles = triangles
        self._tri_xy = tri_xy
        self._tri_z = tri_z
        self._gx = gx
        self._gy = gy
        self._off = off
        self._plane_valid = plane_valid
        self._index = spatial_index

    @classmethod
    def from_mesh(cls, mesh: Mesh) -> "TriangleSurface":
        return cls(mesh.vertices, mesh.faces)

    def _candidate_faces(self, x: float, y: float, r: float) -> list[int]:
        return list(
            self._index.intersection((x - r, y - r, x + r, y + r))
        )

    def flat_tool_height(self, x: float, y: float, r: float) -> float:
        """Highest surface Z anywhere under the flat cutter footprint, or -inf."""
        r2 = r * r
        best = -math.inf
        for face_index in self._candidate_faces(x, y, r):
            xy = self._tri_xy[face_index]
            z = self._tri_z[face_index]
            for i in range(3):
                dx = xy[i, 0] - x
                dy = xy[i, 1] - y
                if dx * dx + dy * dy <= r2 + _EPS and z[i] > best:
                    best = z[i]
            for i in range(3):
                j = (i + 1) % 3
                for px, py, t in _segment_circle_intersections(
                    xy[i, 0], xy[i, 1], xy[j, 0], xy[j, 1], x, y, r
                ):
                    zi = (1.0 - t) * z[i] + t * z[j]
                    if zi > best:
                        best = zi
            if self._plane_valid[face_index]:
                gx = self._gx[face_index]
                gy = self._gy[face_index]
                off = self._off[face_index]
                # If the disk center is inside the triangle, the disk overlaps the
                # face interior. For a flat (zero-gradient) face this is the only
                # candidate; for a sloped face the support point below dominates.
                if _point_in_triangle(x, y, xy):
                    z_center = gx * x + gy * y + off
                    if z_center > best:
                        best = z_center
                gradient_norm = math.hypot(gx, gy)
                if gradient_norm > _EPS:
                    sx = x + r * gx / gradient_norm
                    sy = y + r * gy / gradient_norm
                    if _point_in_triangle(sx, sy, xy):
                        zs = gx * sx + gy * sy + off
                        if zs > best:
                            best = zs
        return best

    def ball_tool_height(self, x: float, y: float, r: float) -> float:
        """Lowest ball-tip Z that keeps the ball on/above the surface, or -inf."""
        r2 = r * r

        def sphere_bump(surface_z: float, distance_squared: float) -> float:
            return surface_z + math.sqrt(max(r2 - distance_squared, 0.0)) - r

        best = -math.inf
        for face_index in self._candidate_faces(x, y, r):
            xy = self._tri_xy[face_index]
            z = self._tri_z[face_index]
            for i in range(3):
                dx = xy[i, 0] - x
                dy = xy[i, 1] - y
                d2 = dx * dx + dy * dy
                if d2 <= r2 + _EPS:
                    value = sphere_bump(z[i], d2)
                    if value > best:
                        best = value
            for i in range(3):
                j = (i + 1) % 3
                ax, ay = xy[i, 0], xy[i, 1]
                bx, by = xy[j, 0], xy[j, 1]
                for px, py, t in _segment_circle_intersections(ax, ay, bx, by, x, y, r):
                    zi = (1.0 - t) * z[i] + t * z[j]
                    d2 = (px - x) ** 2 + (py - y) ** 2
                    value = sphere_bump(zi, d2)
                    if value > best:
                        best = value
                for t in _edge_ball_stationary_t(ax, ay, bx, by, z[i], z[j], x, y, r):
                    px = ax + t * (bx - ax)
                    py = ay + t * (by - ay)
                    d2 = (px - x) ** 2 + (py - y) ** 2
                    if d2 <= r2 + _EPS:
                        zi = (1.0 - t) * z[i] + t * z[j]
                        value = sphere_bump(zi, d2)
                        if value > best:
                            best = value
            if self._plane_valid[face_index]:
                gx = self._gx[face_index]
                gy = self._gy[face_index]
                off = self._off[face_index]
                gradient2 = gx * gx + gy * gy
                denom = math.sqrt(1.0 + gradient2)
                qx = x + gx * r / denom
                qy = y + gy * r / denom
                d2 = (qx - x) ** 2 + (qy - y) ** 2
                if d2 <= r2 + _EPS and _point_in_triangle(qx, qy, xy):
                    zq = gx * qx + gy * qy + off
                    value = sphere_bump(zq, d2)
                    if value > best:
                        best = value
                gradient_norm = math.sqrt(gradient2)
                if gradient_norm > _EPS:
                    sx = x + r * gx / gradient_norm
                    sy = y + r * gy / gradient_norm
                    if _point_in_triangle(sx, sy, xy):
                        zs = gx * sx + gy * sy + off
                        value = sphere_bump(zs, r2)  # on the circle, sphere term is zero
                        if value > best:
                            best = value
        return best


if __name__ == "__main__":
    # Self-check: a single tilted triangle z = 0.5*x + 0.25*y over [0,10]x[0,10].
    verts = np.array(
        [[0.0, 0.0, 0.0], [10.0, 0.0, 5.0], [0.0, 10.0, 2.5], [10.0, 10.0, 7.5]],
        dtype=np.float64,
    )
    faces = np.array([[0, 1, 2], [1, 3, 2]], dtype=np.int64)
    surface = TriangleSurface(verts, faces)
    radius = 1.0

    flat = surface.flat_tool_height(5.0, 5.0, radius)
    # Highest point of z=0.5x+0.25y over the disk at (5,5): gradient (0.5,0.25),
    # support point at (5,5)+1*(0.5,0.25)/0.559 ~ (5.894,5.447) inside the plane.
    expected_flat = 0.5 * (5.0 + radius * 0.5 / 0.5590169) + 0.25 * (5.0 + radius * 0.25 / 0.5590169)
    assert abs(flat - expected_flat) < 1e-6, (flat, expected_flat)

    # Ball at the same place must reach lower than the flat tip (rolls into the slope).
    ball = surface.ball_tool_height(5.0, 5.0, radius)
    assert ball < flat, (ball, flat)

    print("surface.py self-check OK", flat, ball)
