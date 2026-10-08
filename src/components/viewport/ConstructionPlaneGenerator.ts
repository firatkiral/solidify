import * as THREE from "three";
import c3d from '../../kernel/kernel';
import { DatabaseLike } from "../../editor/DatabaseLike";
import { PlaneDatabase } from "../../editor/PlaneDatabase";
import { ConstructionPlane, ConstructionPlaneSnap, FaceConstructionPlaneSnap } from "../../editor/snaps/ConstructionPlaneSnap";
import { FaceSnap } from "../../editor/snaps/Snaps";
import { SnapManager } from "../../editor/snaps/SnapManager";
import { HasSelection } from '../../selection/SelectionDatabase';
import { inst2curve, point2point, vec2vec } from "../../util/Conversion";
import * as visual from '../../visual_model/VisualModel';
import { NavigationTarget } from './ViewportGeometryNavigator';
import { Orientation } from "./ViewportNavigator";

// What the viewport is showing when the plane is made: the current plane and the camera.
export type PlaneContext = { cplane: ConstructionPlane, cameraOrientation: THREE.Quaternion };

export class ConstructionPlaneGenerator {
    constructor(private readonly db: DatabaseLike, private readonly planes: PlaneDatabase, private readonly snaps: SnapManager) { }

    constructionPlaneForSelection(selection: HasSelection, context: PlaneContext): NavigationTarget | undefined {
        const { faces, edges, regions, curves, controlPoints } = selection;
        if (faces.size === 1 && edges.size > 0) return this.constructionPlaneForFaceAndEdge(faces.first, edges.first);
        if (faces.size > 1) return this.constructionPlaneForFaces([...faces]);
        if (faces.size === 1) return this.constructionPlaneForFace(faces.first);
        if (regions.size > 0) return this.constructionPlaneForRegion(regions.first);
        if (edges.size > 0) return this.constructionPlaneForEdge(edges.first, context);
        if (curves.size > 0) return this.constructionPlaneForCurve(curves.first, context);
        if (controlPoints.size > 0) return this.constructionPlaneForControlPoints([...controlPoints], context);
    }

    // Faces on average: the mean of their normals, through the middle of their centers.
    constructionPlaneForFaces(views: visual.Face[]): NavigationTarget {
        const normals = [], centers = [];
        for (const view of views) {
            const { point, normal } = this.db.lookupTopologyItem(view).GetAnyPointOn();
            normals.push(vec2vec(normal, 1).normalize());
            centers.push(point2point(point));
        }
        const normal = normals.reduce((sum, n) => sum.add(n), new THREE.Vector3());
        if (normal.lengthSq() < 1e-10) normal.copy(normals[0]); // e.g. two opposite faces
        const center = centers.reduce((sum, c) => sum.add(c), new THREE.Vector3()).divideScalar(centers.length);
        const cplane = this.planes.temp(new ConstructionPlaneSnap(normal.normalize(), center));
        return { tag: 'selection', targets: new Set(views), cplane };
    }

    // A straight edge gets a plane containing it, facing out between its two faces; any other edge gets the plane it lies in.
    constructionPlaneForEdge(view: visual.CurveEdge, context: PlaneContext): NavigationTarget {
        const model = this.db.lookupTopologyItem(view);
        const curve = model.GetSpaceCurve();
        let cplane: ConstructionPlaneSnap;
        if (curve?.IsStraight(true)) {
            const begin = point2point(model.GetBegPoint()), end = point2point(model.GetEndPoint());
            const middle = model.Point(0.5);
            const outward = new THREE.Vector3();
            for (const face of [model.GetFacePlus(), model.GetFaceMinus()]) {
                if (face !== null) outward.add(vec2vec(face.NearPointProjection(middle).normal, 1).normalize());
            }
            cplane = this.planeContainingLine(begin, end, outward, context);
        } else {
            cplane = this.planeThroughPoints(samples(t => point2point(model.Point(t))), context);
        }
        return { tag: 'selection', targets: new Set([view]), cplane };
    }

    // A straight curve gets a plane containing it, facing the camera; any other curve gets the plane it lies in.
    constructionPlaneForCurve(view: visual.SpaceInstance<visual.Curve3D>, context: PlaneContext): NavigationTarget {
        const curve = inst2curve(this.db.lookup(view))!;
        const cplane = curve.IsStraight(true)
            ? this.planeContainingLine(point2point(curve.GetLimitPoint(1)), point2point(curve.GetLimitPoint(2)), new THREE.Vector3(), context)
            : this.planeThroughPoints(samples(t => point2point(curve.PointOn(curve.GetTMin() + t * (curve.GetTMax() - curve.GetTMin())))), context);
        return { tag: 'selection', targets: new Set([view.underlying]), cplane };
    }

    // One point moves the current plane onto it, two points give a plane containing both, more give the best-fitting plane.
    constructionPlaneForControlPoints(views: visual.ControlPoint[], context: PlaneContext): NavigationTarget {
        const points = views.map(view => view.position.clone().applyMatrix4(view.points.matrixWorld));
        const cplane = points.length === 1
            ? this.planes.temp(new ConstructionPlaneSnap(context.cplane.n, points[0], context.cplane.x))
            : this.planeThroughPoints(points, context);
        return { tag: 'selection', targets: new Set(views), cplane };
    }

    private planeThroughPoints(points: THREE.Vector3[], context: PlaneContext): ConstructionPlaneSnap {
        const centroid = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(points.length);
        const normal = bestFitNormal(points, centroid);
        if (normal === undefined) { // the points are on a line, or all in one spot
            const far = points.reduce((best, p) => p.distanceToSquared(points[0]) > best.distanceToSquared(points[0]) ? p : best, points[0]);
            if (far.distanceToSquared(points[0]) < 1e-20) return this.planes.temp(new ConstructionPlaneSnap(context.cplane.n, points[0], context.cplane.x));
            return this.planeContainingLine(points[0], far, new THREE.Vector3(), context);
        }
        if (normal.dot(towardCamera(context)) < 0) normal.negate();
        // Center on the points' bounding box (e.g. a circle's center) rather than their average, kept on the plane.
        const center = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
        center.addScaledVector(normal, -normal.dot(center.clone().sub(centroid)));
        return this.planes.temp(new ConstructionPlaneSnap(normal, center));
    }

    // The plane through the segment begin-end whose normal is as close as possible to `preferred`, else to the camera.
    private planeContainingLine(begin: THREE.Vector3, end: THREE.Vector3, preferred: THREE.Vector3, context: PlaneContext): ConstructionPlaneSnap {
        const direction = end.clone().sub(begin).normalize();
        const middle = begin.clone().add(end).multiplyScalar(0.5);
        for (const candidate of [preferred, towardCamera(context), context.cplane.n, new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)]) {
            const normal = candidate.clone().addScaledVector(direction, -candidate.dot(direction));
            if (normal.lengthSq() > 1e-10) return this.planes.temp(new ConstructionPlaneSnap(normal.normalize(), middle, direction));
        }
        throw new Error("unreachable: no perpendicular to " + direction.toArray());
    }

    constructionPlaneForRegion(to: visual.PlaneInstance<visual.Region>): NavigationTarget {
        const { db, planes } = this;
        const model = db.lookup(to);
        const placement = model.GetPlacement();
        const normal = vec2vec(placement.GetAxisZ(), 1);
        const cube = new c3d.Cube();
        model.AddYourGabaritTo(cube);
        const min = point2point(cube.pmin), max = point2point(cube.pmax);
        const target = min.add(max).multiplyScalar(0.5);
        const cplane = planes.temp(new ConstructionPlaneSnap(normal, target));
        return { tag: 'region', target: to, cplane }
    }

    constructionPlaneForFace(to: visual.Face): NavigationTarget {
        const { db, planes, snaps } = this;
        const model = db.lookupTopologyItem(to);
        const placement = model.GetControlPlacement();
        model.OrientPlacement(placement);
        placement.Normalize(); // FIXME: for some reason necessary with curved faces
        const normal = vec2vec(placement.GetAxisY(), 1);
        const target = point2point(model.Point(0.5, 0.5));
        const faceSnap = snaps.identityMap.lookup(to) as FaceSnap;
        const cplane = planes.temp(new FaceConstructionPlaneSnap(normal, target, undefined, faceSnap));
        return { tag: 'face', targets: new Set([to]), cplane }
    }

    constructionPlaneForFaceAndEdge(faceView: visual.Face, edgeView: visual.CurveEdge): NavigationTarget {
        const { db, planes, snaps } = this;
        const faceModel = db.lookupTopologyItem(faceView);
        const edgeModel = db.lookupTopologyItem(edgeView);
        const placement = faceModel.GetControlPlacement();
        faceModel.OrientPlacement(placement);
        placement.Normalize(); // FIXME: for some reason necessary with curved faces
        const normal = vec2vec(placement.GetAxisY(), 1);
        const target = point2point(faceModel.Point(0.5, 0.5));
        const faceSnap = snaps.identityMap.lookup(faceView) as FaceSnap;
        const x = vec2vec(edgeModel.GetBegTangent(), 1);
        const cplane = planes.temp(new FaceConstructionPlaneSnap(normal, target, x, faceSnap));
        return { tag: 'face', targets: new Set([faceView, edgeView]), cplane }
    }

    // A plane parallel to the screen: its normal faces the camera and its x axis is the screen's horizontal.
    constructionPlaneForCamera(cameraOrientation: THREE.Quaternion, through = new THREE.Vector3()): ConstructionPlaneSnap {
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(cameraOrientation).normalize();
        const x = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraOrientation).normalize();
        return this.planes.temp(new ConstructionPlaneSnap(normal, through, x));
    }

    constructionPlaneForOrientation(to: Orientation): NavigationTarget {
        switch (to) {
            case Orientation.posX: return { tag: 'orientation', cplane: PlaneDatabase.YZ };
            case Orientation.posY: return { tag: 'orientation', cplane: PlaneDatabase.XZ };
            case Orientation.posZ: return { tag: 'orientation', cplane: PlaneDatabase.XY };
            case Orientation.negX: return { tag: 'orientation', cplane: PlaneDatabase._YZ };
            case Orientation.negY: return { tag: 'orientation', cplane: PlaneDatabase._XZ };
            case Orientation.negZ: return { tag: 'orientation', cplane: PlaneDatabase._XY };
        }
    }
}

// Points along a curve, for t from 0 to 1.
function samples(pointAt: (t: number) => THREE.Vector3, count = 64): THREE.Vector3[] {
    const result = [];
    for (let i = 0; i <= count; i++) result.push(pointAt(i / count));
    return result;
}

function towardCamera(context: PlaneContext) {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(context.cameraOrientation);
}

// Normal of the least-squares plane through the points; undefined when they lie on a line.
function bestFitNormal(points: THREE.Vector3[], centroid: THREE.Vector3): THREE.Vector3 | undefined {
    if (points.length < 3) return;
    let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
    const r = new THREE.Vector3();
    for (const p of points) {
        r.copy(p).sub(centroid);
        xx += r.x * r.x; xy += r.x * r.y; xz += r.x * r.z;
        yy += r.y * r.y; yz += r.y * r.z; zz += r.z * r.z;
    }
    // The normal is the axis the points spread least along; solve the covariance with the best-conditioned axis fixed.
    const detX = yy * zz - yz * yz, detY = xx * zz - xz * xz, detZ = xx * yy - xy * xy;
    const max = Math.max(detX, detY, detZ);
    const spread = xx + yy + zz;
    if (max <= 1e-9 * spread * spread) return;
    if (max === detX) return new THREE.Vector3(detX, xz * yz - xy * zz, xy * yz - xz * yy).normalize();
    if (max === detY) return new THREE.Vector3(xz * yz - xy * zz, detY, xy * xz - yz * xx).normalize();
    return new THREE.Vector3(xy * yz - xz * yy, xy * xz - yz * xx, detZ).normalize();
}
