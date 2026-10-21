"""Lifecycle hooks invoked by the generated C# project shim."""

from __future__ import annotations

from . import runtime, state


def _restore_document(document_serial_number):
    import Rhino

    doc = Rhino.RhinoDoc.FromRuntimeSerialNumber(int(document_serial_number))
    if doc is None:
        return False
    runtime.restore_document(doc, state.load(doc))
    return True


def startup():
    """Restore documents that were already open when the plug-in loaded."""
    import Rhino

    for doc in Rhino.RhinoDoc.OpenDocuments(False):
        _restore_document(doc.RuntimeSerialNumber)


def document_opened(document_serial_number):
    """Rebuild transient display state after plug-in data has loaded."""
    _restore_document(document_serial_number)


def document_closing(document_serial_number):
    runtime.document_closing(document_serial_number)


def shutdown():
    runtime.shutdown()
