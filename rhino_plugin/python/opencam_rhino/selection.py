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


def select_planar_regions(doc):
    """Select planar faces or one or more closed planar edge/curve loops.

    Each face preserves islands from its inner loops. Each independently joined
    closed edge/curve loop becomes its own operation-local region.
    """
    import Rhino
    from Rhino.DocObjects import ObjectType
    from Rhino.Input.Custom import GetObject

    getter = GetObject()
    getter.SetCommandPrompt("Select one or more planar Brep faces or closed edge loops")
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
        if len(faces) != len(references):
            raise ValueError("Select planar faces, or only boundary edges/curves, not both.")
        return [
            _region_from_face(
                face,
                reference,
                doc.ModelAbsoluteTolerance,
                doc.ModelAngleToleranceRadians,
            )
            for face, reference in zip(faces, references)
        ]
    return _regions_from_curves(doc, references)


def _region_from_face(face, reference, tolerance, angle_tolerance):
    ok, plane = face.TryGetPlane()
    if not ok:
        raise ValueError("The selected Brep face must be planar.")
    loops = [_curve_points(loop.To3dCurve(), tolerance, angle_tolerance) for loop in face.Loops]
    if not loops:
        raise ValueError("The selected face has no boundary loop.")
    outer_index = next((i for i, loop in enumerate(face.Loops) if str(loop.LoopType) == "Outer"), 0)
    outer = loops[outer_index]
    inner = [loop for index, loop in enumerate(loops) if index != outer_index]
    return PlanarRegion(
        source_object_ids=[str(reference.ObjectId)],
        plane=_plane_data(plane), outer_loop=outer, inner_loops=inner,
        source_object_names=[_source_name(reference)],
    )


def _regions_from_curves(doc, references):
    import Rhino

    curves = [reference.Curve() or reference.Edge() for reference in references]
    if any(curve is None for curve in curves):
        raise ValueError("Every selected item must be a Brep edge or curve.")
    joined = Rhino.Geometry.Curve.JoinCurves(curves, doc.ModelAbsoluteTolerance)
    if not joined:
        raise ValueError("Selected edges could not be joined into closed loops.")

    source_object_ids = [str(reference.ObjectId) for reference in references]
    source_object_names = [_source_name(reference) for reference in references]
    regions = []
    for curve in joined:
        if not curve.IsClosed:
            raise ValueError("Every selected edge chain must form a closed loop.")
        ok, plane = curve.TryGetPlane(doc.ModelAbsoluteTolerance)
        if not ok:
            raise ValueError("Every selected edge loop must be planar.")
        regions.append(PlanarRegion(
            source_object_ids=source_object_ids,
            plane=_plane_data(plane),
            outer_loop=_curve_points(
                curve,
                doc.ModelAbsoluteTolerance,
                doc.ModelAngleToleranceRadians,
            ),
            source_object_names=source_object_names,
        ))
    return regions


def _source_name(reference):
    obj = reference.Object()
    return obj.Name if obj and obj.Name else "Rhino object"


def _curve_points(curve, tolerance=0.01, angle_tolerance=0.1):
    polyline = _try_get_polyline(curve)
    if polyline is None:
        curve = curve.ToPolyline(tolerance, angle_tolerance, 0.0, 0.0)
        polyline = None if curve is None else _try_get_polyline(curve)
        if polyline is None:
            raise ValueError("Could not tessellate selected boundary.")
    points = [[point.X, point.Y, point.Z] for point in polyline]
    if len(points) < 3:
        raise ValueError("A region loop needs at least three points.")
    if points[0] != points[-1]:
        points.append(points[0])
    return points


def _try_get_polyline(curve):
    """Read RhinoCommon's `out Polyline` result through CPython pythonnet."""
    result = curve.TryGetPolyline()
    if not isinstance(result, tuple) or len(result) != 2:
        return None
    ok, polyline = result
    return polyline if ok else None


def _plane_data(plane):
    return {"origin": [plane.OriginX, plane.OriginY, plane.OriginZ], "x_axis": [plane.XAxis.X, plane.XAxis.Y, plane.XAxis.Z], "y_axis": [plane.YAxis.X, plane.YAxis.Y, plane.YAxis.Z], "normal": [plane.Normal.X, plane.Normal.Y, plane.Normal.Z]}
