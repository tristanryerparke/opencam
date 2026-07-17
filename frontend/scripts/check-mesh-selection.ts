import assert from "node:assert/strict";

import { createMeshFaceSelection, createMeshSelectionData } from "../src/components/polyline-viewer/mesh-selection";

const selection = createMeshFaceSelection(
  createMeshSelectionData(
    [0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0],
    [0, 1, 2, 0, 2, 3],
  ),
  0,
);

assert.equal(selection.triangleCount, 2);
assert.equal(selection.area, 2);
assert.deepEqual(selection.boundaryLoop, [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0], [0, 0, 0]]);
