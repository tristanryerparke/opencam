import * as THREE from "three";
import type { BrepEdgeLoop } from "@/lib/step-three";

const SNAP_DISTANCE_PX = 10;

function distanceToSegmentSquared(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const x = ax + dx * t;
  const y = ay + dy * t;
  return (px - x) ** 2 + (py - y) ** 2;
}

export function pickNearestEdgeLoopFromPointer(
  event: PointerEvent,
  loops: BrepEdgeLoop[],
  camera: THREE.Camera,
  element: HTMLElement,
): BrepEdgeLoop | null {
  const rect = element.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  let best: BrepEdgeLoop | null = null;
  let bestDistanceSquared = SNAP_DISTANCE_PX ** 2;

  for (const loop of loops) {
    for (let index = 0; index < loop.positions.length; index += 6) {
      start.set(loop.positions[index], loop.positions[index + 1], loop.positions[index + 2]);
      end.set(loop.positions[index + 3], loop.positions[index + 4], loop.positions[index + 5]);
      start.applyMatrix4(loop.mesh.matrixWorld).project(camera);
      end.applyMatrix4(loop.mesh.matrixWorld).project(camera);
      if (start.z < -1 || start.z > 1 || end.z < -1 || end.z > 1) {
        continue;
      }

      const ax = ((start.x + 1) / 2) * rect.width;
      const ay = ((1 - start.y) / 2) * rect.height;
      const bx = ((end.x + 1) / 2) * rect.width;
      const by = ((1 - end.y) / 2) * rect.height;
      const distanceSquared = distanceToSegmentSquared(px, py, ax, ay, bx, by);
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        best = loop;
      }
    }
  }

  return best;
}
