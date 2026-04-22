import * as THREE from "three";

import { State } from "@/simulation/scs/state";

export class ScreenPlaneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly state: State;
  private readonly target: THREE.WebGLRenderTarget | null;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly plane: THREE.Mesh;

  constructor(
    renderer: THREE.WebGLRenderer,
    state: State,
    target: THREE.WebGLRenderTarget | null = null,
  ) {
    this.renderer = renderer;
    this.state = state;
    this.target = target;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this.scene.add(this.plane);
  }

  render(material?: THREE.Texture | THREE.Material) {
    const previousMaterial = this.plane.material;
    const planeMaterial = this.plane.material as THREE.MeshBasicMaterial;

    if (material instanceof THREE.Texture) {
      planeMaterial.map = material;
      planeMaterial.needsUpdate = true;
    } else if (material) {
      this.plane.material = material;
    }

    const gl = this.renderer.getContext();

    this.state.push();
    this.state.set({
      cullFace: gl.BACK,
    });

    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);

    this.state.pop();

    if (material instanceof THREE.Texture) {
      planeMaterial.map = null;
      planeMaterial.needsUpdate = true;
    } else if (material) {
      this.plane.material = previousMaterial;
    }
  }

  dispose() {
    this.plane.geometry.dispose();
    const materials = Array.isArray(this.plane.material)
      ? this.plane.material
      : [this.plane.material];

    materials.forEach((material) => material.dispose());
  }
}
