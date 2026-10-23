#! python 3
"""Live-Rhino probe: tool-only frame stepping with a local GLB fixture."""
import json
import sys
from pathlib import Path

import Rhino
from run_in_rhino.rhino_env.jsonl_logger import JsonlLogger

sys.path.insert(0, str(Path(__file__).parents[1] / "python"))
for name in [name for name in sys.modules if name.startswith("opencam_rhino")]:
    del sys.modules[name]  # Rhino keeps a long-lived interpreter; evict stale modules
from opencam_rhino import runtime  # noqa: E402

logger = JsonlLogger(globals().get("RUN_IN_RHINO_LOG"))
with logger:
    doc = Rhino.RhinoDoc.ActiveDoc
    probe_dir = Path("/tmp/opencam_rhino_mesh_probe")

    def fetcher(path):
        return (probe_dir / "tool.glb").read_bytes()

    session = runtime.start_session(doc, "probe-task")
    runtime.complete_session(session, {
        "simulationId": "probe-sim",
        "toolMeshUrl": "/tool-mesh.glb",
        "chunks": [{
            "cachedMeshUrl": "/chunks/0/cached-mesh.glb",
            "frames": [{
                "activeMeshIndex": 0,
                "clRecordIndex": 0,
                "toolPosition": {"x": 2.0, "y": 2.0, "z": 5.0},
            }],
        }],
    }, fetcher)
    index = runtime.SimulationSession.show_frame(session, doc, 0)

    conduit = runtime.active_conduit()
    serial = int(doc.RuntimeSerialNumber)
    layers = conduit._conduit.mesh_layers[serial]
    result = {
        "frames": len(session.frames),
        "frame_index": index,
        "layer_roles": sorted(layers),
        "tool_vertices": sum(mesh.Vertices.Count for mesh in layers["tool"]),
        "enabled": conduit.enabled,
    }
    runtime.clear_document(doc)
    result["enabled_after_clear"] = conduit.enabled
    result["keyed_after_clear"] = serial in conduit._conduit.mesh_layers
    logger.log(json.dumps(result), type="data")
