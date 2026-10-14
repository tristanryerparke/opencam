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

### Adaptive boundary cleanup integration

- [x] Measure remaining border stock and relate it to scoop entry/exit geometry on replayed pocket.
- [x] Attach needed contour fragments to nearby scoops through already-swept, in-bounds connectors.
- [x] Remove cleanup loop only when swept-area residual meets existing coverage tolerance; otherwise retain it.
- [x] Replay Sim 9ba69ab4 request: climb cleanup loop eliminated, cut length 1914.8 -> 1700.8 mm, clearance links unchanged (1), 98 maintained tests pass.

Conventional replay still retains its cleanup loop where the safe-fragment coverage gate fails; no cutting-direction or coverage guarantee is relaxed.

### Adaptive boundary touch-point gaps (Sim d3ad51da)

- [x] Locate logged run and CL record 2446 at final border fragment.
- [x] Extend integrated fragments forward to the next earlier pass's actual border contact only where connector stays within previously swept cutter-center region and pocket bounds.
- [x] Preserve existing keep-down transfers when extension would force a retract.
- [x] Replay logged request: final border move now reaches (144.5662, 123.1750), previous pass contact; full cleanup loop still absent, retract count unchanged (1); 98 maintained tests pass.

Sim `cfe7721d` still shows gaps near CL 2446. Follow-up found the earlier analytic check sampled only a small window by the final XY point; full-pocket coverage leaves 1.47 mm² of thin stock across 32 areas, including 0.136 mm² just above that point. The assumption that tolerance-sized residuals would be invisible was wrong.

- [x] Reproduce the remaining stock from logged Sim `cfe7721d` and identify the tolerance-based cleanup gate.
- [x] Require complete swept-area coverage before omitting the contour loop; preserve loop when fragments leave stock.
- [x] Replay request and verify zero remaining analytic area, full cleanup CL, 98 maintained tests, and lint.

Replayed run `e69200c5`: full contour loop restored (260.33 mm) because fragmented paths leave 1.47 mm²; reachable-pocket residual is now 0.0 mm². Old CL record 2446 no longer refers to the same move after regeneration. Smaller integrated contour fragments alone do not yet meet zero-gap requirement for this pocket.

### Residual-driven adaptive border integration

- [x] Measure uncovered stock projected onto border for reported pocket.
- [x] Interleave residual-relevant offset sections directly into scoop paths at cutter positions within 90% stepover, with bounded native arc-line-arc links and cleared-boundary polyline fallback.
- [x] Replay problematic request and validate negligible numerical residual, link safety, cut direction, and maintained checks.

Probe on logged Sim `cfe7721d`: prior scoop-only coverage leaves 31.76 mm². Buffering uncovered material by tool radius identifies 204.65 mm of the 260.33 mm rim as relevant. Simple append-to-nearest-scoop extension fails: 11/12 contour intervals can be attached within a relaxed connector distance but still leave 10.44 mm²; splitting into 38 pieces assigns 33 yet adds ~410 mm of path and leaves 10.45 mm². Snapping existing scoop vertices to the exact offset line within 1 mm still leaves 17.43 mm². A complete offset line clears the region, but residual spans broad straight walls as well as corners.

Follow-up sequencing probe: divide entire offset ring into 152 sections of at most the effective 90%-stepover distance (1.7145 mm). Every section comes within that radius of an existing scoop vertex, but splitting scoops there creates 341 subpaths, 20 clearance retracts, and 15 failed border links. Choosing only sections with existing native arc-line-arc/straight links has no feasible anchor even at section 1. Resolved by representing internal link spans inside each scoop and routing tight corners along previously swept offset border. Production emits native linking arcs when tangent arcs fit and cleared linear links otherwise; no standalone final rim loop on reported request. Residual mask limits cutting to 128 local offset sections (256 radial moves), with 0 outer retracts in climb and 2 in conventional; leftover Shapely residual is under 1e-8 mm². Logged replay `9cf4cc85` has 324 native linking arcs and 98 maintained tests pass. Cost: added local radial motion; optimize section grouping if simulation shows excessive weaving.

### Adaptive leg-first scoop order (Sim 52ae6737)

- [x] Trace CL records 1056/1111/1177/1635 to scoop sequence and quantify prior centerline spacing.
- [x] Preserve DFS branch order rather than globally chaining paths by proximity to swept tool area.
- [x] Prevent scoop pruning from widening any later DFS scoop past requested stepover.
- [x] Replay reported and earlier spiral regressions; check coverage, engagement, links, and maintained tests.

Sim `52ae6737`: order after global chaining starts at DFS indices 46, 2, 21, 47, 1. Prior centerline spacing at CL 1056/1111 is 1.649/2.866 mm versus 0.791/1.435 mm in DFS order; requested stepover is 1.5875 mm. Pruning also breaks DFS spacing in prior A30 replay (two violations); unpruned DFS has none. Cutter-sweep containment is insufficient to enforce stepover.

Replayed run `62f51be2`: previous CL 1177/1056/1111/1635 appear at new CL 1048/1074/1822/2565 in DFS leg order. Max scoop-to-prior-centerline spacing is 1.4385 mm (requested 1.5875 mm). Prior spiral replay A30: max 1.8235 mm (requested 1.905 mm), first scoop remains within root swept area, and 128 local rim excursions remain. Travel records in reported pocket fell from 39 to 12 despite DFS order. Maintained tests: 98 pass; lint and diff check pass. Pruning's pointwise check now runs only for later scoops near the candidate to retain ~1 s generation time per replay.

### Adaptive generation speed — incremental reach cache

- [x] Cache incremental swept reachability for scoop-border safety checks; remove growing-union buffers.
- [x] Relax tangent blend tessellation from 1° to 2° while retaining tangent continuity and collision checks.
- [x] Profile reported replay; run coverage, linking, and maintained checks.

Replaced per-scoop `prior_centerlines.buffer(stepover)` and its tolerance re-buffer with two incremental unions: each emitted scoop contributes its own requested-stepover sweep and requested-stepover-plus-chord-tolerance sweep. GEOS distributes buffering over union exactly; the centerline union remains only for exact wall-contact discovery and final proofs. Local lead candidates retain identical safe-region and prior-coverage predicates, now against cached sweeps. Focus-end scoops update both caches before later limbs. Root finishing needs no later local-reach query.

Relaxed blend tessellation derivative alignment from one degree to two degrees (`MAX_BLEND_TANGENT_STEP`). Control-hull chord-error subdivision, fine collision sampling, and endpoint tangent matching remain unchanged. Sim `35f739ba`: CL records 4632 to 3714 (-19.818653%); old CL 1510 / 1638 wall joins now 1.455078° / 1.433199°. cProfile generation is 7.504s to 4.089s (-45.509062%); final unprofiled CAM + log replay is 3.273s, run `a4cbc703-6f88-449d-a2e8-acd65d2017d3`.

All reported, `27af87bf`, and `6be39e3d` replays retain coverage proofs, cutter-center bounds, requested stepover, no full-rim fallback, and all tangent joins. Updated maximum emitted blend tangent deviation is below 2° (1.952548° reported, 1.986053° / 1.979251° regressions). 98 maintained tests, focused Ruff, and `git diff --check` pass. Further speed target: cache fixed buffers during pruning; current profile still spends about 1.1s there, but this is lower priority than completed lead-cache change.

### Adaptive generation speed — prune sweep cache

- [x] Build each immutable path's tool-radius sweep once during redundancy pruning.
- [x] Reuse cached sweeps for every trial union; profile reported replay and run maintained checks.

`_prune_redundant_paths` now builds the tool-radius sweep of every immutable path once, keyed by object identity. Every candidate-removal trial unions those cached sweeps instead of repeating the same GEOS buffers. Paths are only removed from `retained`; their geometry never changes, so cache validity holds. Sim `35f739ba` cProfile: 4.089s to 3.921s (-4.108584%); pruning 1.105s to 0.910s (-17.647059%). Unprofiled CAM + log replay `a9e5ffbb-ccbf-404f-9ad2-392df3c08d26`: 3.184s. Its `cl.json` is byte-identical to pre-cache replay `a4cbc703-6f88-449d-a2e8-acd65d2017d3`, proving cache changes performance only. 98 maintained tests, focused Ruff, `git diff --check`, reported replay, and A30 regression replay pass.

### Deferred root spiral closing lap (Sim dea8f882)

- [ ] Build and validate rootless and full-root candidates before pruning; select rootless only when it has no cleanup fallback and no short motion.
- [ ] Replay `dea8f882`; verify duplicate removal, coverage, links, and maintained checks.

Stopped after three invalid variants and reverted all deferred-lap behavior. Root-lap omission before pruning removes the `dea8f882` duplicate and maintains coverage, but at 30% stepover it changes pruning enough to create a 0.628688 mm terminal poke in pocket B. Omitting lap after normal pruning fails `dea8f882`, because pruning had already removed scoops relying on full-root coverage. Restoring the lap afterward cannot restore those pruned scoops. Existing stable output is restored: reported root-circle paths remain 329.240 mm spiral lap, 47.208 mm local wall lead, and 20.442 mm next scoop; all 98 maintained tests and focused Ruff pass.

Next valid design is two complete candidate plans per wall-adjacent root: full-root baseline and rootless-before-pruning. Run prune plus local integration independently. Select rootless only if no original cleanup path remains, no motion is shorter than 90% requested stepover, complete coverage/bounds/stepover proofs pass, and links are safe; otherwise use full-root baseline. This avoids mixing full-root pruning decisions with rootless local planning.

### Residual-driven local wall finishing across tool diameters

- [x] Use existing per-cutter-center-component reach and remaining-wall state during local focus completion; never use a later component's centerlines to justify an earlier cut.
- [x] Subdivide unreachable focus fronts into bounded, validated MIC-radius increments; defer failed focus completion to remaining-wall candidates instead of immediately returning a full rim.
- [x] Extend short, reachable wall remnants into their oriented owning path rather than emitting a standalone poke.
- [x] Recheck the 25% stepover diameter sweep, maintained tests, bounds, and links.
- [ ] Add a branch-local offset-derived fallback if a future geometry cannot be finished by these bounded MIC fronts.

The 5 pocket assets at 10 evenly spaced diameters from 3 to 13 mm, both directions, now pass all 100 configurations: in-bounds cutting paths, residual coverage within existing stepover slack, no standalone short paths or full-rim cuts, and sampled in-bounds keep-down links. The first sweep's reported GEOS errors were checker errors from constructing a one-point `LineString` for empty (zero-distance) keep-down links; its other extra stepover reports compared disconnected cutter-center components. Corrected checker: `/tmp/adaptive_diameter_sweep_verified.py`. Remaining offset-derived fallback is unimplemented; tested intervals were resolved with safe incremental MIC fronts and oriented local wall extensions.

### Constructively safe MIC/scoop generation

- [x] Enforce interior MIC centers and whole-scoop containment before pruning; bound refinement along the medial branch.
- [x] Rebuild unsafe leads from legal local border geometry, with fail-closed handling if no safe construction exists.
- [x] Validate final cutting paths before CL emission; replay all five pocket assets in both directions and maintained checks.

Unsafe bitangent transitions now refine along their sampled medial branch, rebuild through legal local wall leads, or fall back to a contained inscribed-circle arc for branch-local completion. Final generation rejects any cutting centerline outside the cutter-center region or beyond requested prior-centerline reach. D25/D50 no longer emit the known 0.198730/0.615886 mm violations or a 225.340927 mm full-rim fallback. Regression coverage checks both directions for bounds, stepover, swept coverage, keep-down links, and no full-rim fallback. All 30 A/B/C1/C2/D configurations pass at 25/30/50% stepover in climb and conventional mode; 102 maintained tests, focused Ruff, and `git diff --check` pass. Top-down diagnostic: `/tmp/pocketing-D-safe-top-down.png`.

### Pocketing asset sweep — current stable planner

- [x] Generate all five `assets/operations/pocketing/*_drive_curve*.json` polylines at 25/30/50% stepover and both directions.
- [x] Check coverage, center bounds, short paths, links, and closed full-rim paths.

Tested A, B, C1, C2, and D with a 6.35 mm tool, 0 stock-to-leave, 0.01 mm chord tolerance, 25/30/50% stepover, and climb/conventional: 30 configurations. A/B/C1/C2: generation, coverage, cutter-center bounds, no-short-path check, sampled keep-down bounds, and no closed rim pass all pass. D30 passes same checks. D25 and D50 fail cutter-center bounds and retain a 225.340927 mm closed full-rim fallback in both directions. Dense 0.002 mm sampling of outside portions finds D25 centers up to 0.198730 mm outside at `(137.541162, 337.883515)` on path 24; D50 up to 0.615886 mm outside at `(145.843634, 330.543179)` on path 17. Coverage residuals are within current tolerance, but these are safety failures, not acceptable numerical slivers. D25/D50 `AdaptivePocketLayers` have zero `internal_links`; every outside segment is emitted as cutting, not linking. The top-down plot excludes inter-path keep-down moves entirely. D25 has 51 ordinary keep-down links and 3 clearance links; D50 has 23 and 1, respectively, but neither category explains red paths. Likely source: `_scoop_path` bitangent line/arc geometry can leave a concave tool-center component after medial graph edges passed the component tolerance test. No code changed during this sweep.

### Tangent scoop-to-border joins (Sim 35f739ba)

- [x] Replace projected-endpoint doglegs with tangent blends that preserve border overlaps.
- [x] Replay CL 1511/1639 neighborhoods; check tangent continuity, bounds, stepover, and coverage.
- [x] Run maintained checks and save updated replay.

`_scoop_border_leads` now trims short ends of the sampled scoop circle and inserts G1 cubic blends. Endpoint derivatives match the oriented border and analytic circle tangents; existing border overlaps and scoop order stay unchanged. Control-polygon forward progress rejects backwards hooks. Candidate curves receive fine collision sampling against bounds and the prior-cut stepover region; emitted cutting polylines use control-hull chord-error bounds and a 1-degree tangent-direction sampling limit. No CL schema changes or new tests.

Sim `35f739ba` / run `82bb2bf9`: all 86 entry/exit joins accepted in both directions, no original-scoop or full-rim fallback. At the two reported wall joins (old CL 1510 and 1638), emitted turns are 0.731901° and 0.716018°, replacing 90° projection doglegs; underlying curves meet tangentially. Compared before/after at `/tmp/tangent-scoop-comparison.png`. Complete center boundary/interior coverage and all cutter-center bounds remain valid. Sampled maximum prior-centerline spacing is 1.910175 mm, versus logged pre-change 1.910296 mm; requested 1.905 mm plus existing 0.01 mm chord tolerance. Polygonal coverage-buffer residuals remain thin tessellation slivers, with the existing boundary/interior proof passing.

Older `27af87bf` and `6be39e3d` replays also accept every join in both directions without full-rim fallback; maximum spacings 1.437952 / 1.823472 mm respectively. Native keep-down links for the reported replay remain in bounds (100 climb / 96 conventional arcs; 2 / 4 clearance links). 98 maintained tests, focused Ruff, and `git diff --check` pass. Updated replay `955b9ff1-8456-4b6d-9841-a364ecd3c8f2`: 4632 CL records.

### Scoop-local border contacts — confirmed sequencing

- [x] Generate short border lead-in/out from previous and current scoop contacts, retaining scoop order.
- [x] Finish each focus locally with additional scoops until its remaining border is within stepover; use scoop-like entry/exit, not inset contour passes.
- [x] Replay reported pocket and verify local coverage, spacing, safe links, and maintained checks.

Removed whole-interval inset-contour planning. After pruning, each retained scoop follows the oriented border from previously reached wall contacts into its arc and back out to prior wall coverage. Leads are accepted only within the cutter-center region and requested prior-centerline spacing. Retained DFS ancestry determines actual focus ends, including parents whose tiny descendants were pruned. Terminal fronts grow as clipped circles, not offset-wall contours, until the local cap is within the effective stepover. Final caps include the preceding scoop's border lead-in/out. An exposed root-spiral cap is finished immediately after that root, before outgoing limbs, when already within stepover. Existing rounded scoop-link routing supplies native arcs or clearance travel.

Reported pocket, both directions: 54 bordered scoops, 6 terminal focuses, 9 terminal moves (3 additional scoop fronts plus local caps); no full-rim fallback. Climb cutting length 2008.233 mm; maximum sampled cutting-center spacing 1.437797 mm (conventional 1.438243 mm), requested 1.5875 mm. Every cutting path remains in cutter-center bounds. Sampled all native link arcs at 0.001 mm chord tolerance: 118 climb / 120 conventional arcs, no out-of-bounds links; 4 / 3 clearance connections respectively. Final replay `9cc51ab0-9b05-4879-9db3-7572c7257bf9`, 3382 CL records. Plot `/tmp/scoop-local-final.png` inspected.

Coverage verification explicitly proves the complete cutter-center boundary and center-region interior are covered. Polygonal cutter-buffer unions still produce chord-approximation slivers (0.005769938 mm² climb, 0.004761454 mm² conventional); these are accepted only with that geometric coverage proof and empty residual erosion at chord_tolerance/4, not an arbitrary increased residual-area threshold. Older A30 replay `6be39e3d` also avoids full-rim fallback, covers boundary/interior, keeps all cuts in bounds, and stays within 1.823472 mm spacing against 1.905 mm requested in both directions. General cases that cannot prove local completion still retain existing cleanup fallback.

98 maintained tests pass; focused Ruff and `git diff --check` pass. No new tests or unrelated working-tree changes.

### Continuous limb border sweeps — replace fragment weaving (superseded)

- [x] Preserve DFS limb ownership through pruning and assign contiguous border intervals.
- [x] Emit whole-interval sweeps toward border, then border cut, without per-fragment radial returns.
- [x] Replay reported pocket; check spacing, coverage, cut direction, linking, and maintained checks.

Replaced radial fragment excursions with inward parallel contours spanning contiguous limb-owned border intervals. Short ownership islands merge into an adjacent later limb instead of producing tiny cuts. Each interval advances by bounded whole-length sweeps, ending on the oriented border before moving on. All contour segments must lie inside cutter-center bounds and the prior-centerline stepover buffer; connectors use native rounded links or a checked border route. General integration failures still retain the full-rim fallback.

Reported replay: 7 border intervals (shortest 11.397 mm), 7 internal links for climb, no full-rim fallback in either direction. Sampled cutting-center spacing at 0.1 mm resolution: maximum 1.438487 mm for both directions against requested 1.5875 mm. Cutting-only analytic residual: 0.001008507 mm² climb, 2.4271e-8 mm² conventional. All sampled internal connectors remain in cutter-center bounds. Climb cutting length 2236.732 mm; logged replay `00bd33fd-739f-4d61-aa14-ac7283a14256`, 3463 CL records. Inspected plotted cutting paths and internal links at `/tmp/continuous-limb.png`.

Also corrected conventional traversal to reverse individual scoops without reversing their advancing stock-front order. Existing direction assertion now verifies oriented wall tangents for concave border sections whose open-path signed area differs from a convex scoop; it does not reverse those sections to satisfy an area heuristic. 98 maintained tests pass, focused Ruff and `git diff --check` pass.

### Branch-local border scoop (Sim f2f52b15)

- [x] Locate final rim pass and measure CL 2990 engagement against prior cuts.
- [x] Add bounded intermediate sweep immediately before local border interval when gap exceeds requested stepover.
- [x] Attach contour sections to nearby DFS scoops in their focus area; omit full rim when local coverage and radial links pass.
- [x] Replay logged pocket, check CL motion and coverage, run maintained checks.

Run `27af87bf` had a 225.35 mm final rim loop, 86.72 mm² of material left after scoops. At original CL 2990 cutter center sat 1.926 mm from previous centerline (requested 1.5875 mm); about 6.60 mm of rim exceeded requested spacing. New planner allows a previously swept cutter-radius approach, inserts an interpolated intermediate contour sweep where needed, then cuts the true offset immediately at that scoop vertex. On replay, 11 extra intermediate sweeps and 131 border excursions replace the final rim; the local residual near old CL 2990 is below 1e-9 mm². Total analytic residual is about 0.001 mm² across sub-0.005 mm buffer slivers (numerical chord approximation), outer retracts 2. Max cutter-center spacing across the emitted cutting segments, in their actual order, is 1.438 mm versus the requested 1.5875 mm. Replayed CL run `dae2a417`; 98 maintained tests and focused lint pass. Cost: many small excursions and more CL moves than original rim; section grouping remains an optimization. Branch ownership is spatial to the nearest DFS scoop, not stored explicitly as medial-tree IDs.

### Restart-safe regeneration cache

- [x] Persist one backend STEP and converted mesh as a single replaceable cache entry across backend restarts.
- [x] Stop saving new STEP files in browser storage; restore mesh metadata from backend on page load.
- [x] Preserve browser operation/setup-generation inputs on refresh without overwriting saved operations during hydration.
- [x] Validate cache replacement, restart, regeneration inputs, maintained tests, and frontend build.

Backend uses atomic `mesh-cache/current.zip` replacement, stable cache ID on restart, version-checked mesh URLs, and disk deletion on explicit part removal. Existing browser STEP is migrated only when backend has no cached part; new uploads never enter browser storage. Browser keeps operation JSON and settings, not generated CL, frames, or simulation meshes. Maintained tests: 98 pass; frontend TypeScript/build pass. Full ESLint reports three pre-existing errors in unrelated components; App.tsx alone has zero errors and nine existing warnings.

## RhinoCAM offset-pocket comparison

- [ ] Commit current adaptive-pocketing work, merge it into `main`, and create `rhcam-comparison`.
- [ ] Generate 25%-stepover offset-pocket G-code for every drive curve with OpenCAM.
- [ ] Copy curves into remote Rhino document; generate matching plunge-entry RhinoCAM pockets.
- [ ] Store both output sets under `rhcam-experiment/`; compare points and motion behavior.
- [ ] Report algorithm differences and unresolved CAM-setting gaps.
