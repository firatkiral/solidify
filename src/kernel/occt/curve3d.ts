import { SpaceItem } from './base';
import { SpaceType } from './constants';
import { Arc, Bezier, Contour, CubicSpline, Curve, EPS, Hermit, Line, LineSegment, maxAngleForSag, nearestParam2d, Nurbs, Polyline, Spline, TrimmedCurve } from './curve2d';
import { BSpline, HermiteData, hermiteData, hermiteFromData, hermiteInsert, hermiteRemove, hermiteReverse, makeSpline, SplineKind } from './spline';
import { arbitraryPerpendicular, Axis3D, CartPoint, CartPoint3D, cross, Cube, dot, Matrix, Matrix3D, normalized, Placement3D, Vector3D } from './math';

const TWO_PI = 2 * Math.PI;
type P3 = { x: number, y: number, z: number };

// A point of a curve and its first, second and third derivatives there.
export type Derivatives = [CartPoint3D, Vector3D, Vector3D, Vector3D];

function sub(a: P3, b: P3) { return new Vector3D(a.x - b.x, a.y - b.y, a.z - b.z) }
function dist(a: P3, b: P3) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) }
function pt(p: P3) { return new CartPoint3D(p.x, p.y, p.z) }
function neg(v: Vector3D) { return new Vector3D(-v.x, -v.y, -v.z) }
const zero = () => new Vector3D(0, 0, 0);

// 5-point Gauss–Legendre nodes and weights on [-1, 1]
const GAUSS = [[0, 128 / 225], [-0.5384693101056831, 0.4786286704993665], [0.5384693101056831, 0.4786286704993665], [-0.9061798459386640, 0.2369268850561891], [0.9061798459386640, 0.2369268850561891]];

export abstract class Curve3D extends SpaceItem {
    abstract get tmin(): number;
    abstract get tmax(): number;
    abstract IsClosed(): boolean;
    abstract _PointOn(t: number): CartPoint3D;
    abstract Inverse(): void;
    abstract Transform(m: Matrix3D): void;
    abstract Duplicate(): Curve3D;
    // The curve expressed in the 2D coordinates of a placement whose plane contains it; same parametrization.
    abstract to2d(place: Placement3D): Curve;

    Family() { return SpaceType.Curve3D }

    IsBounded() { return true }
    IsPeriodic() { return this.IsClosed() }
    IsTouch() { return this.IsClosed() }
    GetPeriod() { return this.IsPeriodic() ? this.tmax - this.tmin : 0 }
    GetTMin() { return this.tmin }
    GetTMax() { return this.tmax }
    IsStraight(_ignoreParams?: boolean) { return false }
    GetBasisCurve(): Curve3D { return this }

    wrap(t: number) {
        const { tmin, tmax } = this;
        if (this.IsPeriodic()) {
            const p = tmax - tmin;
            if (t < tmin - 1e-12 || t > tmax + 1e-12) t = tmin + (((t - tmin) % p) + p) % p;
            return t;
        }
        if (!this.IsBounded()) return t;
        return Math.min(tmax, Math.max(tmin, t));
    }

    PointOn(t: number) { return this._PointOn(this.wrap(t)) }

    _FirstDer(t: number): Vector3D {
        const span = this.IsBounded() ? Math.abs(this.tmax - this.tmin) : 1;
        const h = 1e-6 * Math.max(1, span);
        const a = this._PointOn(t - h), b = this._PointOn(t + h);
        return new Vector3D((b.x - a.x) / (2 * h), (b.y - a.y) / (2 * h), (b.z - a.z) / (2 * h));
    }
    FirstDer(t: number) { return this._FirstDer(this.wrap(t)) }

    _SecondDer(t: number): Vector3D {
        const span = this.IsBounded() ? Math.abs(this.tmax - this.tmin) : 1;
        const h = 1e-4 * Math.max(1, span);
        const a = this._FirstDer(t - h), b = this._FirstDer(t + h);
        return new Vector3D((b.x - a.x) / (2 * h), (b.y - a.y) / (2 * h), (b.z - a.z) / (2 * h));
    }

    _Tangent(t: number) { return normalized(this._FirstDer(t)) }
    Tangent(t: number) { return this._Tangent(this.wrap(t)) }

    // The principal normal; zero where the curve is straight (as in C3D, which callers rely on).
    Normal(t: number): Vector3D {
        t = this.wrap(t);
        const d1 = this._FirstDer(t), d2 = this._SecondDer(t);
        const b = cross(d1, d2);
        const speed = Math.hypot(d1.x, d1.y, d1.z);
        if (Math.hypot(b.x, b.y, b.z) <= 1e-9 * speed * speed * speed) return new Vector3D(0, 0, 0);
        return normalized(cross(b, d1));
    }

    BNormal(t: number): Vector3D {
        return normalized(cross(this.Tangent(t), this.Normal(t)));
    }

    GetLimitPoint(n: number) { return this._PointOn(n === 1 ? this.tmin : this.tmax) }

    Trimmed(t1: number, t2: number, sense: number): Curve3D | null {
        return new TrimmedCurve3D(this, t1, t2, sense);
    }

    samples(sag: number): number[] {
        const n = 64;
        const result = [];
        for (let i = 0; i <= n; i++) result.push(this.tmin + (this.tmax - this.tmin) * i / n);
        return result;
    }

    polyline(sag: number): CartPoint3D[] { return this.samples(sag).map(t => this._PointOn(t)) }

    GetWeightCentre(): CartPoint3D {
        const ps = this.polyline(0);
        const c = new CartPoint3D(0, 0, 0);
        for (const p of ps) { c.x += p.x; c.y += p.y; c.z += p.z }
        c.x /= ps.length; c.y /= ps.length; c.z /= ps.length;
        return c;
    }

    GetCentre(): CartPoint3D { return this.GetWeightCentre() }

    AddYourGabaritTo(cube: Cube) {
        if (!this.IsBounded()) return;
        for (const p of this.polyline(0)) cube.include(p);
    }

    // The plane containing this curve, if it is planar (and not a straight line).
    planeOf(): Placement3D | undefined {
        if (this.IsStraight(true)) return undefined;
        return fitPlane(this.polyline(0));
    }

    IsPlanar(_accuracy?: number) { return this.planeOf() !== undefined }

    GetPlaneCurve(_saveParams: boolean, _params?: unknown): { curve2d: Curve, placement: Placement3D } {
        const placement = this.planeOf();
        if (placement === undefined) throw new Error("Curve is not planar");
        return { curve2d: this.to2d(placement), placement };
    }

    GetProjection(place: Placement3D): Curve | null { return this.to2d(place) }

    GetCircleAxis(): { success: boolean, axis: Axis3D } {
        return { success: false, axis: new Axis3D(new Vector3D(0, 0, 1)) };
    }

    NearPointProjection(pnt: CartPoint3D, ext: boolean, _tRange?: unknown): { success: boolean, t: number } {
        const t = this.nearest(pnt, ext);
        return { success: true, t };
    }

    // Generic nearest point by sampling and ternary-search refinement.
    nearest(p: P3, _ext: boolean): number {
        const ts = this.samples(0);
        let bi = 0, bd = Infinity;
        for (const [i, t] of ts.entries()) {
            const d = dist(this._PointOn(t), p);
            if (d < bd) { bd = d; bi = i }
        }
        let lo = ts[Math.max(0, bi - 1)], hi = ts[Math.min(ts.length - 1, bi + 1)];
        for (let k = 0; k < 60; k++) {
            const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
            if (dist(this._PointOn(m1), p) < dist(this._PointOn(m2), p)) hi = m2; else lo = m1;
        }
        return (lo + hi) / 2;
    }

    // The point at t and the first three derivatives there, taken on one side of t: below it when side < 0, above it
    // when side > 0. Where the curve is smooth the sides agree; at corners, knots and the curve's ends they need not.
    // By one-sided finite differences here; curves with exact derivatives override it.
    derivatives(t: number, side: number): Derivatives {
        t = this.wrap(t);
        let s = side < 0 ? -1 : 1;
        const bounded = this.IsBounded() && !this.IsPeriodic();
        let h = 1e-3 * (this.IsBounded() ? this.tmax - this.tmin : 1);
        if (bounded) {
            const room = (dir: number) => dir < 0 ? t - this.tmin : this.tmax - t;
            if (room(s) < 4 * h && room(-s) > room(s)) s = -s;
            h = Math.min(h, room(s) / 4);
        }
        const P = this._PointOn(t);
        if (!(h > 0)) return [P, zero(), zero(), zero()];
        const f = [P];
        for (let k = 1; k <= 4; k++) f.push(this.PointOn(t + s * k * h));
        const combine = (c: number[], d: number) => {
            const v = zero();
            for (const [k, ck] of c.entries()) { v.x += ck * f[k].x; v.y += ck * f[k].y; v.z += ck * f[k].z }
            v.x /= d; v.y /= d; v.z /= d;
            return v;
        };
        return [
            P,
            combine([-25, 48, -36, 16, -3], 12 * s * h),
            combine([35, -104, 114, -56, 11], 12 * h * h),
            combine([-5, 18, -24, 14, -3], 2 * s * h * h * h),
        ];
    }

    // Length of the curve between the parameters t1 and t2, within its range.
    CalculateLength(t1: number, t2: number): number {
        if (t2 < t1) [t1, t2] = [t2, t1];
        const ts = [t1, ...this.samples(0).filter(t => t > t1 && t < t2), t2];
        let length = 0;
        for (let i = 1; i < ts.length; i++) length += this.intervalLength(ts[i - 1], ts[i]);
        return length;
    }

    GetMetricLength(): number { return this.CalculateLength(this.tmin, this.tmax) }

    // The parameter `len` along the curve from t, forwards when curveDir > 0; result is false (and t is clamped to the
    // curve's end) when the curve ends first.
    DistanceAlong(t: number, len: number, curveDir: number): { result: boolean, t: number } {
        const { tmin, tmax } = this;
        const ts = [tmin, ...this.samples(0).filter(u => u > tmin && u < tmax), tmax];
        const lengths = [0];
        for (let i = 1; i < ts.length; i++) lengths.push(lengths[i - 1] + this.intervalLength(ts[i - 1], ts[i]));
        const target = this.CalculateLength(tmin, Math.min(tmax, Math.max(tmin, t))) + (curveDir < 0 ? -len : len);
        const total = lengths[lengths.length - 1];
        if (target <= 0) return { result: target > -1e-9, t: tmin };
        if (target >= total) return { result: target < total + 1e-9, t: tmax };
        let i = 1;
        while (lengths[i] < target) i++;
        let lo = ts[i - 1], hi = ts[i];
        const want = target - lengths[i - 1];
        for (let k = 0; k < 60; k++) {
            const mid = (lo + hi) / 2;
            if (this.intervalLength(ts[i - 1], mid) < want) lo = mid; else hi = mid;
        }
        return { result: true, t: (lo + hi) / 2 };
    }

    // Gauss–Legendre quadrature of the speed between two parameters with no corner in between.
    private intervalLength(a: number, b: number) {
        const m = (a + b) / 2, r = (b - a) / 2;
        let sum = 0;
        for (const [x, w] of GAUSS) { const d = this._FirstDer(m + r * x); sum += w * Math.hypot(d.x, d.y, d.z) }
        return sum * r;
    }
}

// Least-squares plane through points (Newell's method); undefined if the points are collinear or not coplanar.
export function fitPlane(points: P3[], tolerance = 1e-6): Placement3D | undefined {
    if (points.length < 3) return undefined;
    let nx = 0, ny = 0, nz = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const a = points[i], b = points[(i + 1) % n];
        nx += (a.y - b.y) * (a.z + b.z);
        ny += (a.z - b.z) * (a.x + b.x);
        nz += (a.x - b.x) * (a.y + b.y);
    }
    let normal = new Vector3D(nx, ny, nz);
    if (Math.hypot(nx, ny, nz) < 1e-12) {
        // Newell fails for open zero-area paths that are still planar, e.g. a polyline that doubles back; try cross products.
        const a = points[0];
        let best = new Vector3D(0, 0, 0), bestLen = 0;
        for (let i = 1; i < n; i++) for (let j = i + 1; j < n; j++) {
            const c = cross(sub(points[i], a), sub(points[j], a));
            const l = Math.hypot(c.x, c.y, c.z);
            if (l > bestLen) { bestLen = l; best = c }
        }
        if (bestLen < 1e-12) return undefined;
        normal = best;
    }
    normal = canonical(normalized(normal));
    const origin = points[0];
    let scale = 0;
    for (const p of points) scale = Math.max(scale, dist(p, origin));
    for (const p of points) if (Math.abs(dot(sub(p, origin), normal)) > Math.max(tolerance, scale * 1e-9)) return undefined;
    return new Placement3D(pt(origin), normal, arbitraryPerpendicular(normal), false);
}

// Prefer normals whose dominant component is positive, so coplanar curves get the same orientation.
function canonical(n: Vector3D): Vector3D {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const dominant = az >= ax && az >= ay ? n.z : ay >= ax ? n.y : n.x;
    return dominant < 0 ? new Vector3D(-n.x, -n.y, -n.z) : n;
}

export class LineSegment3D extends Curve3D {
    p1: CartPoint3D; p2: CartPoint3D;
    constructor(p1: P3, p2: P3) { super(); this.p1 = pt(p1); this.p2 = pt(p2) }

    IsA(): number { return SpaceType.LineSegment3D }
    get tmin() { return 0 }
    get tmax() { return 1 }
    IsClosed() { return false }
    IsStraight(_ignoreParams?: boolean) { return true }
    _PointOn(t: number) { const { p1, p2 } = this; return new CartPoint3D(p1.x + (p2.x - p1.x) * t, p1.y + (p2.y - p1.y) * t, p1.z + (p2.z - p1.z) * t) }
    _FirstDer() { return sub(this.p2, this.p1) }
    _SecondDer() { return new Vector3D(0, 0, 0) }
    derivatives(t: number, _side: number): Derivatives { return [this._PointOn(t), this._FirstDer(), zero(), zero()] }
    Inverse() { [this.p1, this.p2] = [this.p2, this.p1] }
    Transform(m: Matrix3D) { this.p1 = m.applyPoint(this.p1); this.p2 = m.applyPoint(this.p2) }
    Duplicate() { return new LineSegment3D(this.p1, this.p2) }
    to2d(place: Placement3D) { return new LineSegment(place.point2d(this.p1), place.point2d(this.p2)) }
    samples(_sag?: number) { return [0, 1] }
    nearest(p: P3, ext: boolean) { return projectOnSegment(this.p1, this.p2, p, ext) }
}

function projectOnSegment(a: P3, b: P3, p: P3, ext: boolean) {
    const d = sub(b, a);
    const len2 = dot(d, d);
    if (len2 === 0) return 0;
    const u = dot(sub(p, a), d) / len2;
    return ext ? u : Math.min(1, Math.max(0, u));
}

export class Line3D extends Curve3D {
    p1: CartPoint3D; p2: CartPoint3D;
    constructor(p1: P3, p2: P3) { super(); this.p1 = pt(p1); this.p2 = pt(p2) }

    IsA(): number { return SpaceType.Line3D }
    get tmin() { return -Infinity }
    get tmax() { return Infinity }
    IsBounded() { return false }
    IsClosed() { return false }
    IsStraight(_ignoreParams?: boolean) { return true }
    _PointOn(t: number) { const { p1, p2 } = this; return new CartPoint3D(p1.x + (p2.x - p1.x) * t, p1.y + (p2.y - p1.y) * t, p1.z + (p2.z - p1.z) * t) }
    _FirstDer() { return sub(this.p2, this.p1) }
    _SecondDer() { return new Vector3D(0, 0, 0) }
    derivatives(t: number, _side: number): Derivatives { return [this._PointOn(t), this._FirstDer(), zero(), zero()] }
    GetLimitPoint(n: number) { return n === 1 ? this.p1.clone() : this.p2.clone() }
    Inverse() { [this.p1, this.p2] = [this.p2, this.p1] }
    Transform(m: Matrix3D) { this.p1 = m.applyPoint(this.p1); this.p2 = m.applyPoint(this.p2) }
    Duplicate() { return new Line3D(this.p1, this.p2) }
    to2d(place: Placement3D) { return new Line(place.point2d(this.p1), place.point2d(this.p2)) }
    samples(_sag?: number) { return [0, 1] }
    nearest(p: P3) { return projectOnSegment(this.p1, this.p2, p, true) }
}

export abstract class PolyCurve3D extends Curve3D {
    points: CartPoint3D[] = [];
    closed = false;

    Type() { return SpaceType.PolyCurve3D }
    GetPoints() { return this.points.map(p => p.clone()) }
    GetCount() { return this.points.length }
    ChangePoint(index: number, p: CartPoint3D) { this.points[index] = p.clone(); this.changed() }
    RemovePoint(index: number) { this.points.splice(index, 1); this.changed() }
    InsertPoint(index: number, p: CartPoint3D) { this.points.splice(index, 0, p.clone()); this.changed() }
    AddPoint(p: CartPoint3D) { this.points.push(p.clone()); this.changed() }
    Rebuild() { this.changed() }
    IsClosed() { return this.closed }
    SetClosed(c: boolean) { this.closed = c; this.changed() }
    protected changed() { }

    // The points lie on a line and go along it in one direction.
    protected pointsStraight() {
        if (this.closed) return false;
        const { points } = this;
        if (points.length < 2) return false;
        const a = points[0], b = points[points.length - 1];
        if (dist(a, b) < EPS) return false;
        const d = normalized(sub(b, a));
        for (const p of points) {
            const c = cross(sub(p, a), d);
            if (Math.hypot(c.x, c.y, c.z) > EPS) return false;
        }
        for (let i = 1; i < points.length; i++) if (dot(sub(points[i], points[i - 1]), d) < -EPS) return false;
        return true;
    }
}

export class Polyline3D extends PolyCurve3D {
    constructor(a: CartPoint3D[] | Polyline = [], b: boolean | Placement3D = false) {
        super();
        if (a instanceof Polyline) {
            const place = b as Placement3D;
            this.points = a.points.map(p => place.point3d(p));
            this.closed = a.closed;
        } else {
            this.points = a.map(pt);
            this.closed = b as boolean;
        }
    }

    IsA(): number { return SpaceType.Polyline3D }
    get tmin() { return 0 }
    get tmax() { return this.closed ? this.points.length : this.points.length - 1 }

    IsStraight(_ignoreParams?: boolean) { return this.pointsStraight() }

    private segment(t: number): [number, number] {
        const n = this.points.length;
        const segments = this.closed ? n : n - 1;
        const i = Math.max(0, Math.min(segments - 1, Math.floor(t)));
        return [i, (i + 1) % n];
    }

    _PointOn(t: number) {
        const [i, j] = this.segment(t);
        const p = this.points[i], q = this.points[j];
        const u = t - i;
        return new CartPoint3D(p.x + (q.x - p.x) * u, p.y + (q.y - p.y) * u, p.z + (q.z - p.z) * u);
    }

    _FirstDer(t: number) { const [i, j] = this.segment(t); return sub(this.points[j], this.points[i]) }
    _SecondDer() { return new Vector3D(0, 0, 0) }

    // At a vertex, the segment on the side of `side`
    derivatives(t: number, side: number): Derivatives {
        t = this.wrap(t);
        const n = this.points.length;
        const segments = this.closed ? n : n - 1;
        let i = Math.floor(t);
        if (side < 0 && Math.abs(t - Math.round(t)) < 1e-9) i = Math.round(t) - 1;
        i = this.closed ? ((i % segments) + segments) % segments : Math.max(0, Math.min(segments - 1, i));
        return [this._PointOn(t), sub(this.points[(i + 1) % n], this.points[i]), zero(), zero()];
    }

    // A polyline, as in C3D; trimmed beyond its ends, it continues along its end spans.
    Trimmed(t1: number, t2: number, sense: number): Curve3D | null {
        if (this.closed) return super.Trimmed(t1, t2, sense);
        const points = [this._PointOn(t1)];
        for (let i = 1; i < this.points.length - 1; i++) if (i > t1 + 1e-9 && i < t2 - 1e-9) points.push(this.points[i].clone());
        points.push(this._PointOn(t2));
        if (sense < 0) points.reverse();
        return new Polyline3D(points, false);
    }

    Inverse() { this.points.reverse() }
    Transform(m: Matrix3D) { this.points = this.points.map(p => m.applyPoint(p)) }
    Duplicate() { return new Polyline3D(this.points, this.closed) }
    to2d(place: Placement3D) { return new Polyline(this.points.map(p => place.point2d(p)), this.closed) }
    samples(_sag?: number) { const result = []; for (let i = this.tmin; i <= this.tmax; i++) result.push(i); return result }

    planeOf() {
        if (this.IsStraight(true)) return undefined;
        return fitPlane(this.points);
    }

    nearest(p: P3, ext: boolean) {
        const n = this.points.length;
        const segments = this.closed ? n : n - 1;
        let best = 0, bd = Infinity;
        for (let i = 0; i < segments; i++) {
            const a = this.points[i], b = this.points[(i + 1) % n];
            const u = projectOnSegment(a, b, p, ext && ((i === 0) || (i === segments - 1)));
            const t = i + u;
            const d = dist(this._PointOn(t), p);
            if (d < bd) { bd = d; best = t }
        }
        return best;
    }
}

// An interpolating or control-point spline, evaluated as an exact B-spline.
export abstract class Spline3D extends PolyCurve3D {
    protected abstract readonly kind: SplineKind;
    private _bspline?: BSpline;

    constructor(points: P3[] = [], closed = false) {
        super();
        this.points = points.map(pt);
        this.closed = closed;
    }

    bspline(): BSpline { return this._bspline ??= this.build() }
    protected build(): BSpline { return makeSpline(this.kind, this.points.map(p => [p.x, p.y, p.z]), this.closed) }
    protected changed() { this._bspline = undefined }

    get tmin() { return this.bspline().tmin }
    get tmax() { return this.bspline().tmax }
    IsPeriodic() { return this.closed }
    // As in C3D, a spline counts as straight only when its parametrization is ignored
    IsStraight(ignoreParams = false) { return ignoreParams && this.pointsStraight() }

    _PointOn(t: number) { const [x, y, z] = this.bspline().point(t); return new CartPoint3D(x, y, z) }
    _FirstDer(t: number) { const [x, y, z] = this.bspline().derivative(t); return new Vector3D(x, y, z) }

    derivatives(t: number, side: number): Derivatives {
        const b = this.bspline();
        t = this.wrap(t);
        // Across the seam of a closed spline, the other end's span
        if (this.closed && side < 0 && t <= b.tmin + 1e-12) t = b.tmax;
        else if (this.closed && side > 0 && t >= b.tmax - 1e-12) t = b.tmin;
        const [p, d1, d2, d3] = b.derivatives(t, 3, side);
        return [new CartPoint3D(p[0], p[1], p[2]), new Vector3D(d1[0], d1[1], d1[2]), new Vector3D(d2[0], d2[1], d2[2]), new Vector3D(d3[0], d3[1], d3[2])];
    }

    Inverse() { this.points.reverse(); this.changed() }
    Transform(m: Matrix3D) { this.points = this.points.map(p => m.applyPoint(p)); this.changed() }
    protected abstract make2d(points: { x: number, y: number }[], closed: boolean): Curve;
    to2d(place: Placement3D) { return this.make2d(this.points.map(p => place.point2d(p)), this.closed) }

    Duplicate(): Spline3D {
        const C = this.constructor as new (points: P3[], closed: boolean) => Spline3D;
        return new C(this.points, this.closed);
    }

    planeOf() {
        if (this.pointsStraight()) return undefined;
        return fitPlane(this.points);
    }

    samples(_sag?: number) {
        const spans = this.bspline().spans();
        const result = [spans[0]];
        for (let i = 0; i < spans.length - 1; i++) for (let k = 1; k <= 24; k++) result.push(spans[i] + (spans[i + 1] - spans[i]) * k / 24);
        return result;
    }
}

// The tangents and span lengths are fixed when the curve is made: moving, adding or removing points keeps the other
// points' tangents, as in C3D (see hermiteData).
export class Hermit3D extends Spline3D {
    protected readonly kind = SplineKind.Hermite;
    data: HermiteData;

    constructor(points: P3[] = [], closed = false, data?: HermiteData) {
        super(points, closed);
        this.data = data ?? this.fresh();
    }

    private coords() { return this.points.map(p => [p.x, p.y, p.z]) }
    private fresh(): HermiteData { return this.points.length >= 2 ? hermiteData(this.coords(), this.closed) : { tangents: [], spans: [] } }

    IsA(): number { return SpaceType.Hermit3D }
    protected build() { return hermiteFromData(this.coords(), this.data, this.closed) }
    protected make2d(points: { x: number, y: number }[], closed: boolean) { return new Hermit(points, closed) }

    RemovePoint(index: number) {
        this.data = hermiteRemove(this.data, index, this.points.length, this.closed);
        super.RemovePoint(index);
    }
    InsertPoint(index: number, p: CartPoint3D) {
        super.InsertPoint(index, p);
        this.data = this.closed || this.points.length < 3 ? this.fresh() : hermiteInsert(this.coords(), this.data, index);
    }
    AddPoint(p: CartPoint3D) { this.InsertPoint(this.points.length, p) }
    SetClosed(closed: boolean) { this.closed = closed; this.data = this.fresh(); this.changed() }

    // Straight only if the tangents run along the line too (and, as for other splines, when ignoring parametrization)
    IsStraight(ignoreParams = false) {
        if (!ignoreParams || !this.pointsStraight()) return false;
        const d = normalized(sub(this.points[this.points.length - 1], this.points[0]));
        return this.data.tangents.every(([x, y, z]) => { const c = cross(new Vector3D(x, y, z), d); return Math.hypot(c.x, c.y, c.z) <= EPS * Math.max(1, Math.hypot(x, y, z)) });
    }
    planeOf() { return this.IsStraight(true) ? undefined : fitPlane(this.polyline(0)) }

    Inverse() { this.points.reverse(); this.data = hermiteReverse(this.data, this.closed); this.changed() }
    Transform(m: Matrix3D) {
        this.points = this.points.map(p => m.applyPoint(p));
        const tangents = this.data.tangents.map(([x, y, z]) => { const v = m.applyVector(new Vector3D(x, y, z)); return [v.x, v.y, v.z] });
        this.data = { tangents, spans: [...this.data.spans] };
        this.changed();
    }
    Duplicate(): Hermit3D { return new Hermit3D(this.points, this.closed, { tangents: this.data.tangents.map(t => [...t]), spans: [...this.data.spans] }) }
    to2d(place: Placement3D) {
        const tangents = this.data.tangents.map(([x, y, z]) => { const v = new Vector3D(x, y, z); return [dot(v, place.axisX), dot(v, place.axisY)] });
        return new Hermit(this.points.map(p => place.point2d(p)), this.closed, { tangents, spans: [...this.data.spans] });
    }
}

export class CubicSpline3D extends Spline3D {
    protected readonly kind = SplineKind.CubicSpline;
    IsA(): number { return SpaceType.CubicSpline3D }
    protected make2d(points: { x: number, y: number }[], closed: boolean) { return new CubicSpline(points, closed) }
    static Create(curve: CubicSpline, placement: Placement3D) { return new CubicSpline3D(curve.points.map(p => placement.point3d(p)), curve.closed) }
}

export class Bezier3D extends Spline3D {
    protected readonly kind = SplineKind.Bezier;
    IsA(): number { return SpaceType.Bezier3D }
    protected make2d(points: { x: number, y: number }[], closed: boolean) { return new Bezier(points, closed) }
}

export class Nurbs3D extends Spline3D {
    protected readonly kind = SplineKind.Nurbs;
    IsA(): number { return SpaceType.Nurbs3D }
    protected make2d(points: { x: number, y: number }[], closed: boolean) { return new Nurbs(points, closed) }
    static Create(curve: Nurbs, placement: Placement3D) { return new Nurbs3D(curve.points.map(p => placement.point3d(p)), curve.closed) }
}

// A circle, ellipse, or an arc of either: centre + a·cos(t)·X + b·sin(t)·Y in the placement's plane.
export class Arc3D extends Curve3D {
    placement = new Placement3D();
    a = 1; b = 1;
    t1 = 0; t2 = TWO_PI;
    closed = true;

    constructor(...args: any[]) {
        super();
        if (args.length === 0) return;
        const [a0, a1, a2, a3, a4] = args;
        if (a0 instanceof Placement3D) {
            // (place, aa, bb, angle): a full ellipse when angle is 0
            this.placement = new Placement3D(a0);
            this.a = a1; this.b = a2;
            const angle = a3 as number;
            if (angle === 0 || Math.abs(angle) >= TWO_PI - 1e-12) { this.t1 = 0; this.t2 = TWO_PI; this.closed = true }
            else if (angle > 0) { this.t1 = 0; this.t2 = angle; this.closed = false }
            else { this.placement.axisY.Invert(); this.placement.axisZ.Invert(); this.t1 = 0; this.t2 = -angle; this.closed = false }
        } else if (a0 instanceof Arc) {
            // (ellipse2d, place)
            const arc = a0 as Arc, place = a1 as Placement3D;
            const center = place.point3d(arc.c);
            const X = place.GetVectorFrom(arc.u.x, arc.u.y, 0), Y = place.GetVectorFrom(arc.v.x, arc.v.y, 0);
            this.placement = basis(center, X, Y);
            this.a = arc.a; this.b = arc.b;
            this.t1 = arc.t1; this.t2 = arc.t2; this.closed = arc.closed;
        } else if (args.length === 5 && typeof a3 === 'number' && typeof a4 === 'boolean') {
            // (p0, p1, p2, n, closed): circle or arc through three points
            this.initThreePoints(a0, a1, a2, a4);
        } else if (args.length === 5 && a3 instanceof Vector3D) {
            // (pc, p1, p2, aZ, sense)
            this.initCenterTwoPoints(a0, a1, a2, a3, a4 as number);
        } else {
            // (pc, p1, p2, sense?)
            const pc = a0 as CartPoint3D, p1 = a1 as CartPoint3D, p2 = a2 as CartPoint3D;
            let z = cross(sub(p1, pc), sub(p2, pc));
            if (Math.hypot(z.x, z.y, z.z) < 1e-12) z = arbitraryPerpendicular(normalized(sub(p1, pc)));
            this.initCenterTwoPoints(pc, p1, p2, normalized(z), (a3 as number) ?? 1);
        }
    }

    private initThreePoints(p0: CartPoint3D, p1: CartPoint3D, p2: CartPoint3D, closed: boolean) {
        const a = sub(p1, p0), b = sub(p2, p0);
        const axb = cross(a, b);
        const l2 = dot(axb, axb);
        if (l2 < 1e-20) throw new Error("Points are collinear");
        const aa = dot(a, a), bb = dot(b, b);
        const t = cross(new Vector3D(aa * b.x - bb * a.x, aa * b.y - bb * a.y, aa * b.z - bb * a.z), axb);
        const center = new CartPoint3D(p0.x + t.x / (2 * l2), p0.y + t.y / (2 * l2), p0.z + t.z / (2 * l2));
        const r = dist(center, p0);
        const Z = normalized(axb), X = normalized(sub(p0, center));
        this.placement = new Placement3D(center, Z, X, false);
        this.a = this.b = r;
        if (closed) { this.t1 = 0; this.t2 = TWO_PI; this.closed = true }
        else { this.t1 = 0; this.t2 = this.angleOf(p2, true); this.closed = false }
    }

    private initCenterTwoPoints(pc: CartPoint3D, p1: CartPoint3D, p2: CartPoint3D, z: Vector3D, sense: number) {
        const Z = sense < 0 ? new Vector3D(-z.x, -z.y, -z.z) : normalized(z);
        const r = dist(pc, p1);
        this.placement = new Placement3D(pc, Z, normalized(sub(p1, pc)), false);
        this.a = this.b = r;
        this.t1 = 0;
        this.t2 = this.angleOf(p2, true);
        this.closed = false;
        if (this.t2 < 1e-12) { this.t2 = TWO_PI; this.closed = true }
    }

    // Angle of a point in this arc's frame, in [0, 2π) when `positive`.
    angleOf(p: P3, positive = false) {
        const { placement: P } = this;
        const d = sub(p, P.origin);
        let alpha = Math.atan2(dot(d, P.axisY) / this.b, dot(d, P.axisX) / this.a);
        if (positive && alpha < 0) alpha += TWO_PI;
        return alpha;
    }

    IsA(): number { return SpaceType.Arc3D }
    get tmin() { return this.t1 }
    get tmax() { return this.t2 }
    IsClosed() { return this.closed }
    IsCircle() { return Math.abs(this.a - this.b) < EPS }

    _PointOn(t: number) {
        const { placement: P, a, b } = this;
        return P.GetPointFrom(a * Math.cos(t), b * Math.sin(t), 0);
    }
    _FirstDer(t: number) { return this.placement.GetVectorFrom(-this.a * Math.sin(t), this.b * Math.cos(t), 0) }
    _SecondDer(t: number) { return this.placement.GetVectorFrom(-this.a * Math.cos(t), -this.b * Math.sin(t), 0) }
    derivatives(t: number, _side: number): Derivatives {
        return [this._PointOn(t), this._FirstDer(t), this._SecondDer(t), this.placement.GetVectorFrom(this.a * Math.sin(t), -this.b * Math.cos(t), 0)];
    }

    GetCentre() { return this.placement.GetOrigin() }
    GetRadius() { return this.a }
    GetRadiusA() { return this.a }
    GetRadiusB() { return this.b }
    SetRadius(r: number) { this.a = this.b = r }
    SetRadiusA(r: number) { this.a = r }
    SetRadiusB(r: number) { this.b = r }
    GetAngle() { return this.t2 - this.t1 }
    SetAngle(angle: number) { this.t2 = this.t1 + angle; this.closed = Math.abs(angle - TWO_PI) < 1e-12 }
    GetTrim1() { return this.t1 }
    GetTrim2() { return this.t2 }
    GetPlacement() { return this.placement.clone() }

    MakeTrimmed(t1: number, t2: number) {
        if (t2 <= t1) t2 += TWO_PI;
        this.t1 = t1; this.t2 = t2;
        this.closed = Math.abs(t2 - t1 - TWO_PI) < 1e-12;
        return true;
    }

    // Moves one end of the arc: a circular arc keeps its other end, plane and sweep angle (as in C3D), so its radius
    // and centre change; an elliptical arc is trimmed to the angle of the point.
    SetLimitPoint(n: number, pnt: CartPoint3D) {
        const angle = this.t2 - this.t1;
        if (this.IsCircle() && !this.closed && angle > 1e-9) {
            const start = n === 1 ? pnt : this._PointOn(this.t1), end = n === 2 ? pnt : this._PointOn(this.t2);
            const Z = this.placement.axisZ;
            const chord0 = sub(end, start), along = dot(chord0, Z);
            const chord = new Vector3D(chord0.x - along * Z.x, chord0.y - along * Z.y, chord0.z - along * Z.z);
            const length = Math.hypot(chord.x, chord.y, chord.z);
            if (length > 1e-12) {
                const r = length / (2 * Math.sin(angle / 2));
                const left = normalized(cross(Z, chord));
                const d = r * Math.cos(angle / 2);
                const centre = new CartPoint3D(
                    (start.x + end.x - along * Z.x) / 2 + d * left.x,
                    (start.y + end.y - along * Z.y) / 2 + d * left.y,
                    (start.z + end.z - along * Z.z) / 2 + d * left.z);
                const X = normalized(sub(start, centre));
                this.placement = new Placement3D(centre, Z, X, false);
                this.a = this.b = Math.abs(r);
                this.t1 = 0; this.t2 = angle;
                return;
            }
        }
        const alpha = this.angleOf(pnt);
        if (n === 1) {
            let t = alpha;
            while (t > this.t2) t -= TWO_PI;
            while (t < this.t2 - TWO_PI) t += TWO_PI;
            this.t1 = t;
        } else {
            let t = alpha;
            while (t < this.t1) t += TWO_PI;
            while (t > this.t1 + TWO_PI) t -= TWO_PI;
            this.t2 = t;
        }
        this.closed = false;
    }

    GetCircleAxis() {
        return { success: this.IsCircle(), axis: new Axis3D(this.placement.GetOrigin(), this.placement.GetAxisZ()) };
    }

    Inverse() {
        this.placement.axisY.Invert();
        this.placement.axisZ.Invert();
        [this.t1, this.t2] = [-this.t2, -this.t1];
    }

    Transform(m: Matrix3D) {
        const P = this.placement;
        const center = m.applyPoint(P.origin);
        const X = m.applyVector(new Vector3D(P.axisX.x * this.a, P.axisX.y * this.a, P.axisX.z * this.a));
        const Y = m.applyVector(new Vector3D(P.axisY.x * this.b, P.axisY.y * this.b, P.axisY.z * this.b));
        this.a = Math.hypot(X.x, X.y, X.z); this.b = Math.hypot(Y.x, Y.y, Y.z);
        this.placement = basis(center, X, Y);
    }

    Duplicate() {
        const result = new Arc3D();
        result.placement = this.placement.clone();
        result.a = this.a; result.b = this.b; result.t1 = this.t1; result.t2 = this.t2; result.closed = this.closed;
        return result;
    }

    to2d(place: Placement3D) {
        const P = this.placement;
        const c = place.point2d(P.origin);
        const u = { x: dot(P.axisX, place.axisX), y: dot(P.axisX, place.axisY) };
        const v = { x: dot(P.axisY, place.axisX), y: dot(P.axisY, place.axisY) };
        return Arc.make(c, this.a, this.b, u, v, this.t1, this.t2, this.closed);
    }

    planeOf() {
        const P = this.placement;
        return new Placement3D(P.origin, canonical(P.axisZ), arbitraryPerpendicular(canonical(P.axisZ)), false);
    }

    samples(sag: number) {
        const n = Math.max(2, Math.ceil(Math.abs(this.t2 - this.t1) / maxAngleForSag(Math.max(this.a, this.b), sag)));
        const result = [];
        for (let i = 0; i <= n; i++) result.push(this.t1 + (this.t2 - this.t1) * i / n);
        return result;
    }

    nearest(p: P3, ext: boolean) {
        let alpha = this.angleOf(p);
        const { t1, t2 } = this;
        alpha = t1 + (((alpha - t1) % TWO_PI) + TWO_PI) % TWO_PI;
        if (alpha <= t2 || this.closed) return alpha;
        if (ext) return alpha;
        return dist(this._PointOn(t1), p) < dist(this._PointOn(t2), p) ? t1 : t2;
    }
}

export abstract class Spiral extends Curve3D { }

// A cylindrical or conical helix: at the angle t, origin + Z·step/2π·t + (radius + tgAlpha·step/2π·t)·(X·cos t + Y·sin t),
// right-handed when X, Y, Z are. The axes are kept as vectors (not necessarily unit or orthogonal) so that any affine
// transformation is exact.
export class ConeSpiral extends Spiral {
    origin = new CartPoint3D(0, 0, 0);
    X = new Vector3D(1, 0, 0); Y = new Vector3D(0, 1, 0); Z = new Vector3D(0, 0, 1);
    radius = 1; step = 1; tgAlpha = 0;
    t2 = TWO_PI;

    // Around the axis from p0 to p1, starting towards p2, with `step` along the axis per turn.
    static make(p0: P3, p1: P3, p2: P3, radius: number, step: number, tgAlpha: number): ConeSpiral {
        const axis = sub(p1, p0);
        const height = Math.hypot(axis.x, axis.y, axis.z);
        const Z = normalized(axis);
        const d = sub(p2, p0), along = dot(d, Z);
        let X = new Vector3D(d.x - along * Z.x, d.y - along * Z.y, d.z - along * Z.z);
        X = Math.hypot(X.x, X.y, X.z) < 1e-9 ? arbitraryPerpendicular(Z) : normalized(X);
        const result = new ConeSpiral();
        result.origin = pt(p0);
        result.X = X; result.Y = cross(Z, X); result.Z = Z;
        result.radius = radius; result.step = step; result.tgAlpha = tgAlpha;
        result.t2 = TWO_PI * height / step;
        return result;
    }

    IsA(): number { return SpaceType.ConeSpiral }
    get tmin() { return 0 }
    get tmax() { return this.t2 }
    IsClosed() { return false }

    private get rise() { return this.step / TWO_PI }
    radiusAt(t: number) { return this.radius + this.tgAlpha * this.rise * t }

    _PointOn(t: number) {
        const { origin: o, X, Y, Z } = this;
        const h = this.rise * t, r = this.radiusAt(t), c = r * Math.cos(t), s = r * Math.sin(t);
        return new CartPoint3D(o.x + Z.x * h + X.x * c + Y.x * s, o.y + Z.y * h + X.y * c + Y.y * s, o.z + Z.z * h + X.z * c + Y.z * s);
    }

    _FirstDer(t: number) {
        const { X, Y, Z } = this;
        const h = this.rise, r = this.radiusAt(t), dr = this.tgAlpha * this.rise;
        const a = dr * Math.cos(t) - r * Math.sin(t), b = dr * Math.sin(t) + r * Math.cos(t);
        return new Vector3D(Z.x * h + X.x * a + Y.x * b, Z.y * h + X.y * a + Y.y * b, Z.z * h + X.z * a + Y.z * b);
    }

    // The same helix traced from its end: around the reversed axis, starting where it ended.
    Inverse() {
        const T = this.t2, h = this.rise * T, c = Math.cos(T), s = Math.sin(T);
        const { origin: o, X, Y, Z } = this;
        this.origin = new CartPoint3D(o.x + Z.x * h, o.y + Z.y * h, o.z + Z.z * h);
        this.X = new Vector3D(X.x * c + Y.x * s, X.y * c + Y.y * s, X.z * c + Y.z * s);
        this.Y = new Vector3D(X.x * s - Y.x * c, X.y * s - Y.y * c, X.z * s - Y.z * c);
        this.Z = new Vector3D(-Z.x, -Z.y, -Z.z);
        this.radius = this.radiusAt(T);
        this.tgAlpha = -this.tgAlpha;
    }

    Transform(m: Matrix3D) {
        this.origin = m.applyPoint(this.origin);
        this.X = m.applyVector(this.X); this.Y = m.applyVector(this.Y); this.Z = m.applyVector(this.Z);
    }

    Duplicate() {
        const result = new ConeSpiral();
        result.origin = pt(this.origin);
        result.X = new Vector3D(this.X.x, this.X.y, this.X.z);
        result.Y = new Vector3D(this.Y.x, this.Y.y, this.Y.z);
        result.Z = new Vector3D(this.Z.x, this.Z.y, this.Z.z);
        result.radius = this.radius; result.step = this.step; result.tgAlpha = this.tgAlpha; result.t2 = this.t2;
        return result;
    }

    to2d(_place: Placement3D): Curve { throw new Error("A spiral is not planar") }
    planeOf() { return undefined }

    samples(sag: number) {
        const scale = Math.max(Math.hypot(this.X.x, this.X.y, this.X.z), Math.hypot(this.Y.x, this.Y.y, this.Y.z));
        const r = scale * Math.max(Math.abs(this.radius), Math.abs(this.radiusAt(this.t2)));
        const n = Math.max(2, Math.ceil(this.t2 / Math.min(Math.PI / 16, maxAngleForSag(r, sag))));
        const result = [];
        for (let i = 0; i <= n; i++) result.push(this.t2 * i / n);
        return result;
    }
}

// An orthonormal placement at `origin` with the directions of X and Y (Y is made perpendicular to X).
function basis(origin: P3, X: Vector3D, Y: Vector3D): Placement3D {
    const x = normalized(X);
    const yx = dot(Y, x);
    const y = normalized(new Vector3D(Y.x - yx * x.x, Y.y - yx * x.y, Y.z - yx * x.z));
    const result = new Placement3D();
    result.origin = pt(origin);
    result.axisX = x; result.axisY = y; result.axisZ = cross(x, y);
    return result;
}

// A planar curve: a 2D curve placed in 3D.
export class PlaneCurve extends Curve3D {
    placement: Placement3D;
    curve: Curve;

    constructor(placement: Placement3D, init: Curve, same = true) {
        super();
        this.placement = new Placement3D(placement);
        this.curve = same ? init : init.Duplicate() as Curve;
    }

    IsA(): number { return SpaceType.PlaneCurve }
    get tmin() { return this.curve.tmin }
    get tmax() { return this.curve.tmax }
    IsClosed() { return this.curve.IsClosed() }
    IsBounded() { return this.curve.IsBounded() }
    IsPeriodic() { return this.curve.IsPeriodic() }
    IsStraight(ignoreParams?: boolean) { return this.curve.IsStraight(ignoreParams) }
    GetPlacement() { return this.placement.clone() }
    GetCurve() { return this.curve }

    _PointOn(t: number) { return this.placement.point3d(this.curve._PointOn(t)) }
    _FirstDer(t: number) { const d = this.curve._FirstDer(t); return this.placement.GetVectorFrom(d.x, d.y, 0) }

    Inverse() { this.curve.Inverse() }

    Transform(m: Matrix3D) {
        const P = this.placement;
        const X = m.applyVector(P.axisX), Y = m.applyVector(P.axisY);
        const sx = Math.hypot(X.x, X.y, X.z), sy = Math.hypot(Y.x, Y.y, Y.z);
        const origin = m.applyPoint(P.origin);
        const placement = new Placement3D();
        placement.origin = origin;
        placement.axisX = normalized(X); placement.axisY = normalized(Y);
        placement.axisZ = normalized(m.applyVector(P.axisZ));
        if (Math.abs(sx - 1) > 1e-12 || Math.abs(sy - 1) > 1e-12) {
            const s = new Matrix();
            s.m[0][0] = sx; s.m[1][1] = sy;
            this.curve.Transform(s);
        }
        this.placement = placement;
    }

    Duplicate() { return new PlaneCurve(this.placement, this.curve.Duplicate() as Curve, true) }

    to2d(place: Placement3D) {
        const result = this.curve.Duplicate() as Curve;
        result.Transform(this.placement.GetMatrixToPlace(place));
        return result;
    }

    planeOf() {
        if (this.curve.IsStraight()) return undefined;
        return this.placement.clone();
    }

    GetPlaneCurve(_saveParams: boolean) {
        return { curve2d: this.curve.Duplicate() as Curve, placement: this.placement.clone() };
    }

    samples(sag: number) { return this.curve.IsBounded() ? this.curve.samples(sag) : [0, 1] }

    nearest(p: P3, ext: boolean) {
        return nearestParam2d(this.curve, this.placement.point2d(pt(p)), ext).t;
    }
}

export class TrimmedCurve3D extends Curve3D {
    basis: Curve3D;
    t1: number; t2: number; sense: number;

    constructor(basis: Curve3D, t1: number, t2: number, sense = 1) {
        super();
        if (basis instanceof TrimmedCurve3D && basis.sense > 0) basis = basis.basis;
        this.basis = basis;
        if (basis.IsPeriodic() && t2 <= t1) t2 += basis.GetPeriod();
        this.t1 = t1; this.t2 = t2; this.sense = sense;
    }

    IsA(): number { return SpaceType.TrimmedCurve3D }
    get tmin() { return this.t1 }
    get tmax() { return this.t2 }
    IsClosed() { return false }
    IsPeriodic() { return false }
    IsStraight(ignoreParams?: boolean) { return this.basis.IsStraight(ignoreParams) }
    GetBasisCurve() { return this.basis }

    private map(t: number) { return this.sense > 0 ? t : this.t1 + this.t2 - t }
    // Trimmed beyond the ends of a straight basis, the curve continues along it
    private extends(u: number) { const { basis } = this; return (u < basis.tmin || u > basis.tmax) && basis.IsStraight(true) }
    _PointOn(t: number) { const u = this.map(t); return this.extends(u) ? this.basis._PointOn(u) : this.basis.PointOn(u) }
    _FirstDer(t: number) {
        const u = this.map(t);
        const d = this.extends(u) ? this.basis._FirstDer(u) : this.basis.FirstDer(u);
        return this.sense > 0 ? d : new Vector3D(-d.x, -d.y, -d.z);
    }
    derivatives(t: number, side: number): Derivatives {
        const [p, d1, d2, d3] = this.basis.derivatives(this.map(t), this.sense > 0 ? side : -side);
        return this.sense > 0 ? [p, d1, d2, d3] : [p, neg(d1), d2, neg(d3)];
    }

    Inverse() { this.sense = -this.sense }
    Transform(m: Matrix3D) { this.basis = this.basis.Duplicate(); this.basis.Transform(m) }
    Duplicate() { return new TrimmedCurve3D(this.basis.Duplicate(), this.t1, this.t2, this.sense) }
    to2d(place: Placement3D) { return new TrimmedCurve(this.basis.to2d(place), this.t1, this.t2, this.sense) }
    planeOf() { return this.basis.planeOf() }

    samples(sag: number) {
        const ts = this.basis.samples(sag).filter(t => t > this.t1 && t < this.t2);
        const result = [this.t1, ...ts, this.t2];
        return this.sense > 0 ? result : result.map(t => this.t1 + this.t2 - t).reverse();
    }

    nearest(p: P3, ext: boolean) {
        const t = this.basis.nearest(p, ext);
        // Extended, the trimmed curve continues along its basis
        if ((t >= this.t1 && t <= this.t2) || (ext && !this.basis.IsPeriodic())) return this.sense > 0 ? t : this.t1 + this.t2 - t;
        return super.nearest(p, ext);
    }
}

export class Contour3D extends Curve3D {
    segments: Curve3D[] = [];
    private offsets: number[] = [0];
    private closed = false;

    constructor() { super() }

    static of(segments: Curve3D[]) {
        const result = new Contour3D();
        result.segments = segments;
        result.update();
        return result;
    }

    IsA(): number { return SpaceType.Contour3D }

    update() {
        const offsets = [0];
        for (const s of this.segments) offsets.push(offsets[offsets.length - 1] + (s.tmax - s.tmin));
        this.offsets = offsets;
        if (this.segments.length === 0) { this.closed = false; return }
        const a = this.segments[0].GetLimitPoint(1), b = this.segments[this.segments.length - 1].GetLimitPoint(2);
        this.closed = dist(a, b) < EPS;
    }

    get tmin() { return 0 }
    get tmax() { return this.offsets[this.offsets.length - 1] }
    IsClosed() { return this.closed }
    IsStraight(ignoreParams?: boolean) { return this.segments.length === 1 && this.segments[0].IsStraight(ignoreParams) }

    locate(t: number): [Curve3D, number, number] {
        const { segments, offsets } = this;
        let i = 0;
        while (i < segments.length - 1 && t > offsets[i + 1]) i++;
        const s = segments[i];
        return [s, s.tmin + (t - offsets[i]), i];
    }

    _PointOn(t: number) { const [s, u] = this.locate(t); return s._PointOn(u) }
    _FirstDer(t: number) { const [s, u] = this.locate(t); return s._FirstDer(u) }
    // Each segment's own: at a corner, the curvature of the segment there rather than of the corner
    _SecondDer(t: number) { const [s, u] = this.locate(t); return s._SecondDer(u) }

    // At a corner, those of the segment on the side of `side`
    derivatives(t: number, side: number): Derivatives {
        const { segments, offsets } = this;
        t = this.wrap(t);
        const last = segments.length - 1;
        if (this.closed && side < 0 && t <= offsets[0] + 1e-12) return segments[last].derivatives(segments[last].tmax, side);
        if (this.closed && side > 0 && t >= this.tmax - 1e-12) return segments[0].derivatives(segments[0].tmin, side);
        let i = 0;
        while (i < last && (side < 0 ? t > offsets[i + 1] : t >= offsets[i + 1])) i++;
        const s = segments[i];
        return s.derivatives(s.tmin + (t - offsets[i]), side);
    }

    GetSegmentsCount() { return this.segments.length }
    GetSegments() { return [...this.segments] }
    GetSegment(i: number) { return this.segments[i] ?? null }
    GetCornerParams() { return this.offsets.slice(1, -1) }

    AddCurveWithRuledCheck(curve: Curve3D, absEps = 1e-6, toEndOnly = false, _checkSame = true) {
        const eps = Math.max(absEps, EPS);
        const { segments } = this;
        if (segments.length === 0) { segments.push(curve); this.update(); return }
        const start = segments[0].GetLimitPoint(1), end = segments[segments.length - 1].GetLimitPoint(2);
        const cs = curve.GetLimitPoint(1), ce = curve.GetLimitPoint(2);
        if (dist(end, cs) < eps) segments.push(curve);
        else if (dist(end, ce) < eps) { curve.Inverse(); segments.push(curve) }
        else if (!toEndOnly && dist(start, ce) < eps) segments.unshift(curve);
        else if (!toEndOnly && dist(start, cs) < eps) { curve.Inverse(); segments.unshift(curve) }
        else throw new Error("Curve does not connect to the contour");
        this.update();
    }

    Init(points: CartPoint3D[]) {
        this.segments = [];
        for (let i = 0; i < points.length - 1; i++) this.segments.push(new Polyline3D([points[i], points[i + 1]], false));
        this.update();
        return true;
    }

    DeleteSegment(index: number) { this.segments.splice(index, 1); this.update() }

    FindCorner(index: number) { return this.segments[index].GetLimitPoint(1) }

    GetCornerAngle(index: number, angleEps = 1e-6) {
        const n = this.segments.length;
        const prev = this.segments[(index - 1 + n) % n], next = this.segments[index % n];
        const origin = prev.GetLimitPoint(2);
        const tau = prev.Tangent(prev.tmax);
        const tau2 = next.Tangent(next.tmin);
        const axisRaw = cross(tau, tau2);
        const angle = Math.atan2(Math.hypot(axisRaw.x, axisRaw.y, axisRaw.z), dot(tau, tau2));
        if (angle < angleEps) throw new Error("No corner: segments are tangent");
        return { origin, axis: normalized(axisRaw), tau, angle };
    }

    Inverse() {
        this.segments.reverse();
        for (const s of this.segments) s.Inverse();
        this.update();
    }

    Transform(m: Matrix3D) { for (const s of this.segments) s.Transform(m) }

    Duplicate() { return Contour3D.of(this.segments.map(s => s.Duplicate())) }

    to2d(place: Placement3D) {
        const contour = new Contour(this.segments.map(s => s.to2d(place)), true);
        contour.InitClosed(this.closed);
        return contour;
    }

    planeOf() {
        const points: P3[] = [];
        for (const s of this.segments) points.push(...s.polyline(0));
        return fitPlane(points);
    }

    samples(sag: number) {
        const result: number[] = [];
        for (const [i, s] of this.segments.entries()) {
            const ts = s.samples(sag).map(t => t - s.tmin + this.offsets[i]);
            if (result.length > 0) ts.shift();
            result.push(...ts);
        }
        return result;
    }

    nearest(p: P3, ext: boolean) {
        let best = 0, bd = Infinity;
        for (const [i, s] of this.segments.entries()) {
            const t = s.nearest(p, ext && (i === 0 || i === this.segments.length - 1));
            const d = dist(s._PointOn(t), p);
            if (d < bd) { bd = d; best = this.offsets[i] + (t - s.tmin) }
        }
        return best;
    }
}

export abstract class Surface extends SpaceItem {
    IsA(): number { return SpaceType.Surface }
    Family() { return SpaceType.Surface }
    GetSurface(): Surface { return this }
}

export abstract class ElementarySurface extends Surface { }

// The surface swept by a curve moved along a vector (shown, not built into solids).
export class ExtrusionSurface extends Surface {
    constructor(readonly curve: Curve3D, readonly direction: Vector3D) { super() }

    IsA(): number { return SpaceType.ExtrusionSurface }

    // Triangles between the curve and its moved copy.
    grid(sag: number): { index: Uint32Array, position: Float32Array, normal: Float32Array } {
        const { curve, direction: d } = this;
        const ts = curve.samples(sag);
        const n = ts.length;
        const position = new Float32Array(n * 6), normal = new Float32Array(n * 6);
        for (const [i, t] of ts.entries()) {
            const p = curve._PointOn(t), nv = normalized(cross(curve._FirstDer(t), d));
            position.set([p.x, p.y, p.z, p.x + d.x, p.y + d.y, p.z + d.z], i * 6);
            normal.set([nv.x, nv.y, nv.z, nv.x, nv.y, nv.z], i * 6);
        }
        const index = new Uint32Array((n - 1) * 6);
        for (let i = 0; i < n - 1; i++) {
            const a = 2 * i, b = a + 1, c = a + 2, e = a + 3;
            index.set([a, c, b, b, c, e], i * 6);
        }
        return { index, position, normal };
    }

    AddYourGabaritTo(cube: Cube) {
        const d = this.direction;
        for (const p of this.curve.polyline(0)) { cube.include(p); cube.include({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z }) }
    }

    Transform(m: Matrix3D) { this.curve.Transform(m); const d = m.applyVector(this.direction); this.direction.x = d.x; this.direction.y = d.y; this.direction.z = d.z }
    Duplicate() { return new ExtrusionSurface(this.curve.Duplicate(), this.direction.clone()) }
}

export class Plane extends ElementarySurface {
    placement: Placement3D;

    constructor(a?: CartPoint3D | Placement3D, b?: CartPoint3D | number, c?: CartPoint3D) {
        super();
        if (a instanceof Placement3D) {
            this.placement = new Placement3D(a);
            const distance = (b as number) ?? 0;
            if (distance !== 0) this.placement.Move(new Vector3D(a.axisZ.x * distance, a.axisZ.y * distance, a.axisZ.z * distance));
        } else if (a instanceof CartPoint3D) {
            const p1 = b as CartPoint3D, p2 = c!;
            const X = normalized(sub(p1, a));
            const Z = normalized(cross(sub(p1, a), sub(p2, a)));
            this.placement = new Placement3D(a, Z, X, false);
        } else {
            this.placement = new Placement3D();
        }
    }

    IsA(): number { return SpaceType.Plane }
    GetPlacement(_exact?: boolean) { return this.placement.clone() }
    GetUMin() { return -1e6 } GetUMax() { return 1e6 }
    GetVMin() { return -1e6 } GetVMax() { return 1e6 }
    GetUMid() { return 0 } GetVMid() { return 0 }
    GetUEpsilon() { return 1e-6 } GetVEpsilon() { return 1e-6 }
    GetUParamToUnit() { return 1 } GetVParamToUnit() { return 1 }
    GetRadius() { return 0 }
    IsPlanar() { return true }
    PointOn(uv: CartPoint) { return this.placement.GetPointFrom(uv.x, uv.y, 0) }
    _PointOn(u: number, v: number) { return this.placement.GetPointFrom(u, v, 0) }
    Normal(_u: number, _v: number) { return this.placement.GetAxisZ() }

    NearDirectPointProjection(pnt: CartPoint3D, vect: Vector3D, _ext: boolean) {
        const P = this.placement;
        const denom = dot(vect, P.axisZ);
        const along = denom === 0 ? 0 : dot(sub(P.origin, pnt), P.axisZ) / denom;
        const hit = new CartPoint3D(pnt.x + vect.x * along, pnt.y + vect.y * along, pnt.z + vect.z * along);
        const { x, y } = P.PointProjection(hit);
        return { u: x, v: y };
    }

    Transform(m: Matrix3D) { this.placement.Transform(m) }
    Duplicate() { return new Plane(this.placement, 0) }
}

// A 2D contour on a surface. Only planes are supported.
export class ContourOnSurface extends Curve3D {
    surface: Plane;
    contour: Contour;

    constructor(surface: Plane, contour?: Contour | number, same = true) {
        super();
        this.surface = surface;
        this.contour = contour instanceof Contour ? (same ? contour : contour.Duplicate()) : new Contour([], true);
    }

    IsA(): number { return SpaceType.ContourOnSurface }
    get tmin() { return this.contour.tmin }
    get tmax() { return this.contour.tmax }
    IsClosed() { return this.contour.IsClosed() }
    GetContour() { return this.contour }
    GetSurface() { return this.surface }
    GetSegment(i: number) { return this.contour.GetSegment(i) }
    GetSegmentsCount() { return this.contour.GetSegmentsCount() }
    _PointOn(t: number) { return this.surface.placement.point3d(this.contour._PointOn(t)) }
    _FirstDer(t: number) { const d = this.contour._FirstDer(t); return this.surface.placement.GetVectorFrom(d.x, d.y, 0) }
    Inverse() { this.contour.Inverse() }
    Transform(m: Matrix3D) { this.surface.Transform(m) }
    Duplicate(): ContourOnSurface { return new ContourOnSurface(this.surface.Duplicate(), this.contour.Duplicate(), true) }
    to2d(place: Placement3D) {
        const result = this.contour.Duplicate();
        result.Transform(this.surface.placement.GetMatrixToPlace(place));
        return result;
    }
    planeOf() { return this.surface.placement.clone() }
    samples(sag: number) { return this.contour.samples(sag) }
}

export class ContourOnPlane extends ContourOnSurface {
    IsA(): number { return SpaceType.ContourOnPlane }
    GetPlacement() { return this.surface.GetPlacement() }
    Duplicate(): ContourOnSurface { return new ContourOnPlane(this.surface.Duplicate(), this.contour.Duplicate(), true) }
}

// Turns a planar 2D curve into an equivalent 3D curve of the most specific type.
export function curve2dTo3d(curve: Curve, placement: Placement3D): Curve3D {
    if (curve instanceof LineSegment) return new Polyline3D([placement.point3d(curve.p1), placement.point3d(curve.p2)], false);
    if (curve instanceof Polyline) return new Polyline3D(curve, placement);
    if (curve instanceof Arc) return new Arc3D(curve, placement);
    if (curve instanceof Spline) {
        const points = curve.points.map(p => placement.point3d(p));
        if (curve instanceof Hermit) {
            const tangents = curve.data.tangents.map(([x, y]) => { const v = placement.GetVectorFrom(x, y, 0); return [v.x, v.y, v.z] });
            return new Hermit3D(points, curve.closed, { tangents, spans: [...curve.data.spans] });
        }
        if (curve instanceof CubicSpline) return new CubicSpline3D(points, curve.closed);
        if (curve instanceof Bezier) return new Bezier3D(points, curve.closed);
        if (curve instanceof Nurbs) return new Nurbs3D(points, curve.closed);
    }
    if (curve instanceof Contour) return Contour3D.of(curve.segments.map(s => curve2dTo3d(s, placement)));
    return new PlaneCurve(placement, curve.Duplicate() as Curve, true);
}
