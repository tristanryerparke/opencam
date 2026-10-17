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

## Panel UI checks (after the C# WebView host is installed)

1. Operation tree: ＋ Setup / ＋ Operation (dialog with per-type fields),
   per-row ▶ Generate and ✕ Delete, click-to-select highlighting.
2. Visibility toggles Stock / Part / Toolpath / Tool hide exactly their layers
   without dropping cached simulation meshes; re-enabling restores instantly.
3. Simulate → polling status → transport ◀ ▶/⏸ ▶|, timeline scrubbing, and
   0.25–4× speed playback stepping frames with the tool mesh following.
4. Compare (vertex-colored mesh) and Final stock render in shaded viewport
   modes; toggling Part off is useful to see them without occlusion.
5. Debug panel: backend URL Set applies without restart; event log shows
   request results and errors truncated.

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
3. The Python toolpath conduit now exists (`opencam_rhino.display`/
   `runtime.py`). Verify interactively: a generated preview draws over the
   viewport in rapid/linking/cutting colors; redraw, hide/show panel, document
   close, Undo/Redo, and switching documents leave no stale previews or
   handlers. Critically, generate in one document, switch to a second open
   document, and confirm no preview draws there; return and confirm the first
   document still shows its own preview.
4. ~~Probe the current simulation router~~ Done: the host integration test in
   `tests/test_simulation_meshes.py` drives the real app end to end, and a
   live Rhino probe confirmed the mesh layers (rest/active/tool/comparison)
   draw document-keyed and clear cleanly. Remaining interactive checks:
   run Simulate from the panel against the real backend and watch the frame
   stepping, Compare vertex colors, and Final stock rendering in shaded mode;
   confirm mesh previews do not appear in another open document.

## Acceptance before shipping

- Save/reopen a `.3dm`: selected IDs, setup, operations, and result references
  restore; backend geometry/results regenerate rather than being embedded.
- Rhino command buttons and panel buttons reach the identical Python actions.
- No Python 3.12+ dependency is imported in Rhino's CPython runtime.
- Run generation and simulation only from explicit UI commands, never from
  document event handlers or a background watcher.
