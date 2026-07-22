from __future__ import annotations

import math

import numpy as np

from opencam.schemas.mesh import Mesh
from opencam.schemas.tools import BallTool, CylindricalTool, Tool


class OpenCAMLibDropCutter:
    """OpenCAMLib drop-cutter projection for one part/tool pair."""

    def __init__(self, mesh: Mesh, tool: Tool) -> None:
        if not isinstance(tool, (BallTool, CylindricalTool)):
            raise NotImplementedError(
                f"Tool type {tool.type!r} is not supported for parallel finishing."
            )

        from opencam._opencamlib import DropCutterBackend

        vertices = np.asarray(mesh.vertices, dtype=np.float64)
        faces = np.asarray(mesh.faces, dtype=np.int64)
        self._baseline_z = float(vertices[:, 2].min() - max(tool.diameter, 1.0) - 1.0)
        self._tool = tool
        self._backend = DropCutterBackend(
            vertices,
            faces,
            "ball" if isinstance(tool, BallTool) else "cylinder",
            tool.diameter,
            tool.cutting_height,
        )

    def project_runs(
        self,
        path_vertices: list[tuple[float, float]],
        *,
        chord_tolerance: float,
        stock_to_leave: float,
    ) -> list[list[tuple[float, float, float]]]:
        if len(path_vertices) < 2:
            return []
        if chord_tolerance <= 0.0:
            raise ValueError("Chord tolerance must be greater than zero.")

        # OpenCAMLib uses path distance and tangent angle rather than a direct
        # chord-error tolerance. Keep its coarse sampling at tool scale and use
        # the requested tolerance as the adaptive floor.
        points = self._backend.project(
            np.asarray(path_vertices, dtype=np.float64),
            self._baseline_z,
            max(self._tool.diameter, 4.0 * chord_tolerance),
            chord_tolerance,
        )

        runs: list[list[tuple[float, float, float]]] = []
        current: list[tuple[float, float, float]] = []
        for x, y, z in np.asarray(points, dtype=np.float64):
            if not math.isfinite(z) or z <= self._baseline_z + 1e-7:
                if len(current) >= 2:
                    runs.append(current)
                current = []
                continue

            point = (float(x), float(y), float(z + stock_to_leave))
            if not current or abs(current[-1][0] - point[0]) > 1e-9 or abs(current[-1][1] - point[1]) > 1e-9:
                current.append(point)

        if len(current) >= 2:
            runs.append(current)
        return runs
