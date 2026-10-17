#! python 3
"""Non-mutating Rhino 8 API probe used before interactive selection testing."""
import json

import Rhino
from run_in_rhino.rhino_env.jsonl_logger import JsonlLogger

logger = JsonlLogger(globals().get("RUN_IN_RHINO_LOG"))
with logger:
    getter = Rhino.Input.Custom.GetObject()
    logger.log(
        json.dumps(
            {
                "rhino_version": str(Rhino.RhinoApp.Version),
                "get_multiple": hasattr(getter, "GetMultiple"),
                "subobject_select": hasattr(getter, "SubObjectSelect"),
                "enable_preselect": hasattr(getter, "EnablePreSelect"),
                "brep_create_mesh": hasattr(Rhino.Geometry.Mesh, "CreateFromBrep"),
                "curve_join": hasattr(Rhino.Geometry.Curve, "JoinCurves"),
            }
        ),
        type="data",
    )
