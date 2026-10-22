"""Bidirectional CAM-operation references stored on Rhino source objects."""

from __future__ import annotations

import json
import uuid

METADATA_KEY = "OpenCAM.OperationRefs"
TRACKING_KEY = "OpenCAM.Rhino.SourceObjectTracking"
HANDLERS_KEY = "OpenCAM.Rhino.SourceObjectHandlers"
RECENT_OBJECT_MAX_AGE = 200

_reconciling = False


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


def _document_tracking(doc, create=True) -> dict:
    documents = _documents(create)
    serial = int(doc.RuntimeSerialNumber)
    tracking = documents.get(serial)
    if tracking is None:
        if not create:
            return {"records": {}, "recent": {}}
        tracking = {"records": {}, "recent": {}}
        documents[serial] = tracking
    elif "records" not in tracking:
        tracking = {"records": tracking, "recent": {}}
        documents[serial] = tracking
    return tracking


def _has_metadata(obj) -> bool:
    return bool(
        obj is not None
        and obj.Attributes.UserDictionary.ContainsKey(METADATA_KEY)
    )


def _metadata_operation_ids(obj) -> set[str]:
    if not _has_metadata(obj):
        return set()
    try:
        payload = json.loads(str(obj.Attributes.UserDictionary[METADATA_KEY]))
    except (TypeError, ValueError, json.JSONDecodeError):
        return set()
    values = payload.get("operation_ids", []) if isinstance(payload, dict) else payload
    if not isinstance(values, list):
        return set()
    return {str(value) for value in values if value}


def _metadata_associations(objects, existing_operation_ids) -> dict[str, dict]:
    associations = {}
    for obj in objects:
        if obj is None or obj.IsDeleted or not _has_metadata(obj):
            continue
        operation_ids = _metadata_operation_ids(obj) & existing_operation_ids
        if not operation_ids:
            continue
        associations[_object_key(obj.Id)] = {
            "object_id": str(obj.Id),
            "operation_ids": operation_ids,
        }
    return associations


def _new_record(doc, association, *, metadata_present=None) -> dict:
    obj = _find_object(doc, association["object_id"])
    if metadata_present is None:
        metadata_present = _has_metadata(obj)
    return {
        "object_id": association["object_id"],
        "operation_ids": set(association["operation_ids"]),
        "runtime_serial": _object_serial(obj),
        "metadata_required": bool(metadata_present),
    }


def rebuild(doc, document_state, *, scan_metadata=False) -> None:
    """Rebuild transient tracking from operation GUIDs and saved object refs."""
    associations = _associations(document_state)
    existing_operation_ids = {
        operation.id for _, operation in document_state.all_operations()
    }
    if scan_metadata:
        for key, saved in _metadata_associations(
            doc.Objects,
            existing_operation_ids,
        ).items():
            association = associations.setdefault(
                key,
                {"object_id": saved["object_id"], "operation_ids": set()},
            )
            association["operation_ids"].update(saved["operation_ids"])

    tracking = _document_tracking(doc)
    old_records = tracking["records"]
    recent = tracking["recent"]
    records = {}
    for key, association in associations.items():
        obj = _find_object(doc, association["object_id"])
        metadata_present = _has_metadata(obj)
        records[key] = _new_record(
            doc,
            association,
            metadata_present=metadata_present,
        )
        recent.pop(key, None)
    for key, record in old_records.items():
        if key not in records:
            recent[key] = {**record, "age": 0}
    tracking["records"] = records
    if records or recent:
        subscribe()


def forget_document(document_serial_number) -> None:
    _documents(create=False).pop(int(document_serial_number), None)
    if not _has_tracked_objects():
        unsubscribe()


def _has_tracked_objects() -> bool:
    return any(
        tracking.get("records") or tracking.get("recent")
        for tracking in _documents(create=False).values()
    )


def source_serials(doc, operation) -> dict[str, int | None]:
    return {
        _object_key(object_id): _object_serial(_find_object(doc, object_id))
        for object_id in operation.source_object_ids
    }


def sources_changed(doc, serials: dict[str, int | None]) -> bool:
    records = _document_tracking(doc, create=False)["records"]
    for key, original_serial in serials.items():
        record = records.get(key)
        object_id = record["object_id"] if record is not None else key
        if _object_serial(_find_object(doc, object_id)) != original_serial:
            return True
    return False


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
            has_metadata = _has_metadata(obj)
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


def _reconcile(doc, document_state) -> set[str]:
    tracking = _document_tracking(doc, create=False)
    records = tracking["records"]
    recent = tracking["recent"]
    existing_operation_ids = {
        operation.id for _, operation in document_state.all_operations()
    }
    affected = set()

    for key, record in list(records.items()):
        obj = _find_object(doc, record["object_id"])
        current_serial = _object_serial(obj)
        old_operation_ids = set(record["operation_ids"]) & existing_operation_ids
        if current_serial != record["runtime_serial"]:
            affected.update(old_operation_ids)
        if obj is None:
            records.pop(key, None)
            recent[key] = {
                **record,
                "runtime_serial": current_serial,
                "age": 0,
            }
            continue

        has_metadata = _has_metadata(obj)
        saved_operation_ids = _metadata_operation_ids(obj) & existing_operation_ids
        if has_metadata:
            if saved_operation_ids != old_operation_ids:
                affected.update(old_operation_ids | saved_operation_ids)
            if not saved_operation_ids:
                records.pop(key, None)
                recent[key] = {
                    **record,
                    "runtime_serial": current_serial,
                    "age": 0,
                }
                continue
            record["operation_ids"] = saved_operation_ids
            record["metadata_required"] = True
        elif record["metadata_required"]:
            affected.update(old_operation_ids)
            records.pop(key, None)
            recent[key] = {
                **record,
                "runtime_serial": current_serial,
                "age": 0,
            }
            continue
        record["runtime_serial"] = current_serial

    for key, record in list(recent.items()):
        obj = _find_object(doc, record["object_id"])
        if obj is None:
            continue
        saved_operation_ids = _metadata_operation_ids(obj) & existing_operation_ids
        if _has_metadata(obj):
            if not saved_operation_ids:
                continue
            operation_ids = saved_operation_ids
        elif not record["metadata_required"]:
            operation_ids = set(record["operation_ids"]) & existing_operation_ids
            if not operation_ids:
                continue
        else:
            continue
        affected.update(operation_ids)
        records[key] = {
            "object_id": str(obj.Id),
            "operation_ids": operation_ids,
            "runtime_serial": _object_serial(obj),
            "metadata_required": _has_metadata(obj),
        }
        recent.pop(key, None)

    for key, record in list(recent.items()):
        age = int(record.get("age", 0)) + 1
        if age >= RECENT_OBJECT_MAX_AGE:
            recent.pop(key, None)
        else:
            record["age"] = age
    return affected


def _push_panel_state(doc, document_state, *, simulation_cancelled=False) -> int:
    from OpenCamRhinoBridge import PluginBridge

    from .contracts import PanelRequest, panel_event

    message = panel_event(
        PanelRequest(action="get_state", request_id="command-end"),
        document_state,
        ok=True,
        **({"simulation_status": "cancelled"} if simulation_cancelled else {}),
    )
    encoded = json.dumps(message, separators=(",", ":"), sort_keys=True)
    post = getattr(PluginBridge, "PostPanelMessage", None)
    if post is None:
        return int(PluginBridge.ReloadPanel(doc.RuntimeSerialNumber))
    return int(post(doc.RuntimeSerialNumber, encoded))


def end_command_handler(sender, event) -> None:
    global _reconciling
    if _reconciling:
        return

    import Rhino

    doc = Rhino.RhinoDoc.ActiveDoc
    if doc is None:
        return

    from . import actions, state

    document_state = state.load(doc)
    _reconciling = True
    try:
        affected = sorted(_reconcile(doc, document_state))
        if affected:
            for operation_id in affected:
                actions.invalidate_operation_artifacts(
                    document_state,
                    doc,
                    operation_id,
                )
            state.mark_operations_invalid(document_state, affected)
            state.save(doc, document_state)
            Rhino.RhinoApp.WriteLine(
                f"OpenCAM invalidated {len(affected)} operation(s) after "
                f"{_command_name(event)} changed source geometry."
            )
        _push_panel_state(
            doc,
            document_state,
            simulation_cancelled=bool(affected),
        )
    finally:
        _reconciling = False

    if not _has_tracked_objects():
        unsubscribe()
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
