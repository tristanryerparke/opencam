"""Run the OpenCAM Rhino pocketing demo from a terminal via run-in-rhino.

Usage:
    uv run --with run-in-rhino --with-editable ../run-in-rhino python demos/run_rhino_pocketing.py

Rhino 8 must have the ``run-in-rhino`` checkout configured in ScriptEditor →
Options → Python 3 → Paths, and its script server must be running.
"""

from __future__ import annotations

import json
from pathlib import Path

from run_in_rhino.pipe import run_script
from run_in_rhino.server import RunContext, server


WATCHER_PORT = 8766


REPO_ROOT = Path(__file__).resolve().parents[1]
RHINO_SCRIPT = REPO_ROOT / "demos" / "rhino_pocketing.py"


def main() -> None:
    bootstrap = f'''import Rhino
import System
import scriptcontext as sc

curve = Rhino.Geometry.PolylineCurve([
    Rhino.Geometry.Point3d(50, 50, 0),
    Rhino.Geometry.Point3d(150, 50, 0),
    Rhino.Geometry.Point3d(150, 150, 0),
    Rhino.Geometry.Point3d(50, 150, 0),
    Rhino.Geometry.Point3d(50, 50, 0),
])
curve_id = sc.doc.Objects.AddCurve(curve)
if curve_id == System.Guid.Empty:
    raise RuntimeError("Could not add the terminal-demo pocket boundary.")
OPENCAM_CURVE_ID = str(curve_id)
exec(compile(open({str(RHINO_SCRIPT)!r}, encoding="utf-8").read(), {str(RHINO_SCRIPT)!r}, "exec"))
'''
    data = []
    reason = None
    for status, payload in server(port=WATCHER_PORT, context=RunContext(env={})):
        if status == "ready":
            run_script(script=bootstrap)
        elif status == "data":
            data.append(payload)
        elif status in {"done", "quit"}:
            reason = status
    if reason != "done" or len(data) != 1:
        raise RuntimeError(f"Rhino pocketing demo ended with {reason!r}: {data!r}")
    result = json.loads(data[0])
    if not result["gcode_exists"] or not result["conduit_enabled"] or result["record_count"] <= 0:
        raise RuntimeError(f"Rhino demo reported invalid result: {result!r}")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
