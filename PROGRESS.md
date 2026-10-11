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

- [x] Create divergent `adaptive-pocketing-openvoronoi` branch from `main`.
- [x] Audit current 2.5D pocket level generation and operation schema/UI.
- [x] Study OpenVoronoi medial-axis pocket core and motion demonstrator.
- [x] Add pocket-clearing algorithm choice while sharing existing level/retract flow.
- [x] Implement initial adaptive clearing path generator for each level.
- [x] Validate focused pocketing tests and document proof-of-principle limits.

Initial implementation uses a sampled-boundary Voronoi graph plus an LGPL-attributed Python adaptation of OpenVoronoi's MIC cut-width traversal, initial spiral, bi-tangents, and scoop arcs. It is selectable as `adaptive`; existing `offset` remains default. Remaining production work: replace the approximate point-sampled medial axis with an exact segment-site graph, reduce retracts with safe within-cleared-area links, and quantify swept-area coverage across pathological pockets.

### Adaptive traversal follow-up

- [x] Accumulate MIC cut width across medial-axis edges before emitting scoops.
- [x] Traverse one root branch to completion before starting its sibling branch.
- [x] Validate spiral/scoop stepover consistency and path focus ordering.

### Keep-tool-down pocket linking

- [x] Review OpenVoronoi pocket-transfer experiments and current clearance travel flow.
- [x] Add shared keep-tool-down cutting parameter for offset and adaptive strategies.
- [x] Generate tangent-continuous in-bounds links between successive same-level paths.
- [x] Fall back to clearance travel when no collision-free in-pocket link exists.
- [x] Validate both pocket strategies, generated schemas, and maintained test suite.

### Native circular linking moves

- [x] Audit CL, post-processing, simulation, and frontend consumers for arc support.
- [x] Add explicit clockwise/counterclockwise XY arc CL records.
- [x] Emit G2/G3 with I/J offsets in Duet post-processing.
- [x] Use arc-line-arc keep-down links where pocket bounds permit.
- [x] Tessellate arcs for swept simulation and viewport display.
- [x] Validate generated G-code, schemas, frontend, and maintained tests.

### Keep-tool-down UI polish

- [x] Render keep-tool-down with `t-components` Checkbox.
- [x] Place keep-tool-down immediately below clearing algorithm.
- [x] Regenerate schemas and validate frontend build.

### Keep-down link radius

- [x] Cap linking arc radius at 25% of tool diameter.
- [x] Validate native arcs and maintained tests.

### Motion-role metadata

- [x] Add cutting/linking/travel motion roles to CL Pydantic models.
- [x] Populate roles across cut, link, rapid, and arc-linearization paths.
- [x] Render linking moves yellow in frontend toolpath display.
- [x] Regenerate schemas and validate backend/frontend consumers.

### Adaptive step-under pruning

- [x] Run medial-axis clearing at 90% of requested stepover for extra overlap.
- [x] Prune corner-spur leaf scoops when residual stays within stepover slack.
- [x] Guarantee effective spacing never exceeds requested stepover.
- [x] Validate runs, coverage, arc containment, tests, and lint.

### Adaptive short-scoop pruning at coarse stepover

- [x] Extend pruning candidates from leaf tails to all short scoops.
- [x] Verify circular-corner artifacts vanish at 30% stepover.
- [x] Confirm waist machining and coverage guarantee survive.

### Adaptive round-pocket spirals

- [x] Detect compact round medial-axis branches (short, near-uniform MIC radii).
- [x] Replace their scoop chains with a single spiral when coverage permits.
- [x] Eliminate reversal-dart artifacts across the stepover range.
- [x] Add automated quality test over pocket assets.

Findings: isolated corner darts eliminated by locally chained path ordering
(`_chain_nearest_paths`, cap 1.5× stepover); spiral swap covers truly round
sub-pockets; rapids held at baseline while smooth arc links doubled.

### Adaptive redundant-pass elimination

- [x] Extend coverage-gated pruning to all scoops and the cleanup ring.
- [x] Prefilter candidates by near-neighbor redundancy to bound cost.
- [x] Eliminate spiral-adjacent twin scoops (sub-0.5 mm duplicates).
- [x] Validate coverage contract, rapids, tests.

Result: duplicates 0 (was 9), B30 total length 2045->1952, shortest path
3.7->7.6 (twins merged), coverage contract holds, ring proven necessary by
coverage test, 90 tests pass.

### Adaptive climb-milling consistency

- [x] Wind cleanup ring CCW (exteriors) / CW (holes) via shapely orient.
- [x] Stop reversing paths during nearest-chaining (reversal flips handedness).
- [x] Confirm zero CW loops across A/B at 25/30 percent stepover.
- [x] Diagnose cl-7 "islands" as 1-2 micron tessellation slivers, not stock.

Result: all 47-70 loop paths CCW (climb) per pocket; rapids unchanged or
better (B30 12->9); 90 tests pass.

### Adaptive cut-direction support

- [x] Add cut_direction parameter (climb/conventional) to adaptive builder.
- [x] Conventional mirrors spiral rotation, ring winding, and scoop branches
      (reversed traversal + reversed paths).
- [x] Plumb operation cut_direction through pocketing toolpath.
- [x] Tests: 8 handedness assertions; 98 total pass; islands remain 0.

### Toolpath run provenance

- [x] Log each generated CL payload under a unique gitignored run directory.
- [x] Associate simulation with the exact logged CL run using HTTP header/form metadata, not CL schema.
- [x] Log zero-based animation frame to original CL record mappings, including arcs and travel.
- [x] Expose simulation ID in frontend for frame reports and validate mapping.
- [x] Add `scripts/inspect_toolpath_frame.py` lookup for displayed frame numbers.

### Keep-tool-down link stock-engagement checker

- [ ] Check keep-tool-down linking segments between pocketing focus areas and adaptive toolpaths for engagement with uncut stock.
- [ ] Classify links that intersect uncut stock as cutting moves, while preserving them as valid cutting transitions.
- [ ] Cover `assets/operations/pocketing/pocketing_B_part.stp` with `assets/operations/pocketing/pocketing_B_drive_curve.json`, offset pocketing, and a 1/4-inch tool.
- [ ] Provide a future-safe basis for optionally converting only non-cutting links to rapid moves.

### Simulation ID placement

- [x] Show full simulation ID in simulation debug overlay, not playback bar.
- [x] Update lookup docs and verify frontend checks.
- [x] Show only first GUID segment in simulation debug overlay.

### Simulation CL record display

- [x] Include original CL record index in simulation frame response.
- [x] Show displayed frame's CL record index in simulation debug overlay.
- [x] Verify backend and frontend checks.
- [x] Shorten simulation debug label to `CL record`.

### Reproducible toolpath request logs

- [x] Log validated operation request (setup, border geometry, settings) beside generated CL.
- [x] Preserve cached-mesh requests and include self-contained replay mesh snapshot.
- [x] Document replay workflow and verify maintained tests.

### Adaptive full-engagement scoop after spiral (Sim 9ba69ab4)

- [x] Reproduce CL 583 transition using logged request and identify first scoop ordered ahead of clearing passes.
- [x] Order scoops so cleared-area passes precede fully engaged passes while preserving cut direction and coverage.
- [x] Replay logged request, measure engagement at affected CL range, and run maintained checks.
