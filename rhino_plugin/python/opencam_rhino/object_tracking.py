"""Bidirectional CAM-operation references stored on Rhino source objects."""

from __future__ import annotations

import json
import uuid

METADATA_KEY = "OpenCAM.OperationRefs"
TRACKING_KEY = "OpenCAM.Rhino.SourceObjectTracking"
HANDLERS_KEY = "OpenCAM.Rhino.SourceObjectHandlers"


def _sticky():
    import scriptcontext as sc

    return sc.sticky


def _object_key(object_id) -> str:
    return str(object_id).casefold()


def _find_object(doc, object_id):
    import System

    return doc.Objects.FindId(System.Guid(str(object_id)))


def _object_serial(obj):
    return None if obj is None else int(obj.RuntimeSerialNumber)


def operation_source_object_ids(document_state, operation) -> list[str]:
    """Return unique part and drive-geometry object GUIDs in stable order."""
    result = []
    seen = set()
    candidates = []
    if document_state.part is not None:
        candidates.append(document_state.part.object_id)
    for region in operation.regions:
        candidates.extend(region.source_object_ids)
    for object_id in candidates:
        value = str(object_id)
        key = _object_key(value)
        if value and key not in seen:
            seen.add(key)
            result.append(value)
    return result


def refresh_operation_source_object_ids(document_state, operation) -> list[str]:
    operation.source_object_ids = operation_source_object_ids(document_state, operation)
    return operation.source_object_ids


def refresh_all_source_object_ids(document_state) -> None:
    for _, operation in document_state.all_operations():
        refresh_operation_source_object_ids(document_state, operation)


def _associations(document_state) -> dict[str, dict]:
    associations = {}
    for _, operation in document_state.all_operations():
        for object_id in operation.source_object_ids:
            key = _object_key(object_id)
            entry = associations.setdefault(
                key,
                {"object_id": str(object_id), "operation_ids": set()},
            )
            entry["operation_ids"].add(str(operation.id))
    return associations


def _documents(create=True) -> dict:
    sticky = _sticky()
    documents = sticky.get(TRACKING_KEY)
    if documents is None and create:
        documents = {}
        sticky[TRACKING_KEY] = documents
    return documents if documents is not None else {}


def rebuild(doc, document_state) -> None:
    """Rebuild transient tracking from GUIDs persisted on CAM operations."""
    records = {}
    for key, association in _associations(document_state).items():
        obj = _find_object(doc, association["object_id"])
        records[key] = {
            "object_id": association["object_id"],
            "operation_ids": set(association["operation_ids"]),
            "runtime_serial": _object_serial(obj),
        }
    _documents()[int(doc.RuntimeSerialNumber)] = records


def forget_document(document_serial_number) -> None:
    _documents(create=False).pop(int(document_serial_number), None)


def source_serials(doc, operation) -> dict[str, int | None]:
    return {
        _object_key(object_id): _object_serial(_find_object(doc, object_id))
        for object_id in operation.source_object_ids
    }


def sources_changed(doc, serials: dict[str, int | None]) -> bool:
    records = _documents(create=False).get(int(doc.RuntimeSerialNumber), {})
    for key, original_serial in serials.items():
        record = records.get(key)
        object_id = record["object_id"] if record is not None else key
        if _object_serial(_find_object(doc, object_id)) != original_serial:
            return True
    return False


def _metadata_operation_ids(obj) -> set[str]:
    dictionary = obj.Attributes.UserDictionary
    if not dictionary.ContainsKey(METADATA_KEY):
        return set()
    try:
        payload = json.loads(str(dictionary[METADATA_KEY]))
    except (TypeError, ValueError, json.JSONDecodeError):
        return set()
    values = payload.get("operation_ids", []) if isinstance(payload, dict) else payload
    if not isinstance(values, list):
        return set()
    return {str(value) for value in values if value}


def sync_metadata(
    doc,
    document_state,
    object_ids=None,
    *,
    force=False,
) -> bool:
    """Make touched object metadata match persisted operation associations."""
    associations = _associations(document_state)
    if object_ids is None:
        touched = {entry["object_id"] for entry in associations.values()}
    else:
        touched = {str(object_id) for object_id in object_ids if object_id}
    if not touched:
        rebuild(doc, document_state)
        return False

    changed = False
    missing = []
    undo_record = doc.BeginUndoRecord("OpenCAM operation references")
    try:
        for object_id in sorted(touched, key=str.casefold):
            association = associations.get(_object_key(object_id))
            desired = set() if association is None else association["operation_ids"]
            obj = _find_object(doc, object_id)
            if obj is None:
                if desired:
                    missing.append(object_id)
                continue
            existing = _metadata_operation_ids(obj)
            has_metadata = obj.Attributes.UserDictionary.ContainsKey(METADATA_KEY)
            if (
                existing == desired
                and not (force and desired)
                and (desired or not has_metadata)
            ):
                continue
            attributes = obj.Attributes.Duplicate()
            if desired:
                attributes.UserDictionary.Set(
                    METADATA_KEY,
                    json.dumps(
                        {
                            "operation_ids": sorted(desired),
                            "revision": str(uuid.uuid4()),
                        },
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                )
            else:
                attributes.UserDictionary.Remove(METADATA_KEY)
            if not doc.Objects.ModifyAttributes(obj.Id, attributes, True):
                raise RuntimeError(
                    f"OpenCAM could not update source-object metadata on {object_id}."
                )
            changed = True
    finally:
        if undo_record:
            doc.EndUndoRecord(undo_record)

    rebuild(doc, document_state)
    if missing:
        raise ValueError(
            "OpenCAM source geometry no longer exists: " + ", ".join(missing)
        )
    return changed


def _command_name(event) -> str:
    return str(
        getattr(event, "CommandEnglishName", None)
        or getattr(event, "EnglishName", None)
        or getattr(event, "CommandName", None)
        or "<unknown>"
    )


def end_command_handler(sender, event) -> None:
    import Rhino

    doc = Rhino.RhinoDoc.ActiveDoc
    if doc is None:
        return
    records = _documents(create=False).get(int(doc.RuntimeSerialNumber), {})
    changed_operation_ids = set()
    for record in records.values():
        obj = _find_object(doc, record["object_id"])
        current_serial = _object_serial(obj)
        if current_serial != record["runtime_serial"]:
            changed_operation_ids.update(record["operation_ids"])
            record["runtime_serial"] = current_serial
    if not changed_operation_ids:
        return

    from . import actions, state

    document_state = state.load(doc)
    existing_ids = {
        operation.id for _, operation in document_state.all_operations()
    }
    affected = sorted(changed_operation_ids & existing_ids)
    if not affected:
        rebuild(doc, document_state)
        return
    for operation_id in affected:
        actions.invalidate_operation_artifacts(document_state, doc, operation_id)
    state.mark_operations_invalid(document_state, affected)
    state.save(doc, document_state)
    rebuild(doc, document_state)
    Rhino.RhinoApp.WriteLine(
        f"OpenCAM invalidated {len(affected)} operation(s) after "
        f"{_command_name(event)} changed source geometry."
    )
    from OpenCamRhinoBridge import PluginBridge

    PluginBridge.ReloadPanel(doc.RuntimeSerialNumber)
    doc.Views.Redraw()


def subscribe() -> None:
    import Rhino

    sticky = _sticky()
    if sticky.get(HANDLERS_KEY) is not None:
        return
    Rhino.Commands.Command.EndCommand += end_command_handler
    sticky[HANDLERS_KEY] = end_command_handler


def unsubscribe() -> None:
    import Rhino

    handler = _sticky().pop(HANDLERS_KEY, None)
    if handler is None:
        return
    try:
        Rhino.Commands.Command.EndCommand -= handler
    except Exception:  # noqa: BLE001, S110 - shutdown must not fail
        pass


def shutdown() -> None:
    unsubscribe()
    _sticky().pop(TRACKING_KEY, None)
