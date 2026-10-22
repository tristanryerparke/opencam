"""Lifecycle hooks invoked by the generated C# project shim."""

from __future__ import annotations

from . import object_tracking, runtime, state


def _restore_document(document_serial_number):
    import Rhino

    doc = Rhino.RhinoDoc.FromRuntimeSerialNumber(int(document_serial_number))
    if doc is None:
        return False
    document_state = state.load(doc)
    runtime.restore_document(doc, document_state)
    object_tracking.rebuild(doc, document_state)
    return True


def startup():
    """Restore documents that were already open when the plug-in loaded."""
    import Rhino

    object_tracking.subscribe()
    for doc in Rhino.RhinoDoc.OpenDocuments(False):
        _restore_document(doc.RuntimeSerialNumber)


def document_opened(document_serial_number):
    """Rebuild transient display state after plug-in data has loaded."""
    _restore_document(document_serial_number)


def document_closing(document_serial_number):
    object_tracking.forget_document(document_serial_number)
    runtime.document_closing(document_serial_number)


def shutdown():
    object_tracking.shutdown()
    runtime.shutdown()
