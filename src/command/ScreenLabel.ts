import * as THREE from "three";
import { Helper } from "../util/Helpers";

// Labels stand this many pixels clear of what they mark
const gap = 8;

const p = new THREE.Vector3(), q = new THREE.Vector3(), side = new THREE.Vector3();
const scratch = new THREE.Object3D();

// Places a label, centred on its left and top as .axis-helper and the dimension labels are, clear of a point on screen:
// past it, the way direction points there, by radius (in world units around the point) as it shows on screen, a gap,
// and half the label's own size that way, so it never covers what's at the point at any zoom or angle. Looking straight
// down direction, it goes up. Returns whether the point is in front of the camera; the caller hides the label if not.
export function placeClear(element: HTMLElement, viewport: { camera: THREE.Camera, domElement: HTMLElement }, at: THREE.Vector3, direction: THREE.Vector3, radius = 0): boolean {
    const { camera } = viewport;
    const rect = viewport.domElement.getBoundingClientRect();
    const toPixels = (v: THREE.Vector3) => v.set((1 + v.x) / 2 * rect.width, (1 - v.y) / 2 * rect.height, v.z);

    // A step along direction of about a gizmo's size on screen: in front of the camera, and long enough to show its way
    scratch.scale.set(1, 1, 1);
    const step = Helper.scaleIndependentOfZoom(scratch, camera, at);
    q.copy(direction).normalize().multiplyScalar(step).add(at).project(camera);
    p.copy(at).project(camera);
    const inFront = p.z >= -1 && p.z <= 1;
    toPixels(p); toPixels(q);

    let dx = q.x - p.x, dy = q.y - p.y;
    const length = Math.hypot(dx, dy);
    if (length < 2) { dx = 0; dy = -1 } else { dx /= length; dy /= length }

    let reach = gap + Math.abs(dx) * element.offsetWidth / 2 + Math.abs(dy) * element.offsetHeight / 2;
    if (radius > 0) {
        side.setFromMatrixColumn(camera.matrixWorld, 0).normalize().multiplyScalar(radius).add(at).project(camera);
        toPixels(side);
        reach += Math.hypot(side.x - p.x, side.y - p.y);
    }

    element.style.left = p.x + dx * reach + 'px';
    element.style.top = p.y + dy * reach + 'px';
    return inFront;
}
