# OpenCAM

## Rhino cutting-animation demo

This repo uses the sibling `../rhino-python-renderer` package in editable mode. To send an OpenCAM swept-volume animation to Rhino through the C# `RhinoRendererPlugin`:

1. Open Rhino, load/build the `RhinoRendererPlugin`, and run `StartScriptServer`.
2. Open or save an active Rhino document.
3. Run:

```bash
uv run demos/rhino_cutting_animation.py
```

By default the script simulates `assets/2.5D_Part.stl` using the latest cutter-location paths logged in `frontend-paths.json`, sends cached/active stock meshes plus the cutter mesh as per-frame animation data, attaches frontend-style toolpath polylines to the same Rhino plugin animation, and opens it in the Rhino Renderer panel. Use `--delete-all-animations` to clear old Rhino plugin animations before sending. Use `--help` for options such as `--mesh`, `--operation-json`, `--max-frames`, `--no-toolpaths`, and `--ignore-frontend-path-log`.
