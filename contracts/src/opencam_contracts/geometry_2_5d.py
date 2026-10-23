from __future__ import annotations

from opencam_contracts.geometry_2d import ClosedPolyline2D, Polyline2D


class Polyline25D(Polyline2D):
    z: float


class ClosedPolyline25D(ClosedPolyline2D):
    z: float
