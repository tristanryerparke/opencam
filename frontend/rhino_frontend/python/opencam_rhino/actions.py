"""UI-thread actions shared by generated Rhino commands and panel messages.

Rhino state changes stay on the UI thread. Toolpath HTTP generation runs in a
worker thread and is committed by short panel status polls. Every action
returns a panel event with persisted document state, keeping the WebView dumb.
"""

from __future__ import annotations

from copy import deepcopy

from opencam_contracts.cam import GenerateToolpathRequest

from . import (
    backend,
    object_tracking,
    operations,
    runtime,
    selection,
    state,
)
from .contracts import (
    DocumentState,
    OperationSpec,
    PanelRequest,
    PlanarRegion,
    panel_event,
)


def _fetcher(base_url):
    return lambda path: backend.request_bytes(base_url, path)


def _uuid() -> str:
    import uuid

    return str(uuid.uuid4())


def _choose_post_process_path(operation_name: str) -> str | None:
    import re

    import Eto.Forms as forms
    import Rhino

    stem = re.sub(r'[\\/:*?"<>|]+', "-", operation_name.strip())
    stem = "-".join(stem.split()) or "operation"
    dialog = forms.SaveFileDialog()
    dialog.Title = "Save Duet 3D G-code"
    dialog.FileName = f"{stem}.nc"
    dialog.Filters.Add(forms.FileFilter("NC files", ".nc"))
    if dialog.ShowDialog(Rhino.UI.RhinoEtoApp.MainWindow) != forms.DialogResult.Ok:
        return None
    return str(dialog.FileName) if dialog.FileName else None


def _write_post_process_output(output_path: str, nc_bytes: bytes) -> None:
    """Write G-code and remove macOS's AppleDouble sidecar on NFS mounts."""
    import os
    import sys

    with open(output_path, "wb") as output_file:
        output_file.write(nc_bytes)

    if sys.platform != "darwin":
        return

    apple_double_path = os.path.join(
        os.path.dirname(output_path),
        f"._{os.path.basename(output_path)}",
    )
    try:
        os.unlink(apple_double_path)
    except FileNotFoundError:
        pass


def _target_operation(document_state: DocumentState, request: PanelRequest):
    operation_id = request.payload.get("operation_id") or document_state.selected_operation_id
    if operation_id:
        setup, operation = document_state.find_operation(str(operation_id))
        if operation is not None:
            return setup, operation
    for setup, operation in document_state.all_operations():
        return setup, operation
    return None, None


def _edit_operation_dialog(doc, operation, backend_url, has_part):
    import json
    from dataclasses import asdict

    from OpenCam import PluginBridge

    draft = None if operation is None else asdict(operation)
    while True:
        response = json.loads(PluginBridge.ShowOperationDialog(
            doc.RuntimeSerialNumber,
            json.dumps(
                {
                    "draft": draft,
                    "backend_url": backend_url,
                    "has_part": has_part,
                },
                separators=(",", ":"),
            ),
        ))
        action = response.get("action")
        if action == "cancel":
            return None
        draft = response.get("draft")
        if not isinstance(draft, dict):
            raise ValueError("Operation dialog returned no draft.")
        if action == "begin":
            continue
        if action == "select_region":
            regions = selection.select_planar_regions(doc)
            if regions is not None:
                draft.setdefault("regions", []).extend(asdict(region) for region in regions)
            continue
        if action == "generate":
            regions = draft.get("regions", [])
            if not isinstance(regions, list):
                raise ValueError("Operation dialog returned invalid drive geometry.")
            draft["regions"] = [PlanarRegion(**region) for region in regions]
            return draft
        raise ValueError("Unknown operation dialog action: {}".format(action))


def _simulation_summaries(document_state: DocumentState) -> dict:
    summaries = document_state.results.get("simulation_summaries")
    if not isinstance(summaries, dict):
        summaries = {}
        document_state.results["simulation_summaries"] = summaries
    legacy_operation_id = document_state.results.get("simulation_operation_id")
    if legacy_operation_id and legacy_operation_id not in summaries:
        simulation_id = document_state.results.get("simulation_id")
        summaries[str(legacy_operation_id)] = {
            "status": "completed" if simulation_id else "running",
            "task_id": document_state.results.get("simulation_task_id"),
            "simulation_id": simulation_id,
            "generation_hash": document_state.results.get("simulation_generation_hash"),
            "frame_count": int(document_state.results.get("frame_count", 0)),
        }
    for operation_id, summary in list(summaries.items()):
        _, operation = document_state.find_operation(str(operation_id))
        generation_hash = (
            summary.get("generation_hash") if isinstance(summary, dict) else None
        )
        if operation is None or (
            generation_hash
            and generation_hash
            != state.operation_generation_hash(document_state, operation)
        ):
            summaries.pop(operation_id, None)
    return summaries


def _invalidate_simulation(document_state: DocumentState, doc, operation_id=None):
    simulation = runtime.session(doc)
    if simulation is not None and (
        operation_id is None or simulation.operation_id == operation_id
    ):
        if not simulation.simulation_id:
            try:
                backend.request_json(
                    document_state.backend_url,
                    "DELETE",
                    f"/simulate/{simulation.task_id}",
                )
            except Exception:  # noqa: BLE001 - invalidation must still finish
                pass
        runtime.end_session(doc)

    summaries = _simulation_summaries(document_state)
    if operation_id is None:
        document_state.results.pop("simulation_summaries", None)
    else:
        summaries.pop(str(operation_id), None)
        if not summaries:
            document_state.results.pop("simulation_summaries", None)

    result_operation_id = document_state.results.get("simulation_operation_id")
    if operation_id is None or result_operation_id == operation_id:
        document_state.results.pop("simulation_id", None)
        document_state.results.pop("simulation_task_id", None)
        document_state.results.pop("simulation_operation_id", None)
        document_state.results.pop("simulation_generation_hash", None)
        document_state.results.pop("simulation_error", None)
        document_state.results.pop("frame_count", None)


def invalidate_operation_artifacts(
    document_state: DocumentState,
    doc,
    operation_id: str | None = None,
):
    _invalidate_simulation(document_state, doc, operation_id)
    state.invalidate_toolpath_previews(document_state, operation_id)
    state.invalidate_toolpaths(document_state, operation_id)
    runtime.forget_toolpath(doc, operation_id)
    summaries = document_state.results.get("toolpath_summaries")
    if operation_id is None:
        document_state.results.pop("toolpath_summaries", None)
    elif isinstance(summaries, dict):
        summaries.pop(operation_id, None)
        if not summaries:
            document_state.results.pop("toolpath_summaries", None)
    document_state.results.pop("toolpath_summary", None)
    if operation_id is None or document_state.selected_operation_id == operation_id:
        runtime.clear_toolpath(doc)


_invalidate_toolpaths = invalidate_operation_artifacts


def _operation_max_z(operation: OperationSpec) -> float:
    points = [
        point
        for region in operation.regions
        for loop in [region.outer_loop, *region.inner_loops]
        for point in loop
        if len(point) >= 3
    ]
    return max((float(point[2]) for point in points), default=0.0)


def _start_generation(document_state: DocumentState, operation: OperationSpec, doc):
    uses_part = operation.type == "parallel_finishing"
    if uses_part:
        _require(
            document_state.part,
            "Select a part before generating a parallel finishing toolpath.",
        )
    try:
        if uses_part and document_state.part is not None:
            document_state.part = selection.refresh_part(doc, document_state.part)
        operation.regions = selection.refresh_planar_regions(doc, operation.regions)
        object_tracking.refresh_operation_source_object_ids(document_state, operation)
    except Exception:  # noqa: BLE001 - preserve invalid state for any Rhino resolution failure
        state.mark_operations_invalid(document_state, [operation.id])
        state.save(doc, document_state)
        raise
    _invalidate_simulation(document_state, doc, operation.id)
    operation_payload = operations.build_operation_payload(
        {
            "id": operation.id,
            "name": operation.name,
            "type": operation.type,
            "params": operation.params,
            "regions": operation.regions,
        },
        document_state,
    )
    setup = {
        "clearanceOffset": 10.0,
        "stock": {
            "maxZ": (
                document_state.part.stock_box.max[2]
                if uses_part and document_state.part is not None
                else _operation_max_z(operation)
            )
        },
    }
    if uses_part and document_state.part is not None:
        setup["partMesh"] = document_state.part.mesh
    base_url = document_state.backend_url
    request_payload = GenerateToolpathRequest.model_validate({
        "setup": setup,
        "operation": operation_payload,
    }).model_dump(by_alias=True, mode="json")
    return runtime.start_generation(
        doc,
        operation.id,
        state.operation_generation_hash(document_state, operation),
        lambda: backend.request_json(
            base_url,
            "POST",
            "/cam/toolpath",
            request_payload,
        ),
        source_serials=object_tracking.source_serials(doc, operation),
    )


def _start_simulation(
    document_state: DocumentState,
    operation: OperationSpec,
    toolpath: dict,
    doc,
):
    task_id = backend.start_swept_simulation(
        document_state.backend_url,
        None,
        _operation_json(toolpath),
        include_stock_data=False,
    )
    generation_hash = state.operation_generation_hash(document_state, operation)
    session = runtime.start_session(
        doc,
        task_id,
        operation.id,
        generation_hash,
    )
    _simulation_summaries(document_state)[operation.id] = {
        "status": "running",
        "task_id": session.task_id,
        "simulation_id": None,
        "generation_hash": generation_hash,
        "frame_count": 0,
    }
    document_state.results["simulation_task_id"] = session.task_id
    document_state.results["simulation_operation_id"] = operation.id
    document_state.results["simulation_generation_hash"] = generation_hash
    document_state.results.pop("simulation_id", None)
    document_state.results.pop("frame_count", None)
    document_state.results.pop("simulation_error", None)
    _watch_simulation(
        document_state.backend_url,
        int(doc.RuntimeSerialNumber),
        session.task_id,
    )
    return session


def _watch_simulation(backend_url, document_serial, task_id):
    import time
    from threading import Thread

    def watch():
        while True:
            time.sleep(0.5)
            try:
                status = backend.request_json(
                    backend_url,
                    "GET",
                    "/simulate/{}/status".format(task_id),
                )
            except Exception:  # noqa: BLE001 - fallback panel polling reports failures
                return
            if str(status.get("status")) in {"completed", "cancelled", "error"}:
                runtime.push_panel_request(
                    document_serial,
                    "simulate_status",
                    {"task_id": str(task_id)},
                )
                return

    Thread(
        target=watch,
        name="OpenCAM simulation watcher",
        daemon=True,
    ).start()


def _apply_completed_generation(
    document_state: DocumentState,
    task: runtime.GenerationTask,
    doc,
):
    _, operation = document_state.find_operation(task.operation_id)
    _require(operation, "Generated operation no longer exists.")
    if task.generation_hash != state.operation_generation_hash(document_state, operation):
        raise ValueError("Operation inputs changed while its toolpath was generating.")
    if not isinstance(task.response, dict):
        raise TypeError("Toolpath generation returned no response.")
    if object_tracking.sources_changed(doc, task.source_serials):
        raise ValueError("Source geometry changed while its toolpath was generating.")

    object_tracking.sync_metadata(
        doc,
        document_state,
        operation.source_object_ids,
        force=True,
    )
    state.clear_operation_invalid(document_state, operation.id)
    preview = runtime.show_toolpath(doc, task.response)
    runtime.remember_toolpath(doc, task.response, operation.id)
    state.store_toolpath(document_state, operation, task.response)
    state.store_toolpath_preview(document_state, operation, preview.to_dict())
    document_state.results.setdefault("toolpath_summaries", {})[operation.id] = {
        "segment_count": len(preview.segments),
        "point_count": sum(len(segment.points) for segment in preview.segments),
        "displayed": True,
    }
    document_state.results["toolpath_summary"] = document_state.results[
        "toolpath_summaries"
    ][operation.id]
    try:
        _start_simulation(document_state, operation, task.response, doc)
    except Exception as error:  # noqa: BLE001 - toolpath generation still succeeded
        import Rhino

        Rhino.RhinoApp.WriteLine(f"OpenCAM simulation start failed: {error}")
        _simulation_summaries(document_state)[operation.id] = {
            "status": "error",
            "generation_hash": state.operation_generation_hash(
                document_state, operation
            ),
            "error": str(error),
        }
        document_state.results["simulation_error"] = str(error)
    return task.response


def run(request_data, doc):
    request = PanelRequest.from_dict(request_data)
    document_state = state.load(doc)
    _simulation_summaries(document_state)
    try:
        action = request.action
        if action == "get_state":
            generation = runtime.generation_task(doc)
            if generation is not None:
                return panel_event(
                    request,
                    document_state,
                    ok=True,
                    generation_status="running",
                    generation_operation_id=generation.operation_id,
                )
            simulation = runtime.session(doc)
            summaries = _simulation_summaries(document_state)
            for operation_id, summary in list(summaries.items()):
                if (
                    isinstance(summary, dict)
                    and summary.get("status") == "running"
                    and (simulation is None or simulation.operation_id != operation_id)
                ):
                    summaries.pop(operation_id, None)
            if simulation is not None:
                return panel_event(
                    request,
                    document_state,
                    ok=True,
                    simulation_status=(
                        "completed" if simulation.simulation_id else "running"
                    ),
                    simulation_operation_id=simulation.operation_id,
                    frame_count=len(simulation.frames),
                )
        elif action == "select_part":
            part = selection.select_part(doc)
            if part is None:
                return panel_event(request, document_state, cancelled=True)
            previous_part_id = (
                document_state.part.object_id
                if document_state.part is not None
                else None
            )
            operations_in_document = [
                operation for _, operation in document_state.all_operations()
            ]
            part_dependent_operations = [
                operation
                for operation in operations_in_document
                if operation.type == "parallel_finishing"
            ]
            old_source_ids = {
                object_id
                for operation in operations_in_document
                for object_id in operation.source_object_ids
            }
            document_state.part = part
            object_tracking.refresh_all_source_object_ids(document_state)
            new_source_ids = {
                object_id
                for operation in operations_in_document
                for object_id in operation.source_object_ids
            }
            object_tracking.sync_metadata(
                doc,
                document_state,
                old_source_ids
                | new_source_ids
                | {part.object_id}
                | ({previous_part_id} if previous_part_id else set()),
            )
            for operation in part_dependent_operations:
                invalidate_operation_artifacts(document_state, doc, operation.id)
            state.mark_operations_invalid(
                document_state,
                [operation.id for operation in part_dependent_operations],
            )
            runtime.apply_stock_and_part(doc, document_state)
            object_tracking.rebuild(doc, document_state)
            state.save(doc, document_state)
        elif action == "remove_part":
            part = document_state.part
            if part is None:
                return panel_event(request, document_state, ok=True)
            affected_operation_ids = [
                operation.id
                for _, operation in document_state.all_operations()
                if part.object_id in operation.source_object_ids
            ]
            old_source_ids = {
                object_id
                for _, operation in document_state.all_operations()
                for object_id in operation.source_object_ids
            }
            old_source_ids.add(part.object_id)
            document_state.part = None
            object_tracking.refresh_all_source_object_ids(document_state)
            new_source_ids = {
                object_id
                for _, operation in document_state.all_operations()
                for object_id in operation.source_object_ids
            }
            object_tracking.sync_metadata(
                doc, document_state, old_source_ids | new_source_ids
            )
            for operation_id in affected_operation_ids:
                invalidate_operation_artifacts(document_state, doc, operation_id)
            state.mark_operations_invalid(
                document_state,
                affected_operation_ids,
            )
            runtime.apply_stock_and_part(doc, document_state)
            object_tracking.rebuild(doc, document_state)
            state.save(doc, document_state)
        elif action == "select_region":
            regions = selection.select_planar_regions(doc)
            if regions is None:
                return panel_event(request, document_state, cancelled=True)
            from dataclasses import asdict

            return panel_event(
                request,
                document_state,
                ok=True,
                regions=[asdict(region) for region in regions],
            )
        elif action == "open_operation_dialog":
            operation_id = request.payload.get("operation_id")
            setup, operation = document_state.find_operation(str(operation_id)) if operation_id else (None, None)
            if operation_id and operation is None:
                raise ValueError("Selected operation no longer exists.")
            draft = _edit_operation_dialog(
                doc,
                operation,
                document_state.backend_url,
                document_state.part is not None,
            )
            if draft is None:
                return panel_event(request, document_state, cancelled=True)
            editing_existing = operation is not None
            old_source_ids = (
                [] if operation is None else list(operation.source_object_ids)
            )
            if operation is None:
                setup = document_state.setups[0]
                operation = OperationSpec(
                    id=_uuid(),
                    name=draft["name"],
                    type=draft["type"],
                    params=draft["params"],
                    regions=draft["regions"],
                )
                setup.operations.append(operation)
            else:
                operation.name = draft["name"]
                operation.params = draft["params"]
                operation.regions = draft["regions"]
            object_tracking.refresh_operation_source_object_ids(
                document_state, operation
            )
            document_state.selected_operation_id = operation.id
            object_tracking.sync_metadata(
                doc,
                document_state,
                old_source_ids + operation.source_object_ids,
            )
            generation = _start_generation(document_state, operation, doc)
            if editing_existing:
                _invalidate_toolpaths(document_state, doc, operation.id)
            state.save(doc, document_state)
            return panel_event(
                request,
                document_state,
                ok=True,
                selected_operation_id=operation.id,
                generation_status="running",
                generation_operation_id=generation.operation_id,
            )
        elif action == "add_operation":
            setup_id = request.payload.get("setup_id")
            setup = next((item for item in document_state.setups if item.id == setup_id), None)
            if setup is None:
                setup = document_state.setups[0]
            operation_type = str(request.payload.get("type", "pocketing_2d"))
            if operation_type not in operations.OPERATION_TYPES:
                raise ValueError("Unknown operation type: {}".format(operation_type))
            region_data = request.payload.get("region")
            operation = OperationSpec(
                id=_uuid(),
                name=str(request.payload.get("name") or operations.default_params(operation_type)["tool_name"]),
                type=operation_type,
                params=dict(request.payload.get("params", {})),
                regions=[PlanarRegion(**region_data)] if isinstance(region_data, dict) else [],
            )
            setup.operations.append(operation)
            object_tracking.refresh_operation_source_object_ids(
                document_state, operation
            )
            object_tracking.sync_metadata(
                doc, document_state, operation.source_object_ids
            )
            document_state.selected_operation_id = operation.id
            runtime.sync_selected_toolpath(doc, document_state)
            state.save(doc, document_state)
            return panel_event(request, document_state, ok=True, selected_operation_id=operation.id)
        elif action == "update_operation":
            setup, operation = _target_operation(document_state, request)
            _require(operation, "Select an operation to update.")
            old_source_ids = list(operation.source_object_ids)
            if "name" in request.payload:
                operation.name = str(request.payload["name"])
            if isinstance(request.payload.get("params"), dict):
                operation.params.update(request.payload["params"])
            if isinstance(request.payload.get("regions"), list):
                operation.regions = [PlanarRegion(**region) for region in request.payload["regions"]]
            elif isinstance(request.payload.get("region"), dict):
                operation.regions = [PlanarRegion(**request.payload["region"])]
            object_tracking.refresh_operation_source_object_ids(
                document_state, operation
            )
            object_tracking.sync_metadata(
                doc,
                document_state,
                old_source_ids + operation.source_object_ids,
            )
            _invalidate_toolpaths(document_state, doc, operation.id)
            state.save(doc, document_state)
        elif action == "reorder_operations":
            setup_id = str(request.payload.get("setup_id", ""))
            setup = next(
                (item for item in document_state.setups if item.id == setup_id),
                None,
            )
            if setup is None:
                raise ValueError("Setup no longer exists.")
            operation_ids = request.payload.get("operation_ids")
            if not isinstance(operation_ids, list) or not all(
                isinstance(operation_id, str) for operation_id in operation_ids
            ):
                raise ValueError("reorder_operations requires operation_ids.")
            operations_by_id = {operation.id: operation for operation in setup.operations}
            if len(operation_ids) != len(operations_by_id) or set(operation_ids) != set(
                operations_by_id
            ):
                raise ValueError("Operation order must include every setup operation once.")
            setup.operations[:] = [operations_by_id[operation_id] for operation_id in operation_ids]
            state.save(doc, document_state)
        elif action == "duplicate_operation":
            setup, operation = _target_operation(document_state, request)
            _require(operation, "Select an operation to duplicate.")
            duplicate = OperationSpec(
                id=_uuid(),
                name=f"{operation.name}_Copy",
                type=operation.type,
                params=deepcopy(operation.params),
                regions=deepcopy(operation.regions),
            )
            object_tracking.refresh_operation_source_object_ids(
                document_state, duplicate
            )
            setup.operations.append(duplicate)
            object_tracking.sync_metadata(
                doc, document_state, duplicate.source_object_ids
            )
            document_state.selected_operation_id = duplicate.id
            runtime.sync_selected_toolpath(doc, document_state)
            state.save(doc, document_state)
            return panel_event(
                request,
                document_state,
                ok=True,
                selected_operation_id=duplicate.id,
            )
        elif action == "delete_operation":
            setup, operation = _target_operation(document_state, request)
            _require(operation, "Select an operation to delete.")
            old_source_ids = list(operation.source_object_ids)
            setup.operations.remove(operation)
            object_tracking.sync_metadata(doc, document_state, old_source_ids)
            _invalidate_toolpaths(document_state, doc, operation.id)
            state.clear_operation_invalid(document_state, operation.id)
            if document_state.selected_operation_id == operation.id:
                document_state.selected_operation_id = None
            runtime.sync_selected_toolpath(doc, document_state)
            state.save(doc, document_state)
        elif action == "select_operation":
            operation_id = str(request.payload["operation_id"])
            _, operation = document_state.find_operation(operation_id)
            _require(operation, "Selected operation no longer exists.")
            document_state.selected_operation_id = operation_id
            runtime.sync_selected_toolpath(doc, document_state)
            state.save(doc, document_state)
        elif action == "set_visibility":
            flags = request.payload.get("flags")
            if not isinstance(flags, dict):
                raise ValueError("set_visibility requires a flags object.")
            document_state.visibility.update(
                {key: bool(value) for key, value in flags.items() if key in document_state.visibility}
            )
            runtime.set_visibility(doc, document_state.visibility)
            runtime.apply_stock_and_part(doc, document_state)
            object_tracking.rebuild(doc, document_state)
            state.save(doc, document_state)
        elif action == "set_backend_url":
            url = str(request.payload.get("url", "")).strip()
            if not url.startswith(("http://", "https://")):
                raise ValueError("Backend URL must start with http:// or https://")
            document_state.backend_url = url
            state.save(doc, document_state)
        elif action in {"generate", "generate_operation"}:
            setup, operation = _target_operation(document_state, request)
            _require(operation, "Add an operation before generating.")
            generation = _start_generation(document_state, operation, doc)
            document_state.selected_operation_id = operation.id
            state.save(doc, document_state)
            return panel_event(
                request,
                document_state,
                ok=True,
                generation_status="running",
                generation_operation_id=generation.operation_id,
            )
        elif action == "generate_status":
            generation = runtime.generation_task(doc)
            _require(generation, "No toolpath generation is running.")
            if generation.status == "running":
                return panel_event(
                    request,
                    document_state,
                    ok=True,
                    generation_status="running",
                    generation_operation_id=generation.operation_id,
                )

            runtime.forget_generation(doc, generation)
            if generation.status == "error":
                import Rhino

                Rhino.RhinoApp.WriteLine(
                    f"OpenCAM generation failed: "
                    f"{generation.error or 'Unknown backend error.'}"
                )
                return panel_event(
                    request,
                    document_state,
                    ok=False,
                    generation_status="error",
                    generation_operation_id=generation.operation_id,
                )

            try:
                response = _apply_completed_generation(document_state, generation, doc)
                state.save(doc, document_state)
            except Exception as error:  # noqa: BLE001 - report through panel event
                import Rhino

                Rhino.RhinoApp.WriteLine(
                    f"OpenCAM generation completion failed: {error}"
                )
                return panel_event(
                    request,
                    document_state,
                    ok=False,
                    generation_status="error",
                    generation_operation_id=generation.operation_id,
                )
            simulation = runtime.session(doc)
            return panel_event(
                request,
                document_state,
                ok=True,
                generation_status="completed",
                generation_operation_id=generation.operation_id,
                simulation_status="running" if simulation is not None else None,
                simulation_operation_id=(
                    simulation.operation_id if simulation is not None else None
                ),
                record_count=len(response.get("records", [])),
            )
        elif action == "simulate":
            _, selected_operation = _target_operation(document_state, request)
            _require(selected_operation, "Select an operation before simulating.")
            operation = runtime.last_toolpath(doc, selected_operation.id)
            if operation is None:
                operation = state.cached_toolpath(document_state, selected_operation.id)
                if operation is not None:
                    runtime.remember_toolpath(doc, operation, selected_operation.id)
            _require(operation, "Generate this operation before simulating.")
            generation_hash = state.operation_generation_hash(
                document_state, selected_operation
            )
            existing = runtime.session(doc)
            if (
                existing is not None
                and existing.operation_id == selected_operation.id
                and existing.generation_hash == generation_hash
            ):
                if existing.simulation_id and existing.frames:
                    index = max(existing.current_frame, 0)
                    existing.show_frame(doc, index)
                    return panel_event(
                        request,
                        document_state,
                        ok=True,
                        simulation_status="completed",
                        frame_index=index,
                        frame_count=len(existing.frames),
                    )
                return panel_event(
                    request,
                    document_state,
                    ok=True,
                    simulation_status="running",
                    frame_count=0,
                )
            _invalidate_simulation(
                document_state,
                doc,
                selected_operation.id,
            )
            session = _start_simulation(
                document_state,
                selected_operation,
                operation,
                doc,
            )
            state.save(doc, document_state)
        elif action == "simulate_status":
            session = runtime.session(doc)
            _require(session, "Start a simulation before polling status.")
            requested_task_id = str(request.payload.get("task_id", ""))
            if requested_task_id and requested_task_id != session.task_id:
                return panel_event(request, document_state, ok=True)
            status = backend.request_json(
                document_state.backend_url,
                "GET",
                "/simulate/{}/status".format(session.task_id),
            )
            result = status.get("result")
            if status.get("status") == "completed" and result and not session.simulation_id:
                runtime.complete_session(session, result, _fetcher(document_state.backend_url))
                if session.frames and bool(request.payload.get("display", False)):
                    session.show_frame(doc, 0)
                document_state.results["simulation_id"] = session.simulation_id
                document_state.results["frame_count"] = len(session.frames)
                _simulation_summaries(document_state)[session.operation_id] = {
                    "status": "completed",
                    "task_id": session.task_id,
                    "simulation_id": session.simulation_id,
                    "generation_hash": session.generation_hash,
                    "frame_count": len(session.frames),
                }
                state.save(doc, document_state)
            simulation_status = str(status.get("status", "running"))
            if simulation_status in {"cancelled", "error"}:
                _simulation_summaries(document_state)[session.operation_id] = {
                    "status": simulation_status,
                    "task_id": session.task_id,
                    "generation_hash": session.generation_hash,
                    "frame_count": 0,
                    "error": status.get("errorDetail"),
                }
                state.save(doc, document_state)
            return panel_event(
                request,
                document_state,
                ok=True,
                simulation_status=simulation_status,
                simulation_operation_id=session.operation_id,
                frame_count=len(session.frames) if session.simulation_id else 0,
            )
        elif action == "show_frame":
            session = runtime.session(doc)
            _require(
                session and session.simulation_id,
                "Wait for a completed simulation before stepping frames.",
            )
            index = runtime.SimulationSession.show_frame(
                session,
                doc,
                int(request.payload.get("frame_index", 0)),
            )
            return panel_event(
                request, document_state, ok=True, frame_index=index, frame_count=len(session.frames)
            )
        elif action == "exit_simulation":
            runtime.hide_session(doc)
        elif action == "clear_preview":
            _invalidate_simulation(document_state, doc)
            runtime.clear_document(doc)
            state.invalidate_toolpath_previews(document_state)
            document_state.results.pop("toolpath_summary", None)
            document_state.results.pop("toolpath_summaries", None)
            document_state.results.pop("simulation_id", None)
            document_state.results.pop("simulation_task_id", None)
            document_state.results.pop("frame_count", None)
            state.save(doc, document_state)
        elif action == "post_process_setup":
            setup_id = str(request.payload.get("setup_id", ""))
            setup = next(
                (candidate for candidate in document_state.setups if candidate.id == setup_id),
                None,
            )
            _require(setup, "Selected setup no longer exists.")
            generated_operations = []
            missing_operation_names = []
            for operation_spec in setup.operations:
                operation = runtime.last_toolpath(doc, operation_spec.id)
                if operation is None:
                    operation = state.cached_toolpath(document_state, operation_spec.id)
                if operation is None:
                    missing_operation_names.append(operation_spec.name)
                else:
                    generated_operations.append(operation)
            _require(
                generated_operations and not missing_operation_names,
                "Generate every setup operation before post-processing. Missing: "
                + ", ".join(missing_operation_names),
            )
            output_path = _choose_post_process_path(setup.name)
            if output_path is None:
                return panel_event(request, document_state, cancelled=True)
            nc_bytes = backend.post_json_bytes(
                document_state.backend_url,
                "/cam/post-process/duet3d/nc",
                generated_operations,
            )
            _write_post_process_output(output_path, nc_bytes)
            import Rhino

            Rhino.RhinoApp.WriteLine(
                f"OpenCAM wrote {len(generated_operations)} operation(s) "
                f"to Duet 3D NC: {output_path}"
            )
            return panel_event(
                request,
                document_state,
                ok=True,
                output_path=output_path,
            )
        elif action == "post_process":
            _, selected_operation = _target_operation(document_state, request)
            _require(selected_operation, "Select an operation before post-processing.")
            operation = runtime.last_toolpath(doc, selected_operation.id)
            if operation is None:
                operation = state.cached_toolpath(document_state, selected_operation.id)
            _require(operation, "Generate this operation before post-processing.")
            output_path = _choose_post_process_path(selected_operation.name)
            if output_path is None:
                return panel_event(request, document_state, cancelled=True)
            nc_bytes = backend.post_json_bytes(
                document_state.backend_url,
                "/cam/post-process/duet3d/nc",
                [operation],
            )
            _write_post_process_output(output_path, nc_bytes)
            import Rhino

            Rhino.RhinoApp.WriteLine(f"OpenCAM wrote Duet 3D NC: {output_path}")
            return panel_event(
                request,
                document_state,
                ok=True,
                output_path=output_path,
            )
        else:
            raise ValueError("Unknown OpenCAM Rhino action: {}".format(action))
        return panel_event(request, document_state, ok=True)
    except Exception as error:
        import Rhino

        Rhino.RhinoApp.WriteLine("OpenCAM {} failed: {}".format(request.action, error))
        try:
            persisted_state = state.load(doc)
        except Exception:  # noqa: BLE001 - preserve original action failure
            persisted_state = document_state
        return panel_event(request, persisted_state, ok=False)


def _require(value, message):
    if value is None:
        raise ValueError(message)


def _operation_json(operation: dict) -> str:
    import json

    return json.dumps(operation, separators=(",", ":"))
