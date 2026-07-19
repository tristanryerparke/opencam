# Display Remesh / Proximity Color Summary

## What was implemented

A display-only remeshing pass was added for simulation frame meshes and cached chunk meshes.

- The simulation calculations still use the original meshes.
- Only the final meshes sent to the frontend / Rhino are optionally remeshed.
- The remeshing target is a roughly uniform edge length of **5.0** world units by default.

## New backend globals

In `src/opencam/simulation/router.py`:

- `DISPLAY_REMESH_FRAMES = True`
- `DISPLAY_REMESH_CHUNKS = True`
- `DISPLAY_REMESH_TARGET_EDGE_LENGTH = 5.0`
- `DISPLAY_REMESH_ITERATIONS = 10`
- `PROXIMITY_COLOR_FULL_RED_DISTANCE = 5.0`

These are simple global switches / tuning values for now.

## Remeshing behavior

A new helper remeshes exported GLB meshes with PyMeshLab isotropic explicit remeshing:

- input: existing display mesh bytes
- output: denser triangle mesh with more consistent edge length
- source colors are transferred onto the remeshed display mesh

This happens in two places:

- cached chunk mesh generation
- active frame mesh generation

## Proximity color behavior

Proximity coloring was updated so that larger error becomes more red.

### Watertight part mesh

- extra stock: starts from `EXTRA_STOCK_COLOR_RGBA`, blends toward pure red as error increases
- gouge: starts from `GOUGE_COLOR_RGBA`, blends toward pure red as error increases

### Non-watertight part mesh

- distance beyond tolerance starts from `EXTRA_STOCK_COLOR_RGBA`, then blends toward pure red

## Important constraint preserved

The display remesh is **not** used for:

- chunk preparation
- focus mesh simulation
- boolean / manifold operations
- proximity query source part mesh

It is only for the exported visualization meshes.

## Files changed

- `src/opencam/simulation/router.py`
- `tests/test_simulation_router.py`

## Tests run

```bash
uv run pytest tests/test_simulation_router.py -q
```

Result: all tests passed.
