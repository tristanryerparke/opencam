"""A shared, document-scoped OpenCAM display conduit.

One conduit is cheaper and more reliable than a conduit per panel.  Crucially,
every draw callback resolves `event.RhinoDoc.RuntimeSerialNumber`; it never
falls back to ActiveDoc.  Therefore a preview for one document cannot draw in
another document's viewport.

Two kinds of content are supported, always keyed by document serial:

- the toolpath polyline overlay (DrawOverlay); and
- shaded mesh layers (PostDrawObjects, depth-tested): the simulation chunk
  rest/active/tool meshes, the final machined stock, and the vertex-colored
  comparison mesh.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ToolpathSegment:
    role: str
    points: tuple[tuple[float, float, float], ...]


@dataclass(frozen=True)
class ToolpathPreview:
    segments: tuple[ToolpathSegment, ...]
    start: tuple[float, float, float] | None
    end: tuple[float, float, float] | None

    @classmethod
    def from_operation(cls, operation: dict) -> "ToolpathPreview":
        records = operation.get("records")
        if not isinstance(records, list):
            raise ValueError("Toolpath response has no records array.")
        segments: list[ToolpathSegment] = []
        current_role = None
        current_points: list[tuple[float, float, float]] = []
        for record in records:
            if not isinstance(record, dict) or not all(key in record for key in ("x", "y", "z")):
                continue
            point = (float(record["x"]), float(record["y"]), float(record["z"]))
            role = _role_for(record)
            if current_points and role != current_role:
                segments.append(ToolpathSegment(current_role, tuple(current_points)))
                current_points = [current_points[-1], point]
            else:
                current_points.append(point)
            current_role = role
        if current_points:
            segments.append(ToolpathSegment(current_role or "cutting", tuple(current_points)))
        start = segments[0].points[0] if segments else None
        end = segments[-1].points[-1] if segments else None
        return cls(tuple(segment for segment in segments if len(segment.points) >= 2), start, end)


def _role_for(record: dict) -> str:
    if record.get("feed_type") == "rapid" or record.get("motion_role") == "travel":
        return "rapid"
    return "linking" if record.get("motion_role") == "linking" else "cutting"


def _color_for(role):
    import System.Drawing

    return {
        "rapid": System.Drawing.Color.FromArgb(220, 38, 38),
        "linking": System.Drawing.Color.FromArgb(234, 179, 8),
        "cutting": System.Drawing.Color.FromArgb(29, 78, 216),
    }[role]


def _marker_color(kind):
    import System.Drawing

    return System.Drawing.Color.LimeGreen if kind == "start" else System.Drawing.Color.Red


def build_rhino_mesh(parsed: dict, translation: tuple[float, float, float] | None = None):
    """Convert one parsed GLB mesh into a shaded Rhino mesh."""
    import Rhino

    mesh = Rhino.Geometry.Mesh()
    for vertex in parsed["vertices"]:
        mesh.Vertices.Add(vertex[0], vertex[1], vertex[2])
    for face in parsed["faces"]:
        mesh.Faces.AddFace(face[0], face[1], face[2])
    colors = parsed.get("colors")
    if colors:
        for red, green, blue in colors:
            mesh.VertexColors.Add(int(red), int(green), int(blue))
    if translation is not None:
        mesh.Translate(Rhino.Geometry.Vector3d(translation[0], translation[1], translation[2]))
    mesh.Normals.ComputeNormals()
    mesh.Compact()
    return mesh


def _mesh_style(role):
    import System.Drawing

    styles = {
        "rest": (System.Drawing.Color.FromArgb(176, 176, 176), 0.45),
        "active": (System.Drawing.Color.FromArgb(255, 179, 71), 0.0),
        "tool": (System.Drawing.Color.FromArgb(70, 80, 95), 0.0),
        "final": (System.Drawing.Color.FromArgb(96, 205, 133), 0.15),
        "comparison": (System.Drawing.Color.White, 0.0),
    }
    return styles.get(role, (System.Drawing.Color.FromArgb(160, 160, 160), 0.0))


CONDUIT_VERSION = 2


class OpenCamToolpathConduit:
    """Rhino wrapper, imported only when a Rhino session is present."""

    version = CONDUIT_VERSION

    def __init__(self):
        import Rhino

        class _Conduit(Rhino.Display.DisplayConduit):
            def __init__(inner):
                super().__init__()
                inner.toolpaths: dict[int, ToolpathPreview] = {}
                inner.mesh_layers: dict[int, dict[str, list]] = {}

            def _doc_serial(inner, event):
                doc = getattr(event, "RhinoDoc", None)
                return None if doc is None else int(doc.RuntimeSerialNumber)

            def _refresh_enabled(inner):
                inner.Enabled = bool(inner.toolpaths) or any(
                    layers for layers in inner.mesh_layers.values()
                )

            def CalculateBoundingBox(inner, event):
                serial = inner._doc_serial(event)
                if serial is None:
                    return
                points = []
                preview = inner.toolpaths.get(serial)
                if preview is not None:
                    points.extend(
                        Rhino.Geometry.Point3d(*point)
                        for segment in preview.segments
                        for point in segment.points
                    )
                if points:
                    event.IncludeBoundingBox(Rhino.Geometry.BoundingBox(points))
                for meshes in inner.mesh_layers.get(serial, {}).values():
                    for mesh in meshes:
                        box = mesh.GetBoundingBox(True)
                        if box.IsValid:
                            event.IncludeBoundingBox(box)

            def PostDrawObjects(inner, event):
                serial = inner._doc_serial(event)
                if serial is None:
                    return
                for role, meshes in inner.mesh_layers.get(serial, {}).items():
                    color, transparency = _mesh_style(role)
                    material = Rhino.Display.DisplayMaterial(color, transparency)
                    for mesh in meshes:
                        event.Display.DrawMeshShaded(mesh, material)

            def DrawOverlay(inner, event):
                serial = inner._doc_serial(event)
                if serial is None:
                    return
                preview = inner.toolpaths.get(serial)
                if preview is None:
                    return
                for segment in preview.segments:
                    event.Display.DrawPolyline(
                        Rhino.Geometry.Polyline(
                            [Rhino.Geometry.Point3d(*point) for point in segment.points]
                        ),
                        _color_for(segment.role),
                        2 if segment.role == "rapid" else 3,
                    )
                if preview.start is not None:
                    event.Display.DrawPoint(
                        Rhino.Geometry.Point3d(*preview.start),
                        Rhino.Display.PointStyle.RoundSimple,
                        6,
                        _marker_color("start"),
                    )
                if preview.end is not None:
                    event.Display.DrawPoint(
                        Rhino.Geometry.Point3d(*preview.end),
                        Rhino.Display.PointStyle.RoundSimple,
                        6,
                        _marker_color("end"),
                    )

        self._conduit = _Conduit()

    @property
    def enabled(self):
        return self._conduit.Enabled

    def set_toolpath(self, document_serial: int, preview: ToolpathPreview):
        self._conduit.toolpaths[int(document_serial)] = preview
        self._conduit._refresh_enabled()

    def set_mesh_layer(self, document_serial: int, role: str, meshes: list):
        layers = self._conduit.mesh_layers.setdefault(int(document_serial), {})
        if meshes:
            layers[role] = list(meshes)
        else:
            layers.pop(role, None)
        self._conduit._refresh_enabled()

    def clear_meshes(self, document_serial: int):
        self._conduit.mesh_layers.pop(int(document_serial), None)
        self._conduit._refresh_enabled()

    def forget_document(self, document_serial: int):
        serial = int(document_serial)
        self._conduit.toolpaths.pop(serial, None)
        self._conduit.mesh_layers.pop(serial, None)
        self._conduit._refresh_enabled()

    def clear(self):
        self._conduit.toolpaths.clear()
        self._conduit.mesh_layers.clear()
        self._conduit.Enabled = False
