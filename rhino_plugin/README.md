# OpenCAM Rhino integration

This is the replacement architecture for the earlier C#-heavy prototype in
`csharp/OpenCamRhinoPlugin`.  Rhino owns selection, document persistence, and
preview display; the existing OpenCAM FastAPI server remains the sole owner of
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
All Rhino document mutation occurs on Rhino's UI thread. Backend calls run only
from user-invoked Python actions; there is no watcher or background document
mutation.

## Supported first vertical slice

- **Select part**: select one `Brep`/polysurface; mesh it for the backend and
  derive a world-axis stock bounding box from the Brep bounding box.
- **Select planar region**: select either a planar Brep face (outer loop plus
  inner loops) or multiple connected planar Brep edges/curves. The selection
  is normalized into closed coplanar loops in the setup machining plane.
- **Generate**: build a `POST /cam/toolpath` request using the same API schema
  as the web viewer. The operation payload remains panel-owned and is retained
  in document data.
- **Simulate / compare / post**: framework endpoints and display lifecycle are
  explicit; they intentionally remain disabled until their backend contracts
  are reconciled with the current simulation router.

## Persistence model

`OpenCamRhinoBridge` stores one JSON envelope per Rhino document. It contains
schema version, backend URL, selected object IDs, normalized region geometry,
setup/operation JSON, and only lightweight result references. Toolpaths and
simulation meshes are reproducible backend artifacts and are **not** embedded
in `.3dm` files.

## Development layout

- `python/opencam_rhino/`: CPython 3 code that runs inside Rhino.
- `commands/`: generated-command entrypoints; each calls the same action used
  by the panel.
- `web/`: TypeScript panel source. It talks only through the C# message bridge.
- `tests/`: host-independent contract tests. Rhino integration probes live in
  `tests/rhino/` once installed.

## Implementation order

1. Install the Python-project C# shim and load the panel.
2. Interactive-test part and face/edge-loop selection against real `.3dm`
   geometry, then lock down the selected-object and meshing semantics.
3. Wire panel operation editing to validated `POST /cam/toolpath` requests.
4. ~~Add a Python display conduit for generated CL data.~~ Implemented in
   `python/opencam_rhino/display.py` + `runtime.py` (shared conduit, keyed by
   document runtime serial; verified in a live Rhino probe). Interactive
   viewport verification remains.
5. Reconcile simulation/compare request and frame-display contracts with the
   current backend, then enable those controls.
6. Add post-processing download/open behavior and document migration tests.

See `INTERACTIVE_TEST_PLAN.md` for all user-required steps grouped at the end.
