"""UI-thread actions shared by generated Rhino commands and panel messages."""

from __future__ import annotations

from . import backend, runtime, selection, state
from .contracts import PanelRequest, panel_event


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
            document_state.operations = [operation]
            document_state.results["toolpath_summary"] = {
                "segment_count": len(preview.segments),
                "point_count": sum(len(segment.points) for segment in preview.segments),
                "displayed": True,
            }
            state.save(doc, document_state)
        elif request.action == "clear_preview":
            runtime.clear_document(doc)
            document_state.results.pop("toolpath_summary", None)
            state.save(doc, document_state)
        elif request.action in {"simulate", "compare", "post_process"}:
            raise NotImplementedError(
                "{} is intentionally disabled until its API and Rhino display contract is verified.".format(request.action)
            )
        else:
            raise ValueError("Unknown OpenCAM Rhino action: {}".format(request.action))
        return panel_event(request, document_state, ok=True)
    except Exception as error:
        return panel_event(request, document_state, ok=False, error=str(error))


def _require(value, message):
    if value is None:
        raise ValueError(message)
