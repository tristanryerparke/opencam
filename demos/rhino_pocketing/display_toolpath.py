"""Refresh the persistent OpenCAM toolpath display from injected JSON data."""

import json

import Rhino
import System.Drawing
import scriptcontext as sc

from run_in_rhino.rhino_env.client import SocketConnection
from run_in_rhino.rhino_env.env import install_sticky_environment
from run_in_rhino.rhino_env.parasite import OutputParasite

CONDUIT_KEY = "opencam.rhino_pocketing.conduit"
CUTTING_COLOR = System.Drawing.Color.FromArgb(29, 78, 216)
LINKING_COLOR = System.Drawing.Color.FromArgb(234, 179, 8)
RAPID_COLOR = System.Drawing.Color.FromArgb(220, 38, 38)
START_COLOR = System.Drawing.Color.LimeGreen
END_COLOR = System.Drawing.Color.Red


class ToolpathConduit(Rhino.Display.DisplayConduit):
    def __init__(self, segments, start_point, end_point):
        super().__init__()
        self.segments = segments
        self.start_point = start_point
        self.end_point = end_point

    def CalculateBoundingBox(self, event):
        points = [self.start_point, self.end_point]
        for segment, _, _ in self.segments:
            points.extend(segment)
        event.IncludeBoundingBox(Rhino.Geometry.BoundingBox(points))

    def DrawOverlay(self, event):
        for points, color, thickness in self.segments:
            if len(points) >= 2:
                event.Display.DrawPolyline(Rhino.Geometry.Polyline(points), color, thickness)
        event.Display.DrawPoint(self.start_point, Rhino.Display.PointStyle.RoundSimple, 6, START_COLOR)
        event.Display.DrawPoint(self.end_point, Rhino.Display.PointStyle.RoundSimple, 6, END_COLOR)


def color_for(role):
    if role == "rapid":
        return RAPID_COLOR
    if role == "linking":
        return LINKING_COLOR
    return CUTTING_COLOR


def point(values):
    return Rhino.Geometry.Point3d(values[0], values[1], values[2])


connection = SocketConnection()
environment = install_sticky_environment(connection)
with OutputParasite(connection, done_msg=True):
    payload = environment["toolpath"]
    segments = [([point(value) for value in item["points"]], color_for(item["role"]), 2 if item["role"] == "rapid" else 3) for item in payload["segments"]]
    old_conduit = sc.sticky.pop(CONDUIT_KEY, None)
    if old_conduit is not None:
        old_conduit.Enabled = False
    conduit = ToolpathConduit(segments, point(payload["start"]), point(payload["end"]))
    conduit.Enabled = True
    sc.sticky[CONDUIT_KEY] = conduit
    sc.doc.Views.Redraw()
    connection.send_data(json.dumps({"conduit_enabled": conduit.Enabled}))
