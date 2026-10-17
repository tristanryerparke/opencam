"""Transient OpenCAM display lifecycle, modelled on Tack's document isolation."""

from __future__ import annotations

CONDUIT_KEY = "OpenCAM.Rhino.ToolpathConduit"


def active_conduit():
    import scriptcontext as sc

    return sc.sticky.get(CONDUIT_KEY)


def ensure_conduit():
    import scriptcontext as sc
    from .display import OpenCamToolpathConduit

    conduit = active_conduit()
    if conduit is None:
        conduit = OpenCamToolpathConduit()
        sc.sticky[CONDUIT_KEY] = conduit
    return conduit


def show_toolpath(doc, operation: dict):
    """Replace only this document's preview and redraw this document."""
    from .display import ToolpathPreview

    preview = ToolpathPreview.from_operation(operation)
    conduit = ensure_conduit()
    conduit.set_preview(int(doc.RuntimeSerialNumber), preview)
    doc.Views.Redraw()
    return preview


def clear_document(doc):
    """Forget transient display data without touching persisted CAM state."""
    conduit = active_conduit()
    if conduit is None:
        return
    conduit.forget_document(int(doc.RuntimeSerialNumber))
    doc.Views.Redraw()


def document_closing(document_serial_number):
    """Called by the C# lifecycle bridge; safe after Rhino has changed ActiveDoc."""
    conduit = active_conduit()
    if conduit is None:
        return
    conduit.forget_document(int(document_serial_number))


def shutdown():
    conduit = active_conduit()
    if conduit is not None:
        conduit.clear()
    import scriptcontext as sc
    sc.sticky.pop(CONDUIT_KEY, None)
