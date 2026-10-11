# OpenCAM

## Local toolpath diagnostics

Generated CL is saved as `toolpath-runs/<run-id>/cl.json` (gitignored), with validated setup and operation settings (including pocket border polylines) in `request.json`. If the setup refers to a cached part mesh, `replay-request.json` also captures an inline mesh snapshot so the request can be replayed after the cache changes. For other requests, `request.json` is replayable directly. Standalone CL uploads to simulation have no generation request. Successful simulations write `frame-map-<simulation-id>.json` in the same directory. Enable **Simulation debug UI** in general settings to see the first GUID segment of the simulation ID in the simulation debug overlay. The counter displays **1-based** frame numbers: subtract one to index `frameToClRecord`, then use the resulting **0-based** index in `cl.json` → `records`. Arc frames map back to the original arc record, not its tessellated line segments. Runs are retained until manually deleted. To inspect an issue at displayed frame 42 for simulation ID `570b4d31-…`:

```bash
uv run scripts/inspect_toolpath_frame.py 570b4d31 42
```

To reproduce toolpath generation, POST that run's `replay-request.json` if present, otherwise `request.json`, to `/cam/toolpath`, or load it as `GenerateToolpathRequest` and call `cam_engine(request.setup, request.operation)` in an automated regression. Each replay creates a new logged run.

## Rhino cutting-animation demo

This repo uses the sibling `../rhino-python-renderer` package in editable mode. To send an OpenCAM swept-volume animation to Rhino through the C# `RhinoRendererPlugin`:

1. Open Rhino, load/build the `RhinoRendererPlugin`, and run `StartScriptServer`.
2. Open or save an active Rhino document.
3. Run:

```bash
uv run demos/rhino_cutting_animation.py
```

By default the script simulates `assets/2.5D_Part.stl` with a synthetic raster cut, sends cached/active stock meshes plus the cutter mesh as per-frame animation data, attaches toolpath polylines to the same Rhino plugin animation, and opens it in the Rhino Renderer panel. Use `--operation-json` for a saved operation, `--delete-all-animations` to clear old Rhino plugin animations, or `--help` for more options.
