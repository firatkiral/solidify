import { RefItem } from './base';
import { Contour, Curve } from './curve2d';
import { Contour3D, Curve3D, Surface } from './curve3d';
import { Axis3D, CartPoint, CartPoint3D, KObject, Matrix3D, Placement3D, Vector3D } from './math';

export class NameMaker extends RefItem {
    constructor(protected mainName = 0) { super() }
    GetMainName() { return this.mainName }
    IsChild(_t: unknown) { return false }
}

export class SNameMaker extends NameMaker {
    constructor(mainName = 0, private sideAdd = 0, private buttAdd = 0) { super(mainName) }
    Add(_ent: number) { }
}

export class Name extends KObject {
    constructor(private hash = 0, private mainName = 0) { super() }
    Hash() { return this.hash }
    GetFirstName() { return this.hash }
    GetMainName() { return this.mainName }
}

export class PointOnCurve extends KObject {
    constructor(public t: number, public curve: Curve) { super() }
}

export class CrossPoint extends KObject {
    form = 0;
    constructor(public p: CartPoint, public on1: PointOnCurve, public on2: PointOnCurve) { super() }
}

export class MergingFlags extends KObject {
    constructor(public mergeFaces = true, public mergeEdges = true) { super() }
    SetMergingFaces(s: boolean) { this.mergeFaces = s }
    SetMergingEdges(s: boolean) { this.mergeEdges = s }
}

export class BooleanFlags extends MergingFlags {
    closed = true;
    allowNonIntersecting = false;
    InitBoolean(closed: boolean, allowNonIntersecting = false) { this.closed = closed; this.allowNonIntersecting = allowNonIntersecting }
    InitCutting(closed: boolean, allowNonIntersecting = false) { this.closed = closed; this.allowNonIntersecting = allowNonIntersecting }
}

export class SweptSide extends KObject {
    way = 0;
    rake = 0;
    distance = 0;
    scalarValue = 0;
    constructor(scalarValue = 0) { super(); this.scalarValue = scalarValue }
}

export class SweptValues extends KObject {
    thickness1 = 0;
    thickness2 = 0;
    shellClosed = true;
    private checkSelfInt = false;
    CheckSelfInt() { return this.checkSelfInt }
    SetCheckSelfInt(c: boolean) { this.checkSelfInt = c }
}

export class SweptValuesAndSides extends SweptValues {
    side1 = new SweptSide();
    side2 = new SweptSide();
}

export class ExtrusionValues extends SweptValuesAndSides {
    constructor(scalarValue1 = 0, scalarValue2 = 0) {
        super();
        this.side1 = new SweptSide(scalarValue1);
        this.side2 = new SweptSide(scalarValue2);
    }
}

// Revolution angles are side1.scalarValue (forward) and side2.scalarValue (backward), in radians.
// For an open profile, shape 0 (torus) closes it with a straight segment between its ends,
// shape 1 (sphere) closes it by dropping both ends perpendicularly onto the axis.
export class RevolutionValues extends SweptValuesAndSides {
    shape = 0;
}

export class LoftedValues extends SweptValues {
    closed = false;
    derFactor1 = 1;
    derFactor2 = 1;
}

export type EvolutionMode = 'parallel' | 'keepingAngle' | 'orthogonal';

export class EvolutionValues extends SweptValues {
    mode: EvolutionMode = 'keepingAngle';
    range = 0;
    SetParallel() { this.mode = 'parallel' }
    SetKeepingAngle() { this.mode = 'keepingAngle' }
    SetOrthogonal() { this.mode = 'orthogonal' }
}

// What to sweep: planar 2D contours on a surface, or a 3D curve.
export class SweptData extends KObject {
    surface?: Surface;
    placement?: Placement3D;
    contours: Contour[] = [];
    curve3d?: Curve3D;
    contours3d: Contour3D[] = [];

    constructor(a?: Placement3D | Surface | Curve3D | Contour3D[], b?: Contour | Contour[]) {
        super();
        if (a instanceof Placement3D) { this.placement = new Placement3D(a); this.contours = [b as Contour] }
        else if (a instanceof Surface) { this.surface = a; this.contours = b as Contour[] }
        else if (a instanceof Curve3D) { this.curve3d = a }
        else if (Array.isArray(a)) { this.contours3d = a }
    }
}

export class TransformValues extends KObject {
    matrix = new Matrix3D();
    fixedPoint = new CartPoint3D(0, 0, 0);

    constructor(a?: Matrix3D | number, b?: CartPoint3D | number, c?: boolean | number, d?: CartPoint3D) {
        super();
        if (a instanceof Matrix3D) {
            this.matrix = Matrix3D.fromRows(a.m);
            if (b instanceof CartPoint3D) this.fixedPoint = b.clone();
        } else if (typeof a === 'number') {
            const sx = a, sy = b as number, sz = c as number, f = d!;
            this.fixedPoint = f.clone();
            this.matrix = Matrix3D.fromRows([[sx, 0, 0, 0], [0, sy, 0, 0], [0, 0, sz, 0], [f.x * (1 - sx), f.y * (1 - sy), f.z * (1 - sz), 1]]);
        }
    }

    Move(to: Vector3D) { this.matrix.Move(to) }
    Rotate(axis: Axis3D, angle: number) { this.matrix.Rotate(axis, angle) }
    GetMatrix() { return Matrix3D.fromRows(this.matrix.m) }
    SetFixed(_b: boolean) { }
    SetFixedPoint() { return this.fixedPoint.clone() }
}

export class PlanarCheckParams extends KObject {
    constructor(public accuracy = 1e-6) { super() }
}

export class ModifyValues extends KObject {
    way = 0;
    direction = new Vector3D(0, 0, 0);
}

// Fillet and chamfer parameters.
export class SmoothValues extends KObject {
    distance1 = 0;
    distance2 = 0;
    conic = 0;
    begLength = -1e300;
    endLength = -1e300;
    form = 0;
    smoothCorner = 0;
    prolong = true;
    keepCant = 0;
    strict = false;
    equable = false;

    constructor(d1?: number, d2?: number, form?: number, conic?: number, prolong?: boolean, smoothCorner?: number, _autoS?: boolean, keep?: boolean, strict?: boolean, equable?: boolean) {
        super();
        if (d1 !== undefined) this.distance1 = d1;
        if (d2 !== undefined) this.distance2 = d2;
        if (form !== undefined) this.form = form;
        if (conic !== undefined) this.conic = conic;
        if (prolong !== undefined) this.prolong = prolong;
        if (smoothCorner !== undefined) this.smoothCorner = smoothCorner;
        if (keep !== undefined) this.keepCant = keep ? 1 : 0;
        if (strict !== undefined) this.strict = strict;
        if (equable !== undefined) this.equable = equable;
    }
}

// A scalar function of a curve parameter t in [0, 1]; used for variable fillet radii (as a multiplier of the distance).
export class KFunction extends RefItem {
    value(_t: number) { return 1 }
    // Sample points (t, value) that define the function.
    knots(): [number, number][] { return [[0, 1], [1, 1]] }
}

// Interpolates the values at t=0, t=1 and any inserted values.
export class CubicFunction extends KFunction {
    private readonly points: [number, number][];

    constructor(value1 = 1, value2 = 1) {
        super();
        this.points = [[0, value1], [1, value2]];
    }

    InsertValue(t: number, newValue: number) {
        const existing = this.points.find(([u]) => Math.abs(u - t) < 1e-9);
        if (existing !== undefined) existing[1] = newValue;
        else { this.points.push([t, newValue]); this.points.sort((a, b) => a[0] - b[0]) }
        return true;
    }

    knots(): [number, number][] { return this.points.map(([t, v]) => [t, v]) }

    value(t: number) {
        const { points } = this;
        for (let i = 0; i < points.length - 1; i++) {
            const [t0, v0] = points[i], [t1, v1] = points[i + 1];
            if (t <= t1 || i === points.length - 2) {
                const u = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
                const s = u * u * (3 - 2 * u); // smooth between knots
                return v0 + (v1 - v0) * s;
            }
        }
        return points[0][1];
    }

    isConstant() { return this.points.every(([, v]) => Math.abs(v - this.points[0][1]) < 1e-12) }
}

export class EdgeFacesIndexes extends KObject {
    edgeIndex = -1;
    facePIndex = -1;
    faceMIndex = -1;
    itemName = 0;
}

// Placements of the copies of an array.
export class DuplicationValues extends KObject {
    GenerateTransformMatrices(): Matrix3D[] { return [] }
}

// A rectangular grid of copies (num1 along dir1 every step1, by num2 along dir2 every step2), or a polar one: num1
// rings stepping out by step1 along dir1, each with num2 + 1 positions turning by step2 about dir2 through the centre
// (the first and, for a full turn, the last are the original position). Polar copies are rotated along with their
// position when isAlongAxis is set, and only moved otherwise.
export class DuplicationMeshValues extends DuplicationValues {
    constructor(
        readonly isPolar: boolean,
        readonly dir1: Vector3D, readonly step1: number, readonly num1: number,
        readonly dir2: Vector3D, readonly step2: number, readonly num2: number,
        readonly center = new CartPoint3D(0, 0, 0), readonly isAlongAxis = false,
    ) { super() }

    GenerateTransformMatrices(): Matrix3D[] {
        const { dir1, step1, num1, dir2, step2, num2, center } = this;
        const result: Matrix3D[] = [];
        const along = (d: Vector3D, s: number) => new Vector3D(d.x * s, d.y * s, d.z * s);
        if (!this.isPolar) {
            for (let i = 0; i < Math.max(1, num1); i++) for (let j = 0; j < Math.max(1, num2); j++) {
                const m = new Matrix3D();
                const a = along(dir1, step1 * i), b = along(dir2, step2 * j);
                m.Move(new Vector3D(a.x + b.x, a.y + b.y, a.z + b.z));
                result.push(m);
            }
            return result;
        }
        const axis = new Axis3D(center, dir2);
        const reference = new CartPoint3D(center.x + dir1.x * step1, center.y + dir1.y * step1, center.z + dir1.z * step1);
        for (let i = 0; i < Math.max(1, num1); i++) for (let j = 0; j <= num2; j++) {
            const m = new Matrix3D();
            m.Move(along(dir1, step1 * i));
            if (this.isAlongAxis) m.Rotate(axis, step2 * j);
            else {
                const turned = new Matrix3D().Rotate(axis, step2 * j).applyPoint(reference);
                m.Move(new Vector3D(turned.x - reference.x, turned.y - reference.y, turned.z - reference.z));
            }
            result.push(m);
        }
        return result;
    }
}
