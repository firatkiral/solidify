import * as THREE from "three";
import { Viewport } from "../components/viewport/Viewport";
import LayerManager from "../editor/LayerManager";
import * as visual from '../visual_model/VisualModel';
import { FaceOcclusion } from "./FaceOcclusion";
import * as intersectable from "./Intersectable";
import { ControlPoint, Curve3D, CurveEdge, Face, Region } from "./VisualModel";

type IntersectableWithTopologyItem = THREE.Intersection<intersectable.Raycastable> & {
    topologyItem?: visual.TopologyItem;
};

type Unprojectable = THREE.Intersection<intersectable.Raycastable> & {
    pointOnLine?: THREE.Vector3;
}

type Unprojected = { dist2d: number };

export class GeometryPicker {
    private readonly raycaster = new THREE.Raycaster();

    constructor(
        private readonly layers: LayerManager,
        private readonly raycasterParams: THREE.RaycasterParameters,
    ) {
        this.raycaster.layers = layers.visible as THREE.Layers;
    }

    // The occluders are everything drawn, whose faces hide what's behind them, even when they can't be picked themselves
    intersect(objects: THREE.Object3D[], isXRay = this.viewport.isXRay, occluders: readonly THREE.Object3D[] = objects): intersectable.Intersection[] {
        const { raycaster, viewport } = this;

        this.raycaster.params = this.raycasterParams;
        let intersections = raycaster.intersectObjects(objects, false) as Unprojectable[];
        if (!isXRay) {
            const occlusion = new FaceOcclusion(viewport.camera, occluders, viewport.isShowingFaces);
            intersections = intersections.filter(i => !occlusion.hides(positionOf(i)));
        }
        const unprojected = this.unproject(intersections);
        const sorted = unprojected.sort(sort);
        return raycastable2intersectable(sorted);
    }

    unproject<T extends Unprojectable>(intersections: T[]): (T & Unprojected)[] {
        const camera = this.raycaster.camera;
        for (const intersection of intersections) {
            let projected;
            if (intersection.pointOnLine !== undefined) {
                const point = intersection.pointOnLine;
                projected = point.clone().project(camera);
            } else {
                const point = intersection.point;
                projected = point.clone().project(camera);
            }
            const dist2d = this.normalizedScreenPoint.distanceTo(projected as unknown as THREE.Vector2);
            (intersection as any).dist2d = dist2d;
        }
        return intersections as (T & Unprojected)[];
    }

    private viewport!: Viewport;
    private normalizedScreenPoint!: THREE.Vector2;
    setFromViewport(normalizedScreenPoint: THREE.Vector2, viewport: Viewport) {
        this.raycaster.setFromCamera(normalizedScreenPoint, viewport.camera);
        this.normalizedScreenPoint = normalizedScreenPoint;
        this.viewport = viewport;
    }

}

// Where what was hit is, rather than where the ray passes closest to it: lines and points are hit from a little way off
function positionOf(intersection: Unprojectable): THREE.Vector3 {
    if (intersection.pointOnLine !== undefined) return intersection.pointOnLine;
    const object = intersection.object;
    if (object instanceof ControlPoint) return object.position.clone().applyMatrix4(object.points.matrixWorld);
    return intersection.point;
}

function sort(i1: IntersectableWithTopologyItem & Unprojected, i2: IntersectableWithTopologyItem & Unprojected): number {
    const o1 = i1.object, o2 = i2.object;
    const t1 = o1 instanceof intersectable.RaycastableTopologyItem ? i1.topologyItem! : o1;
    const t2 = o2 instanceof intersectable.RaycastableTopologyItem ? i2.topologyItem! : o2;
    const p1 = t1.priority, p2 = t2.priority;
    if (Math.trunc(p1) === Math.trunc(p2)) {
        // Lines are picked within a threshold around them, so the one nearest the cursor on screen wins; their depths
        // can't tell apart curves drawn in the same plane, seen straight on
        if ((t1 instanceof CurveEdge && t2 instanceof CurveEdge) || (t1 instanceof Curve3D && t2 instanceof Curve3D)) {
            return i1.dist2d - i2.dist2d;
        } else {
            const delta = i1.distance - i2.distance;
            if (Math.abs(delta) < 10e-5) {
                if (p1 != p2) return p1 - p2;
                else return delta;
            } else return delta;
        }
    } else return p1 - p2;
}

declare module './VisualModel' {
    interface ControlPoint { priority: number }
    interface TopologyItem { priority: number }
    interface SpaceItem { priority: number }
    interface PlaneItem { priority: number }
}

ControlPoint.prototype.priority = 1;
Curve3D.prototype.priority = 2;
CurveEdge.prototype.priority = 3;
Region.prototype.priority = 4;
Face.prototype.priority = 4.1;

function raycastable2intersectable(sorted: THREE.Intersection<intersectable.Raycastable>[]): intersectable.Intersection[] {
    const result = [];
    for (const intersection of sorted) {
        const object = intersection.object;
        const i = object instanceof intersectable.RaycastableTopologyItem
            // @ts-expect-error
            ? intersection.topologyItem
            : object;
        result.push({ ...intersection, object: i });
    }
    return result;
}

