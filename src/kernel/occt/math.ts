import { ItemLocation } from './constants';

let nextId = BigInt(1);

// Every kernel object has an identity (C3D used the object address).
export class KObject {
    private _id?: bigint;
    Id(): bigint {
        if (this._id === undefined) { this._id = nextId; nextId += BigInt(1) }
        return this._id;
    }
}

export class CartPoint extends KObject {
    constructor(public x = 0, public y = 0) { super() }
    clone() { return new CartPoint(this.x, this.y) }
    distanceTo(p: CartPoint) { return Math.hypot(this.x - p.x, this.y - p.y) }
}

export class Vector extends KObject {
    constructor(public x = 0, public y = 0) { super() }
}

export class CartPoint3D extends KObject {
    constructor(public x = 0, public y = 0, public z = 0) { super() }

    Move(to: Vector3D): CartPoint3D {
        this.x += to.x; this.y += to.y; this.z += to.z;
        return this;
    }

    clone() { return new CartPoint3D(this.x, this.y, this.z) }
    distanceTo(p: CartPoint3D) { return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z) }
}

export class FloatPoint3D extends KObject {
    constructor(public x = 0, public y = 0, public z = 0) { super() }
}

export class Vector3D extends KObject {
    x: number; y: number; z: number;

    constructor(a?: number | CartPoint3D, b?: number | CartPoint3D, c?: number) {
        super();
        if (a instanceof CartPoint3D && b instanceof CartPoint3D) {
            this.x = b.x - a.x; this.y = b.y - a.y; this.z = b.z - a.z;
        } else {
            this.x = (a as number) ?? 0; this.y = (b as number) ?? 0; this.z = c ?? 0;
        }
    }

    Colinear(other: Vector3D, eps = 1e-6): boolean {
        const a = normalized(this), b = normalized(other);
        const cx = a.y * b.z - a.z * b.y, cy = a.z * b.x - a.x * b.z, cz = a.x * b.y - a.y * b.x;
        return Math.hypot(cx, cy, cz) < eps;
    }

    Invert(): Vector3D {
        this.x = -this.x; this.y = -this.y; this.z = -this.z;
        return this;
    }

    clone() { return new Vector3D(this.x, this.y, this.z) }
}

export function normalized(v: { x: number, y: number, z: number }): Vector3D {
    const l = Math.hypot(v.x, v.y, v.z);
    if (l === 0) return new Vector3D(0, 0, 0);
    return new Vector3D(v.x / l, v.y / l, v.z / l);
}

export function cross(a: { x: number, y: number, z: number }, b: { x: number, y: number, z: number }): Vector3D {
    return new Vector3D(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

export function dot(a: { x: number, y: number, z: number }, b: { x: number, y: number, z: number }): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

// Rodrigues rotation of v about unit axis k by angle.
function rotateVector(v: { x: number, y: number, z: number }, k: Vector3D, angle: number): Vector3D {
    const c = Math.cos(angle), s = Math.sin(angle);
    const kxv = cross(k, v);
    const kdv = dot(k, v);
    return new Vector3D(
        v.x * c + kxv.x * s + k.x * kdv * (1 - c),
        v.y * c + kxv.y * s + k.y * kdv * (1 - c),
        v.z * c + kxv.z * s + k.z * kdv * (1 - c));
}

function rotatePoint(p: CartPoint3D, axis: Axis3D, angle: number): CartPoint3D {
    const o = axis.origin;
    const r = rotateVector({ x: p.x - o.x, y: p.y - o.y, z: p.z - o.z }, axis.direction, angle);
    return new CartPoint3D(o.x + r.x, o.y + r.y, o.z + r.z);
}

export class Axis3D extends KObject {
    origin: CartPoint3D;
    direction: Vector3D;

    constructor(a: Axis3D | Vector3D | CartPoint3D, b?: Vector3D) {
        super();
        if (a instanceof Axis3D) {
            this.origin = a.origin.clone(); this.direction = a.direction.clone();
        } else if (a instanceof Vector3D) {
            this.origin = new CartPoint3D(0, 0, 0); this.direction = normalized(a);
        } else {
            this.origin = a.clone(); this.direction = normalized(b!);
        }
    }

    Rotate(axis: Axis3D, angle: number) {
        this.origin = rotatePoint(this.origin, axis, angle);
        this.direction = rotateVector(this.direction, axis.direction, angle);
    }

    Move(to: Vector3D) { this.origin.Move(to) }
    GetOrigin() { return this.origin.clone() }
    GetAxisZ() { return this.direction.clone() }
}

export class FloatAxis3D extends Axis3D { }

// A 2D affine transform in C3D's row-vector convention: [x y 1] * M.
export class Matrix extends KObject {
    m: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

    Scale(s: number) { this.ScaleX(s); this.ScaleY(s) }
    ScaleX(s: number) { for (let i = 0; i < 3; i++) this.m[i][0] *= s }
    ScaleY(s: number) { for (let i = 0; i < 3; i++) this.m[i][1] *= s }

    apply(x: number, y: number): [number, number] {
        const { m } = this;
        return [x * m[0][0] + y * m[1][0] + m[2][0], x * m[0][1] + y * m[1][1] + m[2][1]];
    }

    applyVector(x: number, y: number): [number, number] {
        const { m } = this;
        return [x * m[0][0] + y * m[1][0], x * m[0][1] + y * m[1][1]];
    }

    isIdentity(eps = 1e-12) {
        const { m } = this;
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (Math.abs(m[i][j] - (i === j ? 1 : 0)) > eps) return false;
        return true;
    }

    // Determinant of the linear part; negative means the transform mirrors.
    get determinant() { const { m } = this; return m[0][0] * m[1][1] - m[0][1] * m[1][0] }
}

export class Homogeneous3D extends KObject {
    constructor(public x: number, public y: number, public z: number, public w: number) { super() }
}

// A 3D affine transform in C3D's row-vector convention: [x y z 1] * M (row 3 is the translation).
export class Matrix3D extends KObject {
    m: number[][] = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

    static fromRows(rows: number[][]) {
        const r = new Matrix3D();
        r.m = rows.map(row => [...row]);
        return r;
    }

    Scale(sx: number, sy: number, sz: number) {
        this.multiply(Matrix3D.fromRows([[sx, 0, 0, 0], [0, sy, 0, 0], [0, 0, sz, 0], [0, 0, 0, 1]]));
    }

    Rotate(axis: Axis3D, angle: number): Matrix3D {
        const x = rotatePoint(new CartPoint3D(1, 0, 0), axis, angle);
        const y = rotatePoint(new CartPoint3D(0, 1, 0), axis, angle);
        const z = rotatePoint(new CartPoint3D(0, 0, 1), axis, angle);
        const o = rotatePoint(new CartPoint3D(0, 0, 0), axis, angle);
        this.multiply(Matrix3D.fromRows([
            [x.x - o.x, x.y - o.y, x.z - o.z, 0],
            [y.x - o.x, y.y - o.y, y.z - o.z, 0],
            [z.x - o.x, z.y - o.y, z.z - o.z, 0],
            [o.x, o.y, o.z, 1]]));
        return this;
    }

    Symmetry(origin: CartPoint3D, normal: Vector3D) {
        const n = normalized(normal);
        const d = dot(n, origin);
        const r = (i: number, j: number) => (i === j ? 1 : 0) - 2 * [n.x, n.y, n.z][i] * [n.x, n.y, n.z][j];
        this.multiply(Matrix3D.fromRows([
            [r(0, 0), r(0, 1), r(0, 2), 0],
            [r(1, 0), r(1, 1), r(1, 2), 0],
            [r(2, 0), r(2, 1), r(2, 2), 0],
            [2 * d * n.x, 2 * d * n.y, 2 * d * n.z, 1]]));
    }

    Move(v: Vector3D) {
        this.m[3][0] += v.x; this.m[3][1] += v.y; this.m[3][2] += v.z;
    }

    GetRow(i: number) { return new Vector3D(this.m[i][0], this.m[i][1], this.m[i][2]) }
    GetColumn(j: number) { return new Vector3D(this.m[0][j], this.m[1][j], this.m[2][j]) }
    SetRow(i: number, h: Homogeneous3D) { this.m[i] = [h.x, h.y, h.z, h.w] }
    SetColumn(j: number, h: Homogeneous3D) { this.m[0][j] = h.x; this.m[1][j] = h.y; this.m[2][j] = h.z; this.m[3][j] = h.w }
    GetAxisX() { return this.GetRow(0) }
    GetAxisY() { return this.GetRow(1) }
    GetAxisZ() { return this.GetRow(2) }
    GetOrigin() { return this.GetRow(3) }
    El(i: number, j: number) { return this.m[i][j] }
    GetOffset() { return new CartPoint3D(this.m[3][0], this.m[3][1], this.m[3][2]) }
    SetOffset(p: CartPoint3D) { this.m[3][0] = p.x; this.m[3][1] = p.y; this.m[3][2] = p.z }

    // C3D's division: this matrix undone, then `from` (so dividing the identity gives the inverse)
    Div(from: Matrix3D): Matrix3D {
        return this.inverse().multiply(from);
    }

    Adj() { this.m = this.inverse().m }

    // this := this * other (apply this, then other)
    multiply(other: Matrix3D) {
        const a = this.m, b = other.m;
        const r = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += a[i][k] * b[k][j];
            r[i][j] = s;
        }
        this.m = r;
        return this;
    }

    inverse(): Matrix3D {
        const m = this.m;
        const a = [...m[0], ...m[1], ...m[2], ...m[3]];
        const inv = new Array(16);
        inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
        inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
        inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
        inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
        inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
        inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
        inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
        inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
        inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
        inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
        inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
        inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
        inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
        inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
        inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
        inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
        let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
        if (det === 0) throw new Error("Matrix3D is not invertible");
        det = 1 / det;
        return Matrix3D.fromRows([
            [inv[0] * det, inv[1] * det, inv[2] * det, inv[3] * det],
            [inv[4] * det, inv[5] * det, inv[6] * det, inv[7] * det],
            [inv[8] * det, inv[9] * det, inv[10] * det, inv[11] * det],
            [inv[12] * det, inv[13] * det, inv[14] * det, inv[15] * det]]);
    }

    applyPoint(p: { x: number, y: number, z: number }): CartPoint3D {
        const m = this.m;
        return new CartPoint3D(
            p.x * m[0][0] + p.y * m[1][0] + p.z * m[2][0] + m[3][0],
            p.x * m[0][1] + p.y * m[1][1] + p.z * m[2][1] + m[3][1],
            p.x * m[0][2] + p.y * m[1][2] + p.z * m[2][2] + m[3][2]);
    }

    applyVector(v: { x: number, y: number, z: number }): Vector3D {
        const m = this.m;
        return new Vector3D(
            v.x * m[0][0] + v.y * m[1][0] + v.z * m[2][0],
            v.x * m[0][1] + v.y * m[1][1] + v.z * m[2][1],
            v.x * m[0][2] + v.y * m[1][2] + v.z * m[2][2]);
    }

    get determinant() {
        const m = this.m;
        return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    }

    isIdentity(eps = 1e-12) {
        const { m } = this;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (Math.abs(m[i][j] - (i === j ? 1 : 0)) > eps) return false;
        return true;
    }
}

export class Placement3D extends KObject {
    origin = new CartPoint3D(0, 0, 0);
    axisX = new Vector3D(1, 0, 0);
    axisY = new Vector3D(0, 1, 0);
    axisZ = new Vector3D(0, 0, 1);

    constructor(a?: CartPoint3D | Placement3D, b?: Vector3D, c?: Vector3D | boolean, d?: boolean) {
        super();
        if (a instanceof Placement3D) {
            this.origin = a.origin.clone();
            this.axisX = a.axisX.clone(); this.axisY = a.axisY.clone(); this.axisZ = a.axisZ.clone();
        } else if (a instanceof CartPoint3D) {
            this.origin = a.clone();
            const z = normalized(b!);
            let x: Vector3D;
            let left: boolean;
            if (c instanceof Vector3D) {
                // Remove any component of X along Z
                const xz = dot(c, z);
                x = normalized(new Vector3D(c.x - xz * z.x, c.y - xz * z.y, c.z - xz * z.z));
                left = d ?? false;
            } else {
                x = arbitraryPerpendicular(z);
                left = c ?? false;
            }
            this.axisZ = z; this.axisX = x;
            this.axisY = left ? cross(x, z) : cross(z, x);
        }
    }

    InitYZ(p: CartPoint3D, axisY: Vector3D, axisZ: Vector3D): Placement3D {
        this.origin = p.clone();
        this.axisZ = normalized(axisZ);
        const yz = dot(axisY, this.axisZ);
        this.axisY = normalized(new Vector3D(axisY.x - yz * this.axisZ.x, axisY.y - yz * this.axisZ.y, axisY.z - yz * this.axisZ.z));
        this.axisX = cross(this.axisY, this.axisZ);
        return this;
    }

    Move(to: Vector3D): Placement3D { this.origin.Move(to); return this }

    Rotate(axis: Axis3D, angle: number): Placement3D {
        this.origin = rotatePoint(this.origin, axis, angle);
        this.axisX = rotateVector(this.axisX, axis.direction, angle);
        this.axisY = rotateVector(this.axisY, axis.direction, angle);
        this.axisZ = rotateVector(this.axisZ, axis.direction, angle);
        return this;
    }

    Scale(sx: number, sy: number, sz: number): Placement3D {
        this.origin = new CartPoint3D(this.origin.x * sx, this.origin.y * sy, this.origin.z * sz);
        return this;
    }

    Transform(matrix: Matrix3D): Placement3D {
        const o = matrix.applyPoint(this.origin);
        this.axisX = normalized(matrix.applyVector(this.axisX));
        this.axisY = normalized(matrix.applyVector(this.axisY));
        this.axisZ = normalized(matrix.applyVector(this.axisZ));
        this.origin = o;
        return this;
    }

    SetAxisX(a: Vector3D) { this.axisX = a.clone() }
    SetAxisY(a: Vector3D) { this.axisY = a.clone() }
    SetAxisZ(a: Vector3D) { this.axisZ = a.clone() }
    GetOrigin() { return this.origin.clone() }
    SetOrigin(o: CartPoint3D) { this.origin = o.clone() }
    GetAxisZ() { return this.axisZ.clone() }
    GetAxisY() { return this.axisY.clone() }
    GetAxisX() { return this.axisX.clone() }

    Normalize() {
        this.axisZ = normalized(this.axisZ);
        const xz = dot(this.axisX, this.axisZ);
        this.axisX = normalized(new Vector3D(this.axisX.x - xz * this.axisZ.x, this.axisX.y - xz * this.axisZ.y, this.axisX.z - xz * this.axisZ.z));
        const left = this.IsLeft();
        this.axisY = left ? cross(this.axisX, this.axisZ) : cross(this.axisZ, this.axisX);
    }

    Reset() { }

    Invert() {
        this.axisZ.Invert();
        this.axisY.Invert();
    }

    IsLeft() { return dot(cross(this.axisX, this.axisY), this.axisZ) < 0 }

    GetXEpsilon() { return 1e-6 }
    GetYEpsilon() { return 1e-6 }

    PointProjection(p: CartPoint3D): { x: number, y: number } {
        const d = { x: p.x - this.origin.x, y: p.y - this.origin.y, z: p.z - this.origin.z };
        return { x: dot(d, this.axisX), y: dot(d, this.axisY) };
    }

    // Signed distance of a point from the XY plane of this placement.
    distance(p: { x: number, y: number, z: number }): number {
        return dot({ x: p.x - this.origin.x, y: p.y - this.origin.y, z: p.z - this.origin.z }, this.axisZ);
    }

    PointRelative(pnt: CartPoint3D, eps = 1e-6): number {
        const d = { x: pnt.x - this.origin.x, y: pnt.y - this.origin.y, z: pnt.z - this.origin.z };
        const z = dot(d, this.axisZ);
        if (Math.abs(z) <= eps) return ItemLocation.OnItem;
        return z > 0 ? ItemLocation.OutOfItem : ItemLocation.InItem;
    }

    // Maps 2D coordinates in this placement to 2D coordinates in `p` (the placements are assumed coplanar).
    GetMatrixToPlace(p: Placement3D, _eps?: number): Matrix {
        const result = new Matrix();
        const o = { x: this.origin.x - p.origin.x, y: this.origin.y - p.origin.y, z: this.origin.z - p.origin.z };
        result.m = [
            [dot(this.axisX, p.axisX), dot(this.axisX, p.axisY), 0],
            [dot(this.axisY, p.axisX), dot(this.axisY, p.axisY), 0],
            [dot(o, p.axisX), dot(o, p.axisY), 1],
        ];
        return result;
    }

    GetVectorFrom(x: number, y: number, z: number): Vector3D {
        const { axisX: X, axisY: Y, axisZ: Z } = this;
        return new Vector3D(x * X.x + y * Y.x + z * Z.x, x * X.y + y * Y.y + z * Z.y, x * X.z + y * Y.z + z * Z.z);
    }

    GetPointFrom(x: number, y: number, z: number): CartPoint3D {
        const v = this.GetVectorFrom(x, y, z);
        return new CartPoint3D(this.origin.x + v.x, this.origin.y + v.y, this.origin.z + v.z);
    }

    GetPointInto(p: CartPoint3D) {
        const d = { x: p.x - this.origin.x, y: p.y - this.origin.y, z: p.z - this.origin.z };
        p.x = dot(d, this.axisX); p.y = dot(d, this.axisY); p.z = dot(d, this.axisZ);
    }

    // Local -> global
    GetMatrixFrom(): Matrix3D {
        const { axisX: X, axisY: Y, axisZ: Z, origin: O } = this;
        return Matrix3D.fromRows([[X.x, X.y, X.z, 0], [Y.x, Y.y, Y.z, 0], [Z.x, Z.y, Z.z, 0], [O.x, O.y, O.z, 1]]);
    }

    // Global -> local
    GetMatrixInto(): Matrix3D {
        return this.GetMatrixFrom().inverse();
    }

    point2d(p: CartPoint3D): CartPoint {
        const { x, y } = this.PointProjection(p);
        return new CartPoint(x, y);
    }

    point3d(p: { x: number, y: number }): CartPoint3D {
        return this.GetPointFrom(p.x, p.y, 0);
    }

    clone() { return new Placement3D(this) }
}

export function arbitraryPerpendicular(z: Vector3D): Vector3D {
    // Matches the convention of the default placement: for Z = (0,0,1), X = (1,0,0).
    if (Math.abs(z.z) > 1 - 1e-9) return new Vector3D(z.z > 0 ? 1 : 1, 0, 0);
    const a = Math.abs(z.x) < 0.9 ? new Vector3D(1, 0, 0) : new Vector3D(0, 1, 0);
    const d = dot(a, z);
    return normalized(new Vector3D(a.x - d * z.x, a.y - d * z.y, a.z - d * z.z));
}

export class Placement extends KObject {
    constructor(public origin = new CartPoint(0, 0), public axisX = new Vector(1, 0), public axisY = new Vector(0, 1)) { super() }
}

export class Direction extends KObject {
    constructor(public angle: number) { super() }
}

export class Cube extends KObject {
    pmin: CartPoint3D;
    pmax: CartPoint3D;
    empty: boolean;

    constructor(p0?: CartPoint3D, p1?: CartPoint3D, normalize = false) {
        super();
        if (p0 === undefined || p1 === undefined) {
            this.pmin = new CartPoint3D(Infinity, Infinity, Infinity);
            this.pmax = new CartPoint3D(-Infinity, -Infinity, -Infinity);
            this.empty = true;
        } else if (normalize) {
            this.pmin = new CartPoint3D(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.min(p0.z, p1.z));
            this.pmax = new CartPoint3D(Math.max(p0.x, p1.x), Math.max(p0.y, p1.y), Math.max(p0.z, p1.z));
            this.empty = false;
        } else {
            this.pmin = p0.clone(); this.pmax = p1.clone();
            this.empty = false;
        }
    }

    include(p: { x: number, y: number, z: number }) {
        const { pmin, pmax } = this;
        pmin.x = Math.min(pmin.x, p.x); pmin.y = Math.min(pmin.y, p.y); pmin.z = Math.min(pmin.z, p.z);
        pmax.x = Math.max(pmax.x, p.x); pmax.y = Math.max(pmax.y, p.y); pmax.z = Math.max(pmax.z, p.z);
        this.empty = false;
    }

    Intersect(other: Cube, eps = 1e-6): boolean {
        if (this.empty || other.empty) return false;
        const a = this, b = other;
        return a.pmin.x <= b.pmax.x + eps && a.pmax.x >= b.pmin.x - eps
            && a.pmin.y <= b.pmax.y + eps && a.pmax.y >= b.pmin.y - eps
            && a.pmin.z <= b.pmax.z + eps && a.pmax.z >= b.pmin.z - eps;
    }

    ProjectionRect(place: Placement3D): Rect {
        const rect = new Rect();
        const { pmin, pmax } = this;
        for (const x of [pmin.x, pmax.x]) for (const y of [pmin.y, pmax.y]) for (const z of [pmin.z, pmax.z]) {
            const p = place.PointProjection(new CartPoint3D(x, y, z));
            rect.include(p.x, p.y);
        }
        return rect;
    }
}

export class Rect extends KObject {
    left = Infinity; right = -Infinity; bottom = Infinity; top = -Infinity;
    include(x: number, y: number) {
        this.left = Math.min(this.left, x); this.right = Math.max(this.right, x);
        this.bottom = Math.min(this.bottom, y); this.top = Math.max(this.top, y);
    }
    GetTop() { return this.top }
    GetBottom() { return this.bottom }
    GetLeft() { return this.left }
    GetRight() { return this.right }
}
