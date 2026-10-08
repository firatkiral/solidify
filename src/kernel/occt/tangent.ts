// Lines tangent to planar curves: through a point, or common to two curves.

import { Curve, EPS, Line, P2 } from './curve2d';
import { bisect } from './intersect2d';
import { CartPoint } from './math';

// Parameters at which to look for tangency: the curve's samples, each interval split further.
function params(curve: Curve, split: number): number[] {
    const ts = curve.samples(0);
    const result = [ts[0]];
    for (let i = 1; i < ts.length; i++) for (let k = 1; k <= split; k++) result.push(ts[i - 1] + (ts[i] - ts[i - 1]) * k / split);
    return result;
}

const near = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.y - b.y) < EPS * 10;

// Where the line from p to the curve is tangent to it: the distance from p to the curve's tangent line is zero.
// Corners of a curve change that distance's sign without zeroing it, and are left out.
export function tangentsFromPoint(curve: Curve, p: P2): Line[] {
    if (curve.IsStraight(true)) return [];
    const f = (t: number) => {
        const c = curve._PointOn(t), d = curve._Tangent(t);
        return (c.x - p.x) * d.y - (c.y - p.y) * d.x;
    };
    const result: Line[] = [];
    const found: P2[] = [];
    const ts = params(curve, 4);
    let prev = f(ts[0]);
    for (let i = 1; i < ts.length; i++) {
        const value = f(ts[i]);
        if (prev * value < 0 || value === 0) {
            const t = value === 0 ? ts[i] : bisect(f, ts[i - 1], ts[i], prev);
            const c = curve._PointOn(t);
            if (Math.abs(f(t)) <= EPS && !near(c, p) && !found.some(q => near(q, c))) {
                found.push(c);
                result.push(new Line(p, c));
            }
        }
        prev = value;
    }
    return result;
}

// Lines touching both curves: parameters t, s where the line from C1(t) to C2(s) is along both curves' tangents.
// Solved by Newton's method from the cells of a grid of parameters in which both conditions change sign.
export function commonTangents(curve1: Curve, curve2: Curve): { lines: Line[], points: CartPoint[] } {
    const lines: Line[] = [], points: CartPoint[] = [];
    if (curve1.IsStraight(true) || curve2.IsStraight(true)) return { lines, points };
    const g = (t: number, s: number): [number, number] => {
        const a = curve1._PointOn(t), b = curve2._PointOn(s), u = curve1._Tangent(t), v = curve2._Tangent(s);
        const dx = b.x - a.x, dy = b.y - a.y;
        return [dx * u.y - dy * u.x, dx * v.y - dy * v.x];
    };
    const ts = params(curve1, 1), ss = params(curve2, 1);
    const values = ts.map(t => ss.map(s => g(t, s)));
    const changes = (k: 0 | 1, i: number, j: number) => {
        const corners = [values[i][j][k], values[i + 1][j][k], values[i][j + 1][k], values[i + 1][j + 1][k]];
        return Math.min(...corners) <= 0 && Math.max(...corners) >= 0;
    };
    const found: [P2, P2][] = [];
    for (let i = 0; i < ts.length - 1; i++) {
        for (let j = 0; j < ss.length - 1; j++) {
            if (!changes(0, i, j) || !changes(1, i, j)) continue;
            const solution = newton(g, (ts[i] + ts[i + 1]) / 2, (ss[j] + ss[j + 1]) / 2, curve1, curve2);
            if (solution === undefined) continue;
            const [t, s] = solution;
            const a = curve1._PointOn(t), b = curve2._PointOn(s);
            // Where the curves cross, both conditions hold trivially.
            if (near(a, b) || found.some(([x, y]) => near(x, a) && near(y, b))) continue;
            found.push([a, b]);
            lines.push(new Line(a, b));
            points.push(new CartPoint(b.x, b.y));
        }
    }
    return { lines, points };
}

function newton(g: (t: number, s: number) => [number, number], t: number, s: number, curve1: Curve, curve2: Curve): [number, number] | undefined {
    const ht = 1e-7 * Math.max(1, curve1.tmax - curve1.tmin), hs = 1e-7 * Math.max(1, curve2.tmax - curve2.tmin);
    for (let iter = 0; iter < 50; iter++) {
        const [f1, f2] = g(t, s);
        if (Math.hypot(f1, f2) < EPS * 1e-3) break;
        const [a1, a2] = g(t + ht, s), [b1, b2] = g(t, s + hs);
        const j11 = (a1 - f1) / ht, j21 = (a2 - f2) / ht, j12 = (b1 - f1) / hs, j22 = (b2 - f2) / hs;
        const det = j11 * j22 - j12 * j21;
        if (Math.abs(det) < 1e-300) return undefined;
        t = curve1.wrap(t - (j22 * f1 - j12 * f2) / det);
        s = curve2.wrap(s - (-j21 * f1 + j11 * f2) / det);
    }
    const [f1, f2] = g(t, s);
    if (Math.abs(f1) > EPS || Math.abs(f2) > EPS) return undefined;
    return [t, s];
}
