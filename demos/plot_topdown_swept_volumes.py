#!/usr/bin/env python3
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as PolygonPatch
import numpy as np
from shapely import MultiPoint, union_all
from shapely.geometry import MultiPolygon, Polygon

from opencam.simulation.swept_volume import (
    TOOL_SEGMENTS,
    build_cylinder_mesh,
    march_tool_positions,
    rotation_matrix_about_z_to_face_xy_direction,
)

OUTPUT_PATH = Path("graphics/topdown-swept-volumes.png")
TOOL_DIAMETER = 10.0
STEP_DISTANCE = 5.0
ANGLE_TOLERANCE_DEGREES = 2.0
ARC_RADIUS = 30.0
STRAIGHT_LENGTH = 35.0
ARC_POINT_COUNT = 120
STRAIGHT_POINT_COUNT = 60


def build_demo_path() -> list[np.ndarray]:
    angles = np.linspace(-np.pi / 2.0, 0.0, ARC_POINT_COUNT)
    arc_positions = [
        np.array([ARC_RADIUS * np.cos(angle), ARC_RADIUS * np.sin(angle), 0.0], dtype=np.float64)
        for angle in angles
    ]
    straight_positions = [
        np.array([ARC_RADIUS, distance, 0.0], dtype=np.float64)
        for distance in np.linspace(0.0, STRAIGHT_LENGTH, STRAIGHT_POINT_COUNT)[1:]
    ]
    return arc_positions + straight_positions


def tool_profile_xy() -> np.ndarray:
    vertices, _faces = build_cylinder_mesh(TOOL_DIAMETER, 1.0, TOOL_SEGMENTS)
    bottom_ring = vertices[2 : 2 + TOOL_SEGMENTS, :3]
    return np.asarray(bottom_ring[:, :2], dtype=np.float64)


def swept_polygon(start: np.ndarray, end: np.ndarray, profile_xy: np.ndarray) -> Polygon:
    translation = end - start
    rotation = rotation_matrix_about_z_to_face_xy_direction(translation)
    profile_xyz = np.column_stack([profile_xy, np.zeros(len(profile_xy), dtype=np.float64)])
    rotated_profile_xy = (profile_xyz @ rotation.T)[:, :2]
    start_profile = rotated_profile_xy + start[:2]
    end_profile = rotated_profile_xy + end[:2]
    return MultiPoint(np.vstack([start_profile, end_profile])).convex_hull


def plot_polygon(ax: plt.Axes, polygon: Polygon, *, facecolor: tuple[float, float, float, float]) -> None:
    x, y = polygon.exterior.xy
    ax.add_patch(PolygonPatch(np.column_stack([x, y]), closed=True, facecolor=facecolor, edgecolor="none"))


if __name__ == "__main__":
    dense_path = build_demo_path()
    marched_path = march_tool_positions(dense_path, STEP_DISTANCE, ANGLE_TOLERANCE_DEGREES)
    profile_xy = tool_profile_xy()
    swept_polygons = [
        swept_polygon(start, end, profile_xy)
        for start, end in zip(marched_path, marched_path[1:], strict=False)
        if np.linalg.norm(end - start) > 1e-9
    ]
    union_polygon = union_all(swept_polygons)

    figure, ax = plt.subplots(figsize=(8, 8))
    cmap = plt.get_cmap("viridis")
    color_count = max(len(swept_polygons) - 1, 1)
    for index, polygon in enumerate(swept_polygons):
        plot_polygon(ax, polygon, facecolor=cmap(index / color_count, alpha=0.22))

    if isinstance(union_polygon, Polygon):
        boundaries = [union_polygon]
    elif isinstance(union_polygon, MultiPolygon):
        boundaries = list(union_polygon.geoms)
    else:
        boundaries = []

    for boundary in boundaries:
        x, y = boundary.exterior.xy
        ax.plot(x, y, color="black", linewidth=2)

    dense_xy = np.asarray([position[:2] for position in dense_path], dtype=np.float64)
    marched_xy = np.asarray([position[:2] for position in marched_path], dtype=np.float64)
    ax.plot(dense_xy[:, 0], dense_xy[:, 1], color="0.65", linewidth=1.0, linestyle="--", label="Dense path")
    ax.plot(marched_xy[:, 0], marched_xy[:, 1], color="#dc2626", linewidth=1.5, label="Marched path")
    ax.scatter(marched_xy[:, 0], marched_xy[:, 1], color="#dc2626", s=14, zorder=3)

    ax.set_aspect("equal", adjustable="box")
    ax.set_title(
        f"Top-down swept volumes\n{TOOL_SEGMENTS}-segment tool, step {STEP_DISTANCE:g} mm, turn tol {ANGLE_TOLERANCE_DEGREES:g}°"
    )
    ax.set_xlabel("X (mm)")
    ax.set_ylabel("Y (mm)")
    ax.legend(loc="upper left")
    ax.grid(True, alpha=0.2)
    figure.tight_layout()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(OUTPUT_PATH, dpi=220)
    print(f"Saved {OUTPUT_PATH}")
    print(f"Dense path points: {len(dense_path)}")
    print(f"Marched path points: {len(marched_path)}")
    print(f"Swept segments: {len(swept_polygons)}")
