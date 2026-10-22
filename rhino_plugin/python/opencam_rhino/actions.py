"""UI-thread actions shared by generated Rhino commands and panel messages.

Rhino state changes stay on the UI thread. Toolpath HTTP generation runs in a
worker thread and is committed by short panel status polls. Every action
returns a panel event with persisted document state, keeping the WebView dumb.
"""

from __future__ import annotations

from . import backend, mesh_export, operations, runtime, selection, state
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


def _target_operation(document_state: DocumentState, request: PanelRequest):
    operation_id = request.payload.get("operation_id") or document_state.selected_operation_id
    if operation_id:
        setup, operation = document_state.find_operation(str(operation_id))
        if operation is not None:
            return setup, operation
    for setup, operation in document_state.all_operations():
        return setup, operation
    return None, None


def _edit_operation_dialog(doc, operation, backend_url):
    import json
    from dataclasses import asdict

    from OpenCamRhinoBridge import PluginBridge

    draft = None if operation is None else asdict(operation)
    while True:
        response = json.loads(PluginBridge.ShowOperationDialog(
            doc.RuntimeSerialNumber,
            json.dumps({"draft": draft, "backend_url": backend_url}, separators=(",", ":")),
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


def _invalidate_toolpaths(
    document_state: DocumentState,
    doc,
    operation_id: str | None = None,
):
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


def _start_generation(document_state: DocumentState, operation: OperationSpec, doc):
    _require(document_state.part, "Select a part before generating a toolpath.")
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
        "partMesh": document_state.part.mesh,
        "stock": {"maxZ": document_state.part.stock_box.max[2]},
    }
    base_url = document_state.backend_url
    request_payload = {"setup": setup, "operation": operation_payload}
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
    )


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
    return task.response


def run(request_data, doc):
    request = PanelRequest.from_dict(request_data)
    document_state = state.load(doc)
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
        elif action == "select_part":
            part = selection.select_part(doc)
            if part is None:
                return panel_event(request, document_state, cancelled=True)
            document_state.part = part
            _invalidate_toolpaths(document_state, doc)
            runtime.apply_stock_and_part(doc, document_state)
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
            draft = _edit_operation_dialog(doc, operation, document_state.backend_url)
            if draft is None:
                return panel_event(request, document_state, cancelled=True)
            editing_existing = operation is not None
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
            document_state.selected_operation_id = operation.id
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
            document_state.selected_operation_id = operation.id
            runtime.sync_selected_toolpath(doc, document_state)
            state.save(doc, document_state)
            return panel_event(request, document_state, ok=True, selected_operation_id=operation.id)
        elif action == "update_operation":
            setup, operation = _target_operation(document_state, request)
            _require(operation, "Select an operation to update.")
            if "name" in request.payload:
                operation.name = str(request.payload["name"])
            if isinstance(request.payload.get("params"), dict):
                operation.params.update(request.payload["params"])
            if isinstance(request.payload.get("regions"), list):
                operation.regions = [PlanarRegion(**region) for region in request.payload["regions"]]
            elif isinstance(request.payload.get("region"), dict):
                operation.regions = [PlanarRegion(**request.payload["region"])]
            _invalidate_toolpaths(document_state, doc, operation.id)
            state.save(doc, document_state)
        elif action == "delete_operation":
            setup, operation = _target_operation(document_state, request)
            _require(operation, "Select an operation to delete.")
            setup.operations.remove(operation)
            _invalidate_toolpaths(document_state, doc, operation.id)
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
            return panel_event(
                request,
                document_state,
                ok=True,
                generation_status="completed",
                generation_operation_id=generation.operation_id,
                record_count=len(response.get("records", [])),
            )
        elif action == "simulate":
            _require(document_state.part, "Select a part before simulating.")
            _, selected_operation = _target_operation(document_state, request)
            _require(selected_operation, "Select an operation before simulating.")
            operation = runtime.last_toolpath(doc, selected_operation.id)
            if operation is None:
                operation = state.cached_toolpath(document_state, selected_operation.id)
                if operation is not None:
                    runtime.remember_toolpath(doc, operation, selected_operation.id)
            _require(operation, "Generate this operation before simulating.")
            box = document_state.part.stock_box
            task_id = backend.start_swept_simulation(
                document_state.backend_url,
                mesh_export.box_stl_bytes(box.min, box.max),
                _operation_json(operation),
            )
            session = runtime.start_session(doc, task_id)
            document_state.results["simulation_task_id"] = session.task_id
            state.save(doc, document_state)
        elif action == "simulate_status":
            session = runtime.session(doc)
            _require(session, "Start a simulation before polling status.")
            status = backend.request_json(
                document_state.backend_url,
                "GET",
                "/simulate/{}/status".format(session.task_id),
            )
            result = status.get("result")
            if status.get("status") == "completed" and result and not session.simulation_id:
                runtime.complete_session(session, result, _fetcher(document_state.backend_url))
                if session.frames:
                    session.show_frame(doc, 0)
                document_state.results["simulation_id"] = session.simulation_id
                document_state.results["frame_count"] = len(session.frames)
                state.save(doc, document_state)
            return panel_event(
                request,
                document_state,
                ok=True,
                simulation_status=status.get("status"),
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
        elif action == "clear_preview":
            runtime.clear_document(doc)
            state.invalidate_toolpath_previews(document_state)
            document_state.results.pop("toolpath_summary", None)
            document_state.results.pop("toolpath_summaries", None)
            document_state.results.pop("simulation_id", None)
            document_state.results.pop("simulation_task_id", None)
            document_state.results.pop("frame_count", None)
            state.save(doc, document_state)
        elif action == "post_process":
            _, selected_operation = _target_operation(document_state, request)
            _require(selected_operation, "Select an operation before post-processing.")
            operation = runtime.last_toolpath(doc, selected_operation.id)
            if operation is None:
                operation = state.cached_toolpath(document_state, selected_operation.id)
            _require(operation, "Generate this operation before post-processing.")
            tool = operation.get("tool") if isinstance(operation, dict) else None
            _require(
                isinstance(tool, dict)
                and selected_operation.params.get("tool_id") == tool.get("id"),
                "Edit this operation, select a library tool, and regenerate before post-processing.",
            )
            output_path = _choose_post_process_path(selected_operation.name)
            if output_path is None:
                return panel_event(request, document_state, cancelled=True)
            nc_bytes = backend.post_json_bytes(
                document_state.backend_url,
                "/cam/post-process/duet3d/nc",
                [operation],
            )
            with open(output_path, "wb") as output_file:
                output_file.write(nc_bytes)
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
