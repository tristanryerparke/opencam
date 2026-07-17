import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

import { TOOL_PREVIEW_COLOR } from "./constants";

export function createSimulationToolMesh(scene: Scene): Mesh {
  const mesh = MeshBuilder.CreateCylinder(
    "simulation-tool-preview",
    { diameter: 1, height: 1, tessellation: 8 },
    scene,
  );
  mesh.rotation.x = Math.PI / 2;

  const material = new StandardMaterial("simulation-tool-preview-material", scene);
  material.diffuseColor = Color3.FromHexString(`#${TOOL_PREVIEW_COLOR.toString(16)}`);
  material.alpha = 0.75;
  material.wireframe = true;
  material.disableDepthWrite = true;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.renderingGroupId = 2;
  return mesh;
}
