# Display Remesh / Comparison

Simulation generation exports its normal simplified GLBs. It does not remesh or calculate signed-distance colors per chunk or frame.

`GET /simulate/{simulation_id}/comparison` lazily prepares the final cached-chunk and active meshes, then returns URLs for the two comparison GLBs. Results are cached until the simulation is resampled.

Comparison meshes are remeshed to a **1.0 mm** target edge length, then colored by absolute signed distance to the original stock mesh:

- `< 0.1 mm`: green
- `0.1–0.25 mm`: green-to-blue gradient
- `> 0.25 mm`: blue

The frontend enters this state through **Compare** in the operation context menu; closing its bottom bar returns to the normal viewport.
