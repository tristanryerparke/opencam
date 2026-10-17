# Interactive Rhino test plan

All items below require a human-visible Rhino session. They are deliberately
aggregated here; no background watcher is required.

## One-time installation

1. Create the generated Rhino 8 Python project from the existing
   `rhino-python-plugin-template`, renamed to `OpenCamRhinoBridge`.
2. Copy `rhino_plugin/python/opencam_rhino` into its Python payload and add
   generated commands for `OpenCam`, `OpenCamSelectPart`, and
   `OpenCamSelectRegion`.
3. Add the TypeScript panel build output to the C# WebView host. The host must
   forward `window.chrome.webview.postMessage` JSON to
   `opencam_rhino.entry.handle_panel_message`, then execute
   `window.opencamRhino.receive(<response-json>)`.
4. Install development mode, restart Rhino, start Script Server, and start the
   backend: `uv run uvicorn src.server.main:app --port 9090`.

## Geometry probes

1. Open `assets/CAM_Demos.3dm`; run **OpenCam**.
2. Select a closed planar Brep face with an inner loop. Confirm the panel shows
   a part/stock box and one outer loop plus the face's islands.
3. Repeat using separately selected Brep edges that form the same outer loop.
   Confirm the loop joins, follows its face plane, and rejects an open chain.
4. Select a polysurface part. Confirm mesh counts are nonzero and stock bounds
   match Rhino's `BoundingBox` in document units. Confirm a mesh or a sub-face
   is rejected as the part selection.
5. Test a face not parallel to World XY. Selection must succeed and preserve
   its plane; generation must remain disabled/explicitly rejected until setup
   transforms are implemented.

## Backend and display probes

1. With a World-XY planar region and valid tool payload, generate a pocket and
   profile through `POST /cam/toolpath`. Compare records with the browser
   viewer for the same payload.
2. Verify a backend-offline error is shown in the panel without losing the
   prior persisted document state.
3. Add the Python conduit, then check redraw, hide/show panel, document close,
   Undo/Redo, and switching documents do not leave stale previews or handlers.
4. Probe the current simulation router with a Rhino-generated mesh and CL
   payload. Record the exact start/status/frame/compare responses before
   enabling the currently disabled panel controls.

## Acceptance before shipping

- Save/reopen a `.3dm`: selected IDs, setup, operations, and result references
  restore; backend geometry/results regenerate rather than being embedded.
- Rhino command buttons and panel buttons reach the identical Python actions.
- No Python 3.12+ dependency is imported in Rhino's CPython runtime.
- Run generation and simulation only from explicit UI commands, never from
  document event handlers or a background watcher.
