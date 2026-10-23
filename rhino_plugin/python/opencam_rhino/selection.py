"""Rhino-native part and planar-region getters.

The backend only receives normalized mesh/loop data. Rhino object and Brep
component references remain in document state so regeneration can re-read current
geometry and detect deleted or replaced sources.
"""

from __future__ import annotations

from .contracts import (
    PartSelection,
    PlanarRegion,
    SourceGeometryReference,
    StockBox,
)


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

    obj = reference.Object()
    return _part_selection_from_brep(
        str(reference.ObjectId),
        obj.Name if obj and obj.Name else "Rhino part",
        brep,
    )


def refresh_part(doc, part: PartSelection) -> PartSelection:
    obj = _find_object(doc, part.object_id)
    if obj is None or obj.IsDeleted:
        raise ValueError("The selected OpenCAM part no longer exists.")
    brep = _object_brep(obj)
    if brep is None:
        raise ValueError("The selected OpenCAM part can no longer be converted to a Brep.")
    return _part_selection_from_brep(
        str(obj.Id),
        obj.Name if obj.Name else part.name,
        brep,
    )


def _part_selection_from_brep(object_id, name, brep):
    import Rhino

    meshes = Rhino.Geometry.Mesh.CreateFromBrep(
        brep,
        Rhino.Geometry.MeshingParameters.Default,
    )
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
    return PartSelection(
        object_id=str(object_id),
        name=str(name),
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
    return _region_from_face_geometry(
        face,
        SourceGeometryReference(
            object_id=str(reference.ObjectId),
            component_type="brep_face",
            component_index=int(face.FaceIndex),
        ),
        _source_name(reference),
        tolerance,
        angle_tolerance,
    )


def _region_from_face_geometry(
    face,
    source_reference,
    source_name,
    tolerance,
    angle_tolerance,
):
    ok, plane = face.TryGetPlane()
    if not ok:
        raise ValueError("The selected Brep face must be planar.")
    loops = [
        _curve_points(loop.To3dCurve(), tolerance, angle_tolerance)
        for loop in face.Loops
    ]
    if not loops:
        raise ValueError("The selected face has no boundary loop.")
    outer_index = next(
        (i for i, loop in enumerate(face.Loops) if str(loop.LoopType) == "Outer"),
        0,
    )
    outer = loops[outer_index]
    inner = [loop for index, loop in enumerate(loops) if index != outer_index]
    return PlanarRegion(
        source_object_ids=[source_reference.object_id],
        plane=_plane_data(plane),
        outer_loop=outer,
        inner_loops=inner,
        source_object_names=[source_name],
        source_references=[source_reference],
    )


def _regions_from_curves(doc, references):
    curves = []
    source_references = []
    for reference in references:
        edge = reference.Edge()
        curve = edge or reference.Curve()
        if curve is None:
            raise ValueError("Every selected item must be a Brep edge or curve.")
        curves.append(curve)
        source_references.append(
            SourceGeometryReference(
                object_id=str(reference.ObjectId),
                component_type="brep_edge" if edge is not None else "curve",
                component_index=int(edge.EdgeIndex) if edge is not None else None,
            )
        )
    return _regions_from_curve_geometry(
        doc,
        curves,
        source_references,
        [_source_name(reference) for reference in references],
    )


def _regions_from_curve_geometry(doc, curves, source_references, source_names):
    import Rhino

    joined = Rhino.Geometry.Curve.JoinCurves(curves, doc.ModelAbsoluteTolerance)
    if not joined:
        raise ValueError("Selected edges could not be joined into closed loops.")

    source_object_ids = [reference.object_id for reference in source_references]
    regions = []
    for curve in joined:
        if not curve.IsClosed:
            raise ValueError("Every selected edge chain must form a closed loop.")
        ok, plane = curve.TryGetPlane(doc.ModelAbsoluteTolerance)
        if not ok:
            raise ValueError("Every selected edge loop must be planar.")
        regions.append(
            PlanarRegion(
                source_object_ids=source_object_ids,
                plane=_plane_data(plane),
                outer_loop=_curve_points(
                    curve,
                    doc.ModelAbsoluteTolerance,
                    doc.ModelAngleToleranceRadians,
                ),
                source_object_names=source_names,
                source_references=source_references,
            )
        )
    return regions


def refresh_planar_regions(doc, regions: list[PlanarRegion]) -> list[PlanarRegion]:
    refreshed = []
    seen_groups = set()
    for region in regions:
        source_references = list(region.source_references)
        if not source_references:
            source_references = _legacy_curve_references(doc, region)
        group_key = tuple(
            (
                reference.object_id.casefold(),
                reference.component_type,
                reference.component_index,
            )
            for reference in source_references
        )
        if group_key in seen_groups:
            continue
        seen_groups.add(group_key)

        resolved = [
            _resolve_source_reference(doc, reference)
            for reference in source_references
        ]
        component_types = {reference.component_type for reference in source_references}
        if "brep_face" in component_types:
            if component_types != {"brep_face"}:
                raise ValueError("An OpenCAM region mixes face and curve references.")
            refreshed.extend(
                _region_from_face_geometry(
                    geometry,
                    reference,
                    name,
                    doc.ModelAbsoluteTolerance,
                    doc.ModelAngleToleranceRadians,
                )
                for reference, (geometry, name) in zip(source_references, resolved)
            )
            continue

        refreshed.extend(
            _regions_from_curve_geometry(
                doc,
                [geometry for geometry, _name in resolved],
                source_references,
                [name for _geometry, name in resolved],
            )
        )
    return refreshed


def _legacy_curve_references(doc, region):
    import Rhino

    references = []
    for object_id in region.source_object_ids:
        obj = _find_object(doc, object_id)
        if obj is None or obj.IsDeleted:
            raise ValueError(f"OpenCAM source geometry no longer exists: {object_id}.")
        if not isinstance(obj.Geometry, Rhino.Geometry.Curve):
            raise ValueError(
                "Reselect this operation's drive geometry before regenerating; "
                "its saved face/edge reference predates live geometry tracking."
            )
        references.append(
            SourceGeometryReference(
                object_id=str(obj.Id),
                component_type="curve",
            )
        )
    if not references:
        raise ValueError("Select drive geometry before regenerating this operation.")
    return references


def _resolve_source_reference(doc, reference):
    import Rhino

    obj = _find_object(doc, reference.object_id)
    if obj is None or obj.IsDeleted:
        raise ValueError(
            f"OpenCAM source geometry no longer exists: {reference.object_id}."
        )
    name = obj.Name if obj.Name else "Rhino object"
    geometry = obj.Geometry
    if reference.component_type == "curve":
        if not isinstance(geometry, Rhino.Geometry.Curve):
            raise ValueError(f"OpenCAM source object {reference.object_id} is no longer a curve.")
        return geometry, name

    collection_name = "Faces" if reference.component_type == "brep_face" else "Edges"
    brep = _object_brep(obj)
    collection = getattr(brep, collection_name, None)
    index = reference.component_index
    if collection is None or index is None or index < 0 or index >= collection.Count:
        raise ValueError(
            f"OpenCAM source {reference.component_type} {index} no longer exists "
            f"on object {reference.object_id}."
        )
    return collection[index], name


def _object_brep(obj):
    import Rhino

    geometry = obj.Geometry
    if isinstance(geometry, Rhino.Geometry.Brep):
        return geometry
    return Rhino.Geometry.Brep.TryConvertBrep(geometry)


def _find_object(doc, object_id):
    import System

    return doc.Objects.FindId(System.Guid(str(object_id)))


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
