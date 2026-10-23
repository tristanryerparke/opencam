import * as THREE from "three";

export function drawMeshDirect(
  renderer: THREE.WebGLRenderer,
  object: THREE.Object3D,
  camera: THREE.Camera,
  material?: THREE.Material | THREE.Material[],
) {
  if (!object.visible) {
    return;
  }

  if (object instanceof THREE.Scene || object instanceof THREE.Group) {
    object.children.forEach((child) => {
      drawMeshDirect(renderer, child, camera, material);
    });
    return;
  }

  if (!(object instanceof THREE.Mesh)) {
    return;
  }

  object.updateMatrixWorld(true);

  const directRenderer = renderer as THREE.WebGLRenderer & {
    renderBufferDirect: (
      camera: THREE.Camera,
      scene: THREE.Scene | null,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      object: THREE.Object3D,
      group: THREE.Group | null,
    ) => void;
  };

  const activeMaterial = Array.isArray(material)
    ? material[0]
    : material ?? (Array.isArray(object.material) ? object.material[0] : object.material);

  directRenderer.renderBufferDirect(
    camera,
    null,
    object.geometry,
    activeMaterial,
    object,
    null,
  );
}

export function createRenderTarget(
  width: number,
  height: number,
  depth = true,
  stencil = true,
) {
  return new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: depth,
    stencilBuffer: stencil,
  });
}
