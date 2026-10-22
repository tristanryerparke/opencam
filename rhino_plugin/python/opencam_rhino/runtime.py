"""Transient OpenCAM display lifecycle, modelled on Tack's document isolation.

Simulation sessions and their display meshes are transient runtime state.
Generated CL data is also mirrored here from document persistence for fast use.
Everything is keyed by document runtime serial number.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from threading import Thread

CONDUIT_KEY = "OpenCAM.Rhino.ToolpathConduit"
SESSIONS_KEY = "OpenCAM.Rhino.SimulationSessions"
GENERATION_TASKS_KEY = "OpenCAM.Rhino.GenerationTasks"
TOOLPATHS_KEY = "OpenCAM.Rhino.LastToolpath"
SOURCE_PARTS_KEY = "OpenCAM.Rhino.SourceParts"


@dataclass
class GenerationTask:
    operation_id: str
    generation_hash: str
    status: str = "running"
    response: dict | None = None
    error: str | None = None


@dataclass
class SimulationSession:
    simulation_id: str
    task_id: str
    operation_id: str
    generation_hash: str
    frames: list[dict] = field(default_factory=list)
    tool_meshes: list = field(default_factory=list)
    mesh_cache: dict[str, list] = field(default_factory=dict)
    fetcher: object | None = None
    current_frame: int = -1

    def _meshes(self, url: str):
        meshes = self.mesh_cache.get(url)
        if meshes is not None:
            return meshes
        if self.fetcher is None:
            raise RuntimeError("Simulation mesh fetcher is unavailable.")
        from .display import build_rhino_mesh
        from .glb import parse_glb

        meshes = [build_rhino_mesh(parsed) for parsed in parse_glb(self.fetcher(url))]
        self.mesh_cache[url] = meshes
        return meshes

    def show_frame(self, doc, index: int) -> int:
        index = max(0, min(int(index), len(self.frames) - 1))
        frame = self.frames[index]

        import Rhino

        tool_meshes = []
        position = frame["tool_position"]
        for source in self.tool_meshes:
            tool = source.DuplicateMesh()
            tool.Translate(
                Rhino.Geometry.Vector3d(position[0], position[1], position[2])
            )
            tool_meshes.append(tool)

        conduit = ensure_conduit()
        serial = int(doc.RuntimeSerialNumber)
        conduit.set_mesh_layer(serial, "simulation_cached", self._meshes(frame["cached_mesh_url"]))
        conduit.set_mesh_layer(serial, "simulation_active", self._meshes(frame["active_mesh_url"]))
        conduit.set_mesh_layer(serial, "tool", tool_meshes)
        self.current_frame = index
        doc.Views.Redraw()
        return index


def _sticky():
    import scriptcontext as sc

    return sc.sticky


def active_conduit():
    return _sticky().get(CONDUIT_KEY)


def ensure_conduit():
    from .display import CONDUIT_VERSION, OpenCamToolpathConduit

    conduit = active_conduit()
    if conduit is None or getattr(conduit, "version", 0) < CONDUIT_VERSION:
        if conduit is not None:
            conduit.clear()  # stale shape from an older plugin build in this Rhino session
        conduit = OpenCamToolpathConduit()
        _sticky()[CONDUIT_KEY] = conduit
    return conduit


def _sessions() -> dict:
    sticky = _sticky()
    sessions = sticky.get(SESSIONS_KEY)
    if sessions is None:
        sessions = {}
        sticky[SESSIONS_KEY] = sessions
    return sessions


def _generation_tasks() -> dict:
    sticky = _sticky()
    tasks = sticky.get(GENERATION_TASKS_KEY)
    if tasks is None:
        tasks = {}
        sticky[GENERATION_TASKS_KEY] = tasks
    return tasks


def start_generation(doc, operation_id: str, generation_hash: str, worker) -> GenerationTask:
    serial = int(doc.RuntimeSerialNumber)
    existing = _generation_tasks().get(serial)
    if existing is not None:
        raise RuntimeError("Wait for the current toolpath generation to finish.")

    task = GenerationTask(
        operation_id=str(operation_id),
        generation_hash=str(generation_hash),
    )
    _generation_tasks()[serial] = task

    def run_worker():
        try:
            task.response = worker()
            task.status = "completed"
        except Exception as error:  # noqa: BLE001 - transferred to Rhino UI thread
            task.error = str(error)
            task.status = "error"

    Thread(target=run_worker, name="OpenCAM toolpath generation", daemon=True).start()
    return task


def generation_task(doc) -> GenerationTask | None:
    return _generation_tasks().get(int(doc.RuntimeSerialNumber))


def forget_generation(doc, task: GenerationTask | None = None):
    serial = int(doc.RuntimeSerialNumber)
    current = _generation_tasks().get(serial)
    if task is None or current is task:
        _generation_tasks().pop(serial, None)


def _source_parts() -> dict:
    sticky = _sticky()
    parts = sticky.get(SOURCE_PARTS_KEY)
    if parts is None:
        parts = {}
        sticky[SOURCE_PARTS_KEY] = parts
    return parts


def _source_object(doc, object_id):
    import System

    return doc.Objects.FindId(System.Guid(str(object_id)))


def _restore_source_part(doc, record):
    obj = _source_object(doc, record["object_id"])
    if obj is None:
        return
    if record["initial_hidden"]:
        doc.Objects.Hide(obj, True)
    else:
        doc.Objects.Show(obj, True)


def _sync_source_part(doc, document_state):
    serial = int(doc.RuntimeSerialNumber)
    parts = _source_parts()
    record = parts.get(serial)
    requested_id = document_state.part.object_id if document_state.part is not None else None
    if record is not None and record["object_id"] != requested_id:
        _restore_source_part(doc, record)
        parts.pop(serial, None)
        record = None
    if requested_id is None:
        return

    obj = _source_object(doc, requested_id)
    if obj is None:
        return
    if record is None:
        record = {"object_id": requested_id, "initial_hidden": bool(obj.IsHidden)}
        parts[serial] = record
    if document_state.visibility.get("part", True):
        doc.Objects.Show(obj, True)
    else:
        doc.Objects.Hide(obj, True)


def session(doc) -> SimulationSession | None:
    return _sessions().get(int(doc.RuntimeSerialNumber))


def start_session(
    doc,
    task_id: str,
    operation_id: str,
    generation_hash: str,
) -> SimulationSession:
    end_session(doc)
    result = SimulationSession(
        simulation_id="",
        task_id=str(task_id),
        operation_id=str(operation_id),
        generation_hash=str(generation_hash),
    )
    _sessions()[int(doc.RuntimeSerialNumber)] = result
    return result


def complete_session(simulation: SimulationSession, result: dict, fetcher) -> SimulationSession:
    from .display import build_rhino_mesh
    from .glb import parse_glb

    simulation.simulation_id = str(result["simulationId"])
    simulation.frames = []
    for chunk_index, chunk in enumerate(result.get("chunks", [])):
        cached_mesh_url = str(chunk["cachedMeshUrl"])
        for frame in chunk.get("frames", []):
            position = frame.get("toolPosition", {})
            active_mesh_index = int(frame.get("activeMeshIndex", -1))
            simulation.frames.append(
                {
                    "cl_record_index": int(frame.get("clRecordIndex", -1)),
                    "tool_position": (
                        float(position.get("x", 0.0)),
                        float(position.get("y", 0.0)),
                        float(position.get("z", 0.0)),
                    ),
                    "cached_mesh_url": cached_mesh_url,
                    "active_mesh_url": (
                        f"/simulate/{simulation.simulation_id}/chunks/{chunk_index}"
                        f"/active-meshes/{active_mesh_index}.glb"
                    ),
                }
            )

    simulation.fetcher = fetcher
    simulation.tool_meshes = [
        build_rhino_mesh(parsed)
        for parsed in parse_glb(fetcher(str(result["toolMeshUrl"])))
    ]
    simulation.mesh_cache.clear()
    simulation.current_frame = -1
    return simulation


def hide_session(doc):
    serial = int(doc.RuntimeSerialNumber)
    conduit = active_conduit()
    if conduit is not None:
        conduit.set_mesh_layer(serial, "simulation_cached", [])
        conduit.set_mesh_layer(serial, "simulation_active", [])
        conduit.set_mesh_layer(serial, "tool", [])
    doc.Views.Redraw()


def end_session(doc):
    _sessions().pop(int(doc.RuntimeSerialNumber), None)
    hide_session(doc)


def apply_stock_and_part(doc, document_state):
    """Sync stock display and selected source-polysurface visibility.

    The backend mesh stays data-only. Rhino displays the selected Brep itself,
    so Part visibility changes the actual source object rather than a copy.
    """
    from .display import stock_box_edges

    conduit = ensure_conduit()
    serial = int(doc.RuntimeSerialNumber)
    if document_state.part is not None:
        conduit.set_stock_box(
            serial,
            stock_box_edges(document_state.part.stock_box.min, document_state.part.stock_box.max),
        )
    else:
        conduit.set_stock_box(serial, [])
    conduit.set_mesh_layer(serial, "part", [])
    _sync_source_part(doc, document_state)
    doc.Views.Redraw()


def set_visibility(doc, flags: dict):
    conduit = ensure_conduit()
    conduit.set_layer_visibility(int(doc.RuntimeSerialNumber), flags)
    doc.Views.Redraw()


def _toolpath_key(doc, operation_id=None):
    key = TOOLPATHS_KEY + "." + str(doc.RuntimeSerialNumber)
    return key if operation_id is None else key + "." + str(operation_id)


def remember_toolpath(doc, operation: dict, operation_id=None):
    _sticky()[_toolpath_key(doc)] = operation
    if operation_id is not None:
        _sticky()[_toolpath_key(doc, operation_id)] = operation


def last_toolpath(doc, operation_id=None):
    return _sticky().get(_toolpath_key(doc, operation_id))


def forget_toolpath(doc, operation_id=None):
    if operation_id is not None:
        _sticky().pop(_toolpath_key(doc, operation_id), None)
        return
    prefix = _toolpath_key(doc)
    for key in [key for key in _sticky() if str(key) == prefix or str(key).startswith(prefix + ".")]:
        _sticky().pop(key, None)


def show_toolpath_preview(doc, preview_data: dict):
    """Replace this document's displayed path with one compact saved preview."""
    from .display import ToolpathPreview

    preview = ToolpathPreview.from_dict(preview_data)
    conduit = ensure_conduit()
    conduit.set_toolpath(int(doc.RuntimeSerialNumber), preview)
    doc.Views.Redraw()
    return preview


def show_toolpath(doc, operation: dict):
    """Replace only this document's preview and redraw this document."""
    from .display import ToolpathPreview

    preview = ToolpathPreview.from_operation(operation)
    conduit = ensure_conduit()
    conduit.set_toolpath(int(doc.RuntimeSerialNumber), preview)
    doc.Views.Redraw()
    return preview


def clear_toolpath(doc):
    conduit = active_conduit()
    if conduit is None:
        return
    conduit.clear_toolpath(int(doc.RuntimeSerialNumber))
    doc.Views.Redraw()


def sync_selected_toolpath(doc, document_state):
    """Display only selected operation's valid persisted preview."""
    from . import state

    operation_id = document_state.selected_operation_id
    preview_data = state.toolpath_preview(document_state, operation_id)
    try:
        if preview_data is not None:
            return show_toolpath_preview(doc, preview_data)
        operation = state.cached_toolpath(document_state, operation_id)
        if operation is not None:
            return show_toolpath(doc, operation)
    except (TypeError, ValueError):
        pass
    clear_toolpath(doc)
    return None


def restore_document(doc, document_state):
    """Rebuild transient caches and conduit layers from persisted document state."""
    from . import state

    for _, operation in document_state.all_operations():
        cached = state.cached_toolpath(document_state, operation.id)
        if cached is not None:
            remember_toolpath(doc, cached, operation.id)
    apply_stock_and_part(doc, document_state)
    set_visibility(doc, document_state.visibility)
    sync_selected_toolpath(doc, document_state)


def clear_document(doc):
    """Forget transient display data without touching persisted CAM state."""
    serial = int(doc.RuntimeSerialNumber)
    conduit = active_conduit()
    if conduit is not None:
        conduit.forget_document(serial)
    _sessions().pop(serial, None)
    forget_toolpath(doc)
    doc.Views.Redraw()


def document_closing(document_serial_number):
    """Called by the C# lifecycle bridge; safe after Rhino has changed ActiveDoc."""
    serial = int(document_serial_number)
    conduit = active_conduit()
    if conduit is not None:
        conduit.forget_document(serial)
    _sessions().pop(serial, None)
    _generation_tasks().pop(serial, None)
    prefix = TOOLPATHS_KEY + "." + str(serial)
    for key in [key for key in _sticky() if str(key) == prefix or str(key).startswith(prefix + ".")]:
        _sticky().pop(key, None)
    _source_parts().pop(serial, None)


def shutdown():
    import Rhino

    for serial, record in tuple(_source_parts().items()):
        document = Rhino.RhinoDoc.FromRuntimeSerialNumber(serial)
        if document is not None:
            _restore_source_part(document, record)
    conduit = active_conduit()
    if conduit is not None:
        conduit.clear()
    sticky = _sticky()
    sticky.pop(CONDUIT_KEY, None)
    sticky.pop(SESSIONS_KEY, None)
    sticky.pop(GENERATION_TASKS_KEY, None)
    sticky.pop(SOURCE_PARTS_KEY, None)
    for key in [key for key in sticky if str(key).startswith(TOOLPATHS_KEY + ".")]:
        sticky.pop(key, None)
