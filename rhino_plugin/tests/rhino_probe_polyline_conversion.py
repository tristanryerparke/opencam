#! python 3
"""Non-mutating live Rhino check for CPython Polyline out-parameter conversion."""

import importlib
import sys
from pathlib import Path

import Rhino
from run_in_rhino.rhino_env.client import SocketConnection
from run_in_rhino.rhino_env.parasite import OutputParasite

sys.path.insert(0, str(Path(__file__).parents[1] / "python"))
from opencam_rhino import selection  # noqa: E402

importlib.reload(selection)
curve = Rhino.Geometry.PolylineCurve(Rhino.Geometry.Polyline([
    Rhino.Geometry.Point3d(0, 0, 0),
    Rhino.Geometry.Point3d(10, 0, 0),
    Rhino.Geometry.Point3d(10, 10, 0),
    Rhino.Geometry.Point3d(0, 0, 0),
]))

connection = SocketConnection()
with OutputParasite(connection, done_msg=True):
    points = selection._curve_points(curve)
    print("polyline_points={}".format(points))
