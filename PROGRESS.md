# Progress

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
