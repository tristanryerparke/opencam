from pydantic import ConfigDict, Field

from opencam.schemas.geometry_2d import ClosedPolyline2D as ClosedPolyline, Point2D
from opencam.schemas.operations.base import ui_metadata


class ClosedPolyline25D(ClosedPolyline):
    z: float 
