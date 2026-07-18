import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { OcctReadResult } from "occt-import-js";
import {
  buildStepScene,
  createBrepFaceHoverPreview,
  disposeObject,
  getSelectedBrepFaceFromIntersection,
  setSelectedBrepFace,
  type SelectedBrepFace,
  type StepSceneStats,
} from "@/lib/step-three";

type StepViewerProps = {
  result: OcctReadResult | null;
  pickingMode: boolean;
  selectedFace: SelectedBrepFace | null;
  onFacePick: (selection: SelectedBrepFace) => void;
  onStatsChange: (stats: StepSceneStats | null) => void;
};

type ViewerState = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  modelRoot: THREE.Group;
  animationFrame: number;
};

const EMPTY_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-50, -50, -50),
  new THREE.Vector3(50, 50, 50),
);

function clearGroup(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeObject(child);
  }
}

function fitCameraToObject(
  object: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
) {
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) {
    bounds.copy(EMPTY_BOUNDS);
  }

  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  const distance = maxDimension / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const radius = size.length() * 0.5;

  camera.position.set(
    center.x + distance * 1.35,
    center.y - distance * 1.15,
    center.z + distance * 0.85,
  );
  camera.near = Math.max(0.001, radius / 10_000);
  camera.far = Math.max(camera.near * 100, distance + radius * 8);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = Math.max(maxDimension * 0.0005, 0.01);
  controls.maxDistance = Math.max(maxDimension * 20, distance * 4);
  controls.update();
}

function setupViewer(container: HTMLDivElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf8fafc);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.up.set(0, 0, 1);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.className = "viewer-canvas";
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(80, -60, 120);
  scene.add(light);

  const grid = new THREE.GridHelper(200, 20, 0x94a3b8, 0xcbd5e1);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);

  const axes = new THREE.AxesHelper(40);
  scene.add(axes);

  const modelRoot = new THREE.Group();
  scene.add(modelRoot);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.screenSpacePanning = true;
  controls.mouseButtons = {
    LEFT: null,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };

  const resize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  let animationFrame = 0;
  const render = () => {
    controls.update();
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(render);
  };
  render();

  return {
    state: { scene, camera, renderer, controls, modelRoot, animationFrame },
    dispose: () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      clearGroup(modelRoot);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

export function StepViewer({
  result,
  pickingMode,
  selectedFace,
  onFacePick,
  onStatsChange,
}: StepViewerProps) {
  const containerRef: RefObject<HTMLDivElement | null> = useRef(null);
  const viewerRef = useRef<ViewerState | null>(null);
  const pickingModeRef = useRef(pickingMode);
  const selectedFaceRef = useRef(selectedFace);
  const hoveredFaceRef = useRef<SelectedBrepFace | null>(null);
  const facePreviewRef = useRef<THREE.Object3D | null>(null);
  const onFacePickRef = useRef(onFacePick);

  const clearFacePreview = () => {
    const preview = facePreviewRef.current;
    if (preview) {
      preview.parent?.remove(preview);
      disposeObject(preview);
      facePreviewRef.current = null;
    }
    hoveredFaceRef.current = null;
  };

  const sameFace = (a: SelectedBrepFace | null, b: SelectedBrepFace | null) =>
    a?.meshIndex === b?.meshIndex && a?.faceIndex === b?.faceIndex;

  const showFacePreview = (selection: SelectedBrepFace, state: ViewerState) => {
    if (sameFace(hoveredFaceRef.current, selection)) {
      return;
    }

    clearFacePreview();
    const built = createBrepFaceHoverPreview(state.modelRoot, selection);
    if (!built) {
      return;
    }

    built.mesh.add(built.preview);
    facePreviewRef.current = built.preview;
    hoveredFaceRef.current = selection;
  };

  const pickFace = (
    event: PointerEvent,
    state: ViewerState,
    raycaster: THREE.Raycaster,
    pointer: THREE.Vector2,
  ) => {
    const rect = state.renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const pickables: THREE.Object3D[] = [];
    state.modelRoot.traverse((child) => {
      if (child instanceof THREE.Mesh && typeof child.userData.stepMeshIndex === "number") {
        pickables.push(child);
      }
    });

    raycaster.setFromCamera(pointer, state.camera);
    const [intersection] = raycaster.intersectObjects(pickables, false);
    return intersection ? getSelectedBrepFaceFromIntersection(intersection) : null;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const { state, dispose } = setupViewer(container);
    viewerRef.current = state;
    fitCameraToObject(state.modelRoot, state.camera, state.controls);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handlePointerMove = (event: PointerEvent) => {
      if (!pickingModeRef.current) {
        return;
      }

      const selection = pickFace(event, state, raycaster, pointer);
      if (selection) {
        showFacePreview(selection, state);
      } else {
        clearFacePreview();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!pickingModeRef.current) {
        return;
      }
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const selection = hoveredFaceRef.current ?? pickFace(event, state, raycaster, pointer);
      if (selection) {
        onFacePickRef.current(selection);
      }
    };
    state.renderer.domElement.addEventListener("pointermove", handlePointerMove, true);
    state.renderer.domElement.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      state.renderer.domElement.removeEventListener("pointermove", handlePointerMove, true);
      state.renderer.domElement.removeEventListener("pointerdown", handlePointerDown, true);
      viewerRef.current = null;
      dispose();
    };
  }, []);

  useEffect(() => {
    onFacePickRef.current = onFacePick;
  }, [onFacePick]);

  useEffect(() => {
    pickingModeRef.current = pickingMode;
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    viewer.controls.enabled = true;
    viewer.renderer.domElement.style.cursor = pickingMode ? "crosshair" : "grab";
    if (!pickingMode) {
      clearFacePreview();
    }
  }, [pickingMode]);

  useEffect(() => {
    selectedFaceRef.current = selectedFace;
    clearFacePreview();
    const viewer = viewerRef.current;
    if (viewer) {
      setSelectedBrepFace(viewer.modelRoot, selectedFace);
    }
  }, [selectedFace]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    clearFacePreview();
    clearGroup(viewer.modelRoot);
    if (!result) {
      onStatsChange(null);
      fitCameraToObject(viewer.modelRoot, viewer.camera, viewer.controls);
      return;
    }

    const { group, stats } = buildStepScene(result);
    viewer.modelRoot.add(group);
    setSelectedBrepFace(viewer.modelRoot, selectedFaceRef.current);
    onStatsChange(stats);
    fitCameraToObject(viewer.modelRoot, viewer.camera, viewer.controls);
  }, [onStatsChange, result]);

  return <div ref={containerRef} className="viewer" />;
}
