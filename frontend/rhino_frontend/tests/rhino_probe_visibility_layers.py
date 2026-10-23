#! python 3
"""Live-Rhino probe: visibility flags, stock box, and part mesh layers."""
import json
import sys
from pathlib import Path

import Rhino
from run_in_rhino.rhino_env.jsonl_logger import JsonlLogger

sys.path.insert(0, str(Path(__file__).parents[1] / "python"))
for name in [name for name in sys.modules if name.startswith("opencam_rhino")]:
    del sys.modules[name]
from opencam_rhino import runtime  # noqa: E402
from opencam_rhino.contracts import DocumentState, PartSelection, StockBox  # noqa: E402

import scriptcontext as sc  # noqa: E402
sc.sticky.pop(runtime.CONDUIT_KEY, None)  # deterministic: drop any stale conduit

logger = JsonlLogger(globals().get("RUN_IN_RHINO_LOG"))
with logger:
    doc = Rhino.RhinoDoc.ActiveDoc
    state = DocumentState(
        part=PartSelection(
            object_id="probe-part",
            name="Probe part",
            mesh={
                "source": "inline",
                "vertices": [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [5, 5, 8]],
                "faces": [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
            },
            stock_box=StockBox(min=[0, 0, 0], max=[10, 10, 8]),
        ),
    )
    serial = int(doc.RuntimeSerialNumber)
    runtime.apply_stock_and_part(doc, state)
    conduit = runtime.active_conduit()
    result = {
        "stock_edges": len(conduit._conduit.stock_boxes.get(serial, [])),
        "part_faces": sum(mesh.Faces.Count for mesh in conduit._conduit.mesh_layers.get(serial, {}).get("part", [])),
        "enabled": conduit.enabled,
    }
    runtime.set_visibility(doc, {"stock": False, "part": False})
    result["flags"] = conduit._conduit.layer_visibility[serial]
    runtime.apply_stock_and_part(doc, state)
    # Toggles are draw-time gates: layers stay cached but are skipped at draw.
    result["stock_edges_cached"] = len(conduit._conduit.stock_boxes.get(serial, []))
    result["part_layer_cached"] = "part" in conduit._conduit.mesh_layers.get(serial, {})
    runtime.set_visibility(doc, {"toolpath": False, "tool": False})
    result["flags_cumulative"] = conduit._conduit.layer_visibility[serial]
    runtime.clear_document(doc)
    result["enabled_after_clear"] = conduit.enabled
    logger.log(json.dumps(result), type="data")
