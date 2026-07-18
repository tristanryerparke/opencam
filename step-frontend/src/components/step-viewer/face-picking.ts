import * as THREE from "three";
import {
  getSelectedBrepFaceFromIntersection,
  type SelectedBrepFace,
} from "@/lib/step-three";

export function pickBrepFaceFromPointer(
  event: PointerEvent,
  modelRoot: THREE.Object3D,
  camera: THREE.Camera,
  element: HTMLElement,
  raycaster: THREE.Raycaster,
  pointer: THREE.Vector2,
): SelectedBrepFace | null {
  const rect = element.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  const pickables: THREE.Object3D[] = [];
  modelRoot.traverse((child) => {
    if (child instanceof THREE.Mesh && typeof child.userData.stepMeshIndex === "number") {
      pickables.push(child);
    }
  });

  raycaster.setFromCamera(pointer, camera);
  const [intersection] = raycaster.intersectObjects(pickables, false);
  return intersection ? getSelectedBrepFaceFromIntersection(intersection) : null;
}
