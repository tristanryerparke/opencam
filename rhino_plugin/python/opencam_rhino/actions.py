"""UI-thread actions shared by generated Rhino commands and panel messages.

All backend work happens here, on demand; nothing runs from document events or
background threads.  Every action returns a panel event with the persisted
document state, keeping the WebView dumb.
"""

from __future__ import annotations

from . import backend, mesh_export, runtime, selection, state
from .contracts import PanelRequest, panel_event


def _fetcher(base_url):
    return lambda path: backend.request_bytes(base_url, path)


def run(request_data, doc):
    request = PanelRequest.from_dict(request_data)
    document_state = state.load(doc)
    try:
        if request.action == "get_state":
            pass
        elif request.action == "select_part":
            part = selection.select_part(doc)
            if part is None:
                return panel_event(request, document_state, cancelled=True)
            document_state.part = part
            document_state.setup["part_mesh"] = part.mesh
            document_state.setup["stock"] = {"max_z": part.stock_box.max[2]}
            state.save(doc, document_state)
        elif request.action == "select_region":
            region = selection.select_planar_region(doc)
            if region is None:
                return panel_event(request, document_state, cancelled=True)
            document_state.region = region
            state.save(doc, document_state)
        elif request.action == "generate":
            _require(document_state.part, "Select a part before generating a toolpath.")
            operation = request.payload.get("operation")
            if not isinstance(operation, dict):
                raise ValueError("Generate requires one validated operation payload.")
            setup = dict(document_state.setup)
            setup["part_mesh"] = document_state.part.mesh
            response = backend.request_json(
                document_state.backend_url,
                "POST",
                "/cam/toolpath",
                {"setup": setup, "operation": operation},
            )
            preview = runtime.show_toolpath(doc, response)
            runtime.remember_toolpath(doc, response)
            document_state.operations = [operation]
            document_state.results["toolpath_summary"] = {
                "segment_count": len(preview.segments),
                "point_count": sum(len(segment.points) for segment in preview.segments),
                "displayed": True,
            }
            state.save(doc, document_state)
        elif request.action == "simulate":
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
        elif request.action == "simulate_status":
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
        elif request.action == "show_frame":
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
        elif request.action == "compare":
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
        elif request.action == "show_final":
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
        elif request.action == "clear_preview":
            runtime.clear_document(doc)
            document_state.results.pop("toolpath_summary", None)
            document_state.results.pop("simulation_id", None)
            document_state.results.pop("frame_count", None)
            document_state.results.pop("comparison_displayed", None)
            state.save(doc, document_state)
        elif request.action == "post_process":
            raise NotImplementedError(
                "post_process is intentionally disabled until its download flow is verified."
            )
        else:
            raise ValueError("Unknown OpenCAM Rhino action: {}".format(request.action))
        return panel_event(request, document_state, ok=True)
    except Exception as error:
        return panel_event(request, document_state, ok=False, error=str(error))


def _require(value, message):
    if value is None:
        raise ValueError(message)


def _operation_json(operation: dict) -> str:
    import json

    return json.dumps(operation, separators=(",", ":"))
