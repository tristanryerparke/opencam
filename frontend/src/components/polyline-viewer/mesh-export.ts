import * as THREE from "three";
import { loadMeshGeometry } from "./mesh-loader";
import { isStepFileName } from "./step-geometry";

function vertex(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
) {
  return new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
}

function geometryToAsciiStl(geometry: THREE.BufferGeometry, name: string) {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (!position) {
    throw new Error("Mesh has no positions to export.");
  }

  const lines = [`solid ${name.replace(/\s+/g, "_")}`];
  const triangleCount = index ? index.count / 3 : position.count / 3;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ai = index?.getX(triangle * 3) ?? triangle * 3;
    const bi = index?.getX(triangle * 3 + 1) ?? triangle * 3 + 1;
    const ci = index?.getX(triangle * 3 + 2) ?? triangle * 3 + 2;
    a.copy(vertex(position, ai));
    b.copy(vertex(position, bi));
    c.copy(vertex(position, ci));
    normal.subVectors(b, a).cross(c.clone().sub(a)).normalize();

    lines.push(
      `facet normal ${normal.x} ${normal.y} ${normal.z}`,
      "outer loop",
      `vertex ${a.x} ${a.y} ${a.z}`,
      `vertex ${b.x} ${b.y} ${b.z}`,
      `vertex ${c.x} ${c.y} ${c.z}`,
      "endloop",
      "endfacet",
    );
  }

  lines.push(`endsolid ${name.replace(/\s+/g, "_")}`);
  return lines.join("\n");
}

export async function meshBlobForBackend(source: Blob | string, name: string | null) {
  const sourceUrl = typeof source === "string" ? source : URL.createObjectURL(source);
  try {
    if (!isStepFileName(name)) {
      const blob = typeof source === "string" ? await (await fetch(source)).blob() : source;
      return { blob, name: name ?? "mesh.stl" };
    }

    const geometry = await loadMeshGeometry(sourceUrl);
    try {
      const stlName = (name ?? "mesh.step").replace(/\.st(?:ep|p)$/i, ".stl");
      return {
        blob: new Blob([geometryToAsciiStl(geometry, stlName)], { type: "model/stl" }),
        name: stlName,
      };
    } finally {
      geometry.dispose();
    }
  } finally {
    if (typeof source !== "string") {
      URL.revokeObjectURL(sourceUrl);
    }
  }
}
