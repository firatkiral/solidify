import * as THREE from "three";
import { GridLike, Snap, SnapProjection } from "./Snap";

const Z = new THREE.Vector3(0, 0, 1);

// A point on a reference mesh, where the pointer hit it, facing out from the triangle it hit
export class MeshSurfaceSnap extends Snap {
    readonly name = "Mesh";
    private readonly orientation: THREE.Quaternion;

    constructor(private readonly point: THREE.Vector3, normal: THREE.Vector3) {
        super();
        this.orientation = new THREE.Quaternion().setFromUnitVectors(Z, normal.clone().normalize());
    }

    project(point: THREE.Vector3, snapToGrid?: GridLike): SnapProjection {
        return { position: this.point.clone(), orientation: this.orientation.clone() };
    }

    isValid(point: THREE.Vector3): boolean {
        return point.distanceTo(this.point) < 1e-6;
    }
}
