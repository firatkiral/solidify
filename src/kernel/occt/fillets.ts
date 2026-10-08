// Round fillets at the corners of planar contours.

import { Arc3D, Contour3D, Curve3D, LineSegment3D, Polyline3D, TrimmedCurve3D } from './curve3d';
import { cross, dot, Placement3D, Vector3D } from './math';
import { KernelError } from './solid';

type P2 = { x: number, y: number };

// radiuses[i] rounds the corner at the end of segment i; for a closed contour the last one rounds the corner between
// its last and first segments. Each fillet arc follows the segment it starts from.
export function contourFillets(contour: Contour3D, radiuses: number[]): Contour3D {
    const segments = contour.GetSegments();
    const n = segments.length;
    const corners = contour.IsClosed() ? n : n - 1;
    const place = contour.planeOf();
    if (place === undefined) throw new KernelError("Only planar contours can be filleted");

    const ranges = segments.map(s => [s.tmin, s.tmax]);
    const arcs: (Arc3D | undefined)[] = new Array(n);
    for (let i = 0; i < corners; i++) {
        const r = radiuses[i] ?? 0;
        if (!(r > 0)) continue;
        const j = (i + 1) % n;
        const { t, s, arc } = filletCorner(segments[i], ranges[i], segments[j], ranges[j], r, place);
        ranges[i][1] = t;
        ranges[j][0] = s;
        arcs[i] = arc;
    }

    const result: Curve3D[] = [];
    for (let i = 0; i < n; i++) {
        const [t0, t1] = ranges[i];
        if (t1 - t0 > 1e-9 * Math.max(1, Math.abs(segments[i].tmax - segments[i].tmin))) result.push(trim(segments[i], t0, t1));
        const arc = arcs[i];
        if (arc !== undefined) result.push(arc);
    }
    return Contour3D.of(result);
}

// The arc of radius r tangent to the end of `a` and the start of `b`, inside the corner between them, and where it
// touches each curve.
function filletCorner(a: Curve3D, ra: number[], b: Curve3D, rb: number[], r: number, place: Placement3D) {
    const X = place.axisX, Y = place.axisY;
    const point = (c: Curve3D, t: number): P2 => { const p = c._PointOn(t); return place.PointProjection(p) };
    const tangent = (c: Curve3D, t: number): P2 => { const d = c._FirstDer(t); const x = dot(d, X), y = dot(d, Y), l = Math.hypot(x, y); return { x: x / l, y: y / l } };
    const speed = (c: Curve3D, t: number) => { const d = c._FirstDer(t); return Math.hypot(dot(d, X), dot(d, Y)) };

    const ta = tangent(a, ra[1]), tb = tangent(b, rb[0]);
    const turn = ta.x * tb.y - ta.y * tb.x, along = ta.x * tb.x + ta.y * tb.y;
    if (Math.abs(turn) < 1e-9) throw new KernelError(along > 0 ? "There is no corner to fillet: the segments are tangent" : "The segments double back and cannot be filleted");
    // The fillet's centre is on the inner side of the corner: left of both curves for a left turn.
    const side = Math.sign(turn);
    const centre = (c: Curve3D, t: number): P2 => {
        const p = point(c, t), d = tangent(c, t);
        return { x: p.x - side * r * d.y, y: p.y + side * r * d.x };
    };

    // Start from the fillet of the two tangent lines, whose tangent points are r·tan(φ/2) from the corner.
    const phi = Math.atan2(Math.abs(turn), along);
    const length = r * Math.tan(phi / 2);
    let t = Math.max(ra[0], ra[1] - length / speed(a, ra[1]));
    let s = Math.min(rb[1], rb[0] + length / speed(b, rb[0]));

    const f = (t: number, s: number): [number, number] => { const p = centre(a, t), q = centre(b, s); return [p.x - q.x, p.y - q.y] };
    const ht = 1e-7 * Math.max(1, ra[1] - ra[0]), hs = 1e-7 * Math.max(1, rb[1] - rb[0]);
    const tolerance = 1e-10 * Math.max(1, r);
    for (let iter = 0; iter < 60; iter++) {
        const [f1, f2] = f(t, s);
        if (Math.hypot(f1, f2) < tolerance) break;
        const [a1, a2] = f(t + ht, s), [b1, b2] = f(t, s + hs);
        const j11 = (a1 - f1) / ht, j21 = (a2 - f2) / ht, j12 = (b1 - f1) / hs, j22 = (b2 - f2) / hs;
        const det = j11 * j22 - j12 * j21;
        if (Math.abs(det) < 1e-300) break;
        t -= (j22 * f1 - j12 * f2) / det;
        s -= (-j21 * f1 + j11 * f2) / det;
    }
    const [f1, f2] = f(t, s);
    const eps = 1e-9;
    if (Math.hypot(f1, f2) > 1e-6 * Math.max(1, r) || t < ra[0] - eps || t > ra[1] + eps || s < rb[0] - eps || s > rb[1] + eps) {
        throw new KernelError("The fillet radius is too large for the segments at this corner");
    }
    t = Math.min(ra[1], Math.max(ra[0], t));
    s = Math.min(rb[1], Math.max(rb[0], s));

    const c = centre(a, t);
    const z = cross(place.axisX, place.axisY);
    const arc = new Arc3D(place.point3d(c), a._PointOn(t), b._PointOn(s), new Vector3D(z.x, z.y, z.z), side);
    return { t, s, arc };
}

// The part of a contour segment between two of its parameters, of the same kind as the segment where possible.
function trim(segment: Curve3D, t0: number, t1: number): Curve3D {
    if (t0 <= segment.tmin && t1 >= segment.tmax) return segment.Duplicate();
    if (segment instanceof Arc3D) {
        const result = segment.Duplicate();
        result.closed = false;
        if (!result.IsCircle()) { result.t1 = t0; result.t2 = t1; return result }
        // A trimmed circular arc starts at angle 0, as in C3D: its X axis turns to the new start
        const P = result.placement, c = Math.cos(t0), s = Math.sin(t0);
        const X = P.axisX, Y = P.axisY;
        P.axisX = new Vector3D(c * X.x + s * Y.x, c * X.y + s * Y.y, c * X.z + s * Y.z);
        P.axisY = new Vector3D(-s * X.x + c * Y.x, -s * X.y + c * Y.y, -s * X.z + c * Y.z);
        result.t1 = 0; result.t2 = t1 - t0;
        return result;
    }
    if (segment instanceof Polyline3D && !segment.IsClosed()) {
        const points = [segment._PointOn(t0)];
        for (const [i, p] of segment.GetPoints().entries()) if (i > t0 && i < t1) points.push(p);
        points.push(segment._PointOn(t1));
        return new Polyline3D(points, false);
    }
    if (segment instanceof LineSegment3D) return new LineSegment3D(segment._PointOn(t0), segment._PointOn(t1));
    return new TrimmedCurve3D(segment.Duplicate(), t0, t1, 1);
}
