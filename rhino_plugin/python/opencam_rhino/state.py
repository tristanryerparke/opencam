"""Per-document OpenCAM state persisted by the minimal C# bridge."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict

from .contracts import (
    DEFAULT_VISIBILITY,
    DOCUMENT_SCHEMA_VERSION,
    DocumentState,
    OperationSpec,
    PartSelection,
    PlanarRegion,
    SetupSpec,
    StockBox,
    default_setup,
)

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
    legacy_region_data = value.get("region")
    part = None if not part_data else PartSelection(
        object_id=part_data["object_id"],
        name=part_data["name"],
        mesh=part_data["mesh"],
        stock_box=StockBox(**part_data["stock_box"]),
    )
    setups = [
        SetupSpec(
            id=setup["id"],
            name=setup.get("name", "Setup"),
            operations=[
                OperationSpec(
                    id=operation["id"],
                    name=operation.get("name", operation.get("type", "Operation")),
                    type=operation["type"],
                    params=dict(operation.get("params", {})),
                    regions=[PlanarRegion(**region) for region in operation.get("regions", [])]
                    if "regions" in operation else (
                        [PlanarRegion(**operation["region"])] if operation.get("region") else []
                    ),
                    source_object_ids=[
                        str(object_id)
                        for object_id in operation.get("source_object_ids", [])
                    ],
                )
                for operation in setup.get("operations", [])
            ],
        )
        for setup in value.get("setups", [])
    ]
    if not setups:
        setups = [default_setup()]
    if legacy_region_data:
        for setup in setups:
            for operation in setup.operations:
                if not operation.regions:
                    operation.regions = [PlanarRegion(**legacy_region_data)]
                    break
            else:
                continue
            break
    result = DocumentState(
        schema_version=DOCUMENT_SCHEMA_VERSION,
        backend_url=str(value.get("backend_url", "http://127.0.0.1:9090")),
        part=part,
        setups=setups,
        selected_operation_id=value.get("selected_operation_id"),
        toolpath_previews=dict(value.get("toolpath_previews", {})),
        toolpaths=dict(value.get("toolpaths", {})),
        visibility=dict(value.get("visibility") or DEFAULT_VISIBILITY),
        results=dict(value.get("results", {})),
    )
    from .object_tracking import refresh_all_source_object_ids

    refresh_all_source_object_ids(result)
    return result


def invalid_operation_ids(value: DocumentState) -> set[str]:
    saved = value.results.get("invalid_operation_ids", [])
    return (
        {str(operation_id) for operation_id in saved}
        if isinstance(saved, list)
        else set()
    )


def mark_operations_invalid(value: DocumentState, operation_ids) -> None:
    invalid = invalid_operation_ids(value)
    invalid.update(str(operation_id) for operation_id in operation_ids)
    value.results["invalid_operation_ids"] = sorted(invalid)


def clear_operation_invalid(value: DocumentState, operation_id: str) -> None:
    invalid = invalid_operation_ids(value)
    invalid.discard(str(operation_id))
    if invalid:
        value.results["invalid_operation_ids"] = sorted(invalid)
    else:
        value.results.pop("invalid_operation_ids", None)


def operation_generation_hash(value: DocumentState, operation: OperationSpec) -> str:
    generation_inputs = {
        "schema_version": DOCUMENT_SCHEMA_VERSION,
        "part": None if value.part is None else asdict(value.part),
        "operation": asdict(operation),
    }
    encoded = json.dumps(
        generation_inputs,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def store_toolpath(
    value: DocumentState,
    operation: OperationSpec,
    toolpath: dict,
) -> None:
    value.toolpaths[operation.id] = {
        "generation_hash": operation_generation_hash(value, operation),
        "toolpath": toolpath,
    }


def cached_toolpath(value: DocumentState, operation_id: str | None) -> dict | None:
    if not operation_id:
        return None
    _, operation = value.find_operation(operation_id)
    entry = value.toolpaths.get(operation_id)
    if operation is None or not isinstance(entry, dict):
        return None
    if entry.get("generation_hash") != operation_generation_hash(value, operation):
        return None
    toolpath = entry.get("toolpath")
    return toolpath if isinstance(toolpath, dict) else None


def store_toolpath_preview(
    value: DocumentState,
    operation: OperationSpec,
    preview: dict,
) -> None:
    value.toolpath_previews[operation.id] = {
        "generation_hash": operation_generation_hash(value, operation),
        "preview": preview,
    }


def toolpath_preview(value: DocumentState, operation_id: str | None) -> dict | None:
    if not operation_id:
        return None
    _, operation = value.find_operation(operation_id)
    entry = value.toolpath_previews.get(operation_id)
    if operation is None or not isinstance(entry, dict):
        return None
    if entry.get("generation_hash") != operation_generation_hash(value, operation):
        return None
    preview = entry.get("preview")
    return preview if isinstance(preview, dict) else None


def invalidate_toolpath_previews(
    value: DocumentState,
    operation_id: str | None = None,
) -> None:
    if operation_id is None:
        value.toolpath_previews.clear()
    else:
        value.toolpath_previews.pop(operation_id, None)


def invalidate_toolpaths(
    value: DocumentState,
    operation_id: str | None = None,
) -> None:
    if operation_id is None:
        value.toolpaths.clear()
    else:
        value.toolpaths.pop(operation_id, None)


def save(doc, value: DocumentState) -> None:
    persisted = _bridge().SetDocumentDataJson(
        doc.RuntimeSerialNumber,
        json.dumps(value.to_dict(), separators=(",", ":"), sort_keys=True),
    )
    if not persisted:
        raise RuntimeError("OpenCAM could not persist document data.")
    doc.Modified = True
