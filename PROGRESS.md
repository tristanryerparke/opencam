# Progress

## Development workflow

- User authorizes replacement of development `OpenCamRhinoBridge.rhp` whenever required by OpenCAM changes; rebuild/install without asking. State when Rhino restart is required.

## Shared schema-driven operation editor

- [x] Audit the Pydantic operation-schema pipeline and identify Rhino contract gaps.
- [x] Move the frontend schema-driven operation editor body into `frontend/opencam-ui`.
- [x] Replace the Rhino editor’s hand-authored fields/defaults with a thin host shim over the shared editor.
- [x] Keep the browser dialog as a thin wrapper over the shared editor and validate both frontend builds.

The Pydantic operation models already generate the JSON Schema used by the browser editor. The shared UI package now owns schema traversal/validation and the operation-editor component; generation also writes the Pydantic schema bundle directly there. The browser is a tool-loading wrapper, while Rhino maps its persisted `OperationSpec`/live `PlanarRegion` bridge contract into and out of the same Pydantic-shaped draft before rendering the shared editor.

Layout fix: Rhino bundles no compiled Tailwind utilities, so layout-critical sizing in the shared editor (fixed 80vh dialog body, grid rows, flex/overflow interior) and the Rhino operation picker now use inline styles; both hosts get a fixed-height editing area and a 2-column, scrollable picker.

Rhino stale-bundle fix: `reload-development-mac.sh` still built from the deleted `rhino_plugin/web`; it now builds `frontend/rhino_frontend` and installs that dist. Rebuilt and reinstalled the development bundle.

Rhino operation creation fix: Bun resolved the file-based shared package from `frontend/opencam-ui` and bundled its package-local React alongside the Rhino app's React, causing the shared editor to throw `Invalid hook call` before it could return a draft. The Rhino bundle script now symlinks React/ReactDOM in both source packages to the Rhino app's instances before bundling. The shared schema clone also no longer relies on unsupported `structuredClone`. Browser-level smoke checks now render both the shared editor and a panel state containing `Rough Pocket`; both frontend builds and `git diff --check` pass.

## Frontend setup operation reordering

- [x] Add a drag handle to reorder operations within a setup.
- [x] Validate the frontend build.

Setup operation rows now have a grip handle. Dragging a grip reorders only sibling operations in `Setup 1`; the resulting sequence is persisted in frontend state and is used by setup regeneration and post-processing. `cd frontend && bun run build` and `git diff --check` pass.

## CAM tree guide-line cleanup

- [x] Remove the guide line that overlaps operation drag handles.
- [x] Validate the frontend build.

The CAM tree now suppresses generic parent guide lines, leaving the operation drag grips unobstructed. `cd frontend && bun run build` and `git diff --check` pass.

## CAM tree operation indentation

- [x] Reduce operation-row indentation from 16 px to 8 px.
- [x] Validate the frontend build.

Operation rows now indent by 8 px per tree depth. `cd frontend && bun run build` and `git diff --check` pass.

## Rhino panel setup operation reordering

- [x] Add 8 px-indented drag handles to reorder operations within the setup.
- [x] Persist the reordered operation sequence in Rhino document state.
- [x] Validate the Rhino WebView build and focused plug-in checks.

The Rhino panel now uses native drag-and-drop from a six-dot grip beside each operation. Drops reorder only within the target setup; the bridge validates that every operation ID appears exactly once, then persists `setup.operations`, which already controls regeneration and post-processing order. Validation: `cd rhino_plugin/web && bun run build`, `uv run pytest rhino_plugin/tests/test_contracts.py` (4 passed), Python compile, and `git diff --check` pass. The development `OpenCamRhinoBridge.rhp` was then rebuilt and installed; its installed `web/dist/index.html` contains the grip styling, 8 px indentation, and reorder bridge action. Rhino restart is required to load the installed panel assets.

## React migration for Rhino WebViews

- [ ] Add minimal React/ReactDOM runtime and JSX build support to the Rhino WebView package.
- [ ] Port the docked OpenCAM panel to React and reusable `t-components` React controls.
- [ ] Port the blocking operation editor to React and reusable `t-components` React controls.
- [ ] Preserve panel/operation-dialog bridge protocols and behaviors.
- [ ] Validate, rebuild, and install the development Rhino bridge.

## 2.5D facing operation

- [x] Create and switch to branch `adding-facing`.
- [x] Audit pocketing, profiling, level generation, schemas, engine dispatch, and UI operation registration.
- [x] Add facing schema with rectangular area, edge/corner overtravel, stepover, levels, climb/conventional/mixed direction, and a 0–180° pass angle.
- [x] Add facing path generation with complete face coverage and safe linking/retract behavior.
- [x] Wire facing into backend dispatch and operation UI.
- [x] Validate formatting, type checks, and maintained tests (118 backend/Rhino tests pass; direct output checks pass at 0°, 45°, and 90° with two Z levels and one-way retracts; frontend and Rhino WebView production builds pass).

- [x] Merge `test-parallel-finishing` into `main`.
- [x] Switch working tree to `main` and verify status.
- [x] Create and switch to `post-processor-beginnings` from `main`.
- [x] Audit cutter-location, tool-library, and backend integration points.
- [x] Research Duet 3D G-code requirements.
- [x] Add machine-definition schema and Duet 3D post-processor baseline.
- [x] Validate implementation and document remaining integration needs.

## Post-processing follow-up

- [ ] Persist machine definitions and expose machine CRUD endpoints.
- [ ] Define setup/work-coordinate transforms and machine-safe retract behavior.
- [ ] Add explicit CL events for operation identity, coolant, dwell, and tool-change policy.
- [ ] Add Duet configuration validation for `M563` and tool macros.
- [ ] Connect frontend program export and optional Duet upload workflow.
- [x] Move all Duet 3D-specific models and implementation into `post_processing/duet3d/`.
- [x] Remove abstract post-processor base and keep implementation as simple concrete classes.
- [x] Remove spindle direction configuration and assume clockwise operation.
- [x] Move machine validation from Pydantic model methods into Duet post-processing.
- [x] Reset branch commits to `main` while preserving changes as working-tree diff.
- [x] Flatten Duet machine/controller settings and assume implicit spindle plus `G54`.
- [x] Remove configurable `M453` and `G94` emission.
- [x] Add demo script turning saved CL-data JSON into Duet 3D G-code.
- [x] Add shared G-code emitter with axis culling, prefix culling, and `fg` formatting.
- [x] Add backend route returning an `.nc` download for stored CL data.
- [x] Add frontend right-click "Post Process" on operation/setup tree items to download the `.nc`.

## Adaptive 2.5D pocketing

- [x] Added selectable OpenVoronoi-inspired adaptive clearing alongside offset, with climb/conventional direction, native arc CL, and safe keep-down links.
- [x] Improved MIC traversal, scoop ordering/pruning, tangent border leads, local caps, and residual-driven wall finishing; avoids full-rim cleanup when proof permits.
- [x] Enforced cutter-center bounds, stepover, coverage, cut direction, and link safety before CL emission; unsafe geometry fails closed or uses safe local fallback.
- [x] Validated A/B/C1/C2/D at 25/30/50% stepover, both directions, plus logged replays; 102 maintained tests, focused Ruff, and diff checks pass.
- [x] Cached reachability and pruning sweeps; reported generation profile fell 7.504s → 3.921s with byte-identical output.
- [ ] Deferred root-spiral lap: compare full-root and rootless plans for `dea8f882`; accept rootless only with complete safety/coverage proofs.
- [ ] Add branch-local offset-derived fallback for future geometries unreachable by bounded MIC fronts.
- [ ] Classify keep-down links crossing uncut stock as cutting transitions; preserve valid links and enable future rapid-only non-cutting links.

### Restart-safe regeneration cache

- [x] Persist one backend STEP and converted mesh as a single replaceable cache entry across backend restarts.
- [x] Stop saving new STEP files in browser storage; restore mesh metadata from backend on page load.
- [x] Preserve browser operation/setup-generation inputs on refresh without overwriting saved operations during hydration.
- [x] Validate cache replacement, restart, regeneration inputs, maintained tests, and frontend build.

Backend uses atomic `mesh-cache/current.zip` replacement, stable cache ID on restart, version-checked mesh URLs, and disk deletion on explicit part removal. Existing browser STEP is migrated only when backend has no cached part; new uploads never enter browser storage. Browser keeps operation JSON and settings, not generated CL, frames, or simulation meshes. Maintained tests: 98 pass; frontend TypeScript/build pass. Full ESLint reports three pre-existing errors in unrelated components; App.tsx alone has zero errors and nine existing warnings.

## RhinoCAM offset-pocket comparison

- [x] Commit current adaptive-pocketing work, merge it into `main`, and create `rhcam-comparison`.
- [x] Make offset-pocket loop winding honor OpenCAM `cut_direction`.
- [x] Generate 25%-stepover offset-pocket G-code for every drive curve with OpenCAM.
- [x] Copy curves into remote Rhino document; generate matching plunge-entry RhinoCAM pockets.
- [x] Store both output sets under `rhcam-experiment/`; compare points and motion behavior.
- [x] Render and report algorithm differences and unresolved CAM-setting gaps.

Zero depth regenerates only after setting rough depth, rough depth per cut, and finish depth to zero. Crash diagnosis after clean-document retry: cleanup deleted the only MOp setup, then the operation script called `Create2AxPocketingMOp()` without recreating and activating a setup. Earlier successful zero-depth probe still had an active setup. RhinoCAM's native API terminated Rhino instead of returning a Python error; no Rhino crash dump or result sentinel was produced. Fixed by creating and explicitly activating fresh `RhinoCAM Comparison` setup before any MOp; operation A then regenerated successfully. A second crash came from hard-coding the post directory as `C:\\users\\...`; the proven `winepath.exe -w` path (`Z:\\Users\\...`) posts all six operations reliably. On every Windows Rhino restart, dismiss RhinoCAM's blocked-internet dialog before starting Script Server, then verify server with a ping script.

RhinoCAM defaults (`0.635 mm` stock, `0.1 mm` tolerance) were detected and excluded; final operations explicitly use `0 mm` stock and `0.01 mm` tolerance. OpenCAM offset entry was also corrected from rapid descent to configured feed plunge. Final matched comparison: core centerlines and swept coverage nearly coincide; OpenCAM traverses inner-to-outer and keeps B/D continuous, while RhinoCAM traverses outer-to-inner, uses more fitted arcs, and splits B/D into extra plunge groups. Artifacts and full metrics are in `rhcam-experiment/README.md`; 102 maintained tests, focused Ruff, diff check, and frontend build pass. Root-level pytest still collects two stale `old-demos/` files whose removed `opencam.services.mesh` imports fail before maintained tests run.

### RhinoCAM inner-to-outer rerun

- [x] Identify and verify documented RhinoCAM traversal setting.
- [ ] Update all six existing MOps to inner-to-outer, regenerate, and re-post.
- [x] Regenerate OpenCAM with keep-tool-down disabled.
- [x] Preserve prior NC files; retrieve rerun outputs separately.
- [ ] Rebuild metrics, images, and findings against matched traversal/linking settings.

RhinoCAM manual documents `SetPocketOffsetType(PocketOffsetType.CONTOUR_START_INSIDE)`, but the installed `MecSoftCAM.Objects.Cut2AxPocketingMOp` does not expose `SetPocketOffsetType` or `GetPocketOffsetType`. Both Python `dir(mop)` and .NET reflection confirm only spatial `SetStartPoint(ContourStartPointType)` is available. No Rhino MOp changed during the failed setter call; prior outputs were restored. OpenCAM rerun now has `keep_tool_down=false`, with prior keep-down files preserved under `rhcam-experiment/opencam/inner-to-outer-keep-tool-down/`. Rhino inner-to-outer requires manual UI configuration or an updated RhinoCAM API binding before matched rerun can finish.

### Combined C pocket operation

- [x] Generate one OpenCAM C operation containing both C drive curves.
- [x] Replace RhinoCAM C_1/C_2 MOps with one C MOp using both control GUIDs.
- [x] Update comparison analysis and graphics to treat C as one multi-curve operation.
- [x] Add combined-drive-geometry coverage to maintained pocketing tests.

Combined C now uses two drive geometries in one OpenCAM operation and two selected control GUIDs in one RhinoCAM MOp. Both outputs produce 106 XY cut points, two cutting groups, two plunges, and 2343.8 mm cutting length. OpenCAM inter-pocket rapid is 24.1 mm versus RhinoCAM 48.9 mm due to different seam/start choices. With OpenCAM keep-tool-down disabled, aggregate path groups, plunges, and retracts now match RhinoCAM exactly; updated plots and metrics are under `rhcam-experiment/`.

### Keep-down link stock engagement

Keep-down links now compare cutter sweeps with material removed by prior paths. Links entering uncut stock emit cutting motion role; already-cleared links retain linking role for a future rapid-only policy. Offset B regression uses 1/4-inch tool and B drive curve; adaptive regression verifies both roles. Maintained suite: 104 passed.

## Facing branch integration

- [x] Merge `origin/adding-facing` into `rhino-integration`.
- [x] Resolve schema/frontend conflicts while preserving Rhino integration changes.
- [x] Extend Rhino operation support for facing where required.
- [x] Run backend, frontend, and Rhino integration checks.

Merge commit `d46e433` brings configurable rectangular facing into the backend and browser UI. Rhino now creates/edits `facing_2d` operations, serializes rectangle geometry and all facing cut controls, and generates the payload successfully through the real FastAPI route. Maintained suite: 118 passed. Frontend and Rhino WebView builds pass; development plug-in rebuilt, installed, and reload dispatched. Rhino restart required to load the replaced C# assembly and show the facing dialog title.

## Live simulation speed control

- [x] Stop frame-response renders from replacing playback controls while running.
- [x] Keep frame label/timeline synchronized without rebuilding speed selector.
- [x] Validate WebView build and reload development plug-in.

Playback frame responses now update only frame label and timeline value while running. Speed selector DOM remains stable, so changing speed restarts playback timer immediately without dropdown replacement. WebView TypeScript/build passed and development reload dispatched.

## Bottom geometry defaults and multi-loop Rhino selection

- [x] Make Rhino defaults match core `at_bottom` level semantics for every operation.
- [x] Return every selected closed planar edge loop as operation-local drive geometry.
- [x] Update dialog/action handling for multi-region picker results.
- [x] Validate payloads, WebView build, and development reload.

Core `CAMLevels` already defaulted to `at_bottom`; Rhino operation defaults/editor now match for pocketing, profiling, and parallel finishing. One picker selection may return multiple faces or disconnected joined edge loops; dialog appends each as its own region. Rhino plug-in tests: 13 passed. WebView build, focused selection Ruff, multi-loop smoke check, and development reload passed/dispatched.

## Profiling default side

- [x] Make Rhino profiling default side `outside` in payload and operation editor.
- [x] Validate default-side payload and rebuild/reload Rhino panel.

Core Pydantic schema already defaulted profiling to `outside`; Rhino payload defaults and operation-dialog draft now match it. Rhino plug-in tests: 13 passed. WebView build passed and development reload dispatched.

## Rhino World-XY face orientation fix

- [x] Accept both +Z and -Z plane normals as parallel to World XY.
- [x] Prevent failed unsaved operation drafts from leaking into panel state.
- [x] Validate profiling payload and Rhino plug-in checks; reload development plug-in.

World-XY validation now accepts unit normals in either Z direction, covering Rhino faces whose parameterization reports `-Z`. Failed actions reload persisted document state before replying, so unsaved draft rows cannot trigger follow-on missing-operation errors. Rhino plug-in tests: 13 passed. WebView build and development reload passed/dispatched.

## Non-blocking Rhino toolpath generation

- [x] Move generate/regenerate backend HTTP work off Rhino UI thread.
- [x] Poll document-scoped generation tasks and commit completed paths on UI thread.
- [x] Show frontend-style green spinner on operation being generated.
- [x] Handle completion, failure, document close, and panel reload without stale tasks.
- [x] Validate tests/build and reload development plug-in.

Generate/regenerate now starts one daemon worker per document for `POST /cam/toolpath`; 500 ms panel polls commit completed previews on Rhino's UI thread. Operation rows show frontend-matched green loader, and generation controls disable until completion. Rhino plug-in tests: 13 passed. WebView TypeScript/build, Python compile, focused runtime Ruff, diff check, and async-task smoke check passed. Development reload dispatched to running Rhino.

## Rhino tool-only simulation

- [x] Stop loading and drawing rest, active-cut, final-stock, and comparison simulation meshes.
- [x] Keep simulation playback moving only tool mesh through backend frame positions.
- [x] Remove Rhino comparison/final-stock controls and action paths.
- [x] Validate Rhino plug-in tests and WebView build; reload development plug-in.

Rhino now fetches only backend tool mesh after simulation completes; frame stepping translates that mesh through returned tool positions while stock and part remain unchanged. Rhino plug-in tests: 13 passed. WebView TypeScript/build, Python compile, focused Ruff, diff check, and tool-only frame smoke check passed. Development reload dispatched to running Rhino.

## Rhino document persistence and selected toolpaths

- [x] Persist compact generated toolpath previews per operation in `.3dm` plug-in data.
- [x] Restore stock, visibility, and selected-operation preview when documents open.
- [x] Show only selected operation's toolpath; clear stale/deleted previews.
- [x] Invalidate persisted and runtime toolpaths when generation inputs change.
- [x] Build and run maintained Rhino plug-in checks.

Schema v5 stores generation-hashed preview segments, not full CL records. Open/startup rebuilds stock, visibility, and selected preview; selection swaps one document-scoped conduit path. Rhino plug-in tests: 13 passed. WebView TypeScript/build passed. Development reload dispatched to running Rhino.

## Rhino integration

- [x] Inspect existing pocketing APIs, demo conventions, and toolpath display colors.
- [x] Add Rhino Python 3 demo script with sticky curve selection, Duet G-code export, and persistent conduit.
- [x] Validate script syntax and generated output path assumptions.

## Rhino WebView bridge and manual testing

- [x] Create installable `OpenCamRhinoBridge` from Python-plugin template.
- [x] Host TypeScript panel in Eto WebView and bridge JSON to Python actions.
- [x] Build/install development bundle at `~/Library/Application Support/McNeel/Rhinoceros/8.0/MacPlugIns/OpenCamRhinoBridge.rhp`.
- [ ] Restart Rhino and manually test panel in Rhino 8.
- [x] Replace failed native Eto operation controls with blocking TypeScript WebView dialogs; temporarily close for geometry selection.
- [x] Restore frontend-style operation Simulate/Compare context actions; show simulation transport only during active simulation.
- [x] Remove Rhino-only Clear preview control to match frontend operation workflow.
- [x] Keep operation left-click selection-only; open settings only from context-menu Edit.
- [x] Make Part visibility toggle hide/show selected source polysurface, not conduit mesh.
- [x] Add frontend-style operation context menu and paginated operation-options dialog.
- [x] Fix CPython `Curve.TryGetPolyline` selection conversion for polyline regions.
- [x] Add Tack-style development reload for OpenCAM Python and WebView panel without Rhino restart.
- [x] Couple region selection to operation editing; hide simulation, comparison, debug, and top-level region controls; mirror frontend operation flow.
- [x] Preload one `Setup 1` machining setup; remove setup-add control.
- [x] Route OpenCAM panel-action errors to Rhino command history; never render errors in panel.
- [x] Serve one self-contained panel page, support macOS `window.eto`, and apply Rhino theme/font tokens.
- [x] Bundle React-free `t-components/dom` controls and matching Tailwind styles into self-contained Rhino panel and operation-dialog pages.
- [x] Add frontend operation-picker graphics to Rhino blocking WebView picker.
- [x] Lay out operation choices in columns without picker scrolling.
- [x] Match Rhino operation-picker and operation-settings dialog styling to frontend.
- [x] Preserve frontend SVG stroke colors and resize operation dialog by current content mode.
- [x] Fix operation-picker resize message reaching Python as an invalid dialog response.
- [x] Remove OpenCAM title and Ready status from Rhino panel.
- [x] Apply Rhino light/dark theme tokens to blocking operation dialog.
- [x] Remove operation-dialog outer chrome, fix sidebar tab sizing, and disable resizing.
- [x] Size editor dialog for fields and eliminate horizontal overflow bounce.
- [x] Restore frontend dialog interior padding and move operation title to native window bar.
- [x] Add Tailwind preflight to Rhino WebViews so DOM primitives match frontend layout resets.
- [x] Put injected Tailwind preflight in base layer so component border utilities retain precedence.
- [x] Reduce picker and editor native client sizes by 80 px in each dimension.
- [x] Reduce editor height by 100 px and make editor content fill native window height.
- [x] Constrain panel operation context menu and map its DOM component colors to Rhino theme.
- [x] Match Rhino panel setup/operation tree visual hierarchy to frontend tree components.
- [x] Load Rhino operation-dialog tools from backend tool library like frontend.
- [x] Render all Rhino toolpath lines at 1 px and endpoint dots at 3 px.
- [x] Match operation context-menu item gap to its edge padding.
- [x] Disable native browser context menus in OpenCAM panel and operation WebViews.
- [x] Tessellate non-polyline face loops with Rhino 8's supported four-argument `Curve.ToPolyline` overload.
- [x] Support multiple operation-local planar regions: persisted contract migration, dialog add/delete rows, and multi-loop backend payloads.
- [x] Classify camelCase backend motion fields in Rhino toolpath preview so travel/linking colors match frontend.
- [x] Tessellate backend arc records in the Rhino toolpath preview conduit.
- [x] Prune degenerate offset-collapse slivers that caused a pointless opening plunge in offset pocketing.
- [x] Apply frontend base border token after WebView preflight for outline operation cards.
- [x] Add selected geometry table to Rhino operation editor.
- [x] Use frontend global theme tokens in operation dialog; use Rhino only for light/dark mode.
- [x] Align Rhino operation-editor section order and coverage with frontend operation schema.
- [x] Add frontend-sized React-free checkbox primitive for Rhino operation dialog.
### Terminal-driven Rhino demo

- [x] Inspect Tack run-in-rhino test configuration and Rhino execution conventions.
- [x] Add editable local `run-in-rhino` dependency for its `rhino-watch` CLI.
- [x] Adapt the Rhino pocketing demo to run OpenCAM locally while run-in-rhino selects geometry and refreshes the conduit.
- [ ] Run the terminal integration path and verify Rhino-visible output.

## Simulation playback sync and failure handling

- [x] Make tool and completed toolpath follow simulation playhead during mesh loading.
- [x] Surface mesh-load failures and stop playback instead of silently stalling.
- [x] Validate frontend TypeScript build and focused lint.

## Timeline slider hit target

- [x] Expand animation timeline slider vertical pointer target without changing visual track or stride slider.
- [x] Validate focused frontend lint.

## Facing raster artifacts

- [x] Normalize lane orientation before mixed-direction alternation.
- [x] Remove tangent-only edge lanes and uneven remainder spacing.
- [x] Validate axis-aligned and angled facing paths against the reported run.
- [x] Run maintained tests and reload the development plug-in if required.

Shapely returned the first boundary intersection opposite to subsequent lanes, so index-based alternation produced a 106.027 mm diagonal crossover. Lane generation also appended a 0.4 mm final remainder after 2.4 mm steps and placed exact tangent lanes on the buffered boundary. Facing now canonicalizes local lane endpoints and centers evenly distributed lanes within the coverage span. The reported run regenerates as 45 lanes at uniform 2.355556 mm spacing with short same-side links. Maintained suite: 118 passed; focused Ruff, compile, diff, 0°/45°/90° geometry checks, and the live auto-reloaded backend route pass. No Rhino plug-in reload required for this backend-only change.

## Rhino Duet 3D post-processing

- [x] Inspect backend post contract and Rhino save-dialog conventions.
- [x] Enable selected-operation post processing through the Duet 3D backend route.
- [x] Show a native save dialog and write returned `.nc` bytes only after user confirmation.
- [x] Expose Post Process in the Rhino operation context menu.
- [x] Validate backend/Rhino checks, build WebView, and reload development plug-in.

Generated operation context menus now expose **Post Process** when CL data exists. Rhino confirms an output path through `Eto.Forms.SaveFileDialog`, posts the selected CL record to `/cam/post-process/duet3d/nc`, and writes returned bytes only after confirmation. Operation generation now retains backend tool-library IDs for strict configurable post requests; newly opened editors select the existing matching tool or the first library tool. Live end-to-end smoke check emitted valid Duet G-code, 118 maintained tests pass, WebView build and focused checks pass, and development reload was dispatched. No Rhino restart required.

## Stored-CL Duet tool resolution

- [x] Make default `.nc` export trust the tool snapshot embedded in generated CL data.
- [x] Keep strict current-library validation for configurable Duet post requests.
- [x] Remove Rhino-side current-library identity gate.
- [x] Reproduce the reported missing-tool export and validate maintained checks.

Default `.nc` export now treats generated CL as the immutable source of its tool snapshot instead of requiring that tool to remain in the mutable current library. The configurable Duet endpoint still resolves and validates tools against the current library. The exact failed toolpath (`26148ed5-…`, tool `01c71da6-…`) now emits 6,880 bytes of Duet G-code from 255 records. Maintained suite: 118 passed; focused Ruff, compile, and diff checks pass. Backend auto-reloaded; Rhino source reload found no running RhinoCode pipe, so the next OpenCAM load will import the action update.

## Rhino context-menu dismissal

- [x] Close operation context menu for clicks elsewhere in the panel.
- [x] Close operation context menu when the WebView loses focus to Rhino or another app.
- [x] Build and reload the development WebView.

Operation context-menu state now clears through one shared dismissal path for panel clicks and browser-window blur. Clicking a Rhino viewport, another panel, or another application removes the menu when the OpenCAM WebView loses focus. TypeScript/build passed and development reload was dispatched without restart.

- [x] Capture all panel pointer events so controls that stop bubbling also dismiss the menu.
- [x] Stop full re-renders from clearing an open context menu.
- [x] Make the operation picker window 100 px taller (220→320).
- [x] Parent the operation dialog to the active document window so it no longer floats over other applications; add another 50 px picker height (320→370).

Panel dismissal now listens during pointer-event capture and ignores only clicks inside the open menu. Setup toggles and other controls that stop event bubbling therefore close the menu before handling their own action. WebView build passed and development reload was dispatched.

## Rhino simulation playback parity

- [x] Auto-start matching `/simulate` work whenever a toolpath generation completes.
- [x] Move playback to a dedicated panel page with skip/step/play/exit, timeline, progress, and stride control.
- [x] Make playback cadence 30 ms with stride options 1/2/4/8/16, like the browser frontend.
- [x] Gate each playback tick on the previous `show_frame` reply to prevent message pile-up.
- [x] Add backend `include_stock_data` field; Rhino sends `false` to skip final-stock and comparison artifacts while receiving browser-identical chunk, active-cut, tool, and frame data.
- [x] Validate contracts end to end and rebuild the panel.

`POST /simulate` now accepts `include_stock_data` (default true). When false, the backend skips the final-mesh export and the background comparison build but keeps `toolMeshUrl`, chunk cached meshes, active-cut frame meshes, and per-frame `toolPosition` exactly as the TypeScript frontend receives them; `finalMeshUrl` is returned empty. Rhino sessions track operation and generation hash so regeneration restarts matching simulation data and repeated Simulate reuses it. Playback strides source frames like the browser, runs at 30 ms, and each tick waits for the previous frame reply. Live smoke: stock-less request completed with 175 frames, empty `finalMeshUrl`, and fetchable tool/cached meshes. Maintained suite: 119 passed (new `include_stock_data=false` contract test); focused Ruff, compile, diff, and WebView builds pass. Development reload had no running RhinoCode pipe (Rhino closed); next Rhino start loads the new panel and actions.

## Rhino document dirty flag

- [x] Require successful plugin-data persistence before returning from `state.save`.
- [x] Explicitly set `RhinoDoc.Modified` after every persisted OpenCAM state change.
- [x] Validate Rhino plug-in tests and reload development Python source.

Regeneration completion persists full CL, compact preview, and operation state, then explicitly marks its owning Rhino document modified. This forces Rhino's unsaved-edit indicator and normal save prompt even if its plugin-data write did not update visible dirty state. Rhino plug-in tests: 14 passed; compile/diff and focused Ruff pass; development reload dispatched.

## Rhino source-object tracking

- [x] Persist associated Rhino object GUIDs on each CAM operation.
- [x] Store referencing operation IDs in source-object `Attributes.UserDictionary` metadata.
- [x] Rebuild document-scoped runtime tracking when documents open.
- [x] Invalidate affected toolpaths and simulations after changed/deleted geometry at `EndCommand`.
- [x] Show invalid operations with a red status dot until successful regeneration.
- [x] Validate pure checks and build/reload development plug-in.
- [x] Run a focused Rhino interaction test for metadata, native dirty state, invalidation, and regeneration.

Schema v7 stores canonical part/drive-object GUIDs on each operation. Associated Rhino objects store `OpenCAM.OperationRefs` JSON in `Attributes.UserDictionary`; each successful generation writes a fresh metadata revision through `RhinoDoc.Objects.ModifyAttributes` inside one undo record, producing a real object-table edit on macOS. Runtime tracking is rebuilt from operation GUIDs without scanning the document. `EndCommand` compares object runtime serials, invalidates affected CL/previews/simulation, and reloads the panel with a red status dot until generation succeeds. Pure metadata lifecycle smoke checks, 14 Rhino plug-in tests, 119 maintained tests, compile, focused Ruff, diff check, and WebView build pass. Development source/panel reload dispatched.

Focused Rhino interaction tests on `CAM_Demos_duplicate2.3dm` (two operations, saved clean): baseline read confirmed bidirectional metadata on part and both drive objects with the `EndCommand` handler subscribed; a scripted 0.01 mm move of one tracked curve invalidated exactly the owning operation and dropped its CL/preview/summary; a scripted metadata-only regeneration write preserved operation IDs, changed the revision, and produced the native macOS unsaved-document indicator (`RhinoDoc.Modified` stays false, as McNeel documents); a move-out/move-back/regeneration cycle kept the red-dot invalid state until generation completed, then restored toolpath/preview/summary, changed the metadata revision, and preserved source IDs. Geometry and OpenCAM plugin data were restored between tests; the final regenerated state is equivalent to the saved baseline.

### Tack-style command reconciliation and panel refresh

- [x] Reconcile operation references from tracked/recent object metadata after every `EndCommand`.
- [x] Retain recently associated object GUIDs for native Undo/Redo recovery.
- [x] Push fresh panel state directly to open WebViews instead of reloading pages.
- [x] Validate pure checks and WebView/C# builds.
- [x] Rebuild/install development plug-in and report restart requirement.
- [ ] Run focused Rhino interaction test after approval and restart.

OpenCAM now follows Tack's lifecycle shape: document restore scans object metadata once, active and recently associated objects are reconciled after every `EndCommand`, runtime serial changes invalidate owning operations, and recently removed objects remain observable for 200 commands so native Undo/Redo can restore tracking. Open WebViews receive fresh state directly through `PluginBridge.PostPanelMessage`; no page reload is needed to render invalid-operation dots. Tack-style metadata removal/restoration and serial-change smoke checks pass, along with 119 maintained tests, focused Ruff, compile, diff check, WebView build, and a clean C# build/install. Rhino restart required to load the replaced bridge assembly before interaction testing.

## Rhino mesh-free simulation mode

- [x] Make `include_stock_data=false` skip swept-stock Boolean and stock-mesh generation while retaining tool animation frames.
- [x] Keep the regular frontend's default `/simulate` behavior unchanged.
- [x] Prevent the Rhino client from requesting cached or active stock meshes in mesh-free mode.
- [x] Validate backend and Rhino plug-in checks, then rebuild/reload the development plug-in.

The Rhino client now posts `/simulate` with `include_stock_data=false` and no stock mesh. The backend takes a tool-animation-only path that samples generated CL records, maps them back to CL indices, and builds only the moving tool asset; it does not load stock, run swept-volume Booleans, simplify stock meshes, or expose cached/active/final stock URLs. Calls without the flag retain the browser's full stock simulation behavior. Rhino clears stock-simulation conduit layers and never requests empty mesh URLs. Validation: 119 maintained tests passed, focused Ruff and Python compile passed, the WebView build passed, and the development source reload was dispatched to Rhino.

## Regenerate from live Rhino geometry

- [x] Persist object and Brep face/edge component references for selected drive geometry.
- [x] Re-read current part and drive geometry before every regeneration request.
- [x] Keep operations invalid when current source geometry cannot be resolved or validated.
- [x] Show a red X for invalid operations in the Rhino operation tree.
- [x] Validate maintained tests/builds and reload the development plug-in.

Document schema v8 stores standalone-curve references and Brep face/edge component indices with each normalized region snapshot. Explicit regeneration now remeshes the current part, recalculates stock bounds, resolves current drive subobjects, retessellates their loops, and only then posts `/cam/toolpath`; resolution failures are persisted as invalid instead of falling back to stale coordinates. Legacy standalone-curve operations are resolved from their saved object GUIDs, while legacy face/edge operations must have their drive geometry reselected once because schema v7 did not retain component indices. Invalid operations render the existing status X in red. Validation: 119 maintained tests passed, focused Ruff and Python compile passed, the WebView build passed, diff checks passed, and the development source/panel reload was dispatched to Rhino.

## Optional Rhino part for 2D operations

- [x] Allow adding and editing operations before selecting a part.
- [x] Generate pocketing, profiling, and facing from live drive geometry without a part.
- [x] Keep parallel finishing generation blocked until a part is selected.
- [x] Allow mesh-free tool simulation without a part.
- [x] Validate maintained tests/builds and reload the development plug-in.

The Rhino panel no longer gates Add Operation on part selection. Pocketing, profiling, and facing refresh their live drive geometry and post a setup without `partMesh`; stock max Z is derived from the operation loops so relative clearance modes remain valid. Mesh-free simulation no longer checks for a part. The operation editor receives current part availability and disables Generate only for parallel finishing when no part exists, in addition to the existing drive-geometry requirement; the Python action repeats that validation server-side. The regular backend contract remains unchanged and still requires a part mesh for parallel finishing. Validation: 119 maintained tests passed, focused Ruff and Python compile passed, WebView TypeScript/build passed, and diff checks passed.

## Populate operation tree on panel load

- [x] Request document state only after the Eto WebView reports `DocumentLoaded`.
- [x] Remove the premature browser-side initial state request.
- [x] Build/install the development bridge and validate maintained checks.

The C# panel now dispatches `get_state` only after setting `m_pageLoaded=true`, so its first response cannot be dropped by `PostMessage`. The TypeScript page no longer sends the request while Eto still considers the document loading. Validation: 119 maintained tests and the WebView build passed; the Debug development bridge built with zero warnings/errors and was installed. Rhino must restart once to load the replaced assembly.

## Refresh Rhino Brep-compatible parts

- [x] Resolve current part and drive subobjects through a Brep conversion instead of requiring `RhinoObject.Geometry` to already be a `Brep`.
- [x] Validate maintained checks and reload the development plug-in.

The failing selected part is a `Rhino.Geometry.Extrusion`, which Rhino's picker exposes as a Brep but `RhinoObject.Geometry` retains as an extrusion. Live refresh now uses `Rhino.Geometry.Brep.TryConvertBrep` for both the part and saved Brep face/edge references. A live Rhino probe confirmed conversion to a six-face Brep and successfully rebuilt the current 64-vertex/52-face part mesh and stock bounds. Validation: 119 maintained tests, focused Ruff, Python compile, and diff checks passed; development source/panel reload was dispatched.

## Part reference lifecycle and invalid status color

- [x] Add a Part context-menu action that removes its document reference without deleting Rhino geometry.
- [x] Remove Part from operation source associations and invalidate affected operations/toolpaths.
- [x] Verify selected Part is persisted, written to source-object metadata for referencing operations, and runtime-serial tracked.
- [x] Make the invalid-operation X visibly red despite tree icon CSS specificity.
- [x] Validate maintained checks and reload the development plug-in.

Part references are stored in the document state and represented on the source object with `OpenCAM.OperationRefs`, now including a `roles: ["part"]` marker even before an operation references it. The same object is included in every operation's `source_object_ids`, so the existing runtime-serial watcher invalidates every referencing operation after its geometry changes. The new Part right-click menu has **Remove reference**; it removes only OpenCAM metadata/state, restores normal Rhino visibility, and invalidates affected generated artifacts. The status icon rule now overrides the tree icon's dim color so invalid X icons render `#ef4444`. Validation: 119 maintained tests, focused Ruff, Python compile, WebView build, and diff checks passed; development source/panel reload was dispatched.

## Duplicate Rhino operation

- [x] Add an operation context-menu Duplicate action.
- [x] Persist an identical new operation with a new ID and `_Copy` name.
- [x] Attach copied references to source metadata/tracking without generating a toolpath.
- [x] Validate maintained checks/builds and reload the development plug-in.

The operation context menu now includes **Duplicate**. It deep-copies all operation parameters and region/reference snapshots, assigns a fresh UUID, appends `_Copy` to the name, selects the duplicate, and writes the duplicate's shared part/drive object associations to `OpenCAM.OperationRefs`. It deliberately creates no toolpath, preview, or simulation artifact. Validation: 119 maintained tests, focused Ruff, Python compile, WebView build, and diff checks passed; development source/panel reload was dispatched.

## Decouple 2.5D operations from Part

- [x] Associate Part only with operations that require its mesh.
- [x] Generate pocketing, profiling, and facing without `partMesh`, even when a Part is selected.
- [x] Invalidate only Part-dependent operations when Part is selected, removed, or changed.
- [x] Validate maintained checks/builds and reload the development plug-in.

Pocketing, profiling, and facing now depend only on their drive geometry: their source IDs exclude Part, their generation hashes exclude Part, and their `/cam/toolpath` setup never includes `partMesh` even when the document has a selected Part. Their stock max Z comes from operation loops. Parallel finishing remains Part-dependent. Selecting, removing, or editing Part now invalidates only parallel-finishing operations, and metadata reconciliation treats persisted document associations as canonical so stale object metadata cannot reattach Part to 2.5D operations. Existing valid 2.5D cache hashes are migrated when possible. Validation: 119 maintained tests, focused Ruff, Python compile, WebView build, diff checks, and a part-dependency/hash smoke check passed; development source/panel reload was dispatched.

## Per-operation simulation status

- [x] Persist simulation status and identity by operation ID.
- [x] Invalidate only the regenerated/edited operation's simulation status.
- [x] Keep completed blue checks on unaffected operations.
- [x] Validate maintained checks/builds and reload the development plug-in.

`results.simulation_summaries` now stores running/completed/error state, task/simulation IDs, generation hash, and frame count under each operation ID. Regeneration, source invalidation, editing, and deletion remove only the affected operation's summary; the one active playback session remains document-scoped, but replacing it no longer erases completed status for other operations. The panel reads per-operation summaries for spinner/blue-check status, stale running entries are suppressed on panel load, mismatched generation hashes are discarded, and legacy document-wide simulation fields migrate into the map. Validation: 119 maintained tests, focused Ruff, Python compile, WebView build, and diff checks passed; development source/panel reload was dispatched.

## Setup regeneration and post-processing

- [x] Add Setup right-click Regenerate and Post Process actions.
- [x] Regenerate setup operations sequentially in tree order.
- [x] Post setup CL operations as one ordered list to the backend.
- [x] Ensure single and multi-operation post-processing return one delineated NC program.
- [x] Validate maintained checks/builds and reload the development plug-in.

The Setup row context menu now offers **Regenerate** and **Post Process**. Regenerate queues operations in tree order and advances only after each operation's toolpath generation and automatic simulation preparation reaches a terminal state; one failure does not prevent later operations from running. Setup post-processing collects valid generated CL records in tree order and sends one JSON list to `/cam/post-process/duet3d/nc`; single-operation posting continues to send the same list shape with one element. The backend already emits one program header/footer and explicit `; Operation N`/tool comments around each operation, returning one `.nc` response for lists of any supported length. Validation: 119 maintained tests, focused Ruff, Python compile, WebView build, diff checks, and a two-operation NC delineation smoke check passed; development source/panel reload was dispatched. Setup post-processing requires every operation to have valid generated CL (panel menu and Python action both enforce this), so a partial setup cannot produce an NC file.

## Climb/conventional cutting-direction audit

- [x] Establish the clockwise-spindle direction convention used by each toolpath strategy.
- [x] Audit facing, parallel finishing, pocketing, and profiling for consistent climb/conventional behavior.
- [x] Correct reversed direction handling without changing mixed-direction behavior.
- [x] Validate focused geometry checks and the maintained test suite.

For the assumed clockwise spindle, climb cutting keeps the remaining material on the tool's right. Facing and parallel-finishing one-way rasters were reversed and now use that convention; mixed rasters are unchanged. Profiling previously ignored `cut_direction` and now orients open and closed paths from both cut side and direction. Offset and adaptive pocketing were already correct; only an inaccurate adaptive comment changed. The reported 90° facing case now travels -Y for climb and +Y for conventional while lanes advance -X. Validation: 105 maintained backend tests and 14 Rhino plug-in tests pass, focused geometry checks cover all four strategies, focused Ruff/compile/diff checks pass, and the frontend production build passes. No Rhino plug-in rebuild is required for these backend-only toolpath changes.

## Push-based generation and simulation status

- [x] Push generation completion from the toolpath worker instead of panel polling.
- [x] Watch simulation tasks off-thread and push terminal status to the UI thread.
- [x] Keep slow fallback polling for bridge builds without push support.
- [x] Validate maintained checks, rebuild/install the bridge, and reload the plug-in.

Setup regeneration drove roughly one panel dispatch per 500 ms through the synchronous UI-thread `ExecuteScript` bridge, saturating Rhino's main thread and producing a sustained beachball. Live timing showed the Python actions themselves are fast (polls 11-19 ms, completions up to 600 ms), so dispatch volume is the cost. The generation worker and a new simulation watcher now push one completion event each through a C# `AsyncInvoke` hop; the panel keeps only 2 s fallback polls for older bridges.

## Dual-React invalid hook call in frontend

- [x] Diagnose `Invalid hook call` from `t-components` Dialog: bun's `file:../../t-components` install copied the package's own `node_modules/react`, shadowing the app's React for all imports from `t-components/dist`.
- [x] Add `resolve.dedupe: ["react", "react-dom"]` to `frontend/vite.config.ts` so Vite always resolves React from the frontend root, surviving future `bun install` re-copies.
- [x] Delete stale nested `react`/`react-dom` from `frontend/node_modules/t-components/node_modules` and clear `node_modules/.vite` so the dev server pre-bundles one React.

- [x] Fix `geometries.map is not a function` crash (`App.tsx` `operationToMeshFaceSelections`): legacy `localStorage` sidebar payload carried `driveGeometry` as a single object instead of an array. Guard now normalizes to an array (wrapping a lone object), matching the existing `draftToMeshFaceSelections` defensive pattern; frontend `tsc -b` passes.

## Python-side UI-thread push (replace C# SchedulePanelDispatch)

- [x] Probe `Eto.Forms.Application.Instance.AsyncInvoke` from a worker thread with a persistent module callback.
- [x] Probe full push: `handle_panel_message` + `PostPanelMessage` inside the UI-thread callback.
- [x] Rewrite `runtime.push_panel_request` to use Eto `AsyncInvoke`; revert the C# method.
- [x] Validate checks, reload Python, and reinstall the bridge source.

The RhinoCode async guide documents `Eto.Forms.Application.Instance.Invoke/AsyncInvoke` with plain Python callables as the supported UI-thread hop; `RhinoApp.InvokeOnUiThread(Delegate, args)` takes a base `Delegate` and crashed Rhino when handed a raw callable, so it is off the table.

The RhinoCode async guide documents `Eto.Forms.Application.Instance.Invoke/AsyncInvoke` with plain Python callables as the supported UI-thread hop; `RhinoApp.InvokeOnUiThread(Delegate, args)` takes a base `Delegate` and crashed Rhino when handed a raw callable, so it is off the table. Live probes confirmed a worker-thread `AsyncInvoke` callback runs on the UI thread, reads the active document, and delivers a full `handle_panel_message` response to the open panel (`posted: 1`) without a crash. `runtime.push_panel_request` now builds the request JSON, marshals through Eto `AsyncInvoke`, runs `entry.handle_panel_message` and posts via `PluginBridge.PostPanelMessage` entirely in Python with a guarded callback; the C# `SchedulePanelDispatch` shim was reverted. The whole push path is now reloadable via `reload-development-mac.sh` without a bridge rebuild or Rhino restart. Validation: 119 maintained tests, focused Ruff, compile, and diff checks passed; development Python reloaded into running Rhino; the reverted bridge was rebuilt and installed for the next restart.

## Arbitrary-polyline facing

- [x] Accept one valid closed face-boundary polyline rather than only four-corner rectangles.
- [x] Retain raster slicing of concave and tessellated boundaries, and update user-facing geometry labels/messages.
- [x] Validate the reported tessellated rectangle and a non-rectangular boundary.
- [x] Collapse every operation input polyline at 0.001 mm before Shapely-based processing.

Facing now accepts any valid, single closed polygon. A mixed-direction raster only links adjacent slices when their connector stays inside the buffered face boundary; disconnected concave slices retract safely. The reported 33-vertex rectangle collapses to its five-point closed boundary, and open/closed polylines are simplified at 0.001 mm before every engine uses them. Validation: 119 backend/Rhino tests, frontend production build, Python compile, focused direct tessellated/concave-facing checks, and `git diff --check` pass.

## Ruff tooling

- [x] Install Ruff with uv and run it against the changed Python files.

`uv tool install ruff` installed Ruff 0.17.2. Ruff and `git diff --check` pass for the changed Python files.

## Shared context menus

- [x] Identify the two frontend right-click menu implementations and their shared-code path.
- [x] Move menu styling and item highlighting to shared code, then update both frontends.
- [x] Run relevant frontend checks.

Rhino TypeScript check and browser TypeScript check pass. Browser ESLint remains blocked by two pre-existing errors in `tool-editor-dialog.tsx` and `integer-input.tsx`.

## Frontend per-operation simulation status

- [x] Preserve the simulated status for every completed operation.
- [x] Clear simulated status when an operation is regenerated, edited, deleted, or invalidated.
- [x] Run frontend type checks.

Completed simulations now retain a per-operation blue status; starting a new generation only clears that operation's simulation status. Browser and Rhino TypeScript checks pass.

## Visibility picker active styling

- [x] Style active visibility-picker items with the shared solid primary fill.
- [x] Run frontend type checks.

Active visibility items now use the primary background and foreground in both frontends. Browser and Rhino TypeScript checks pass.

## Visibility picker button-group styling

- [x] Apply the `t-components` button-group geometry to visibility toggles.
- [x] Run frontend type checks.

Visibility toggles now share borders and have rounded corners only at the two outer ends, matching the `t-components` horizontal button-group geometry. Browser and Rhino TypeScript checks pass.

## Visibility picker pressed styling

- [x] Use a single shared border across visibility toggles.
- [x] Use the `t-components` pressed-toggle fill for active items.
- [x] Run frontend type checks.

Visibility toggles now use the same neutral 15%-foreground pressed fill as `t-components` toggles, with one continuous border between items. Browser and Rhino TypeScript checks pass.

## Disabled visibility-toggle cursor

- [x] Show the native unavailable cursor for disabled visibility toggles.
- [x] Run frontend type checks.

Disabled visibility toggles now use the native unavailable cursor. Browser and Rhino TypeScript checks pass.

## Visibility-toggle height

- [x] Match visibility-toggle height to the Add Operation button.
- [x] Run frontend type checks.

Visibility toggles are now 1.75 rem high, matching the Add Operation button. Browser and Rhino TypeScript checks pass.

## Shared Add Operation button

- [x] Create a shared Add Operation button using the web frontend's button styling.
- [x] Replace the browser and Rhino panel buttons with the shared component.
- [x] Build and reload the Rhino development panel.

The shared button now uses the browser's default-button geometry, colors, hover treatment, and disabled state. A panel-only Rhino bundle was installed and reload request `1c62118d-4539-46fc-9892-c44a64b685d1` was sent to Rhino. The full frontend build remains blocked by existing incomplete `operation-schema.ts` types and missing generated schemas in `frontend/opencam-ui`.
