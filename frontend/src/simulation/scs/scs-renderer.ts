import * as THREE from "three";

import { alphaFilterMaterial, alphaIdMaterial } from "@/simulation/scs/materials";
import { ScreenPlaneRenderer } from "@/simulation/scs/screen-plane-renderer";
import { State } from "@/simulation/scs/state";
import { createRenderTarget, drawMeshDirect } from "@/simulation/scs/utils";

const NOOP_AFTER_RENDER: THREE.Object3D["onAfterRender"] = () => {};

export class SCSRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly state: State;
  private renderTarget: THREE.WebGLRenderTarget | null;
  private fb1: THREE.WebGLRenderTarget;
  private fb2: THREE.WebGLRenderTarget;
  private dummyTarget: THREE.WebGLRenderTarget;
  private planeRenderer: ScreenPlaneRenderer;
  private readonly size = new THREE.Vector2();

  constructor(
    renderer: THREE.WebGLRenderer,
    renderTarget: THREE.WebGLRenderTarget | null = null,
  ) {
    this.renderer = renderer;
    this.renderTarget = renderTarget;
    this.state = new State(renderer.getContext());

    this.renderer.getSize(this.size);
    this.fb1 = createRenderTarget(this.size.x, this.size.y);
    this.fb2 = createRenderTarget(this.size.x, this.size.y);
    this.dummyTarget = createRenderTarget(this.size.x, this.size.y);
    this.planeRenderer = new ScreenPlaneRenderer(renderer, this.state, renderTarget);
  }

  private ensureTargets() {
    const nextSize = this.renderer.getSize(this.size);

    if (this.fb1.width === nextSize.x && this.fb1.height === nextSize.y) {
      return;
    }

    this.fb1.dispose();
    this.fb2.dispose();
    this.dummyTarget.dispose();
    this.planeRenderer.dispose();

    this.fb1 = createRenderTarget(nextSize.x, nextSize.y);
    this.fb2 = createRenderTarget(nextSize.x, nextSize.y);
    this.dummyTarget = createRenderTarget(nextSize.x, nextSize.y);
    this.planeRenderer = new ScreenPlaneRenderer(this.renderer, this.state, this.renderTarget);
  }

  renderSubtract(
    scene: THREE.Scene,
    camera: THREE.Camera,
    primitive: THREE.Mesh,
    sequence: THREE.Mesh[],
    other: THREE.Mesh,
  ) {
    this.ensureTargets();
    this.state.push();

    const gl = this.renderer.getContext();

    primitive.updateMatrixWorld(true);
    sequence.forEach((mesh) => mesh.updateMatrixWorld(true));
    other.updateMatrixWorld(true);

    const render = () => {
      this.renderer.setRenderTarget(this.fb2);
      this.renderer.clear();

      this.renderer.setRenderTarget(this.fb1);
      this.renderer.clear();

      this.state.set({
        colorMask: [true, true, true, true],
        depthTest: true,
        depthMask: true,
        depthFunc: gl.ALWAYS,
        stencilTest: false,
        faceCulling: true,
        cullFace: gl.BACK,
      });

      drawMeshDirect(this.renderer, primitive, camera, alphaIdMaterial(1));

      let stencilRef = 0;
      let id = 1;

      for (let index = 0; index < sequence.length; index += 1) {
        stencilRef += 1;
        id += 1;

        this.state.set({
          colorMask: [false, false, false, false],
          depthTest: true,
          depthMask: false,
          depthFunc: gl.LESS,
          stencilTest: true,
          stencilMask: ~0,
          stencilFunc: [gl.ALWAYS, stencilRef, ~0],
          stencilOp: [gl.KEEP, gl.KEEP, gl.REPLACE],
          faceCulling: true,
          cullFace: gl.BACK,
        });

        drawMeshDirect(this.renderer, sequence[index], camera);

        this.state.set({
          colorMask: [true, true, true, true],
          faceCulling: true,
          cullFace: gl.FRONT,
          depthMask: true,
          depthFunc: gl.GREATER,
          stencilFunc: [gl.EQUAL, stencilRef, ~0],
          stencilOp: [gl.ZERO, gl.ZERO, gl.ZERO],
        });

        drawMeshDirect(this.renderer, sequence[index], camera, alphaIdMaterial(id));
      }

      this.state.set({
        colorMask: [true, true, true, true],
        depthMask: false,
        stencilTest: false,
        cullFace: gl.FRONT,
        depthFunc: gl.LESS,
      });
      drawMeshDirect(this.renderer, primitive, camera, alphaIdMaterial(0));

      other.visible = true;
      id += 1;

      this.state.set({
        colorMask: [true, true, true, true],
        depthTest: true,
        depthMask: false,
        depthFunc: gl.LESS,
        stencilTest: false,
        stencilMask: 0,
        stencilFunc: [gl.ALWAYS, stencilRef, ~0],
        stencilOp: [gl.KEEP, gl.KEEP, gl.REPLACE],
        faceCulling: true,
        cullFace: gl.BACK,
      });

      primitive.visible = false;
      sequence.forEach((mesh) => {
        mesh.visible = false;
      });
      this.renderer.setRenderTarget(this.fb1);
      drawMeshDirect(this.renderer, scene, camera, alphaIdMaterial(id));
      primitive.visible = true;
      sequence.forEach((mesh) => {
        mesh.visible = true;
      });
      other.visible = false;

      this.renderer.setRenderTarget(this.fb2);
      this.state.set({
        colorMask: [true, true, true, true],
        faceCulling: true,
        cullFace: gl.BACK,
        depthMask: false,
        depthFunc: gl.LESS,
        depthTest: false,
        stencilTest: false,
      });

      drawMeshDirect(this.renderer, primitive, camera);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      this.renderer.setRenderTarget(this.renderTarget);
      this.planeRenderer.render(
        alphaFilterMaterial(1, this.fb1.texture, this.fb2.texture),
      );
      gl.disable(gl.BLEND);
      this.renderer.setRenderTarget(null);
    };

    const renderSequenceSurface = (index: number) => () => {
      const id = index + 2;
      const mesh = sequence[index];

      this.renderer.setRenderTarget(this.fb2);

      this.state.set({
        cullFace: gl.FRONT,
        depthMask: true,
        depthFunc: gl.LESS,
        depthTest: false,
        stencilTest: false,
      });

      drawMeshDirect(this.renderer, mesh, camera);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      this.renderer.setRenderTarget(this.renderTarget);
      this.planeRenderer.render(
        alphaFilterMaterial(id, this.fb1.texture, this.fb2.texture),
      );

      gl.disable(gl.BLEND);
      this.renderer.setRenderTarget(null);
    };

    const renderOther = () => {
      this.renderer.setRenderTarget(this.fb2);
      this.renderer.clear();

      this.state.set({
        cullFace: gl.BACK,
        depthMask: true,
        depthFunc: gl.LESS,
        depthTest: true,
        stencilTest: false,
      });

      primitive.visible = false;
      sequence.forEach((mesh) => {
        mesh.visible = false;
      });
      const previousAfterRender = scene.onAfterRender;
      scene.onAfterRender = NOOP_AFTER_RENDER;
      try {
        this.renderer.render(scene, camera);
      } finally {
        scene.onAfterRender = previousAfterRender;
        primitive.visible = true;
        sequence.forEach((mesh) => {
          mesh.visible = true;
        });
        other.visible = false;
      }

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      this.renderer.setRenderTarget(this.renderTarget);
      this.planeRenderer.render(
        alphaFilterMaterial(
          sequence.length + 2,
          this.fb1.texture,
          this.fb2.texture,
          true,
        ),
      );

      gl.disable(gl.BLEND);
      this.renderer.setRenderTarget(null);
    };

    other.visible = true;
    scene.onAfterRender = render;
    this.renderer.setRenderTarget(this.dummyTarget);
    this.renderer.render(scene, camera);
    other.visible = false;
    scene.onAfterRender = NOOP_AFTER_RENDER;

    for (let index = 0; index < sequence.length; index += 1) {
      scene.onAfterRender = renderSequenceSurface(index);
      this.renderer.setRenderTarget(this.dummyTarget);
      this.renderer.render(scene, camera);
    }

    scene.onAfterRender = renderOther;
    other.visible = true;
    this.renderer.setRenderTarget(this.dummyTarget);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    scene.onAfterRender = NOOP_AFTER_RENDER;

    this.state.pop();
  }

  dispose() {
    this.fb1.dispose();
    this.fb2.dispose();
    this.dummyTarget.dispose();
    this.planeRenderer.dispose();
  }
}
