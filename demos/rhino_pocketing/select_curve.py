"""Select or reuse a Rhino curve and return a sampled 3D closed polyline."""

import json

import Rhino
import Rhino.Input.Custom
import scriptcontext as sc

from run_in_rhino.rhino_env.client import SocketConnection
from run_in_rhino.rhino_env.env import install_sticky_environment
from run_in_rhino.rhino_env.parasite import OutputParasite

CURVE_ID_KEY = "opencam.rhino_pocketing.curve_id"
PROMPT_KEY = "opencam.rhino_pocketing.prompt"


def selected_curve_id():
    curve_id = sc.sticky.get(CURVE_ID_KEY)
    prompt = sc.sticky.get(PROMPT_KEY, "Select a closed planar boundary")
    if curve_id is not None and sc.doc.Objects.FindId(curve_id) is not None:
        return curve_id

    getter = Rhino.Input.Custom.GetObject()
    getter.SetCommandPrompt(prompt)
    getter.GeometryFilter = Rhino.DocObjects.ObjectType.Curve
    getter.Get()
    if getter.CommandResult() != Rhino.Commands.Result.Success:
        return None

    curve_id = getter.Object(0).ObjectId
    sc.sticky[CURVE_ID_KEY] = curve_id
    return curve_id


def curve_points(curve_id):
    rhino_object = sc.doc.Objects.FindId(curve_id)
    if rhino_object is None:
        sc.sticky.pop(CURVE_ID_KEY, None)
        raise ValueError("The saved curve no longer exists.")

    curve = rhino_object.Geometry
    if not isinstance(curve, Rhino.Geometry.Curve) or not curve.IsClosed:
        raise ValueError("Select a closed curve.")
    success, plane = curve.TryGetPlane()
    if not success:
        raise ValueError("The pocket boundary must be planar.")

    polyline_curve = curve if isinstance(curve, Rhino.Geometry.PolylineCurve) else None
    if polyline_curve is None:
        success, polyline = curve.ToPolyline(
            0.0,
            0.0,
            0.0,
            0.01,
            0.0,
            0.0,
            0.0,
            True,
        )
        if not success:
            raise ValueError("Could not convert the selected curve to a 0.01-unit polyline.")
        points = list(polyline)
    else:
        points = list(polyline_curve.ToPolyline())

    if len(points) < 3:
        raise ValueError("The selected curve has too few polyline vertices.")
    if points[0].DistanceTo(points[-1]) > sc.doc.ModelAbsoluteTolerance:
        points.append(points[0])
    return [[point.X, point.Y, point.Z] for point in points]


connection = SocketConnection()
environment = install_sticky_environment(connection)
with OutputParasite(connection, done_msg=True):
    sc.sticky[PROMPT_KEY] = environment.get("prompt", "Select a closed planar boundary")
    curve_id = selected_curve_id()
    if curve_id is not None:
        connection.send_data(json.dumps({"curve_id": str(curve_id), "points": curve_points(curve_id)}))
