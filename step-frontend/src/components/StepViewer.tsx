import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useStepViewerStore } from "@/store/use-step-viewer-store";
import { pickNearestEdgeLoopFromPointer } from "./step-viewer/edge-loop-picking";
import { pickBrepFaceFromPointer } from "./step-viewer/face-picking";
import {
  buildStepScene,
  createBrepEdgeLoopLine,
  createBrepFaceHoverPreview,
  createSelectedBrepEdgeLoopLine,
  disposeObject,
  getAllBrepEdgeLoops,
  getBrepFaceEdgeLoops,
  setSelectedBrepFace,
  type BrepEdgeLoop,
  type SelectedBrepFace,
} from "@/lib/step-three";

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

export function StepViewer() {
  const pickMode = useStepViewerStore((state) => state.pickMode);
  const result = useStepViewerStore((state) => state.result);
  const selectedEdgeLoop = useStepViewerStore((state) => state.selectedEdgeLoop);
  const selectedFace = useStepViewerStore((state) => state.selectedFace);
  const selectEdgeLoop = useStepViewerStore((state) => state.selectEdgeLoop);
  const selectFace = useStepViewerStore((state) => state.selectFace);
  const setStats = useStepViewerStore((state) => state.setStats);

  const containerRef: RefObject<HTMLDivElement | null> = useRef(null);
  const viewerRef = useRef<ViewerState | null>(null);
  const pickModeRef = useRef(pickMode);
  const selectedFaceRef = useRef(selectedFace);
  const hoveredFaceRef = useRef<SelectedBrepFace | null>(null);
  const facePreviewRef = useRef<THREE.Object3D | null>(null);
  const edgeLoopsRef = useRef<BrepEdgeLoop[]>([]);
  const hoveredEdgeLoopRef = useRef<BrepEdgeLoop | null>(null);
  const edgeLoopPreviewRef = useRef<THREE.Object3D | null>(null);
  const selectedEdgeLoopLineRef = useRef<THREE.Object3D | null>(null);

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

  const clearEdgeLoopPreview = () => {
    const preview = edgeLoopPreviewRef.current;
    if (preview) {
      preview.parent?.remove(preview);
      disposeObject(preview);
      edgeLoopPreviewRef.current = null;
    }
    hoveredEdgeLoopRef.current = null;
  };

  const clearSelectedEdgeLoopLine = () => {
    const line = selectedEdgeLoopLineRef.current;
    if (line) {
      line.parent?.remove(line);
      disposeObject(line);
      selectedEdgeLoopLineRef.current = null;
    }
  };

  const sameLoop = (a: BrepEdgeLoop | null, b: BrepEdgeLoop | null) =>
    a?.meshIndex === b?.meshIndex && a?.faceIndex === b?.faceIndex && a?.loopIndex === b?.loopIndex;

  const showEdgeLoopPreview = (loop: BrepEdgeLoop) => {
    if (sameLoop(hoveredEdgeLoopRef.current, loop)) {
      return;
    }

    clearEdgeLoopPreview();
    const preview = createBrepEdgeLoopLine(loop);
    loop.mesh.add(preview);
    edgeLoopPreviewRef.current = preview;
    hoveredEdgeLoopRef.current = loop;
  };

  const updateEdgeLoopPreview = (event: PointerEvent, state: ViewerState) => {
    if (edgeLoopsRef.current.length === 0) {
      edgeLoopsRef.current = getAllBrepEdgeLoops(state.modelRoot);
    }

    const loop = pickNearestEdgeLoopFromPointer(
      event,
      edgeLoopsRef.current,
      state.camera,
      state.renderer.domElement,
    );
    if (loop) {
      showEdgeLoopPreview(loop);
    } else {
      clearEdgeLoopPreview();
    }
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
      if (pickModeRef.current === "edge-loop") {
        updateEdgeLoopPreview(event, state);
        return;
      }
      if (pickModeRef.current !== "face") {
        return;
      }

      const selection = pickBrepFaceFromPointer(
        event,
        state.modelRoot,
        state.camera,
        state.renderer.domElement,
        raycaster,
        pointer,
      );
      if (selection) {
        showFacePreview(selection, state);
      } else {
        clearFacePreview();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (pickModeRef.current === "none" || event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (pickModeRef.current === "edge-loop") {
        const loop = hoveredEdgeLoopRef.current;
        if (loop) {
          selectEdgeLoop({
            meshIndex: loop.meshIndex,
            faceIndex: loop.faceIndex,
            loopIndex: loop.loopIndex,
          });
        }
        return;
      }

      const selection = hoveredFaceRef.current ?? pickBrepFaceFromPointer(
        event,
        state.modelRoot,
        state.camera,
        state.renderer.domElement,
        raycaster,
        pointer,
      );
      if (selection) {
        selectFace(selection);
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
    pickModeRef.current = pickMode;
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    viewer.controls.enabled = true;
    viewer.renderer.domElement.style.cursor = pickMode === "none" ? "grab" : "crosshair";
    if (pickMode !== "face") {
      clearFacePreview();
    }
    if (pickMode !== "edge-loop") {
      clearEdgeLoopPreview();
    }
  }, [pickMode]);

  useEffect(() => {
    selectedFaceRef.current = selectedFace;
    clearFacePreview();
    const viewer = viewerRef.current;
    if (viewer) {
      setSelectedBrepFace(viewer.modelRoot, selectedFace);
    }
  }, [selectedFace]);

  useEffect(() => {
    clearEdgeLoopPreview();
    clearSelectedEdgeLoopLine();
    const viewer = viewerRef.current;
    if (!viewer || !selectedEdgeLoop) {
      return;
    }

    const loop = getBrepFaceEdgeLoops(viewer.modelRoot, selectedEdgeLoop).find(
      (candidate) => candidate.loopIndex === selectedEdgeLoop.loopIndex,
    );
    if (!loop) {
      return;
    }

    const line = createSelectedBrepEdgeLoopLine(loop);
    loop.mesh.add(line);
    selectedEdgeLoopLineRef.current = line;
  }, [selectedEdgeLoop]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    edgeLoopsRef.current = [];
    clearFacePreview();
    clearEdgeLoopPreview();
    clearSelectedEdgeLoopLine();
    clearGroup(viewer.modelRoot);
    if (!result) {
      setStats(null);
      fitCameraToObject(viewer.modelRoot, viewer.camera, viewer.controls);
      return;
    }

    const { group, stats } = buildStepScene(result);
    viewer.modelRoot.add(group);
    setSelectedBrepFace(viewer.modelRoot, selectedFaceRef.current);
    setStats(stats);
    fitCameraToObject(viewer.modelRoot, viewer.camera, viewer.controls);
  }, [result, setStats]);

  return <div ref={containerRef} className="viewer" />;
}
