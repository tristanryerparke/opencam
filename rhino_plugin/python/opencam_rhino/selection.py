"""Rhino-native part and planar-region getters.

The backend only receives normalized mesh/loop data.  Rhino object IDs remain in
document state so a later command can detect deleted or replaced source objects.
"""

from __future__ import annotations

from .contracts import PartSelection, PlanarRegion, StockBox


def select_part(doc):
    import Rhino
    from Rhino.DocObjects import ObjectType
    from Rhino.Input import GetResult
    from Rhino.Input.Custom import GetObject

    getter = GetObject()
    getter.SetCommandPrompt("Select a polysurface or Brep part for OpenCAM")
    getter.GeometryFilter = ObjectType.Brep
    getter.SubObjectSelect = False
    getter.EnablePreSelect(True, True)
    if getter.Get() != GetResult.Object:
        return None
    reference = getter.Object(0)
    brep = reference.Brep()
    if brep is None:
        raise ValueError("Select a Brep or polysurface, not a subobject.")

    meshes = Rhino.Geometry.Mesh.CreateFromBrep(brep, Rhino.Geometry.MeshingParameters.Default)
    if not meshes:
        raise ValueError("Rhino could not mesh the selected part.")
    mesh = Rhino.Geometry.Mesh()
    for item in meshes:
        mesh.Append(item)
    mesh.Faces.ConvertQuadsToTriangles()
    mesh.Compact()
    if mesh.Vertices.Count < 3 or mesh.Faces.Count < 1:
        raise ValueError("The selected part produced an empty mesh.")

    bounds = brep.GetBoundingBox(True)
    obj = reference.Object()
    return PartSelection(
        object_id=str(reference.ObjectId),
        name=(obj.Name if obj and obj.Name else "Rhino part"),
        mesh={
            "source": "inline",
            "vertices": [[point.X, point.Y, point.Z] for point in mesh.Vertices],
            "faces": [[face.A, face.B, face.C] for face in mesh.Faces],
        },
        stock_box=StockBox(
            min=[bounds.Min.X, bounds.Min.Y, bounds.Min.Z],
            max=[bounds.Max.X, bounds.Max.Y, bounds.Max.Z],
        ),
    )


def select_planar_region(doc):
    """Select a planar face or a connected set of planar boundary edges/curves.

    A face preserves islands from its inner loops.  For edge selection, joined
    closed curves are treated as loops; the largest signed-area loop is outer.
    """
    import Rhino
    from Rhino.DocObjects import ObjectType
    from Rhino.Input import GetResult
    from Rhino.Input.Custom import GetObject

    getter = GetObject()
    getter.SetCommandPrompt("Select a planar Brep face or closed planar edge region")
    getter.GeometryFilter = ObjectType.Curve | ObjectType.Surface
    getter.SubObjectSelect = True
    getter.EnablePreSelect(True, True)
    getter.EnableClearObjectsOnEntry(False)
    getter.EnableUnselectObjectsOnExit(False)
    getter.GetMultiple(1, 0)
    if getter.CommandResult() != Rhino.Commands.Result.Success or getter.ObjectCount < 1:
        return None

    references = [getter.Object(index) for index in range(getter.ObjectCount)]
    faces = [reference.Face() for reference in references if reference.Face() is not None]
    if faces:
        if len(faces) != 1 or len(references) != 1:
            raise ValueError("Select one planar face, or only boundary edges/curves.")
        return _region_from_face(faces[0], references[0])
    return _region_from_curves(doc, references)


def _region_from_face(face, reference):
    ok, plane = face.TryGetPlane()
    if not ok:
        raise ValueError("The selected Brep face must be planar.")
    loops = [_curve_points(loop.To3dCurve()) for loop in face.Loops]
    if not loops:
        raise ValueError("The selected face has no boundary loop.")
    outer_index = next((i for i, loop in enumerate(face.Loops) if str(loop.LoopType) == "Outer"), 0)
    outer = loops[outer_index]
    inner = [loop for index, loop in enumerate(loops) if index != outer_index]
    return PlanarRegion(
        source_object_ids=[str(reference.ObjectId)],
        plane=_plane_data(plane), outer_loop=outer, inner_loops=inner,
    )


def _region_from_curves(doc, references):
    import Rhino

    curves = [reference.Curve() or reference.Edge() for reference in references]
    if any(curve is None for curve in curves):
        raise ValueError("Every selected item must be a Brep edge or curve.")
    joined = Rhino.Geometry.Curve.JoinCurves(curves, doc.ModelAbsoluteTolerance)
    if not joined:
        raise ValueError("Selected edges could not be joined into a closed loop.")
    loops = []
    plane = None
    for curve in joined:
        if not curve.IsClosed:
            raise ValueError("Selected edges must form closed loops.")
        ok, curve_plane = curve.TryGetPlane(doc.ModelAbsoluteTolerance)
        if not ok:
            raise ValueError("Selected edges must be planar.")
        if plane is None:
            plane = curve_plane
        elif not _coplanar(plane, curve_plane, doc.ModelAbsoluteTolerance):
            raise ValueError("Selected loops must share one machining plane.")
        loops.append(_curve_points(curve))
    if plane is None:
        raise ValueError("No planar loops were selected.")
    outer_index = max(range(len(loops)), key=lambda index: abs(_signed_area(loops[index], plane)))
    return PlanarRegion(
        source_object_ids=[str(reference.ObjectId) for reference in references],
        plane=_plane_data(plane), outer_loop=loops[outer_index],
        inner_loops=[loop for index, loop in enumerate(loops) if index != outer_index],
    )


def _curve_points(curve):
    import Rhino

    polyline = Rhino.Geometry.Polyline()
    if not curve.TryGetPolyline(polyline):
        curve = curve.ToPolyline(0.0, 0.0, 0.0, 0.01, 0.0, 0.0, 0.0, True)
        if curve is None or not curve.TryGetPolyline(polyline):
            raise ValueError("Could not tessellate selected boundary.")
    points = [[point.X, point.Y, point.Z] for point in polyline]
    if len(points) < 3:
        raise ValueError("A region loop needs at least three points.")
    if points[0] != points[-1]:
        points.append(points[0])
    return points


def _plane_data(plane):
    return {"origin": [plane.OriginX, plane.OriginY, plane.OriginZ], "x_axis": [plane.XAxis.X, plane.XAxis.Y, plane.XAxis.Z], "y_axis": [plane.YAxis.X, plane.YAxis.Y, plane.YAxis.Z], "normal": [plane.Normal.X, plane.Normal.Y, plane.Normal.Z]}


def _coplanar(first, second, tolerance):
    origin_delta = second.Origin - first.Origin
    return abs(origin_delta * first.Normal) <= tolerance and abs(first.Normal * second.Normal) >= 1.0 - 1e-7


def _signed_area(points, plane):
    import Rhino

    area = 0.0
    for first, second in zip(points, points[1:]):
        a = plane.ClosestParameter(Rhino.Geometry.Point3d(*first))
        b = plane.ClosestParameter(Rhino.Geometry.Point3d(*second))
        area += a[0] * b[1] - b[0] * a[1]
    return area / 2.0
