#! python 3
"""Non-mutating live-Rhino probe for the document-keyed conduit lifecycle."""
import json
import sys
from pathlib import Path

import Rhino
from run_in_rhino.rhino_env.jsonl_logger import JsonlLogger

sys.path.insert(0, str(Path(__file__).parents[1] / "python"))
from opencam_rhino import runtime  # noqa: E402

logger = JsonlLogger(globals().get("RUN_IN_RHINO_LOG"))
with logger:
    doc = Rhino.RhinoDoc.ActiveDoc
    preview = runtime.show_toolpath(doc, {"records": [
        {"x": 0, "y": 0, "z": 0, "feed_type": "rapid", "motion_role": "travel"},
        {"x": 10, "y": 0, "z": 0, "feed_type": "feed_rate", "motion_role": "cutting"},
    ]})
    conduit = runtime.active_conduit()
    keyed_before = int(doc.RuntimeSerialNumber) in conduit._conduit.previews
    runtime.clear_document(doc)
    logger.log(json.dumps({
        "segments": len(preview.segments),
        "keyed_before_clear": keyed_before,
        "enabled_after_clear": conduit.enabled,
        "keyed_after_clear": int(doc.RuntimeSerialNumber) in conduit._conduit.previews,
    }), type="data")
