import { ArcPrim, Curve, CurvePrim, EPS, Line, P2, Prim, primPoint, SegPrim } from './curve2d';

const TWO_PI = 2 * Math.PI;

// Intersections of two planar curves as pairs of parameters [t on c1, t on c2].
// Touching endpoints count as intersections; overlapping pieces report the ends of the overlap.
export function intersectCurves(c1: Curve, c2: Curve, eps = EPS): [number, number][] {
    if (c1 instanceof Line && c2 instanceof Line) return lineLine(c1, c2);
    const result: [number, number][] = [];
    const same = c1 === c2;
    const prims1 = c1 instanceof Line ? clippedLine(c1, c2) : c1.prims();
    const prims2 = same ? prims1 : c2 instanceof Line ? clippedLine(c2, c1) : c2.prims();
    for (const [i, p] of prims1.entries()) {
        for (const [j, q] of prims2.entries()) {
            if (same && j <= i) continue;
            for (const [t, s] of intersectPrims(p, q, eps)) {
                if (same) {
                    // Adjacent pieces of the same curve always touch at their shared end; that's not a self-intersection.
                    if (j === i + 1 && Math.abs(t - p.t1) < 1e-9 && Math.abs(s - q.t0) < 1e-9) continue;
                    if (c1.IsClosed() && i === 0 && j === prims1.length - 1 && Math.abs(t - p.t0) < 1e-9 && Math.abs(s - q.t1) < 1e-9) continue;
                }
                result.push([snap(c1, t), snap(c2, s)]);
            }
        }
    }
    return dedupe(result, c1, c2, eps);
}

// An unbounded line as its segment across the other curve, where any intersection with it must lie.
function clippedLine(line: Line, other: Curve): Prim[] {
    const { p1, p2 } = line;
    const dx = p2.x - p1.x, dy = p2.y - p1.y, l2 = dx * dx + dy * dy;
    if (l2 === 0) return [];
    let lo = Infinity, hi = -Infinity;
    for (const p of other.polyline(0)) {
        const t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / l2;
        lo = Math.min(lo, t); hi = Math.max(hi, t);
    }
    if (lo > hi) return [];
    // The polyline can fall short of the curve by its sag.
    const margin = 0.1 * (hi - lo) + 1 / Math.sqrt(l2);
    lo -= margin; hi += margin;
    return [{ kind: 'seg', a: line._PointOn(lo), b: line._PointOn(hi), t0: lo, t1: hi }];
}

function lineLine(l1: Line, l2: Line): [number, number][] {
    const rx = l1.p2.x - l1.p1.x, ry = l1.p2.y - l1.p1.y;
    const sx = l2.p2.x - l2.p1.x, sy = l2.p2.y - l2.p1.y;
    const denom = cross(rx, ry, sx, sy);
    if (Math.abs(denom) <= 1e-12 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) return [];
    const qpx = l2.p1.x - l1.p1.x, qpy = l2.p1.y - l1.p1.y;
    return [[cross(qpx, qpy, sx, sy) / denom, cross(qpx, qpy, rx, ry) / denom]];
}

// A root of f in [a, b], where f changes sign.
export function bisect(f: (t: number) => number, a: number, b: number, fa = f(a)): number {
    for (let i = 0; i < 100 && b - a > 1e-15 * Math.max(1, Math.abs(a)); i++) {
        const m = (a + b) / 2, fm = f(m);
        if (fm === 0) return m;
        if ((fm < 0) === (fa < 0)) { a = m; fa = fm } else b = m;
    }
    return (a + b) / 2;
}

// The minimum of a unimodal function in [a, b].
export function goldenMin(f: (t: number) => number, a: number, b: number): number {
    const g = (Math.sqrt(5) - 1) / 2;
    let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
    for (let i = 0; i < 100 && b - a > 1e-15 * Math.max(1, Math.abs(a)); i++) {
        if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c) }
        else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d) }
    }
    return (a + b) / 2;
}

function snap(c: Curve, t: number) {
    const span = Math.abs(c.tmax - c.tmin);
    const tol = 1e-9 * Math.max(1, span);
    if (Math.abs(t - c.tmin) < tol) return c.tmin;
    if (Math.abs(t - c.tmax) < tol) return c.tmax;
    return t;
}

// The same crossing can be found by neighboring pieces (e.g. at a polyline corner or the seam of a closed curve).
function dedupe(pairs: [number, number][], c1: Curve, _c2: Curve, eps: number): [number, number][] {
    const result: [number, number][] = [];
    const points: P2[] = [];
    for (const pair of pairs) {
        const p = c1._PointOn(pair[0]);
        if (points.some(q => Math.hypot(p.x - q.x, p.y - q.y) < eps * 10)) continue;
        result.push(pair); points.push(p);
    }
    return result;
}

export function intersectPrims(p: Prim, q: Prim, eps: number): [number, number][] {
    if (p.kind === 'seg' && q.kind === 'curve') return segCurve(p, q, eps);
    if (p.kind === 'curve' && q.kind === 'seg') return segCurve(q, p, eps).map(([a, b]) => [b, a]);
    if (p.kind === 'curve' || q.kind === 'curve') return intersectGeneric(p, q, eps);
    if (p.kind === 'seg' && q.kind === 'seg') return segSeg(p, q, eps);
    if (p.kind === 'seg' && q.kind === 'arc') return segArc(p, q, eps);
    if (p.kind === 'arc' && q.kind === 'seg') return segArc(q, p, eps).map(([a, b]) => [b, a]);
    return arcArc(p as ArcPrim, q as ArcPrim, eps);
}

function cross(ax: number, ay: number, bx: number, by: number) { return ax * by - ay * bx }

// Parameter (in the primitive's curve parameter) of point `x` if it lies on the primitive within eps.
export function paramOnPrim(p: Prim, x: P2, eps: number): number | undefined {
    switch (p.kind) {
        case 'seg': {
            const rx = p.b.x - p.a.x, ry = p.b.y - p.a.y;
            const len2 = rx * rx + ry * ry;
            if (len2 === 0) return undefined;
            let u = ((x.x - p.a.x) * rx + (x.y - p.a.y) * ry) / len2;
            const len = Math.sqrt(len2);
            if (u < -eps / len || u > 1 + eps / len) return undefined;
            u = Math.min(1, Math.max(0, u));
            const px = p.a.x + rx * u, py = p.a.y + ry * u;
            if (Math.hypot(px - x.x, py - x.y) > eps) return undefined;
            return p.t0 + (p.t1 - p.t0) * u;
        }
        case 'arc': {
            const dx = x.x - p.c.x, dy = x.y - p.c.y;
            if (Math.abs(Math.hypot(dx, dy) - p.r) > eps) return undefined;
            return arcParam(p, x, eps);
        }
        case 'curve': {
            return undefined;
        }
    }
}

function arcParam(p: ArcPrim, x: P2, eps: number): number | undefined {
    const dx = x.x - p.c.x, dy = x.y - p.c.y;
    const lx = dx * p.u.x + dy * p.u.y, ly = dx * p.v.x + dy * p.v.y;
    const alpha = Math.atan2(ly, lx);
    const lo = Math.min(p.a0, p.a1), hi = Math.max(p.a0, p.a1);
    const tolA = eps / Math.max(p.r, eps);
    let a = lo + (((alpha - lo) % TWO_PI) + TWO_PI) % TWO_PI;
    if (a > hi + tolA) {
        if (a - TWO_PI >= lo - tolA) a -= TWO_PI;
        else return undefined;
    }
    a = Math.min(hi, Math.max(lo, a));
    return p.t0 + (a - p.a0) / (p.a1 - p.a0) * (p.t1 - p.t0);
}

function endpoints(p: SegPrim | ArcPrim): P2[] {
    return [primPoint(p, p.t0), primPoint(p, p.t1)];
}

// Pairs for endpoints of one primitive lying on the other (handles touching and overlapping).
function endpointPairs(p: SegPrim | ArcPrim, q: SegPrim | ArcPrim, eps: number): [number, number][] {
    const result: [number, number][] = [];
    const [pa, pb] = endpoints(p);
    for (const [x, t] of [[pa, p.t0], [pb, p.t1]] as [P2, number][]) {
        const s = paramOnPrim(q, x, eps);
        if (s !== undefined) result.push([t, s]);
    }
    const [qa, qb] = endpoints(q);
    for (const [x, s] of [[qa, q.t0], [qb, q.t1]] as [P2, number][]) {
        const t = paramOnPrim(p, x, eps);
        if (t !== undefined) result.push([t, s]);
    }
    return result;
}

function segSeg(p: SegPrim, q: SegPrim, eps: number): [number, number][] {
    const result = endpointPairs(p, q, eps);
    const rx = p.b.x - p.a.x, ry = p.b.y - p.a.y;
    const sx = q.b.x - q.a.x, sy = q.b.y - q.a.y;
    const denom = cross(rx, ry, sx, sy);
    const lr = Math.hypot(rx, ry), ls = Math.hypot(sx, sy);
    if (Math.abs(denom) > 1e-12 * lr * ls) {
        const qpx = q.a.x - p.a.x, qpy = q.a.y - p.a.y;
        const u = cross(qpx, qpy, sx, sy) / denom;
        const w = cross(qpx, qpy, rx, ry) / denom;
        if (u > 0 && u < 1 && w > 0 && w < 1) {
            result.push([p.t0 + (p.t1 - p.t0) * u, q.t0 + (q.t1 - q.t0) * w]);
        }
    }
    return result;
}

function segArc(p: SegPrim, q: ArcPrim, eps: number): [number, number][] {
    const result = endpointPairs(p, q, eps);
    const rx = p.b.x - p.a.x, ry = p.b.y - p.a.y;
    const fx = p.a.x - q.c.x, fy = p.a.y - q.c.y;
    const A = rx * rx + ry * ry;
    const B = 2 * (fx * rx + fy * ry);
    const C = fx * fx + fy * fy - q.r * q.r;
    let disc = B * B - 4 * A * C;
    // Tangency within tolerance
    const len = Math.sqrt(A);
    const distToLine = Math.abs(cross(rx, ry, -fx, -fy)) / len;
    if (disc < 0 && Math.abs(distToLine - q.r) < eps) disc = 0;
    if (disc < 0) return result;
    const sq = Math.sqrt(disc);
    const us = disc === 0 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
    for (const u of us) {
        if (!(u > 0 && u < 1)) continue;
        const x = { x: p.a.x + rx * u, y: p.a.y + ry * u };
        const s = arcParam(q, x, eps);
        if (s === undefined) continue;
        result.push([p.t0 + (p.t1 - p.t0) * u, s]);
    }
    return result;
}

function arcArc(p: ArcPrim, q: ArcPrim, eps: number): [number, number][] {
    const result = endpointPairs(p, q, eps);
    const dx = q.c.x - p.c.x, dy = q.c.y - p.c.y;
    const d = Math.hypot(dx, dy);
    if (d < eps) return result; // concentric: only overlaps, handled by endpoints
    if (d > p.r + q.r + eps || d < Math.abs(p.r - q.r) - eps) return result;
    const a = (p.r * p.r - q.r * q.r + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, p.r * p.r - a * a));
    const mx = p.c.x + a * dx / d, my = p.c.y + a * dy / d;
    const points = h < eps ? [{ x: mx, y: my }] : [
        { x: mx + h * -dy / d, y: my + h * dx / d },
        { x: mx - h * -dy / d, y: my - h * dx / d },
    ];
    for (const x of points) {
        const t = arcParam(p, x, eps), s = arcParam(q, x, eps);
        if (t === undefined || s === undefined) continue;
        result.push([t, s]);
    }
    return result;
}

// A segment and a curve: the roots of the curve's signed distance from the segment's line, including where it only
// touches the line.
function segCurve(p: SegPrim, q: CurvePrim, eps: number): [number, number][] {
    const rx = p.b.x - p.a.x, ry = p.b.y - p.a.y, len = Math.hypot(rx, ry);
    if (len === 0) return [];
    const distance = (s: number) => { const x = primPoint(q, s); return ((x.x - p.a.x) * ry - (x.y - p.a.y) * rx) / len };
    const n = 128;
    const ss: number[] = [], ds: number[] = [];
    for (let i = 0; i <= n; i++) { const s = q.t0 + (q.t1 - q.t0) * i / n; ss.push(s); ds.push(distance(s)) }
    const roots: number[] = [];
    for (let i = 0; i <= n; i++) {
        if (ds[i] === 0) roots.push(ss[i]);
        if (i < n && ds[i] * ds[i + 1] < 0) roots.push(bisect(distance, ss[i], ss[i + 1], ds[i]));
        // A touch: the distance comes close to zero without changing sign.
        if (i > 0 && i < n && ds[i - 1] * ds[i + 1] > 0 && ds[i - 1] * ds[i] > 0 && Math.abs(ds[i]) <= Math.abs(ds[i - 1]) && Math.abs(ds[i]) <= Math.abs(ds[i + 1])) {
            const s = goldenMin(x => Math.abs(distance(x)), ss[i - 1], ss[i + 1]);
            if (Math.abs(distance(s)) <= eps) roots.push(s);
        }
    }
    const result: [number, number][] = [];
    for (const s of roots) {
        const t = paramOnPrim(p, primPoint(q, s), eps * 10);
        if (t !== undefined) result.push([t, s]);
    }
    return result;
}

// Fallback for curves without an analytic form: intersect polyline approximations, then refine with Newton's method.
function intersectGeneric(p: Prim, q: Prim, eps: number): [number, number][] {
    const segsP = approximate(p), segsQ = approximate(q);
    const result: [number, number][] = [];
    for (const a of segsP) for (const b of segsQ) {
        for (const [t, s] of segSeg(a, b, eps * 100)) {
            const refined = refine(p, q, t, s);
            if (refined !== undefined) result.push(refined);
        }
    }
    return result;
}

function approximate(p: Prim, n = 64): SegPrim[] {
    if (p.kind === 'seg') return [p];
    const result: SegPrim[] = [];
    let prev = primPoint(p, p.t0);
    for (let i = 1; i <= n; i++) {
        const t0 = p.t0 + (p.t1 - p.t0) * (i - 1) / n, t1 = p.t0 + (p.t1 - p.t0) * i / n;
        const next = primPoint(p, t1);
        result.push({ kind: 'seg', a: prev, b: next, t0, t1 });
        prev = next;
    }
    return result;
}

function refine(p: Prim, q: Prim, t: number, s: number): [number, number] | undefined {
    const lo1 = Math.min(p.t0, p.t1), hi1 = Math.max(p.t0, p.t1);
    const lo2 = Math.min(q.t0, q.t1), hi2 = Math.max(q.t0, q.t1);
    for (let iter = 0; iter < 30; iter++) {
        const P = primPoint(p, t), Q = primPoint(q, s);
        const fx = P.x - Q.x, fy = P.y - Q.y;
        if (Math.hypot(fx, fy) < 1e-10) break;
        const h1 = 1e-7 * Math.max(1, hi1 - lo1), h2 = 1e-7 * Math.max(1, hi2 - lo2);
        const Pt = primPoint(p, t + h1), Qs = primPoint(q, s + h2);
        const a = (Pt.x - P.x) / h1, c = (Pt.y - P.y) / h1;
        const b = -(Qs.x - Q.x) / h2, d = -(Qs.y - Q.y) / h2;
        const det = a * d - b * c;
        if (Math.abs(det) < 1e-14) break;
        t -= (d * fx - b * fy) / det;
        s -= (-c * fx + a * fy) / det;
        t = Math.min(hi1, Math.max(lo1, t)); s = Math.min(hi2, Math.max(lo2, s));
    }
    const P = primPoint(p, t), Q = primPoint(q, s);
    if (Math.hypot(P.x - Q.x, P.y - Q.y) > EPS * 10) return undefined;
    return [t, s];
}
