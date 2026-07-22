# OpenCAM

## Rhino cutting-animation demo

This repo uses the sibling `../rhino-python-renderer` package in editable mode. To send an OpenCAM swept-volume animation to Rhino through the C# `RhinoRendererPlugin`:

1. Open Rhino, load/build the `RhinoRendererPlugin`, and run `StartScriptServer`.
2. Open or save an active Rhino document.
3. Run:

```bash
uv run demos/rhino_cutting_animation.py
```

By default the script simulates `assets/2.5D_Part.stl` with a synthetic raster cut, sends cached/active stock meshes plus the cutter mesh as per-frame animation data, attaches toolpath polylines to the same Rhino plugin animation, and opens it in the Rhino Renderer panel. Use `--operation-json` for a saved operation, `--delete-all-animations` to clear old Rhino plugin animations, or `--help` for more options.

## Native OpenCAMLib drop-cutter backend

Parallel finishing uses the OpenCAMLib C++ drop-cutter core through a small pybind11 extension. Initialize the pinned source before building:

```bash
git submodule update --init
uv sync
```

The native build needs a C++ compiler, Boost headers, and the existing CGAL/GMP/MPFR dependencies. OpenCAMLib is LGPL-2.1; its license is included in `third_party/opencamlib/COPYING`.
