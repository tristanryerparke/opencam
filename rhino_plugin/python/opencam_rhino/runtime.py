"""Transient OpenCAM display lifecycle, modelled on Tack's document isolation.

Simulation sessions, mesh caches, and the last generated CL data are runtime
state: nothing here is persisted into the `.3dm`, and everything is keyed by
document runtime serial number.
"""

from __future__ import annotations

from dataclasses import dataclass, field

CONDUIT_KEY = "OpenCAM.Rhino.ToolpathConduit"
SESSIONS_KEY = "OpenCAM.Rhino.SimulationSessions"
TOOLPATHS_KEY = "OpenCAM.Rhino.LastToolpath"

ACTIVE_MESH_CACHE_LIMIT = 240


@dataclass
class SimulationSession:
    simulation_id: str
    task_id: str
    frames: list[dict] = field(default_factory=list)
    tool_mesh = None
    cached_chunks: dict[int, list] = field(default_factory=dict)
    cached_active: dict[tuple[int, int], list] = field(default_factory=dict)
    current_frame: int = -1

    def show_frame(self, doc, index: int, fetcher) -> int:
        index = max(0, min(int(index), len(self.frames) - 1))
        frame = self.frames[index]

        chunk_index = int(frame["chunk_index"])
        if chunk_index not in self.cached_chunks:
            from .glb import parse_glb
            from .display import build_rhino_mesh

            self.cached_chunks[chunk_index] = [
                build_rhino_mesh(parsed)
                for parsed in parse_glb(fetcher(frame["cached_mesh_url"]))
            ]

        active_key = (chunk_index, int(frame["active_mesh_index"]))
        if active_key not in self.cached_active:
            from .glb import parse_glb
            from .display import build_rhino_mesh

            active_path = "/simulate/{}/chunks/{}/active-meshes/{}.glb".format(
                self.simulation_id, chunk_index, active_key[1]
            )
            self.cached_active[active_key] = [
                build_rhino_mesh(parsed) for parsed in parse_glb(fetcher(active_path))
            ]
            while len(self.cached_active) > ACTIVE_MESH_CACHE_LIMIT:
                self.cached_active.pop(next(iter(self.cached_active)))

        import Rhino

        tool_meshes = []
        if self.tool_mesh is not None:
            tool = self.tool_mesh.DuplicateMesh()
            position = frame["tool_position"]
            tool.Translate(
                Rhino.Geometry.Vector3d(position[0], position[1], position[2])
            )
            tool_meshes.append(tool)

        conduit = ensure_conduit()
        serial = int(doc.RuntimeSerialNumber)
        conduit.set_mesh_layer(serial, "rest", self.cached_chunks[chunk_index])
        conduit.set_mesh_layer(serial, "active", self.cached_active[active_key])
        conduit.set_mesh_layer(serial, "tool", tool_meshes)
        conduit.set_mesh_layer(serial, "final", [])
        conduit.set_mesh_layer(serial, "comparison", [])
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


def session(doc) -> SimulationSession | None:
    return _sessions().get(int(doc.RuntimeSerialNumber))


def start_session(doc, task_id: str) -> SimulationSession:
    result = SimulationSession(simulation_id="", task_id=str(task_id))
    _sessions()[int(doc.RuntimeSerialNumber)] = result
    return result


def complete_session(doc, simulation: SimulationSession, result: dict, fetcher) -> SimulationSession:
    from .display import build_rhino_mesh
    from .glb import parse_glb

    simulation.simulation_id = str(result["simulationId"])
    simulation.frames = []
    for chunk in result.get("chunks", []):
        cached_mesh_url = str(chunk["cachedMeshUrl"])
        for frame in chunk.get("frames", []):
            position = frame.get("toolPosition", {})
            simulation.frames.append(
                {
                    "chunk_index": None,  # filled after loop with ordinal chunk index
                    "cached_mesh_url": cached_mesh_url,
                    "active_mesh_index": int(frame["activeMeshIndex"]),
                    "cl_record_index": int(frame.get("clRecordIndex", -1)),
                    "tool_position": (
                        float(position.get("x", 0.0)),
                        float(position.get("y", 0.0)),
                        float(position.get("z", 0.0)),
                    ),
                }
            )
    # Chunks are flattened in order, so assign chunk ordinals by walking the
    # frames' per-chunk cached-mesh runs.
    ordinal = -1
    previous_url = None
    for frame in simulation.frames:
        if frame["cached_mesh_url"] != previous_url:
            ordinal += 1
            previous_url = frame["cached_mesh_url"]
        frame["chunk_index"] = ordinal

    simulation.tool_mesh = build_rhino_mesh(parse_glb(fetcher(str(result["toolMeshUrl"])))[0])
    simulation.cached_chunks.clear()
    simulation.cached_active.clear()
    simulation.current_frame = -1
    return simulation


def show_mesh_layer(doc, role: str, glb_bytes: bytes):
    from .display import build_rhino_mesh
    from .glb import parse_glb

    meshes = [build_rhino_mesh(parsed) for parsed in parse_glb(glb_bytes)]
    conduit = ensure_conduit()
    conduit.set_mesh_layer(int(doc.RuntimeSerialNumber), role, meshes)
    doc.Views.Redraw()
    return len(meshes)


def apply_stock_and_part(doc, document_state):
    """Sync the stock-box and part-mesh layers with the current selection.

    Visibility is a draw-time gate inside the conduit, so toggles never need
    to rebuild or drop cached geometry.
    """
    from .display import build_rhino_mesh, stock_box_edges

    conduit = ensure_conduit()
    serial = int(doc.RuntimeSerialNumber)
    if document_state.part is not None:
        conduit.set_stock_box(
            serial,
            stock_box_edges(document_state.part.stock_box.min, document_state.part.stock_box.max),
        )
        conduit.set_mesh_layer(serial, "part", [build_rhino_mesh(document_state.part.mesh)])
    else:
        conduit.set_stock_box(serial, [])
        conduit.set_mesh_layer(serial, "part", [])
    doc.Views.Redraw()


def set_visibility(doc, flags: dict):
    conduit = ensure_conduit()
    conduit.set_layer_visibility(int(doc.RuntimeSerialNumber), flags)
    doc.Views.Redraw()


def clear_meshes(doc):
    conduit = active_conduit()
    if conduit is None:
        return
    conduit.clear_meshes(int(doc.RuntimeSerialNumber))
    doc.Views.Redraw()


def remember_toolpath(doc, operation: dict):
    _sticky()[TOOLPATHS_KEY + "." + str(doc.RuntimeSerialNumber)] = operation


def last_toolpath(doc):
    return _sticky().get(TOOLPATHS_KEY + "." + str(doc.RuntimeSerialNumber))


def forget_toolpath(doc):
    _sticky().pop(TOOLPATHS_KEY + "." + str(doc.RuntimeSerialNumber), None)


def show_toolpath(doc, operation: dict):
    """Replace only this document's preview and redraw this document."""
    from .display import ToolpathPreview

    preview = ToolpathPreview.from_operation(operation)
    conduit = ensure_conduit()
    conduit.set_toolpath(int(doc.RuntimeSerialNumber), preview)
    doc.Views.Redraw()
    return preview


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
    _sticky().pop(TOOLPATHS_KEY + "." + str(serial), None)


def shutdown():
    conduit = active_conduit()
    if conduit is not None:
        conduit.clear()
    sticky = _sticky()
    sticky.pop(CONDUIT_KEY, None)
    sticky.pop(SESSIONS_KEY, None)
    for key in [key for key in sticky if str(key).startswith(TOOLPATHS_KEY + ".")]:
        sticky.pop(key, None)
