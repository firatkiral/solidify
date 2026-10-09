// Offsets of planar curves within their plane, and across planar faces.

import { OffsetGapFill } from './constants';
import { Arc3D, Contour3D, CubicSpline3D, Curve3D, LineSegment3D, PlaneCurve, Polyline3D } from './curve3d';
import { reach, split } from './cutting';
import { Axis3D, CartPoint3D, cross, dot, Matrix3D, normalized, Placement3D, Vector3D } from './math';
import { SNameMaker } from './misc';
import { oc } from './occt';
import { cart, curveOfEdge, distanceToShape, edgesOf3d, explore, Face, gpPnt, KernelError, segmentEdge, Shape, transformShape, vec, wireOf } from './solid';

type P2 = { x: number, y: number };
type Line = { k: 'line', a: P2, b: P2 };
// Centre, radius, and the angles of the ends; dir is +1 anticlockwise, -1 clockwise.
type Arc = { k: 'arc', c: P2, r: number, s0: number, s1: number, dir: number };
type Points = { k: 'points', pts: P2[] };
type Piece = Line | Arc | Points;

const TWO_PI = 2 * Math.PI;
const EPS = 1e-9;
const dist = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.y - b.y);

// The curve moved `distance` to its left (as seen along the plane's normal) at every point. Corners between
// straight pieces stay sharp; the pieces of a contour are extended or trimmed to meet again. The plane is the curve's
// own unless given (a straight curve has none).
export function offsetPlaneCurve(curve: Curve3D, distance: number, plane?: Placement3D): Curve3D {
    const place = plane ?? frameOf(curve);
    if (place === undefined) throw new KernelError("Only planar curves can be offset in their plane");

    if (curve instanceof Arc3D && curve.IsClosed()) {
        const [arc] = piecesOf(curve, place) as Arc[];
        return toCurve(offsetPiece(arc, distance), place, false) as Arc3D;
    }

    const segments = curve instanceof Contour3D ? curve.GetSegments() : [curve];
    const groups = segments.map(s => piecesOf(s, place).map(p => offsetPiece(p, distance)));
    const pieces = groups.flat();
    const closed = curve.IsClosed();
    for (let i = 0; i < pieces.length - 1; i++) join(pieces[i], pieces[i + 1]);
    if (closed && pieces.length > 1) join(pieces[pieces.length - 1], pieces[0]);

    if (curve instanceof Polyline3D || curve instanceof LineSegment3D) {
        const lines = pieces as Line[];
        const points = lines.map(l => l.a);
        if (!closed) points.push(lines[lines.length - 1].b);
        if (curve instanceof LineSegment3D) return new LineSegment3D(place.point3d(points[0]), place.point3d(points[1]));
        return new Polyline3D(points.map(p => place.point3d(p)), closed);
    }
    if (!(curve instanceof Contour3D)) return toCurve(pieces[0], place, false);

    // Each segment of the contour stays one segment
    const result: Curve3D[] = [];
    let k = 0;
    for (const [i, group] of groups.entries()) {
        const mine = pieces.slice(k, k + group.length);
        k += group.length;
        const segment = segments[i];
        if (segment instanceof Polyline3D && mine.every(p => p.k === 'line')) {
            const points = (mine as Line[]).map(l => l.a);
            points.push((mine[mine.length - 1] as Line).b);
            result.push(new Polyline3D(points.map(p => place.point3d(p)), false));
        } else for (const p of mine) result.push(toCurve(p, place, false));
    }
    return Contour3D.of(result);
}

// The closed outline of the band between the offsets of an open planar curve by `lo` and by `hi` (to its left, as seen
// along the plane's normal), with square ends. Where the curve ends on `axis`, a line in the plane, the band's sides
// are extended or trimmed to the axis instead: revolved about that axis, the curve's end is a pole of the surface, and
// thickening the surface moves the pole along the axis (as C3D does) rather than opening a hole around it.
export function offsetBand(curve: Curve3D, lo: number, hi: number, plane: Placement3D, axis?: Axis3D): Curve3D {
    if (hi - lo < EPS) throw new KernelError("Thickness must not be zero");
    // Profiles arrive as contours of contours (the app wraps each curve in one); only the innermost segments are pieces.
    const flatten = (c: Curve3D): Curve3D[] => c instanceof Contour3D ? c.GetSegments().flatMap(flatten) : [c];
    const segments = flatten(curve);
    const sides = [hi, lo].map(d => {
        const pieces = segments.flatMap(s => piecesOf(s, plane)).map(p => offsetPiece(p, d));
        for (let i = 0; i < pieces.length - 1; i++) join(pieces[i], pieces[i + 1]);
        return pieces;
    });
    if (axis !== undefined) {
        const o = axis.origin, v = axis.direction;
        const p = plane.PointProjection(o), q = plane.PointProjection(new CartPoint3D(o.x + v.x, o.y + v.y, o.z + v.z));
        const line: Carrier = { k: 'line', p, d: { x: q.x - p.x, y: q.y - p.y } };
        const l = Math.hypot(line.d.x, line.d.y);
        const onAxis = (x: P2) => l > EPS && Math.abs((x.x - p.x) * line.d.y - (x.y - p.y) * line.d.x) / l < 1e-6;
        const [first, last] = [curve.GetLimitPoint(1), curve.GetLimitPoint(2)].map(x => plane.PointProjection(x));
        for (const pieces of sides) {
            if (onAxis(first)) toAxis(pieces[0], 'start', line);
            if (onAxis(last)) toAxis(pieces[pieces.length - 1], 'end', line);
        }
    }
    const [upper, lower] = sides;
    const outline: Piece[] = [...upper];
    const cap = (a: P2, b: P2) => { if (dist(a, b) > EPS) outline.push({ k: 'line', a, b }) };
    cap(end(upper[upper.length - 1]), end(lower[lower.length - 1]));
    outline.push(...lower.map(reversed).reverse());
    cap(start(lower[0]), start(upper[0]));
    return Contour3D.of(outline.map(p => toCurve(p, plane, false)));
}

// The plane to offset in, facing so that the curve turns anticlockwise overall: a positive distance moves the curve
// to the inside of its turn (as in C3D, e.g. shrinking a circle).
function frameOf(curve: Curve3D): Placement3D | undefined {
    const plane = curve instanceof Arc3D ? curve.GetPlacement() : curve instanceof PlaneCurve ? curve.GetPlacement() : curve.planeOf();
    if (plane === undefined || curve instanceof Arc3D) return plane;
    const points = curve.polyline(0).map(p => plane.PointProjection(p));
    let turning = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const a = points[i - 1], b = points[i], c = points[i + 1];
        const u = { x: b.x - a.x, y: b.y - a.y }, v = { x: c.x - b.x, y: c.y - b.y };
        if (Math.hypot(u.x, u.y) < 1e-12 || Math.hypot(v.x, v.y) < 1e-12) continue;
        turning += Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y);
    }
    if (turning < 0) { plane.axisZ.Invert(); plane.axisY.Invert() }
    return plane;
}

// A segment as straight lines, arcs or a polyline of points in the plane's coordinates.
function piecesOf(segment: Curve3D, place: Placement3D): Piece[] {
    const p2 = (p: CartPoint3D) => place.PointProjection(p);
    if (segment instanceof Polyline3D) {
        const pts = segment.GetPoints().map(p2);
        if (segment.IsClosed()) pts.push(pts[0]);
        const result: Line[] = [];
        for (let i = 0; i < pts.length - 1; i++) if (dist(pts[i], pts[i + 1]) > EPS) result.push({ k: 'line', a: pts[i], b: pts[i + 1] });
        return result;
    }
    if (segment.IsStraight(true)) return [{ k: 'line', a: p2(segment.GetLimitPoint(1)), b: p2(segment.GetLimitPoint(2)) }];
    if (segment instanceof Arc3D && segment.IsCircle()) {
        const P = segment.placement;
        const Z = P.axisZ, N = place.axisZ;
        const dir = Z.x * N.x + Z.y * N.y + Z.z * N.z >= 0 ? 1 : -1;
        const c = p2(P.origin);
        const angle = (t: number) => { const q = p2(segment._PointOn(t)); return Math.atan2(q.y - c.y, q.x - c.x) };
        const s0 = angle(segment.tmin);
        const sweep = segment.tmax - segment.tmin;
        return [{ k: 'arc', c, r: segment.GetRadius(), s0, s1: s0 + dir * sweep, dir }];
    }
    const ts = segment.samples(0);
    const n = Math.max(32, ts.length * 4);
    const pts: P2[] = [];
    for (let i = 0; i <= n; i++) pts.push(p2(segment._PointOn(segment.tmin + (segment.tmax - segment.tmin) * i / n)));
    return [{ k: 'points', pts }];
}

function offsetPiece(piece: Piece, d: number): Piece {
    switch (piece.k) {
        case 'line': {
            const { a, b } = piece, l = dist(a, b);
            const n = { x: -(b.y - a.y) / l * d, y: (b.x - a.x) / l * d };
            return { k: 'line', a: { x: a.x + n.x, y: a.y + n.y }, b: { x: b.x + n.x, y: b.y + n.y } };
        }
        case 'arc': {
            const r = piece.r - piece.dir * d;
            if (r <= EPS) throw new KernelError("The offset is larger than the radius of an arc of the curve");
            return { ...piece, r };
        }
        case 'points': {
            const { pts } = piece;
            return {
                k: 'points', pts: pts.map((p, i) => {
                    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = dist(a, b);
                    return { x: p.x - (b.y - a.y) / l * d, y: p.y + (b.x - a.x) / l * d };
                })
            };
        }
    }
}

function start(p: Piece): P2 {
    if (p.k === 'line') return p.a;
    if (p.k === 'arc') return { x: p.c.x + p.r * Math.cos(p.s0), y: p.c.y + p.r * Math.sin(p.s0) };
    return p.pts[0];
}
function end(p: Piece): P2 {
    if (p.k === 'line') return p.b;
    if (p.k === 'arc') return { x: p.c.x + p.r * Math.cos(p.s1), y: p.c.y + p.r * Math.sin(p.s1) };
    return p.pts[p.pts.length - 1];
}

// Makes piece a end where piece b starts: both are trimmed or extended to the intersection of the lines or circles
// they lie on that is nearest their ends; if there is none, b is moved to start at a's end.
function join(a: Piece, b: Piece) {
    const ea = end(a), sb = start(b);
    if (dist(ea, sb) < 1e-9) return;
    const near = { x: (ea.x + sb.x) / 2, y: (ea.y + sb.y) / 2 };
    const candidates = intersections(carrier(a, 'end'), carrier(b, 'start'));
    let best: P2 | undefined, bd = Infinity;
    for (const x of candidates) { const d = dist(x, near); if (d < bd) { bd = d; best = x } }
    const scale = Math.max(dist(ea, sb), 1e-9);
    if (best === undefined || bd > 100 * scale + 1e3) best = ea;
    setEnd(a, best);
    setStart(b, best);
}

type Carrier = { k: 'line', p: P2, d: P2 } | { k: 'circle', c: P2, r: number };
function carrier(piece: Piece, side: 'start' | 'end'): Carrier {
    if (piece.k === 'line') return { k: 'line', p: piece.a, d: { x: piece.b.x - piece.a.x, y: piece.b.y - piece.a.y } };
    if (piece.k === 'arc') return { k: 'circle', c: piece.c, r: piece.r };
    const pts = piece.pts;
    const [p, q] = side === 'end' ? [pts[pts.length - 2], pts[pts.length - 1]] : [pts[0], pts[1]];
    return { k: 'line', p, d: { x: q.x - p.x, y: q.y - p.y } };
}

function intersections(u: Carrier, v: Carrier): P2[] {
    if (u.k === 'line' && v.k === 'line') {
        const det = u.d.x * v.d.y - u.d.y * v.d.x;
        if (Math.abs(det) < 1e-12 * Math.hypot(u.d.x, u.d.y) * Math.hypot(v.d.x, v.d.y)) return [];
        const t = ((v.p.x - u.p.x) * v.d.y - (v.p.y - u.p.y) * v.d.x) / det;
        return [{ x: u.p.x + u.d.x * t, y: u.p.y + u.d.y * t }];
    }
    if (u.k === 'circle' && v.k === 'line') return intersections(v, u);
    if (u.k === 'line' && v.k === 'circle') {
        const l = Math.hypot(u.d.x, u.d.y), d = { x: u.d.x / l, y: u.d.y / l };
        const w = { x: u.p.x - v.c.x, y: u.p.y - v.c.y };
        const b = w.x * d.x + w.y * d.y, c = w.x * w.x + w.y * w.y - v.r * v.r;
        const disc = b * b - c;
        if (disc < -1e-12) return [];
        const s = Math.sqrt(Math.max(0, disc));
        return [-b - s, -b + s].map(t => ({ x: u.p.x + d.x * t, y: u.p.y + d.y * t }));
    }
    if (u.k === 'circle' && v.k === 'circle') {
        const D = dist(u.c, v.c);
        if (D < 1e-12 || D > u.r + v.r + 1e-12 || D < Math.abs(u.r - v.r) - 1e-12) return [];
        const a = (u.r * u.r - v.r * v.r + D * D) / (2 * D);
        const h = Math.sqrt(Math.max(0, u.r * u.r - a * a));
        const m = { x: u.c.x + (v.c.x - u.c.x) * a / D, y: u.c.y + (v.c.y - u.c.y) * a / D };
        const o = { x: -(v.c.y - u.c.y) / D * h, y: (v.c.x - u.c.x) / D * h };
        return [{ x: m.x + o.x, y: m.y + o.y }, { x: m.x - o.x, y: m.y - o.y }];
    }
    return [];
}

// The angle of a point on an arc, chosen as close as possible to the angle it replaces.
function angleNear(arc: Arc, p: P2, previous: number) {
    let a = Math.atan2(p.y - arc.c.y, p.x - arc.c.x);
    while (a - previous > Math.PI) a -= TWO_PI;
    while (previous - a > Math.PI) a += TWO_PI;
    return a;
}

function setEnd(piece: Piece, p: P2) {
    if (piece.k === 'line') piece.b = p;
    else if (piece.k === 'arc') piece.s1 = angleNear(piece, p, piece.s1);
    else piece.pts[piece.pts.length - 1] = p;
}
function setStart(piece: Piece, p: P2) {
    if (piece.k === 'line') piece.a = p;
    else if (piece.k === 'arc') piece.s0 = angleNear(piece, p, piece.s0);
    else piece.pts[0] = p;
}

// Moves one end of a piece to where its line or circle crosses the axis, nearest to where the end was (the piece is
// extended or trimmed); the end stays where it is if they do not cross.
function toAxis(piece: Piece, side: 'start' | 'end', axis: Carrier) {
    const from = side === 'start' ? start(piece) : end(piece);
    let best: P2 | undefined, bd = Infinity;
    for (const x of intersections(axis, carrier(piece, side))) { const d = dist(x, from); if (d < bd) { bd = d; best = x } }
    if (best === undefined) return;
    if (side === 'start') setStart(piece, best); else setEnd(piece, best);
}

function reversed(piece: Piece): Piece {
    if (piece.k === 'line') return { k: 'line', a: piece.b, b: piece.a };
    if (piece.k === 'arc') return { ...piece, s0: piece.s1, s1: piece.s0, dir: -piece.dir };
    return { k: 'points', pts: [...piece.pts].reverse() };
}

function toCurve(piece: Piece, place: Placement3D, _closed: boolean): Curve3D {
    const p3 = (p: P2) => place.point3d(p);
    switch (piece.k) {
        case 'line': return new Polyline3D([p3(piece.a), p3(piece.b)], false);
        case 'arc': {
            const sweep = Math.abs(piece.s1 - piece.s0);
            const N = place.axisZ;
            const axis = piece.dir > 0 ? new Vector3D(N.x, N.y, N.z) : new Vector3D(-N.x, -N.y, -N.z);
            const result = new Arc3D(p3(piece.c), p3(start(piece)), p3(end(piece)), axis, 1);
            if (sweep >= TWO_PI - 1e-9) { result.t1 = 0; result.t2 = TWO_PI; result.closed = true }
            else { result.t1 = 0; result.t2 = sweep; result.closed = false }
            return result;
        }
        case 'points': return new CubicSpline3D(piece.pts.map(p3), false);
    }
}

// ---- Offsets across planar faces ----

// C3D's parameters for offsetting a curve that lies on a face: the face, a point on the curve with the direction across
// the face to offset towards, and the distance. How gaps at corners are filled is the OCCT kernel's own.
export class SurfaceOffsetCurveParams {
    constructor(readonly face: Face, readonly axis: Axis3D, readonly distance: number, _names?: SNameMaker, readonly gapFill: number = OffsetGapFill.Natural) { }
}

// Curves, as C3D returns an offset that can come apart in several.
export class WireFrame {
    constructor(private readonly curves: Curve3D[]) { }
    GetCurves() { return this.curves }
}

// A curve lying on a planar face offset across it, towards the side the axis points to from a point on the curve.
// Where the offset pieces part at a corner, the gap is closed as params.gapFill says. A closed curve (a loop of the
// face) is offset whole; an open one is extended along its end tangents as far as the face goes, so that it divides
// the face.
export function offsetOnFace(curve: Curve3D, params: SurfaceOffsetCurveParams): Curve3D[] {
    const { face, axis, gapFill } = params;
    const distance = Math.abs(params.distance);
    if (!face.IsPlanar()) throw new KernelError("Offset on curved faces isn't supported yet");
    if (distance < EPS) throw new KernelError("The offset distance must not be zero");
    const n = face.planePlacement().axisZ;
    const d = axis.direction, along = dot(d, n);
    const across = normalized(new Vector3D(d.x - n.x * along, d.y - n.y * along, d.z - n.z * along));

    const edges = edgesOf3d(curve);
    let offset: Shape[];
    if (curve.IsStraight(true)) {
        // A straight curve has no plane of its own to offset in: move it across
        const a = curve.GetLimitPoint(1), b = curve.GetLimitPoint(2);
        let side = normalized(cross(n, new Vector3D(b.x - a.x, b.y - a.y, b.z - a.z)));
        if (dot(side, across) < 0) side = new Vector3D(-side.x, -side.y, -side.z);
        const m = new Matrix3D();
        m.Move(new Vector3D(side.x * distance, side.y * distance, side.z * distance));
        offset = edges.map(e => transformShape(e, m));
    } else {
        offset = offsetWire(wireOf(edges), !curve.IsClosed(), distance, axis.origin, across, gapFill);
    }
    if (!curve.IsClosed()) offset.push(...extensions(offset, face));
    return offset.map(e => curveOfEdge(oc.TopoDS.Edge(e)));
}

// The edges of a planar wire's offset to the side `across` points to from `origin`, a point on the wire.
function offsetWire(wire: Shape, open: boolean, distance: number, origin: CartPoint3D, across: Vector3D, gapFill: number): Shape[] {
    const join = gapFill === OffsetGapFill.Natural ? oc.GeomAbs_JoinType.GeomAbs_Intersection : oc.GeomAbs_JoinType.GeomAbs_Arc;
    // Which way a positive distance goes depends on how the wire runs; try one, else the other
    for (const signed of [distance, -distance]) {
        const maker = new oc.BRepOffsetAPI_MakeOffset(wire, join, open);
        try {
            maker.Perform(signed, 0);
            if (!maker.IsDone()) continue;
            const result = maker.Shape();
            const edges = explore(result, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
            if (edges.length === 0 || sideOf(result, origin, across) <= 0) continue;
            return gapFill === OffsetGapFill.Linear ? chorded(maker, wire, edges) : edges;
        } catch (e) {
            continue;
        } finally {
            maker.delete();
        }
    }
    throw new KernelError("The offset doesn't fit in the face");
}

// How far across the nearest point of the shape to `origin` is.
function sideOf(shape: Shape, origin: CartPoint3D, across: Vector3D) {
    const vertex = new oc.BRepBuilderAPI_MakeVertex(gpPnt(origin)).Vertex();
    const nearest = new oc.BRepExtrema_DistShapeShape(vertex, shape);
    const p = nearest.IsDone() && nearest.NbSolution() > 0 ? cart(nearest.PointOnShape2(1)) : origin;
    nearest.delete();
    return dot(new Vector3D(p.x - origin.x, p.y - origin.y, p.z - origin.z), across);
}

// The offset with the arcs it put round the corners of the wire replaced by straight lines.
function chorded(maker: any, wire: Shape, edges: Shape[]): Shape[] {
    const arcs: Shape[] = [];
    for (const vertex of explore(wire, oc.TopAbs_ShapeEnum.TopAbs_VERTEX)) {
        const generated = new oc.NCollection_List_TopoDS_Shape(maker.Generated(vertex));
        while (!generated.IsEmpty()) {
            arcs.push(generated.First());
            generated.RemoveFirst();
        }
        generated.delete();
    }
    return edges.flatMap(e => {
        if (!arcs.some(a => a.IsSame(e))) return [e];
        const [start, end] = endsOf(e);
        return segmentEdge(start.point, end.point);
    });
}

// The two ends of an edge, each with the direction leading out of the edge there.
function endsOf(edge: Shape): { point: CartPoint3D, out: Vector3D }[] {
    const c = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(edge));
    const p = new oc.gp_Pnt(), v = new oc.gp_Vec();
    c.D1(c.FirstParameter(), p, v);
    const start = { point: cart(p), out: normalized(vec(v.Reversed())) };
    c.D1(c.LastParameter(), p, v);
    const end = { point: cart(p), out: normalized(vec(v)) };
    p.delete(); v.delete(); c.delete();
    return [start, end];
}

// Straight extensions of an open offset from its free ends, along the tangent there, as far as the face goes.
function extensions(edges: Shape[], face: Face): Shape[] {
    const ends = edges.flatMap(endsOf);
    const free = ends.filter(e => ends.filter(o => o.point.distanceTo(e.point) < 1e-6).length === 1);
    const result: Shape[] = [];
    for (const { point, out } of free) {
        const L = reach(face.solid.GetCube(), point);
        const far = new CartPoint3D(point.x + out.x * L, point.y + out.y * L, point.z + out.z * L);
        const [ray] = segmentEdge(point, far);
        const pieces = explore(split([ray], [face.shape]), oc.TopAbs_ShapeEnum.TopAbs_EDGE)
            .map(piece => endsOf(piece).map(e => e.point).sort((a, b) => a.distanceTo(point) - b.distanceTo(point)))
            .sort(([a], [b]) => a.distanceTo(point) - b.distanceTo(point));
        // From the end outward, as long as the ray stays on the face
        let reached: CartPoint3D | undefined;
        for (const [a, b] of pieces) {
            const middle = new CartPoint3D((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
            if (distanceToShape(middle, face.shape) > 1e-6) break;
            reached = b;
        }
        if (reached !== undefined) result.push(...segmentEdge(point, reached));
    }
    return result;
}
