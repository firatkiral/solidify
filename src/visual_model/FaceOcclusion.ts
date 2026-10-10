import * as THREE from "three";
import * as visual from "./VisualModel";
import { raycastFaces } from "./VisualModelRaycasting";

// A face nearer than a point by this much of the distance to it is in front of it; any less and the point is on the
// face, as its edges and corners are
const tolerance = 1e-3;

// The solids' faces, while they're drawn, hide whatever is behind them from the camera
export class FaceOcclusion {
    private readonly raycaster = new THREE.Raycaster();
    private readonly solids: readonly visual.Solid[];
    private readonly intersections: THREE.Intersection[] = [];
    private readonly projected = new THREE.Vector3();
    private readonly normalized = new THREE.Vector2();

    constructor(private readonly camera: THREE.Camera, objects: readonly THREE.Object3D[], showingFaces: boolean) {
        this.solids = showingFaces ? objects.filter((o): o is visual.Solid => o instanceof visual.Solid) : [];
        this.raycaster.layers.enableAll();
    }

    // Whether a face is between the camera and the point
    hides(point: THREE.Vector3): boolean {
        const { raycaster, camera, projected, normalized } = this;
        projected.copy(point).project(camera);
        normalized.set(projected.x, projected.y);
        raycaster.setFromCamera(normalized, camera);
        return this.isFaceNearer(raycaster.ray.origin.distanceTo(point));
    }

    // Whether a face is nearer than the distance along the ray
    hidesAlong(ray: THREE.Ray, distance: number): boolean {
        this.raycaster.ray.copy(ray);
        return this.isFaceNearer(distance);
    }

    private isFaceNearer(distance: number) {
        const { raycaster, intersections } = this;
        const limit = distance * (1 - tolerance);
        for (const solid of this.solids) {
            intersections.length = 0;
            raycastFaces(solid, raycaster, intersections);
            for (const intersection of intersections) {
                if (intersection.distance < limit) return true;
            }
        }
        return false;
    }
}
