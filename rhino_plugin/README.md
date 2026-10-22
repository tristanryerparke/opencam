# OpenCAM Rhino integration

This is the current Rhino integration architecture. Rhino owns selection,
document persistence, and preview display; the existing OpenCAM FastAPI server
remains the sole owner of
CAM generation, simulation, comparison, tool library, and post-processing.

## Architecture

```text
TypeScript WebView panel
  <-> small C# host (panel registration, WebView messages, Python launcher)
  <-> Rhino 8 CPython package (`python/opencam_rhino`)
       - Rhino getters / object IDs / conduits / document JSON
       - serializes OpenCAM API requests, never reimplements CAM
  <-> OpenCAM backend at http://127.0.0.1:9090
```

The panel uses a versioned JSON message contract (`contracts.py`). C# forwards
messages to Python and posts the resulting state/event JSON back to the panel.
All Rhino document mutation occurs on Rhino's UI thread. User-invoked toolpath
HTTP work runs in a document-scoped worker while the panel polls status; only
completed results return to the UI thread. There is no background document
mutation.

## Supported first vertical slice

- **Select part**: select one `Brep`/polysurface; mesh it for the backend and
  derive a world-axis stock bounding box from the Brep bounding box.
- **Select planar regions**: select one or more planar Brep faces or multiple
  closed Brep edge/curve chains in one Rhino picker. Face inner loops remain
  islands; each independently joined edge loop becomes separate drive geometry.
- **Generate**: launch `POST /cam/toolpath` without blocking Rhino, show the
  operation's green generation spinner, then commit its preview on the UI
  thread. Operation payload remains panel-owned and retained in document data.
- **Simulate**: regenerate simulation data with each toolpath, then open a
  dedicated panel view with stock-removal meshes, moving tool, full playback
  controls, frame stride, timeline scrubbing, and explicit exit.
- **Post Process**: send the selected operation's generated CL records to the
  default Duet 3D backend post and save returned `.nc` bytes through a native
  Eto save dialog.

## Persistence model

`OpenCamRhinoBridge` stores one JSON envelope per Rhino document. It contains
schema version, backend URL, selected object IDs, normalized region geometry,
setup/operation JSON, visibility, selected operation, compact toolpath preview
geometry, and full generated cutter-location records for every valid operation.
Simulation meshes remain transient reproducible backend artifacts and are not
embedded in `.3dm` files.

## Development layout

- `python/opencam_rhino/`: CPython 3 code that runs inside Rhino.
- `commands/`: generated-command entrypoints; each calls the same action used
  by the panel.
- `web/`: TypeScript panel source. It talks only through the C# message bridge.
- `bridge/`: installable `OpenCamRhinoBridge` RhinoCode/C# WebView host.
- `tests/`: host-independent contract tests and Rhino integration probes.

## Implementation order

1. Build/install `bridge/` and load `OpenCam`.
2. Interactive-test part and face/edge-loop selection against real `.3dm`
   geometry, then lock down selected-object and meshing semantics.
3. Interactive-test generation, simulation-view playback, post output,
   visibility, and two-document isolation.
4. Add document migration tests.

See `INTERACTIVE_TEST_PLAN.md` for all user-required steps grouped at the end.
