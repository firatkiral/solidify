// Splines through or around a list of points, represented exactly as B-splines (so they convert to OCCT without loss).
// The curve parameter is the B-spline parameter: interpolating splines have one unit of parameter per span.

export type Pole = number[];

// Index of the knot span containing t (clamped to the valid range). At a knot, side < 0 picks the span ending there
// instead of the one starting there.
function findSpan(t: number, count: number, p: number, knots: number[], side = 1) {
    const n = count - 1;
    if (t >= knots[n + 1]) return n;
    if (t <= knots[p]) return p;
    let lo = p, hi = n + 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (side < 0 ? t <= knots[mid] : t < knots[mid]) hi = mid; else lo = mid;
    }
    return lo;
}

// The B-spline of the derivative: one degree lower, on the knots without their ends.
function differentiate(p: number, knots: number[], poles: Pole[]): { p: number, knots: number[], poles: Pole[] } {
    const dpoles: Pole[] = [];
    for (let i = 0; i < poles.length - 1; i++) {
        const d = knots[i + p + 1] - knots[i + 1];
        dpoles.push(poles[i].map((v, k) => d === 0 ? 0 : p * (poles[i + 1][k] - v) / d));
    }
    return { p: p - 1, knots: knots.slice(1, -1), poles: dpoles };
}

export class BSpline {
    constructor(
        readonly degree: number,
        readonly knots: number[], // full, clamped knot vector
        readonly poles: Pole[],
    ) { }

    get tmin() { return this.knots[this.degree] }
    get tmax() { return this.knots[this.knots.length - this.degree - 1] }

    // de Boor's algorithm
    point(t: number): number[] {
        return this.deBoor(t, this.poles, this.degree, this.knots);
    }

    derivative(t: number): number[] {
        return this.derivatives(t, 1)[1];
    }

    // The point and its derivatives up to `order` at t. At a knot they are those of the span on the side of `side`.
    derivatives(t: number, order: number, side = 1): number[][] {
        let { degree: p, knots, poles } = this;
        const result = [this.deBoor(t, poles, p, knots, side)];
        for (let k = 1; k <= order; k++) {
            if (p === 0) { result.push(result[0].map(() => 0)); continue }
            ({ p, knots, poles } = differentiate(p, knots, poles));
            result.push(this.deBoor(t, poles, p, knots, side));
        }
        return result;
    }

    private deBoor(t: number, poles: Pole[], p: number, knots: number[], side = 1): number[] {
        const k = findSpan(t, poles.length, p, knots, side);
        const d: number[][] = [];
        for (let j = 0; j <= p; j++) d.push([...poles[j + k - p]]);
        for (let r = 1; r <= p; r++) {
            for (let j = p; j >= r; j--) {
                const denom = knots[j + 1 + k - r] - knots[j + k - p];
                const alpha = denom === 0 ? 0 : (t - knots[j + k - p]) / denom;
                d[j] = d[j].map((v, i) => (1 - alpha) * d[j - 1][i] + alpha * v);
            }
        }
        return d[p];
    }

    // Distinct knots with multiplicities, as OCCT wants them.
    uniqueKnots(): { knots: number[], mults: number[] } {
        const knots: number[] = [], mults: number[] = [];
        for (const k of this.knots) {
            if (knots.length > 0 && Math.abs(k - knots[knots.length - 1]) < 1e-12) mults[mults.length - 1]++;
            else { knots.push(k); mults.push(1) }
        }
        return { knots, mults };
    }

    // Parameters of the boundaries between polynomial spans.
    spans(): number[] {
        return this.uniqueKnots().knots.filter(k => k >= this.tmin - 1e-12 && k <= this.tmax + 1e-12);
    }
}

const add = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const scale = (a: number[], s: number) => a.map(v => v * s);

// Piecewise cubic Bézier through the points with the given tangents (derivatives per unit parameter, or per
// spans[i] units of parameter along span i).
function hermiteToBSpline(points: Pole[], tangents: Pole[], closed: boolean, spans?: number[]): BSpline {
    const n = points.length;
    const segments = closed ? n : n - 1;
    const poles: Pole[] = [points[0]];
    for (let i = 0; i < segments; i++) {
        const a = points[i], b = points[(i + 1) % n];
        const ta = tangents[i], tb = tangents[(i + 1) % n];
        const s = (spans?.[i] ?? 1) / 3;
        poles.push(add(a, scale(ta, s)), sub(b, scale(tb, s)), b);
    }
    const knots = [0, 0, 0, 0];
    for (let i = 1; i < segments; i++) knots.push(i, i, i);
    knots.push(segments, segments, segments, segments);
    return new BSpline(3, knots, poles);
}

// The data of a Hermite spline: a tangent at each point and the parameter length of each span.
export type HermiteData = { tangents: Pole[], spans: number[] };

// C3D's Hermite spline: spans are as long as their chords, and at each point the tangent is that of the parabola
// through it and its neighbours (Bessel tangents); open curves have natural (zero curvature) ends.
export function hermiteData(points: Pole[], closed: boolean): HermiteData {
    const n = points.length;
    if (n < 2) throw new Error("A spline needs at least 2 points");
    const segments = closed ? n : n - 1;
    const spans: number[] = [], slopes: Pole[] = [];
    for (let i = 0; i < segments; i++) {
        const d = sub(points[(i + 1) % n], points[i]);
        const h = Math.max(Math.hypot(...d), 1e-12);
        spans.push(h);
        slopes.push(scale(d, 1 / h));
    }
    const tangents: Pole[] = [];
    if (closed) for (let i = 0; i < n; i++) tangents.push(besselTangent(points, spans, (i - 1 + n) % n, i, (i + 1) % n));
    else if (n === 2) tangents.push(slopes[0], slopes[0]);
    else {
        for (let i = 1; i < n - 1; i++) tangents[i] = besselTangent(points, spans, i - 1, i, i + 1);
        tangents[0] = naturalEnd(slopes[0], tangents[1]);
        tangents[n - 1] = naturalEnd(slopes[n - 2], tangents[n - 2]);
    }
    return { tangents, spans };
}

// The tangent at points[i] of the parabola through points a, i, b, with the spans before and after i
function besselTangent(points: Pole[], spans: number[], a: number, i: number, b: number) {
    const h0 = spans[a], h1 = spans[i];
    const d0 = scale(sub(points[i], points[a]), 1 / h0), d1 = scale(sub(points[b], points[i]), 1 / h1);
    return scale(add(scale(d0, h1), scale(d1, h0)), 1 / (h0 + h1));
}

// The end tangent giving zero curvature at the end of a span with the given slope (chord / span) and other tangent
function naturalEnd(slope: Pole, other: Pole) { return sub(scale(slope, 1.5), scale(other, 0.5)) }

// The tangent for a point added to a Hermite spline, from its neighbours: an end is natural, an inner point Bessel.
export function hermiteTangentFor(points: Pole[], spans: number[], tangents: Pole[], i: number, closed: boolean): Pole {
    const n = points.length;
    if (closed) return besselTangent(points, spans, (i - 1 + n) % n, i, (i + 1) % n);
    if (n === 2) return scale(sub(points[1], points[0]), 1 / spans[0]);
    if (i === 0) return naturalEnd(scale(sub(points[1], points[0]), 1 / spans[0]), tangents[1]);
    if (i === n - 1) return naturalEnd(scale(sub(points[n - 1], points[n - 2]), 1 / spans[n - 2]), tangents[n - 2]);
    return besselTangent(points, spans, i - 1, i, i + 1);
}

// The parameter still runs one unit per span; the span lengths scale the tangents within each span.
export function hermiteFromData(points: Pole[], data: HermiteData, closed: boolean): BSpline {
    return hermiteToBSpline(points, data.tangents, closed, data.spans);
}

export function hermite(points: Pole[], closed: boolean): BSpline {
    return hermiteFromData(points, hermiteData(points, closed), closed);
}

// Editing the points of a Hermite spline keeps the tangents of the other points, as in C3D.

// After removing point i of n: its tangent goes, and the spans on either side of it merge.
export function hermiteRemove(data: HermiteData, i: number, n: number, closed: boolean): HermiteData {
    const tangents = [...data.tangents], spans = [...data.spans];
    tangents.splice(i, 1);
    if (closed) { spans[(i - 1 + n) % n] += spans[i]; spans.splice(i, 1) }
    else if (i === 0) spans.shift();
    else if (i === n - 1) spans.pop();
    else { spans[i - 1] += spans[i]; spans.splice(i, 1) }
    return { tangents, spans };
}

// After inserting point i of `points` into an open spline: the span it splits is shared in proportion to the chords.
export function hermiteInsert(points: Pole[], data: HermiteData, i: number): HermiteData {
    const n = points.length;
    const tangents = [...data.tangents], spans = [...data.spans];
    const chord = (a: number, b: number) => Math.max(Math.hypot(...sub(points[b], points[a])), 1e-12);
    if (i === 0) spans.unshift(chord(0, 1));
    else if (i === n - 1) spans.push(chord(n - 2, n - 1));
    else {
        const c1 = chord(i - 1, i), c2 = chord(i, i + 1), s = spans[i - 1];
        spans.splice(i - 1, 1, s * c1 / (c1 + c2), s * c2 / (c1 + c2));
    }
    tangents.splice(i, 0, []);
    tangents[i] = hermiteTangentFor(points, spans, tangents, i, false);
    return { tangents, spans };
}

// The same curve with its points in reverse order.
export function hermiteReverse(data: HermiteData, closed: boolean): HermiteData {
    const n = data.tangents.length;
    const tangents = data.tangents.map((_, k) => scale(data.tangents[n - 1 - k], -1));
    const spans = closed ? data.spans.map((_, k) => data.spans[(2 * n - 2 - k) % n]) : [...data.spans].reverse();
    return { tangents, spans };
}

// C2 interpolating cubic spline: natural end conditions when open, periodic when closed.
export function cubicSpline(points: Pole[], closed: boolean): BSpline {
    const n = points.length;
    if (n < 2) throw new Error("A spline needs at least 2 points");
    if (n === 2 && !closed) return hermiteToBSpline(points, [sub(points[1], points[0]), sub(points[1], points[0])], false);
    const dim = points[0].length;
    const tangents: Pole[] = [];
    for (let d = 0; d < dim; d++) {
        const y = points.map(p => p[d]);
        const D = closed ? periodicDerivatives(y) : naturalDerivatives(y);
        D.forEach((v, i) => { (tangents[i] ??= [])[d] = v });
    }
    return hermiteToBSpline(points, tangents, closed);
}

// Solves the tridiagonal system for first derivatives of a natural cubic spline with unit spacing.
function naturalDerivatives(y: number[]): number[] {
    const n = y.length;
    const a = new Array(n).fill(1), b = new Array(n).fill(4), c = new Array(n).fill(1), r = new Array(n);
    b[0] = 2; b[n - 1] = 2;
    r[0] = 3 * (y[1] - y[0]);
    r[n - 1] = 3 * (y[n - 1] - y[n - 2]);
    for (let i = 1; i < n - 1; i++) r[i] = 3 * (y[i + 1] - y[i - 1]);
    return thomas(a, b, c, r);
}

function thomas(a: number[], b: number[], c: number[], r: number[]): number[] {
    const n = r.length;
    const cp = new Array(n), rp = new Array(n);
    cp[0] = c[0] / b[0]; rp[0] = r[0] / b[0];
    for (let i = 1; i < n; i++) {
        const m = b[i] - a[i] * cp[i - 1];
        cp[i] = c[i] / m;
        rp[i] = (r[i] - a[i] * rp[i - 1]) / m;
    }
    const x = new Array(n);
    x[n - 1] = rp[n - 1];
    for (let i = n - 2; i >= 0; i--) x[i] = rp[i] - cp[i] * x[i + 1];
    return x;
}

// Periodic version: D[i-1] + 4 D[i] + D[i+1] = 3 (y[i+1] - y[i-1]), solved densely (point counts are small).
function periodicDerivatives(y: number[]): number[] {
    const n = y.length;
    const M = Array.from({ length: n }, () => new Array(n + 1).fill(0));
    for (let i = 0; i < n; i++) {
        M[i][(i - 1 + n) % n] += 1; M[i][i] += 4; M[i][(i + 1) % n] += 1;
        M[i][n] = 3 * (y[(i + 1) % n] - y[(i - 1 + n) % n]);
    }
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let row = col + 1; row < n; row++) if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
        [M[col], M[pivot]] = [M[pivot], M[col]];
        for (let row = 0; row < n; row++) {
            if (row === col) continue;
            const f = M[row][col] / M[col][col];
            for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
        }
    }
    return M.map((row, i) => row[n] / row[i]);
}

// A single Bézier curve with the points as control points, parameter in [0, 1].
export function bezier(points: Pole[], closed: boolean): BSpline {
    const pts = closed ? [...points, points[0]] : points;
    const p = pts.length - 1;
    if (p < 1) throw new Error("A Bézier curve needs at least 2 points");
    const knots = [...new Array(p + 1).fill(0), ...new Array(p + 1).fill(1)];
    return new BSpline(p, knots, pts);
}

// A clamped uniform B-spline (cubic when there are enough points) with the points as control points.
export function nurbs(points: Pole[], closed: boolean): BSpline {
    const pts = closed ? [...points, points[0]] : points;
    const n = pts.length;
    const p = Math.min(3, n - 1);
    if (p < 1) throw new Error("A NURBS curve needs at least 2 points");
    const inner = n - p - 1;
    const knots = [...new Array(p + 1).fill(0)];
    for (let i = 1; i <= inner; i++) knots.push(i);
    knots.push(...new Array(p + 1).fill(inner + 1));
    return new BSpline(p, knots, pts);
}

export const SplineKind = { Hermite: 'hermite', CubicSpline: 'cubic', Bezier: 'bezier', Nurbs: 'nurbs' } as const;
export type SplineKind = typeof SplineKind[keyof typeof SplineKind];

export function makeSpline(kind: SplineKind, points: Pole[], closed: boolean): BSpline {
    switch (kind) {
        case 'hermite': return hermite(points, closed);
        case 'cubic': return cubicSpline(points, closed);
        case 'bezier': return bezier(points, closed);
        case 'nurbs': return nurbs(points, closed);
    }
}
