"""Stable C#-to-Python entry points; payloads cross the shim as JSON only."""

from __future__ import annotations

import json

from . import actions


def handle_panel_message(document_serial_number, request_json):
    import Rhino

    doc = Rhino.RhinoDoc.FromRuntimeSerialNumber(int(document_serial_number))
    if doc is None:
        raise RuntimeError("The Rhino document for this panel is no longer available.")
    response = actions.run(json.loads(request_json), doc)
    return json.dumps(response, separators=(",", ":"), sort_keys=True)


def run_command(action, doc):
    request = {"action": action, "request_id": "command"}
    response = actions.run(request, doc)
    if response.get("error"):
        import Rhino
        Rhino.RhinoApp.WriteLine("OpenCAM: " + response["error"])
    return response
