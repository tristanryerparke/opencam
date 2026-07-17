import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import "@babylonjs/loaders/STL";

export type ImportedMesh = {
  meshes: Mesh[];
  roots: Node[];
  dispose: () => void;
};

export async function importMesh(meshUrl: string, scene: Scene): Promise<ImportedMesh> {
  const response = await fetch(meshUrl);
  if (!response.ok) throw new Error(`Failed to load mesh (${response.status}).`);

  const contentType = response.headers.get("content-type") ?? "";
  const isGlb = contentType.includes("model/gltf-binary") || meshUrl.toLowerCase().endsWith(".glb");
  const extension = isGlb ? ".glb" : ".stl";
  const file = new File([await response.arrayBuffer()], `mesh${extension}`, { type: contentType });
  const result = await ImportMeshAsync(file, scene, { pluginExtension: extension });
  const nodes = [...result.transformNodes, ...result.meshes];
  const roots = nodes.filter((node) => !node.parent);
  const meshes = result.meshes.filter(
    (mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0,
  );

  if (meshes.length === 0) {
    roots.forEach((node) => node.dispose(false, true));
    throw new Error("Loaded mesh does not contain geometry.");
  }

  return {
    meshes,
    roots,
    dispose: () => roots.forEach((node) => node.dispose(false, true)),
  };
}
