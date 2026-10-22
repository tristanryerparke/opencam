# Progress

## Development workflow

- User authorizes replacement of development `OpenCamRhinoBridge.rhp` whenever required by OpenCAM changes; rebuild/install without asking. State when Rhino restart is required.

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

Panel dismissal now listens during pointer-event capture and ignores only clicks inside the open menu. Setup toggles and other controls that stop event bubbling therefore close the menu before handling their own action. WebView build passed and development reload was dispatched.

## Rhino simulation playback parity

- [x] Auto-start matching `/simulate` work whenever a toolpath generation completes.
- [x] Move playback to a dedicated panel page with skip/step/play/exit, timeline, progress, and stride control.
- [x] Make playback cadence 30 ms with stride options 1/2/4/8/16, like the browser frontend.
- [x] Gate each playback tick on the previous `show_frame` reply to prevent message pile-up.
- [x] Add backend `include_stock_data` field; Rhino sends `false` to skip final-stock and comparison artifacts while receiving browser-identical chunk, active-cut, tool, and frame data.
- [x] Validate contracts end to end and rebuild the panel.

`POST /simulate` now accepts `include_stock_data` (default true). When false, the backend skips the final-mesh export and the background comparison build but keeps `toolMeshUrl`, chunk cached meshes, active-cut frame meshes, and per-frame `toolPosition` exactly as the TypeScript frontend receives them; `finalMeshUrl` is returned empty. Rhino sessions track operation and generation hash so regeneration restarts matching simulation data and repeated Simulate reuses it. Playback strides source frames like the browser, runs at 30 ms, and each tick waits for the previous frame reply. Live smoke: stock-less request completed with 175 frames, empty `finalMeshUrl`, and fetchable tool/cached meshes. Maintained suite: 119 passed (new `include_stock_data=false` contract test); focused Ruff, compile, diff, and WebView builds pass. Development reload had no running RhinoCode pipe (Rhino closed); next Rhino start loads the new panel and actions.
