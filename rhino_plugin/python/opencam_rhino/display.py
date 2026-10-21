"""A shared, document-scoped OpenCAM display conduit.

One conduit is cheaper and more reliable than a conduit per panel.  Crucially,
every draw callback resolves `event.RhinoDoc.RuntimeSerialNumber`; it never
falls back to ActiveDoc.  Therefore a preview for one document cannot draw in
another document's viewport.

Two kinds of content are supported, always keyed by document serial:

- the toolpath polyline overlay (DrawOverlay); and
- the moving shaded tool mesh (PostDrawObjects, depth-tested).
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

    def to_dict(self) -> dict:
        return {
            "segments": [
                {"role": segment.role, "points": [list(point) for point in segment.points]}
                for segment in self.segments
            ],
            "start": None if self.start is None else list(self.start),
            "end": None if self.end is None else list(self.end),
        }

    @classmethod
    def from_dict(cls, value: dict) -> ToolpathPreview:
        if not isinstance(value, dict):
            raise TypeError("Saved toolpath preview must be an object.")
        segments = []
        for item in value.get("segments", []):
            if not isinstance(item, dict) or item.get("role") not in {"rapid", "linking", "cutting"}:
                raise ValueError("Saved toolpath preview has an invalid segment.")
            points = tuple(_saved_point(point) for point in item.get("points", []))
            if len(points) >= 2:
                segments.append(ToolpathSegment(str(item["role"]), points))
        start = None if value.get("start") is None else _saved_point(value["start"])
        end = None if value.get("end") is None else _saved_point(value["end"])
        return cls(tuple(segments), start, end)

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
            role = _role_for(record)
            start = current_points[-1] if current_points else None
            for point in _record_points(record, start):
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


def _saved_point(value) -> tuple[float, float, float]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError("Saved toolpath point must contain three coordinates.")
    return tuple(float(coordinate) for coordinate in value)


def _record_points(record: dict, start: tuple[float, float, float] | None):
    """Endpoint for linear moves; tessellated arc points for arc moves."""
    point = (float(record["x"]), float(record["y"]), float(record["z"]))
    offset_x = record.get("centerOffsetX", record.get("center_offset_x"))
    offset_y = record.get("centerOffsetY", record.get("center_offset_y"))
    if offset_x is None or offset_y is None or start is None:
        return [point]
    center = (start[0] + float(offset_x), start[1] + float(offset_y), point[2])
    return _arc_points(start, center, point, bool(record.get("clockwise", False)))


def _arc_points(start, center, end, clockwise, tolerance=0.05):
    """Tessellate one XY arc from start to end around center."""
    import math

    radius = math.hypot(start[0] - center[0], start[1] - center[1])
    end_radius = math.hypot(end[0] - center[0], end[1] - center[1])
    if radius <= 1e-9 or end_radius <= 1e-9 or abs(radius - end_radius) > max(1e-6, 0.01 * radius):
        return [end]
    a0 = math.atan2(start[1] - center[1], start[0] - center[0])
    a1 = math.atan2(end[1] - center[1], end[0] - center[0])
    two_pi = 2.0 * math.pi
    sweep = -((a0 - a1) % two_pi) if clockwise else (a1 - a0) % two_pi
    if abs(sweep) < 1e-9:
        return [end]
    try:
        step = 2.0 * math.acos(max(-1.0, min(1.0, 1.0 - tolerance / radius)))
    except ValueError:
        step = math.pi / 2.0
    count = max(4, min(64, math.ceil(abs(sweep) / max(step, 1e-6))))
    points = []
    for index in range(1, count + 1):
        angle = a0 + sweep * index / count
        points.append((
            center[0] + radius * math.cos(angle),
            center[1] + radius * math.sin(angle),
            end[2],
        ))
    return points


def _role_for(record: dict) -> str:
    feed_type = record.get("feedType", record.get("feed_type"))
    motion_role = record.get("motionRole", record.get("motion_role"))
    if feed_type == "rapid" or motion_role == "travel":
        return "rapid"
    return "linking" if motion_role == "linking" else "cutting"


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


def stock_box_edges(min_point, max_point):
    """Twelve world-axis box edges as point pairs for the stock preview."""
    x0, y0, z0 = min_point
    x1, y1, z1 = max_point
    bottom = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)]
    top = [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    ring = lambda pts: list(zip(pts, pts[1:] + pts[:1]))
    return ring(bottom) + ring(top) + list(zip(bottom, top))


CONDUIT_VERSION = 7

DEFAULT_LAYER_VISIBILITY = {"stock": True, "part": True, "toolpath": True, "tool": True}


class OpenCamToolpathConduit:
    """Rhino wrapper with draw-ready geometry cached outside viewport callbacks."""

    version = CONDUIT_VERSION

    def __init__(self):
        import Rhino
        import System.Drawing

        class _Conduit(Rhino.Display.DisplayConduit):
            def __init__(inner):
                super().__init__()
                inner.toolpaths: dict[int, dict] = {}
                inner.mesh_layers: dict[int, dict[str, list]] = {}
                inner.stock_boxes: dict[int, list] = {}
                inner.layer_visibility: dict[int, dict] = {}
                inner.bounding_boxes: dict[int, object] = {}
                inner.path_colors = {
                    "rapid": System.Drawing.Color.FromArgb(220, 38, 38),
                    "linking": System.Drawing.Color.FromArgb(234, 179, 8),
                    "cutting": System.Drawing.Color.FromArgb(29, 78, 216),
                }
                inner.marker_colors = {
                    "start": System.Drawing.Color.LimeGreen,
                    "end": System.Drawing.Color.Red,
                }
                inner.stock_color = System.Drawing.Color.FromArgb(120, 113, 108)
                inner.mesh_materials = {
                    "tool": Rhino.Display.DisplayMaterial(
                        System.Drawing.Color.FromArgb(70, 80, 95), 0.0
                    ),
                    "part": Rhino.Display.DisplayMaterial(
                        System.Drawing.Color.FromArgb(148, 163, 184), 0.55
                    ),
                }

            def _visibility(inner, serial):
                return inner.layer_visibility.setdefault(serial, dict(DEFAULT_LAYER_VISIBILITY))

            def _doc_serial(inner, event):
                doc = getattr(event, "RhinoDoc", None)
                return None if doc is None else int(doc.RuntimeSerialNumber)

            def _cache_toolpath(inner, serial, preview):
                lines = {role: [] for role in inner.path_colors}
                points = []
                for segment in preview.segments:
                    segment_points = [
                        Rhino.Geometry.Point3d(*point) for point in segment.points
                    ]
                    points.extend(segment_points)
                    lines[segment.role].extend(
                        Rhino.Geometry.Line(start, end)
                        for start, end in zip(segment_points, segment_points[1:])
                    )
                inner.toolpaths[serial] = {
                    "lines": lines,
                    "start": None if preview.start is None else Rhino.Geometry.Point3d(*preview.start),
                    "end": None if preview.end is None else Rhino.Geometry.Point3d(*preview.end),
                    "bounding_box": Rhino.Geometry.BoundingBox(points),
                }

            def _rebuild_bounding_box(inner, serial):
                visibility = inner._visibility(serial)
                points = []
                toolpath = inner.toolpaths.get(serial)
                if visibility.get("toolpath", True) and toolpath is not None:
                    box = toolpath["bounding_box"]
                    if box.IsValid:
                        points.extend(box.GetCorners())
                if visibility.get("stock", True):
                    for start, end in inner.stock_boxes.get(serial, []):
                        points.extend((start, end))
                for role, meshes in inner.mesh_layers.get(serial, {}).items():
                    if not visibility.get(role, True):
                        continue
                    for mesh in meshes:
                        box = mesh.GetBoundingBox(True)
                        if box.IsValid:
                            points.extend(box.GetCorners())
                if points:
                    inner.bounding_boxes[serial] = Rhino.Geometry.BoundingBox(points)
                else:
                    inner.bounding_boxes.pop(serial, None)
                inner.Enabled = bool(inner.bounding_boxes)

            def CalculateBoundingBox(inner, event):
                serial = inner._doc_serial(event)
                box = None if serial is None else inner.bounding_boxes.get(serial)
                if box is not None and box.IsValid:
                    event.IncludeBoundingBox(box)

            def PostDrawObjects(inner, event):
                serial = inner._doc_serial(event)
                if serial is None:
                    return
                visibility = inner._visibility(serial)
                for role, meshes in inner.mesh_layers.get(serial, {}).items():
                    if not visibility.get(role, True):
                        continue
                    material = inner.mesh_materials[role]
                    for mesh in meshes:
                        event.Display.DrawMeshShaded(mesh, material)

            def DrawOverlay(inner, event):
                serial = inner._doc_serial(event)
                if serial is None:
                    return
                visibility = inner._visibility(serial)
                if visibility.get("stock", True):
                    for start, end in inner.stock_boxes.get(serial, []):
                        event.Display.DrawDottedLine(start, end, inner.stock_color)
                if not visibility.get("toolpath", True):
                    return
                toolpath = inner.toolpaths.get(serial)
                if toolpath is None:
                    return
                for role, lines in toolpath["lines"].items():
                    if lines:
                        event.Display.DrawLines(lines, inner.path_colors[role], 1)
                if toolpath["start"] is not None:
                    event.Display.DrawPoint(
                        toolpath["start"],
                        Rhino.Display.PointStyle.RoundSimple,
                        3,
                        inner.marker_colors["start"],
                    )
                if toolpath["end"] is not None:
                    event.Display.DrawPoint(
                        toolpath["end"],
                        Rhino.Display.PointStyle.RoundSimple,
                        3,
                        inner.marker_colors["end"],
                    )

        self._rhino = Rhino
        self._conduit = _Conduit()

    @property
    def enabled(self):
        return self._conduit.Enabled

    def set_toolpath(self, document_serial: int, preview: ToolpathPreview):
        serial = int(document_serial)
        self._conduit._cache_toolpath(serial, preview)
        self._conduit._rebuild_bounding_box(serial)

    def clear_toolpath(self, document_serial: int):
        serial = int(document_serial)
        self._conduit.toolpaths.pop(serial, None)
        self._conduit._rebuild_bounding_box(serial)

    def set_mesh_layer(self, document_serial: int, role: str, meshes: list):
        if role not in {"tool", "part"}:
            raise ValueError(f"Unsupported OpenCAM mesh layer: {role}")
        serial = int(document_serial)
        layers = self._conduit.mesh_layers.setdefault(serial, {})
        if meshes:
            layers[role] = list(meshes)
        else:
            layers.pop(role, None)
        self._conduit._rebuild_bounding_box(serial)

    def set_layer_visibility(self, document_serial: int, flags: dict):
        serial = int(document_serial)
        merged = dict(self._conduit.layer_visibility.get(serial, DEFAULT_LAYER_VISIBILITY))
        merged.update({key: bool(value) for key, value in flags.items() if key in merged})
        self._conduit.layer_visibility[serial] = merged
        self._conduit._rebuild_bounding_box(serial)

    def set_stock_box(self, document_serial: int, edges):
        serial = int(document_serial)
        if edges:
            self._conduit.stock_boxes[serial] = [
                (
                    self._rhino.Geometry.Point3d(*start),
                    self._rhino.Geometry.Point3d(*end),
                )
                for start, end in edges
            ]
        else:
            self._conduit.stock_boxes.pop(serial, None)
        self._conduit._rebuild_bounding_box(serial)

    def forget_document(self, document_serial: int):
        serial = int(document_serial)
        self._conduit.toolpaths.pop(serial, None)
        self._conduit.mesh_layers.pop(serial, None)
        self._conduit.stock_boxes.pop(serial, None)
        self._conduit.layer_visibility.pop(serial, None)
        self._conduit.bounding_boxes.pop(serial, None)
        self._conduit.Enabled = bool(self._conduit.bounding_boxes)

    def clear(self):
        self._conduit.toolpaths.clear()
        self._conduit.mesh_layers.clear()
        self._conduit.stock_boxes.clear()
        self._conduit.layer_visibility.clear()
        self._conduit.bounding_boxes.clear()
        self._conduit.Enabled = False
