import { PlaneItem } from './base';
import { PlaneType } from './constants';
import { CartPoint, Matrix, Rect, Vector } from './math';
import { BSpline, HermiteData, hermiteData, hermiteFromData, hermiteReverse, makeSpline, SplineKind } from './spline';

// Geometric tolerance in kernel units (the app works in units of 1/100).
export const EPS = 1e-6;
const TWO_PI = 2 * Math.PI;

export type P2 = { x: number, y: number };

// Primitive pieces of a curve, used for intersections, region building and conversion to OCCT.
// The curve parameter is linear in the primitive's own parameter.
export type SegPrim = { kind: 'seg', a: P2, b: P2, t0: number, t1: number };
export type ArcPrim = { kind: 'arc', c: P2, r: number, u: P2, v: P2, a0: number, a1: number, t0: number, t1: number };
export type CurvePrim = { kind: 'curve', curve: Curve, t0: number, t1: number };
export type Prim = SegPrim | ArcPrim | CurvePrim;

export function maxAngleForSag(radius: number, sag: number) {
    if (!(sag > 0) || radius <= sag) return Math.PI / 8;
    return Math.min(Math.PI / 8, 2 * Math.acos(1 - sag / radius));
}

export abstract class Curve extends PlaneItem {
    abstract get tmin(): number;
    abstract get tmax(): number;
    abstract IsClosed(): boolean;
    abstract _PointOn(t: number): CartPoint;
    abstract Inverse(): void;
    abstract prims(): Prim[];

    Family() { return PlaneType.Curve }

    IsBounded() { return true }
    IsPeriodic() { return this.IsClosed() }
    IsStraight(_ignoreParams?: boolean) { return false }
    GetTMin() { return this.tmin }
    GetTMax() { return this.tmax }
    GetPeriod() { return this.IsPeriodic() ? this.tmax - this.tmin : 0 }

    wrap(t: number) {
        const { tmin, tmax } = this;
        if (this.IsPeriodic()) {
            const p = tmax - tmin;
            if (t < tmin - 1e-12 || t > tmax + 1e-12) t = tmin + (((t - tmin) % p) + p) % p;
            return t;
        }
        return Math.min(tmax, Math.max(tmin, t));
    }

    PointOn(t: number): CartPoint { return this._PointOn(this.wrap(t)) }

    _FirstDer(t: number): Vector {
        const h = 1e-6 * Math.max(1, Math.abs(this.tmax - this.tmin));
        const a = this._PointOn(t - h), b = this._PointOn(t + h);
        return new Vector((b.x - a.x) / (2 * h), (b.y - a.y) / (2 * h));
    }
    FirstDer(t: number) { return this._FirstDer(this.wrap(t)) }

    _Tangent(t: number): Vector {
        const d = this._FirstDer(t);
        const l = Math.hypot(d.x, d.y);
        return l === 0 ? new Vector(0, 0) : new Vector(d.x / l, d.y / l);
    }
    Tangent(t: number) { return this._Tangent(this.wrap(t)) }
    _Normal(t: number) { const d = this._Tangent(t); return new Vector(-d.y, d.x) }
    Normal(t: number) { return this._Normal(this.wrap(t)) }

    GetLimitPoint(n: number): CartPoint { return this._PointOn(n === 1 ? this.tmin : this.tmax) }

    Trimmed(t1: number, t2: number, sense: number): Curve | null {
        return new TrimmedCurve(this, t1, t2, sense);
    }

    GetWeightCentre(): CartPoint {
        const ts = this.samples(0);
        let x = 0, y = 0;
        for (const t of ts) { const p = this._PointOn(t); x += p.x; y += p.y }
        return new CartPoint(x / ts.length, y / ts.length);
    }

    AddYourGabaritTo(rect: Rect) {
        for (const t of this.samples(0)) { const p = this._PointOn(t); rect.include(p.x, p.y) }
    }

    // Parameters at which to sample the curve so that the chord deviation is at most `sag`.
    samples(sag: number): number[] {
        const result: number[] = [];
        for (const prim of this.prims()) {
            const ts = primSamples(prim, sag);
            if (result.length > 0) ts.shift();
            result.push(...ts);
        }
        return result;
    }

    polyline(sag: number): CartPoint[] {
        return this.samples(sag).map(t => this._PointOn(t));
    }

    // Signed area enclosed by the curve, closed by the chord between its ends (positive when counterclockwise):
    // ½∮(x dy − y dx), exact for segments and arcs.
    signedArea(): number {
        const prims = this.prims();
        if (prims.length === 0) return 0;
        let a = 0;
        for (const prim of prims) a += primArea(prim);
        const start = primPoint(prims[0], prims[0].t0), end = primPoint(prims[prims.length - 1], prims[prims.length - 1].t1);
        return a + (end.x * start.y - start.x * end.y) / 2;
    }
}

// ½∫(x dy − y dx) along a primitive.
function primArea(p: Prim): number {
    switch (p.kind) {
        case 'seg': return (p.a.x * p.b.y - p.b.x * p.a.y) / 2;
        case 'arc': {
            const s = primPoint(p, p.t0), e = primPoint(p, p.t1);
            const chord = p.c.x * (e.y - s.y) - p.c.y * (e.x - s.x);
            return (chord + p.r * p.r * (p.u.x * p.v.y - p.u.y * p.v.x) * (p.a1 - p.a0)) / 2;
        }
        case 'curve': {
            // Gauss–Legendre quadrature, 5 points on each of 64 intervals.
            const xs = [0, -0.5384693101056831, 0.5384693101056831, -0.9061798459386640, 0.9061798459386640];
            const ws = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];
            const n = 64, h = (p.t1 - p.t0) / n;
            let a = 0;
            for (let i = 0; i < n; i++) {
                const m = p.t0 + h * (i + 0.5);
                for (let k = 0; k < 5; k++) {
                    const t = m + xs[k] * h / 2;
                    const x = p.curve._PointOn(t), d = p.curve._FirstDer(t);
                    a += ws[k] * (x.x * d.y - x.y * d.x) * h / 2;
                }
            }
            return a / 2;
        }
    }
}

export function polygonArea(points: P2[]): number {
    let a = 0;
    for (let i = 0, n = points.length; i < n; i++) {
        const p = points[i], q = points[(i + 1) % n];
        a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
}

function primSamples(prim: Prim, sag: number): number[] {
    switch (prim.kind) {
        case 'seg': return [prim.t0, prim.t1];
        case 'arc': {
            const sweep = Math.abs(prim.a1 - prim.a0);
            const n = Math.max(1, Math.ceil(sweep / maxAngleForSag(prim.r, sag)));
            const result = [];
            for (let i = 0; i <= n; i++) result.push(prim.t0 + (prim.t1 - prim.t0) * i / n);
            return result;
        }
        case 'curve': {
            const n = 64;
            const result = [];
            for (let i = 0; i <= n; i++) result.push(prim.t0 + (prim.t1 - prim.t0) * i / n);
            return result;
        }
    }
}

function transformPoint(m: Matrix, p: P2): CartPoint {
    const [x, y] = m.apply(p.x, p.y);
    return new CartPoint(x, y);
}

export class LineSegment extends Curve {
    p1: CartPoint; p2: CartPoint;

    constructor(p1: P2, p2: P2) {
        super();
        this.p1 = new CartPoint(p1.x, p1.y); this.p2 = new CartPoint(p2.x, p2.y);
    }

    IsA(): number { return PlaneType.LineSegment }
    get tmin() { return 0 }
    get tmax() { return 1 }
    IsClosed() { return false }
    IsStraight(_ignoreParams?: boolean) { return true }
    _PointOn(t: number) { const { p1, p2 } = this; return new CartPoint(p1.x + (p2.x - p1.x) * t, p1.y + (p2.y - p1.y) * t) }
    _FirstDer(_t: number) { return new Vector(this.p2.x - this.p1.x, this.p2.y - this.p1.y) }
    GetPoint1() { return this.p1.clone() }
    GetPoint2() { return this.p2.clone() }
    Inverse() { [this.p1, this.p2] = [this.p2, this.p1] }
    Transform(m: Matrix) { this.p1 = transformPoint(m, this.p1); this.p2 = transformPoint(m, this.p2) }
    Duplicate() { return new LineSegment(this.p1, this.p2) }
    prims(): Prim[] { return [{ kind: 'seg', a: this.p1, b: this.p2, t0: 0, t1: 1 }] }
}

export class Line extends Curve {
    p1: CartPoint; p2: CartPoint;

    constructor(p1: P2, p2: P2) {
        super();
        this.p1 = new CartPoint(p1.x, p1.y); this.p2 = new CartPoint(p2.x, p2.y);
    }

    IsA(): number { return PlaneType.Line }
    get tmin() { return -Infinity }
    get tmax() { return Infinity }
    IsBounded() { return false }
    IsClosed() { return false }
    IsStraight(_ignoreParams?: boolean) { return true }
    _PointOn(t: number) { const { p1, p2 } = this; return new CartPoint(p1.x + (p2.x - p1.x) * t, p1.y + (p2.y - p1.y) * t) }
    _FirstDer(_t: number) { return new Vector(this.p2.x - this.p1.x, this.p2.y - this.p1.y) }
    Inverse() { [this.p1, this.p2] = [this.p2, this.p1] }
    Transform(m: Matrix) { this.p1 = transformPoint(m, this.p1); this.p2 = transformPoint(m, this.p2) }
    Duplicate() { return new Line(this.p1, this.p2) }
    prims(): Prim[] { return [] }
}

export abstract class PolyCurve extends Curve {
    points: CartPoint[] = [];
    closed = false;

    Type() { return PlaneType.PolyCurve }
    GetPointsCount() { return this.points.length }
    GetPoint(i: number) { return this.points[i].clone() }
    AddPoint(p: CartPoint) { this.points.push(p.clone()); this.changed() }
    protected changed() { }
}

// An interpolating or control-point spline, evaluated as an exact B-spline.
export abstract class Spline extends PolyCurve {
    protected abstract readonly kind: SplineKind;
    private _bspline?: BSpline;

    constructor(points: P2[] = [], closed = false) {
        super();
        this.points = points.map(p => new CartPoint(p.x, p.y));
        this.closed = closed;
    }

    bspline(): BSpline { return this._bspline ??= this.build() }
    protected build(): BSpline { return makeSpline(this.kind, this.points.map(p => [p.x, p.y]), this.closed) }
    protected changed() { this._bspline = undefined }

    get tmin() { return this.bspline().tmin }
    get tmax() { return this.bspline().tmax }
    IsClosed() { return this.closed }
    IsPeriodic() { return this.closed }

    _PointOn(t: number) { const [x, y] = this.bspline().point(t); return new CartPoint(x, y) }
    _FirstDer(t: number) { const [x, y] = this.bspline().derivative(t); return new Vector(x, y) }

    Inverse() { this.points.reverse(); this.changed() }
    Transform(m: Matrix) { this.points = this.points.map(p => transformPoint(m, p)); this.changed() }
    Duplicate(): Spline { const C = this.constructor as new (points: P2[], closed: boolean) => Spline; return new C(this.points, this.closed) }

    prims(): Prim[] {
        const spans = this.bspline().spans();
        const result: Prim[] = [];
        for (let i = 0; i < spans.length - 1; i++) result.push({ kind: 'curve', curve: this, t0: spans[i], t1: spans[i + 1] });
        return result;
    }
}

// The tangents and span lengths are fixed when the curve is made (see hermiteData).
export class Hermit extends Spline {
    protected readonly kind = SplineKind.Hermite;
    data: HermiteData;

    constructor(points: P2[] = [], closed = false, data?: HermiteData) {
        super(points, closed);
        this.data = data ?? (this.points.length >= 2 ? hermiteData(this.points.map(p => [p.x, p.y]), closed) : { tangents: [], spans: [] });
    }

    IsA(): number { return PlaneType.Hermit }
    protected build() { return hermiteFromData(this.points.map(p => [p.x, p.y]), this.data, this.closed) }

    Inverse() { this.points.reverse(); this.data = hermiteReverse(this.data, this.closed); this.changed() }
    Transform(m: Matrix) {
        this.points = this.points.map(p => transformPoint(m, p));
        const tangents = this.data.tangents.map(([x, y]) => [m.m[0][0] * x + m.m[1][0] * y, m.m[0][1] * x + m.m[1][1] * y]);
        this.data = { tangents, spans: [...this.data.spans] };
        this.changed();
    }
    Duplicate(): Hermit { return new Hermit(this.points, this.closed, { tangents: this.data.tangents.map(t => [...t]), spans: [...this.data.spans] }) }
}

export class CubicSpline extends Spline {
    protected readonly kind = SplineKind.CubicSpline;
    IsA(): number { return PlaneType.CubicSpline }
}

export class Bezier extends Spline {
    protected readonly kind = SplineKind.Bezier;
    IsA(): number { return PlaneType.Bezier }
}

export class Nurbs extends Spline {
    protected readonly kind = SplineKind.Nurbs;
    IsA(): number { return PlaneType.Nurbs }
}

export class Polyline extends PolyCurve {
    constructor(points: P2[] = [], closed = false) {
        super();
        this.points = points.map(p => new CartPoint(p.x, p.y));
        this.closed = closed;
    }

    IsA(): number { return PlaneType.Polyline }
    get tmin() { return 0 }
    get tmax() { return this.closed ? this.points.length : this.points.length - 1 }
    IsClosed() { return this.closed }
    IsStraight(_ignoreParams?: boolean) { return !this.closed && this.points.length === 2 }

    _PointOn(t: number) {
        const { points } = this, n = points.length;
        let i = Math.floor(t);
        const segments = this.closed ? n : n - 1;
        i = Math.max(0, Math.min(segments - 1, i));
        const p = points[i], q = points[(i + 1) % n];
        const u = t - i;
        return new CartPoint(p.x + (q.x - p.x) * u, p.y + (q.y - p.y) * u);
    }

    _FirstDer(t: number) {
        const { points } = this, n = points.length;
        const segments = this.closed ? n : n - 1;
        const i = Math.max(0, Math.min(segments - 1, Math.floor(t)));
        const p = points[i], q = points[(i + 1) % n];
        return new Vector(q.x - p.x, q.y - p.y);
    }

    Inverse() { this.points.reverse() }
    Transform(m: Matrix) { this.points = this.points.map(p => transformPoint(m, p)) }
    Duplicate() { return new Polyline(this.points, this.closed) }

    prims(): Prim[] {
        const { points } = this, n = points.length;
        const result: Prim[] = [];
        const segments = this.closed ? n : n - 1;
        for (let i = 0; i < segments; i++) result.push({ kind: 'seg', a: points[i], b: points[(i + 1) % n], t0: i, t1: i + 1 });
        return result;
    }
}

// A circle, ellipse, or an arc of either: c + a·cos(t)·u + b·sin(t)·v for t in [t1, t2].
export class Arc extends Curve {
    c = new CartPoint(0, 0);
    a = 1; b = 1;
    u: P2 = { x: 1, y: 0 };
    v: P2 = { x: 0, y: 1 };
    t1 = 0; t2 = TWO_PI;
    closed = true;

    constructor(rad?: number) {
        super();
        if (rad !== undefined) { this.a = this.b = rad }
    }

    static make(c: P2, a: number, b: number, u: P2, v: P2, t1: number, t2: number, closed: boolean) {
        const arc = new Arc();
        arc.c = new CartPoint(c.x, c.y); arc.a = a; arc.b = b;
        arc.u = { x: u.x, y: u.y }; arc.v = { x: v.x, y: v.y };
        arc.t1 = t1; arc.t2 = t2; arc.closed = closed;
        return arc;
    }

    IsA(): number { return PlaneType.Arc }
    get tmin() { return this.t1 }
    get tmax() { return this.t2 }
    IsClosed() { return this.closed }
    IsCircle() { return Math.abs(this.a - this.b) < EPS }
    GetRadius() { return this.a }
    GetCentre() { return this.c.clone() }

    _PointOn(t: number) {
        const { c, a, b, u, v } = this;
        const ca = a * Math.cos(t), sb = b * Math.sin(t);
        return new CartPoint(c.x + ca * u.x + sb * v.x, c.y + ca * u.y + sb * v.y);
    }

    _FirstDer(t: number) {
        const { a, b, u, v } = this;
        const sa = -a * Math.sin(t), cb = b * Math.cos(t);
        return new Vector(sa * u.x + cb * v.x, sa * u.y + cb * v.y);
    }

    Inverse() {
        this.v = { x: -this.v.x, y: -this.v.y };
        [this.t1, this.t2] = [-this.t2, -this.t1];
    }

    Transform(m: Matrix) {
        const c = transformPoint(m, this.c);
        const [ux, uy] = m.applyVector(this.u.x * this.a, this.u.y * this.a);
        const [vx, vy] = m.applyVector(this.v.x * this.b, this.v.y * this.b);
        this.c = c;
        this.a = Math.hypot(ux, uy); this.b = Math.hypot(vx, vy);
        this.u = { x: ux / this.a, y: uy / this.a };
        this.v = { x: vx / this.b, y: vy / this.b };
    }

    Duplicate() { return Arc.make(this.c, this.a, this.b, this.u, this.v, this.t1, this.t2, this.closed) }

    Trimmed(t1: number, t2: number, sense: number): Curve | null {
        if (sense < 0) return super.Trimmed(t1, t2, sense);
        if (this.closed && t2 <= t1) t2 += TWO_PI;
        if (!this.closed) { t1 = Math.max(this.t1, t1); t2 = Math.min(this.t2, t2) }
        return Arc.make(this.c, this.a, this.b, this.u, this.v, t1, t2, Math.abs(t2 - t1 - TWO_PI) < 1e-12);
    }

    prims(): Prim[] {
        if (this.IsCircle()) return [{ kind: 'arc', c: this.c, r: this.a, u: this.u, v: this.v, a0: this.t1, a1: this.t2, t0: this.t1, t1: this.t2 }];
        return [{ kind: 'curve', curve: this, t0: this.t1, t1: this.t2 }];
    }
}

export class Contour extends Curve {
    segments: Curve[] = [];
    private offsets: number[] = [0];
    private closed = false;

    constructor(curves: Curve[] = [], sameCurves = true) {
        super();
        for (const c of curves) this.segments.push(sameCurves ? c : c.Duplicate() as Curve);
        this.update();
        this.CheckClosed(EPS);
    }

    IsA(): number { return PlaneType.Contour }
    Family() { return PlaneType.Curve }

    private update() {
        const offsets = [0];
        for (const s of this.segments) offsets.push(offsets[offsets.length - 1] + (s.tmax - s.tmin));
        this.offsets = offsets;
    }

    get tmin() { return 0 }
    get tmax() { return this.offsets[this.offsets.length - 1] }
    IsClosed() { return this.closed }
    InitClosed(c: boolean) { this.closed = c }
    CheckClosed(eps: number) {
        if (this.segments.length === 0) { this.closed = false; return }
        const a = this.segments[0].GetLimitPoint(1), b = this.segments[this.segments.length - 1].GetLimitPoint(2);
        this.closed = a.distanceTo(b) < Math.max(eps, EPS);
    }
    IsStraight(_ignoreParams?: boolean) { return this.segments.length === 1 && this.segments[0].IsStraight() }

    locate(t: number): [Curve, number, number] {
        const { segments, offsets } = this;
        let i = 0;
        while (i < segments.length - 1 && t > offsets[i + 1]) i++;
        const s = segments[i];
        return [s, s.tmin + (t - offsets[i]), i];
    }

    _PointOn(t: number) { const [s, u] = this.locate(t); return s._PointOn(u) }
    _FirstDer(t: number) { const [s, u] = this.locate(t); return s._FirstDer(u) }

    GetSegmentsCount() { return this.segments.length }
    GetSegment(i: number) { return this.segments[i] ?? null }
    GetCornerParams(): number[] { return this.offsets.slice(1, -1) }

    // Adds a curve that touches the end of the contour (or, unless toEndOnly, its start), turning it round if need be.
    AddCurveWithRuledCheck(curve: Curve, absEps = 1e-6, toEndOnly = false): boolean {
        const eps = Math.max(absEps, EPS);
        const { segments } = this;
        if (segments.length > 0) {
            const start = segments[0].GetLimitPoint(1), end = segments[segments.length - 1].GetLimitPoint(2);
            const cs = curve.GetLimitPoint(1), ce = curve.GetLimitPoint(2);
            if (end.distanceTo(cs) < eps) segments.push(curve);
            else if (end.distanceTo(ce) < eps) { curve.Inverse(); segments.push(curve) }
            else if (!toEndOnly && start.distanceTo(ce) < eps) segments.unshift(curve);
            else if (!toEndOnly && start.distanceTo(cs) < eps) { curve.Inverse(); segments.unshift(curve) }
            else return false;
        } else segments.push(curve);
        this.update();
        this.CheckClosed(EPS);
        return true;
    }

    GetArea(_sag?: number) { return this.signedArea() }

    Inverse() {
        this.segments.reverse();
        for (const s of this.segments) s.Inverse();
        this.update();
    }

    Transform(m: Matrix) { for (const s of this.segments) s.Transform(m) }

    Duplicate() {
        const result = new Contour(this.segments.map(s => s.Duplicate() as Curve), true);
        result.closed = this.closed;
        return result;
    }

    prims(): Prim[] {
        const result: Prim[] = [];
        for (const [i, s] of this.segments.entries()) {
            const shift = this.offsets[i] - s.tmin;
            // A curve piece is evaluated through the contour, whose parameter it now has.
            for (const p of s.prims()) result.push({ ...p, ...(p.kind === 'curve' ? { curve: this } : {}), t0: p.t0 + shift, t1: p.t1 + shift } as Prim);
        }
        return result;
    }
}

export class ContourWithBreaks extends Contour {
    IsA(): number { return PlaneType.Contour + 1 }
}

// A piece of a basis curve: parameters in [t1, t2] of the basis (sense > 0) or traversed backwards (sense < 0).
export class TrimmedCurve extends Curve {
    basis: Curve;
    t1: number; t2: number;
    sense: number;

    constructor(basis: Curve, t1: number, t2: number, sense = 1) {
        super();
        if (basis instanceof TrimmedCurve && basis.sense > 0) basis = basis.basis;
        this.basis = basis;
        if (basis.IsPeriodic() && t2 <= t1) t2 += basis.GetPeriod();
        this.t1 = t1; this.t2 = t2; this.sense = sense;
    }

    IsA(): number { return PlaneType.TrimmedCurve }
    get tmin() { return this.t1 }
    get tmax() { return this.t2 }
    IsClosed() { return false }
    IsPeriodic() { return false }
    IsStraight(_ignoreParams?: boolean) { return this.basis.IsStraight() }
    GetBasisCurve() { return this.basis }

    private map(t: number) {
        return this.sense > 0 ? t : this.t1 + this.t2 - t;
    }

    _PointOn(t: number) { return this.basis.PointOn(this.map(t)) }
    _FirstDer(t: number) {
        const d = this.basis.FirstDer(this.map(t));
        return this.sense > 0 ? d : new Vector(-d.x, -d.y);
    }

    Inverse() { this.sense = -this.sense }
    Transform(m: Matrix) { this.basis = this.basis.Duplicate() as Curve; this.basis.Transform(m) }
    Duplicate() { return new TrimmedCurve(this.basis.Duplicate() as Curve, this.t1, this.t2, this.sense) }

    prims(): Prim[] {
        if (this.sense < 0) return [{ kind: 'curve', curve: this, t0: this.t1, t1: this.t2 }];
        return trimPrims(this.basis, this.t1, this.t2);
    }
}

// The primitives of `curve` restricted to the parameter range [t1, t2] (which may wrap around a periodic curve).
export function trimPrims(curve: Curve, t1: number, t2: number): Prim[] {
    const period = curve.GetPeriod();
    const all = curve.prims();
    const result: Prim[] = [];
    const ranges: [number, number, number][] = []; // [from, to, shift]
    if (period > 0 && t2 > curve.tmax + 1e-12) {
        ranges.push([t1, curve.tmax, 0]);
        ranges.push([curve.tmin, t2 - period, period]);
    } else {
        ranges.push([t1, t2, 0]);
    }
    for (const [from, to, shift] of ranges) {
        for (const p of all) {
            const lo = Math.max(from, p.t0), hi = Math.min(to, p.t1);
            if (hi - lo <= 1e-12) continue;
            result.push({ ...restrictPrim(p, lo, hi), t0: lo + shift, t1: hi + shift } as Prim);
        }
    }
    return result;
}

function restrictPrim(p: Prim, lo: number, hi: number): Prim {
    const f = (t: number) => (t - p.t0) / (p.t1 - p.t0);
    switch (p.kind) {
        case 'seg': {
            const A = lerp(p.a, p.b, f(lo)), B = lerp(p.a, p.b, f(hi));
            return { kind: 'seg', a: A, b: B, t0: lo, t1: hi };
        }
        case 'arc': {
            const a0 = p.a0 + (p.a1 - p.a0) * f(lo), a1 = p.a0 + (p.a1 - p.a0) * f(hi);
            return { ...p, a0, a1, t0: lo, t1: hi };
        }
        case 'curve': return { ...p, t0: lo, t1: hi };
    }
}

function lerp(a: P2, b: P2, u: number): P2 { return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u } }

export function primPoint(p: Prim, t: number): P2 {
    const u = (t - p.t0) / (p.t1 - p.t0);
    switch (p.kind) {
        case 'seg': return lerp(p.a, p.b, u);
        case 'arc': {
            const al = p.a0 + (p.a1 - p.a0) * u;
            const ca = p.r * Math.cos(al), sa = p.r * Math.sin(al);
            return { x: p.c.x + ca * p.u.x + sa * p.v.x, y: p.c.y + ca * p.u.y + sa * p.v.y };
        }
        case 'curve': return p.curve._PointOn(t);
    }
}

// Parameter of the point of `curve` nearest to `x`, and the distance to it.
export function nearestParam2d(curve: Curve, x: P2, ext = false): { t: number, distance: number } {
    let best = { t: curve.tmin, distance: Infinity };
    const consider = (t: number) => {
        const p = curve._PointOn(t);
        const d = Math.hypot(p.x - x.x, p.y - x.y);
        if (d < best.distance) best = { t, distance: d };
    };
    if (!curve.IsBounded()) {
        // Infinite line
        const a = curve._PointOn(0), b = curve._PointOn(1);
        const dx = b.x - a.x, dy = b.y - a.y;
        consider(((x.x - a.x) * dx + (x.y - a.y) * dy) / (dx * dx + dy * dy));
        return best;
    }
    for (const p of curve.prims()) {
        switch (p.kind) {
            case 'seg': {
                const dx = p.b.x - p.a.x, dy = p.b.y - p.a.y;
                const len2 = dx * dx + dy * dy;
                let u = len2 === 0 ? 0 : ((x.x - p.a.x) * dx + (x.y - p.a.y) * dy) / len2;
                if (!ext) u = Math.min(1, Math.max(0, u));
                consider(p.t0 + (p.t1 - p.t0) * u);
                break;
            }
            case 'arc': {
                const dx = x.x - p.c.x, dy = x.y - p.c.y;
                const alpha = Math.atan2(dx * p.v.x + dy * p.v.y, dx * p.u.x + dy * p.u.y);
                const lo = Math.min(p.a0, p.a1), hi = Math.max(p.a0, p.a1);
                let a = lo + (((alpha - lo) % TWO_PI) + TWO_PI) % TWO_PI;
                if (a > hi) a = (a - hi) < (lo + TWO_PI - a) ? hi : lo;
                consider(p.t0 + (a - p.a0) / (p.a1 - p.a0) * (p.t1 - p.t0));
                consider(p.t0); consider(p.t1);
                break;
            }
            case 'curve': {
                const n = 64;
                let bi = 0, bd = Infinity;
                for (let i = 0; i <= n; i++) {
                    const t = p.t0 + (p.t1 - p.t0) * i / n;
                    const q = curve._PointOn(t);
                    const d = Math.hypot(q.x - x.x, q.y - x.y);
                    if (d < bd) { bd = d; bi = i }
                }
                let lo = p.t0 + (p.t1 - p.t0) * Math.max(0, bi - 1) / n, hi = p.t0 + (p.t1 - p.t0) * Math.min(n, bi + 1) / n;
                for (let k = 0; k < 60; k++) {
                    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
                    const d1 = curve._PointOn(m1), d2 = curve._PointOn(m2);
                    if (Math.hypot(d1.x - x.x, d1.y - x.y) < Math.hypot(d2.x - x.x, d2.y - x.y)) hi = m2; else lo = m1;
                }
                consider((lo + hi) / 2);
                break;
            }
        }
    }
    return best;
}

export class Region extends PlaneItem {
    contours: Contour[];

    constructor(contours: Contour[] = []) {
        super();
        this.contours = contours;
    }

    IsA(): number { return PlaneType.Region }
    Family() { return PlaneType.Region }
    GetContoursCount() { return this.contours.length }
    GetContour(k: number) { return this.contours[k] ?? null }
    SetContour(k: number) { return this.contours[k] ?? null }
    GetOutContour() { return this.contours[0] ?? null }
    DetachContours() { const result = this.contours; this.contours = []; return result }

    // Outer contour counterclockwise, holes clockwise.
    SetCorrect() {
        for (const [i, c] of this.contours.entries()) {
            const area = c.signedArea();
            if ((i === 0 && area < 0) || (i > 0 && area > 0)) c.Inverse();
        }
        return true;
    }

    Transform(m: Matrix) { for (const c of this.contours) c.Transform(m) }
    Duplicate() { return new Region(this.contours.map(c => c.Duplicate())) }
    AddYourGabaritTo(rect: Rect) { for (const c of this.contours) c.AddYourGabaritTo(rect) }
}
