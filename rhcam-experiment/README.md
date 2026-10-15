# OpenCAM / RhinoCAM offset-pocket comparison

## Current settings

- Drive curves: `assets/operations/pocketing/*_drive_curve*.json`
- Operations: A, B, combined C (two curves), D, E
- Tool: 1/4-inch flat end mill (`6.35 mm`)
- Depth: `0 mm`; drive geometry at bottom, `Z = 1 mm`
- Pattern: offset pocketing
- Stepover: `25%` (`1.5875 mm`)
- Direction: climb
- Entry: vertical plunge
- Stock to leave: `0 mm`
- Chord/tolerance: `0.01 mm`
- OpenCAM keep-tool-down: disabled
- RhinoCAM keep-tool-down: enabled
- RhinoCAM post: GRBL-MM (`G21` verified)

RhinoCAM defaults were initially `0.635 mm` stock and `0.1 mm` tolerance. Those files remain under `rhinocam/default-stock-0.635mm/` but are excluded. Previous OpenCAM keep-tool-down output remains under `opencam/inner-to-outer-keep-tool-down/`.

## Current results

| Asset | Cut points O/R | Cut length O/R (mm) | Path groups O/R | Inter-path rapid O/R (mm) | Plunges O/R | Arcs O/R |
|---|---:|---:|---:|---:|---:|---:|
| A | 90 / 140 | 657.1 / 694.4 | 2 / 2 | 32.2 / 28.8 | 2 / 2 | 0 / 0 |
| B | 1111 / 953 | 1156.5 / 1323.1 | 3 / 3 | 59.4 / 51.3 | 3 / 3 | 0 / 45 |
| C | 106 / 106 | 2343.8 / 2343.8 | 2 / 2 | 24.1 / 48.9 | 2 / 2 | 0 / 0 |
| D | 2276 / 2494 | 1221.3 / 1306.1 | 2 / 2 | 29.9 / 24.7 | 2 / 2 | 0 / 41 |
| E | 236 / 622 | 490.9 / 636.9 | 1 / 1 | 0.0 / 0.0 | 1 / 1 | 0 / 0 |

O/R means OpenCAM / RhinoCAM. Metrics come from modal G-code parsing; G2/G3 arcs are tessellated for geometry and swept-area checks.

## Findings

1. Disabling OpenCAM keep-tool-down aligns operation structure: both programs now produce 10 cutting groups, 10 plunges, and 15 retracts across five operations.
2. Combined C exposes multi-curve handling. Both produce two path groups, two plunges, 106 XY cut points, and `2343.8 mm` cutting length. OpenCAM uses `24.1 mm` inter-pocket rapid travel; RhinoCAM uses `48.9 mm` because of different seam/start choices.
3. Core offsets still match closely. Aggregate cutter-sweep uncovered area is `95.7671 mm²` for OpenCAM and `95.7777 mm²` for RhinoCAM.
4. Traversal order remains unmatched. OpenCAM clears inner-to-outer; RhinoCAM still clears outer-to-inner. RhinoCAM documents `SetPocketOffsetType(CONTOUR_START_INSIDE)`, but the installed `Cut2AxPocketingMOp` binding omits that method. Manual UI configuration is required before a fully matched rerun.
5. RhinoCAM uses 86 fitted arcs versus OpenCAM's zero with keep-tool-down disabled. RhinoCAM cutting centerlines total `7.4%` longer (`6304.4 mm` versus `5869.5 mm`), while aggregate inter-path rapid differs by only `5.6%`.

## Artifacts

- Overlay: `plots/offset-pocket-path-comparison.png`
- Separate views: `plots/offset-pocket-path-side-by-side.png`
- Metrics: `comparison-metrics.json`, `comparison-metrics.csv`
- OpenCAM current: `opencam/`
- RhinoCAM current: `rhinocam/`
