"""UI-thread actions shared by generated Rhino commands and panel messages.

All backend work happens here, on demand; nothing runs from document events or
background threads.  Every action returns a panel event with the persisted
document state, keeping the WebView dumb.
"""

from __future__ import annotations

from . import backend, mesh_export, operations, runtime, selection, state
from .contracts import DocumentState, OperationSpec, PanelRequest, SetupSpec, panel_event


def _fetcher(base_url):
    return lambda path: backend.request_bytes(base_url, path)


def _default_setup(document_state: DocumentState) -> SetupSpec:
    setup = SetupSpec(id=_uuid(), name="Setup {}".format(len(document_state.setups) + 1))
    document_state.setups.append(setup)
    return setup


def _uuid() -> str:
    import uuid

    return str(uuid.uuid4())


def _target_operation(document_state: DocumentState, request: PanelRequest):
    operation_id = request.payload.get("operation_id") or document_state.selected_operation_id
    if operation_id:
        setup, operation = document_state.find_operation(str(operation_id))
        if operation is not None:
            return setup, operation
    for setup, operation in document_state.all_operations():
        return setup, operation
    return None, None


def _generate(document_state: DocumentState, operation: OperationSpec, doc):
    _require(document_state.part, "Select a part before generating a toolpath.")
    payload = operations.build_operation_payload(
        {"id": operation.id, "name": operation.name, "type": operation.type, "params": operation.params},
        document_state,
    )
    setup = dict({"clearanceOffset": 10.0})
    setup["partMesh"] = document_state.part.mesh
    setup["stock"] = {"maxZ": document_state.part.stock_box.max[2]}
    response = backend.request_json(
        document_state.backend_url,
        "POST",
        "/cam/toolpath",
        {"setup": setup, "operation": payload},
    )
    preview = runtime.show_toolpath(doc, response)
    runtime.remember_toolpath(doc, response)
    document_state.results.setdefault("toolpath_summaries", {})[operation.id] = {
        "segment_count": len(preview.segments),
        "point_count": sum(len(segment.points) for segment in preview.segments),
        "displayed": True,
    }
    document_state.results["toolpath_summary"] = document_state.results["toolpath_summaries"][operation.id]
    return response


def run(request_data, doc):
    request = PanelRequest.from_dict(request_data)
    document_state = state.load(doc)
    try:
        action = request.action
        if action == "get_state":
            pass
        elif action == "select_part":
            part = selection.select_part(doc)
            if part is None:
                return panel_event(request, document_state, cancelled=True)
            document_state.part = part
            runtime.apply_stock_and_part(doc, document_state)
            state.save(doc, document_state)
        elif action == "select_region":
            region = selection.select_planar_region(doc)
            if region is None:
                return panel_event(request, document_state, cancelled=True)
            document_state.region = region
            state.save(doc, document_state)
        elif action == "add_setup":
            _default_setup(document_state)
            state.save(doc, document_state)
        elif action == "add_operation":
            setup_id = request.payload.get("setup_id")
            setup = next((item for item in document_state.setups if item.id == setup_id), None)
            if setup is None:
                setup = document_state.setups[-1] if document_state.setups else _default_setup(document_state)
            operation_type = str(request.payload.get("type", "pocketing_2d"))
            if operation_type not in operations.OPERATION_TYPES:
                raise ValueError("Unknown operation type: {}".format(operation_type))
            operation = OperationSpec(
                id=_uuid(),
                name=str(request.payload.get("name") or operations.default_params(operation_type)["tool_name"]),
                type=operation_type,
                params=dict(request.payload.get("params", {})),
            )
            setup.operations.append(operation)
            document_state.selected_operation_id = operation.id
            state.save(doc, document_state)
            return panel_event(request, document_state, ok=True, selected_operation_id=operation.id)
        elif action == "update_operation":
            setup, operation = _target_operation(document_state, request)
            _require(operation, "Select an operation to update.")
            if "name" in request.payload:
                operation.name = str(request.payload["name"])
            if isinstance(request.payload.get("params"), dict):
                operation.params.update(request.payload["params"])
            state.save(doc, document_state)
        elif action == "delete_operation":
            setup, operation = _target_operation(document_state, request)
            _require(operation, "Select an operation to delete.")
            setup.operations.remove(operation)
            if document_state.selected_operation_id == operation.id:
                document_state.selected_operation_id = None
            document_state.results.get("toolpath_summaries", {}).pop(operation.id, None)
            state.save(doc, document_state)
        elif action == "select_operation":
            document_state.selected_operation_id = str(request.payload["operation_id"])
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
            response = _generate(document_state, operation, doc)
            document_state.selected_operation_id = operation.id
            state.save(doc, document_state)
            return panel_event(
                request, document_state, ok=True, record_count=len(response.get("records", []))
            )
        elif action == "simulate":
            _require(document_state.part, "Select a part before simulating.")
            operation = runtime.last_toolpath(doc)
            _require(operation, "Generate a toolpath before simulating.")
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
                runtime.complete_session(doc, session, result, _fetcher(document_state.backend_url))
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
                session, doc, int(request.payload.get("frame_index", 0)), _fetcher(document_state.backend_url)
            )
            return panel_event(
                request, document_state, ok=True, frame_index=index, frame_count=len(session.frames)
            )
        elif action == "compare":
            session = runtime.session(doc)
            _require(
                session and session.simulation_id,
                "Run a simulation before comparing against the part.",
            )
            comparison = backend.request_json(
                document_state.backend_url,
                "GET",
                "/simulate/{}/comparison".format(session.simulation_id),
            )
            mesh_count = runtime.show_mesh_layer(
                doc,
                "comparison",
                backend.request_bytes(document_state.backend_url, comparison["activeMeshUrl"]),
            )
            document_state.results["comparison_displayed"] = True
            state.save(doc, document_state)
        elif action == "show_final":
            session = runtime.session(doc)
            _require(
                session and session.simulation_id,
                "Run a simulation before showing the final stock.",
            )
            runtime.show_mesh_layer(
                doc,
                "final",
                backend.request_bytes(
                    document_state.backend_url,
                    "/simulate/{}/final-mesh.glb".format(session.simulation_id),
                ),
            )
        elif action == "clear_preview":
            runtime.clear_document(doc)
            document_state.results.pop("toolpath_summary", None)
            document_state.results.pop("toolpath_summaries", None)
            document_state.results.pop("simulation_id", None)
            document_state.results.pop("simulation_task_id", None)
            document_state.results.pop("frame_count", None)
            document_state.results.pop("comparison_displayed", None)
            state.save(doc, document_state)
        elif action == "post_process":
            raise NotImplementedError(
                "post_process is intentionally disabled until its download flow is verified."
            )
        else:
            raise ValueError("Unknown OpenCAM Rhino action: {}".format(action))
        return panel_event(request, document_state, ok=True)
    except Exception as error:
        return panel_event(request, document_state, ok=False, error=str(error))


def _require(value, message):
    if value is None:
        raise ValueError(message)


def _operation_json(operation: dict) -> str:
    import json

    return json.dumps(operation, separators=(",", ":"))
