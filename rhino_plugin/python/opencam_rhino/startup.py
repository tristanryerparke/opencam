"""Lifecycle hooks invoked by the generated C# project shim."""

from __future__ import annotations

from . import runtime


def startup():
    """Reserved for explicit application-wide initialization; creates no conduit."""


def document_opened(_document_serial_number):
    """Previews are intentionally transient and are not restored from a .3dm."""


def document_closing(document_serial_number):
    runtime.document_closing(document_serial_number)


def shutdown():
    runtime.shutdown()
