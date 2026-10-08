import * as THREE from "three";
import c3d from '../../kernel/kernel';
import { deunit, inst2curve, point2point, unit, vec2vec } from "../../util/Conversion";
import { GeometryFactory } from '../../command/GeometryFactory';
import { DatabaseLike } from "../../editor/DatabaseLike";
import * as visual from "../../visual_model/VisualModel";

export class CenterPointArcFactory extends GeometryFactory {
    center!: THREE.Vector3;
    p2!: THREE.Vector3;
    p3!: THREE.Vector3;
    orientation = new THREE.Quaternion();

    private readonly Cp2 = new THREE.Vector3();
    private readonly Cp3 = new THREE.Vector3();
    private readonly cross = new THREE.Vector3();
    private readonly normal = new THREE.Vector3();

    private lastQuadrant = 0;
    private sense = false;

    async calculate() {
        const { center, p2, p3, Cp2, Cp3, cross, normal, orientation } = this;
        normal.copy(Z).applyQuaternion(orientation);

        Cp2.copy(p2).sub(center);
        Cp3.copy(p3).sub(center);

        const dot = Cp2.dot(Cp3);
        cross.crossVectors(Cp2, Cp3);

        let quadrant;
        const crossDotN = cross.dot(normal);
        if (dot > 0) {
            if (crossDotN > 0) quadrant = 3;
            else quadrant = 0;
        } else {
            if (crossDotN > 0) quadrant = 2;
            else quadrant = 1;
        }

        const diff = quadrant - this.lastQuadrant;
        if (diff == -3 || diff == 3) {
            this.sense = crossDotN > 0;
        }
        this.lastQuadrant = quadrant;

        // if (cross.manhattanLength() < 10e-6) throw new ValidationError();

        const z = vec2vec(normal, 1);
        const circle = new c3d.Arc3D(point2point(center), point2point(p2), point2point(p3), z, this.sense ? 1 : -1);

        return new c3d.SpaceInstance(circle);
    }

    // The arc runs from p2 around the axis by the angle (in [0, 2π)) to p3's direction, as calculate() builds it
    get sweep(): { axis: THREE.Vector3, angle: number } {
        const { center, p2, p3, orientation, sense } = this;
        const axis = Z.clone().applyQuaternion(orientation);
        if (!sense) axis.negate();
        const x = p2.clone().sub(center).normalize();
        const y = axis.clone().cross(x);
        const d = p3.clone().sub(center);
        let angle = Math.atan2(d.dot(y), d.dot(x));
        if (angle < 0) angle += 2 * Math.PI;
        return { axis, angle };
    }
}
const Z = new THREE.Vector3(0, 0, 1);
export class ThreePointArcFactory extends GeometryFactory {
    p1!: THREE.Vector3;
    p2!: THREE.Vector3;
    p3!: THREE.Vector3;

    async calculate() {
        const { p1, p2, p3 } = this;
        const circle = new c3d.Arc3D(point2point(p1), point2point(p2), point2point(p3), 1, false);

        return new c3d.SpaceInstance(circle);
    }

    // The middle of the arc; throws while the points are collinear
    get middle() {
        const { p1, p2, p3 } = this;
        const circle = new c3d.Arc3D(point2point(p1), point2point(p2), point2point(p3), 1, false);
        return point2point(circle.PointOn((circle.GetTMin() + circle.GetTMax()) / 2));
    }
}

// An arc's length (and height) never goes below this, and its angle stays within these
export const minLength = 0.01;
export const minAngle = THREE.MathUtils.degToRad(0.1);
export const maxAngle = THREE.MathUtils.degToRad(359.9);

function lookupArc(db: DatabaseLike, arc: visual.SpaceInstance<visual.Curve3D>): c3d.Arc3D {
    const curve = inst2curve(db.lookup(arc));
    if (!(curve instanceof c3d.Arc3D)) throw new Error("invalid precondition");
    return curve;
}

export interface EditCenterPointArcParams {
    length: number;
    angle: number;
    degrees: number;
}

// Edits an arc drawn from its centre: Length is its radius (centre to start) and Angle its sweep. The centre and the
// direction of the start stay where they were drawn.
export class EditCenterPointArcFactory extends GeometryFactory implements EditCenterPointArcParams {
    private model!: c3d.Arc3D;

    private _length?: number;
    get length() { return this._length ?? deunit(this.model.GetRadius()) }
    set length(length: number) { this._length = Math.max(length, minLength) }

    private _angle?: number;
    get angle() { return this._angle ?? this.model.GetAngle() }
    set angle(angle: number) { this._angle = THREE.MathUtils.clamp(angle, minAngle, maxAngle) }

    get degrees() { return THREE.MathUtils.radToDeg(this.angle) }
    set degrees(degrees: number) { this.angle = THREE.MathUtils.degToRad(degrees) }

    // The arc runs counterclockwise around Z from X (its start); Y = Z × X
    readonly centre = new THREE.Vector3();
    readonly basis = new THREE.Matrix4();

    private _arc!: visual.SpaceInstance<visual.Curve3D>;
    set arc(arc: visual.SpaceInstance<visual.Curve3D>) {
        this._arc = arc;
        const model = lookupArc(this.db, arc);
        this.model = model;

        const centre = this.centre.copy(point2point(model.GetCentre()));
        const x = point2point(model.GetLimitPoint(1)).sub(centre).normalize();
        const z = x.clone().cross(vec2vec(model.Tangent(model.GetTMin()), 1)).normalize();
        const y = z.clone().cross(x);
        this.basis.makeBasis(x, y, z);
    }

    async calculate() {
        const { length, angle } = this;
        const arc = this.model.Duplicate().Cast<c3d.Arc3D>(c3d.SpaceType.Arc3D);
        arc.SetRadius(unit(length));
        arc.SetAngle(angle);
        return new c3d.SpaceInstance(arc);
    }

    get originalItem() { return this._arc }
}

export interface EditThreePointArcParams {
    length: number;
    height: number;
}

// Edits an arc drawn through three points: Length is the distance between its ends, and Height the distance from the
// middle of that line to the arc. The start, the direction of the end and the side the arc bulges to stay where they
// were drawn; its radius follows.
export class EditThreePointArcFactory extends GeometryFactory implements EditThreePointArcParams {
    private _length = 0;
    get length() { return this._length }
    set length(length: number) { this._length = Math.max(length, minLength) }

    private _height = 0;
    get height() { return this._height }
    set height(height: number) { this._height = Math.max(height, minLength) }

    // The arc starts at the origin of this basis, its end is along X and it bulges toward Y
    readonly start = new THREE.Vector3();
    readonly basis = new THREE.Matrix4();
    private readonly chord = new THREE.Vector3();
    private readonly side = new THREE.Vector3();

    private _arc!: visual.SpaceInstance<visual.Curve3D>;
    set arc(arc: visual.SpaceInstance<visual.Curve3D>) {
        this._arc = arc;
        const model = lookupArc(this.db, arc);

        const start = this.start.copy(point2point(model.GetLimitPoint(1)));
        const end = point2point(model.GetLimitPoint(2));
        const middle = point2point(model.PointOn((model.GetTMin() + model.GetTMax()) / 2));
        const midpoint = start.clone().add(end).multiplyScalar(0.5);
        this.length = end.distanceTo(start);
        this.height = middle.distanceTo(midpoint);

        const x = this.chord.copy(end).sub(start).normalize();
        const y = this.side.copy(middle).sub(midpoint).normalize();
        this.basis.makeBasis(x, y, x.clone().cross(y));
    }

    async calculate() {
        const { start, chord, side, length, height } = this;
        const end = chord.clone().multiplyScalar(length).add(start);
        const through = chord.clone().multiplyScalar(length / 2).add(start).addScaledVector(side, height);
        const arc = new c3d.Arc3D(point2point(start), point2point(through), point2point(end), 1, false);
        return new c3d.SpaceInstance(arc);
    }

    get originalItem() { return this._arc }
}
