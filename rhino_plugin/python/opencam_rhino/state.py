"""Per-document OpenCAM state persisted by the minimal C# bridge."""

from __future__ import annotations

import json

from .contracts import DocumentState, PartSelection, PlanarRegion, StockBox

_BRIDGE = None


def _bridge():
    global _BRIDGE
    if _BRIDGE is None:
        # Imported only in Rhino; keeping this module importable enables pure tests.
        from OpenCamRhinoBridge import PluginBridge

        _BRIDGE = PluginBridge
    return _BRIDGE


def load(doc) -> DocumentState:
    raw = _bridge().GetDocumentDataJson(doc.RuntimeSerialNumber)
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError:
        value = {}
    part_data = value.get("part")
    region_data = value.get("region")
    part = None if not part_data else PartSelection(
        object_id=part_data["object_id"],
        name=part_data["name"],
        mesh=part_data["mesh"],
        stock_box=StockBox(**part_data["stock_box"]),
    )
    region = None if not region_data else PlanarRegion(**region_data)
    return DocumentState(
        schema_version=int(value.get("schema_version", 1)),
        backend_url=str(value.get("backend_url", "http://127.0.0.1:9090")),
        part=part,
        region=region,
        setup=dict(value.get("setup", {})),
        operations=list(value.get("operations", [])),
        results=dict(value.get("results", {})),
    )


def save(doc, value: DocumentState) -> None:
    _bridge().SetDocumentDataJson(
        doc.RuntimeSerialNumber,
        json.dumps(value.to_dict(), separators=(",", ":"), sort_keys=True),
    )
