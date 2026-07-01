from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from shapely.geometry import Polygon


Coordinate2D = tuple[float, float]


@dataclass
class PocketTreeNode:
    polyline: np.ndarray
    polygon: Polygon
    parent: PocketTreeNode | None = None
    children: list["PocketTreeNode"] = field(default_factory=list)


@dataclass
class PocketPathTemplate:
    coordinates: np.ndarray


@dataclass
class StraightRunCandidate:
    start_index: int
    end_index: int
    start_length: float
    length: float
    midpoint_length: float
    midpoint: Coordinate2D
    start_point: Coordinate2D
    end_point: Coordinate2D
