"""A shared, document-scoped OpenCAM toolpath display conduit.

One conduit is cheaper and more reliable than a conduit per panel.  Crucially,
every draw callback resolves `event.RhinoDoc.RuntimeSerialNumber`; it never
falls back to ActiveDoc.  Therefore a toolpath for one document cannot draw in
another document's viewport.
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


class OpenCamToolpathConduit:
    """Rhino wrapper, imported only when a Rhino session is present."""

    def __init__(self):
        import Rhino

        class _Conduit(Rhino.Display.DisplayConduit):
            def __init__(inner):
                super().__init__()
                inner.previews: dict[int, ToolpathPreview] = {}

            def _preview(inner, event):
                doc = getattr(event, "RhinoDoc", None)
                return None if doc is None else inner.previews.get(int(doc.RuntimeSerialNumber))

            def CalculateBoundingBox(inner, event):
                preview = inner._preview(event)
                if preview is None:
                    return
                points = [Rhino.Geometry.Point3d(*point) for segment in preview.segments for point in segment.points]
                if points:
                    event.IncludeBoundingBox(Rhino.Geometry.BoundingBox(points))

            def DrawOverlay(inner, event):
                preview = inner._preview(event)
                if preview is None:
                    return
                for segment in preview.segments:
                    event.Display.DrawPolyline(
                        Rhino.Geometry.Polyline([Rhino.Geometry.Point3d(*point) for point in segment.points]),
                        _color_for(segment.role),
                        2 if segment.role == "rapid" else 3,
                    )
                if preview.start is not None:
                    event.Display.DrawPoint(Rhino.Geometry.Point3d(*preview.start), Rhino.Display.PointStyle.RoundSimple, 6, _marker_color("start"))
                if preview.end is not None:
                    event.Display.DrawPoint(Rhino.Geometry.Point3d(*preview.end), Rhino.Display.PointStyle.RoundSimple, 6, _marker_color("end"))

        self._conduit = _Conduit()

    @property
    def enabled(self):
        return self._conduit.Enabled

    def set_preview(self, document_serial: int, preview: ToolpathPreview):
        self._conduit.previews[int(document_serial)] = preview
        self._conduit.Enabled = bool(self._conduit.previews)

    def forget_document(self, document_serial: int):
        self._conduit.previews.pop(int(document_serial), None)
        self._conduit.Enabled = bool(self._conduit.previews)

    def clear(self):
        self._conduit.previews.clear()
        self._conduit.Enabled = False


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
