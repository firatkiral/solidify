import { Arc, Contour, Curve, EPS, LineSegment, P2, polygonArea, Prim, Region, Spline, TrimmedCurve, trimPrims } from './curve2d';
import { intersectCurves } from './intersect2d';

// Builds the planar arrangement of a set of curves and returns its bounded faces as closed contours
// (counterclockwise). Holes of each face (other connected groups of curves nested inside it) are
// remembered for GetCorrectRegions.

const holesOf = new WeakMap<Contour, Contour[]>();

type Piece = { curve: Curve, ta: number, tb: number, va: number, vb: number };
type HalfEdge = { piece: Piece, forward: boolean, from: number, to: number, angle: number, chord: number, twin?: HalfEdge, next?: HalfEdge, visited: boolean };

const VERTEX_EPS = EPS * 10;

export function buildContours(curves: Curve[]): Contour[] {
    // 1. Split every curve at its intersections with all the others (and itself).
    const splits = curves.map(() => new Set<number>());
    for (let i = 0; i < curves.length; i++) {
        for (let j = i; j < curves.length; j++) {
            const pairs = intersectCurves(curves[i], curves[j]);
            for (const [t, s] of pairs) { splits[i].add(t); splits[j].add(s) }
        }
    }

    // 2. Pieces between consecutive split parameters, with endpoints merged into shared vertices.
    const vertices: P2[] = [];
    const vertexAt = (p: P2) => {
        for (const [i, v] of vertices.entries()) if (Math.hypot(v.x - p.x, v.y - p.y) < VERTEX_EPS) return i;
        vertices.push({ x: p.x, y: p.y });
        return vertices.length - 1;
    };

    let pieces: Piece[] = [];
    for (const [i, curve] of curves.entries()) {
        const closed = curve.IsClosed();
        const ts = [...splits[i]].map(t => closed && t >= curve.tmax - 1e-9 ? curve.tmin : t);
        if (!closed) ts.push(curve.tmin, curve.tmax);
        ts.sort((a, b) => a - b);
        const cuts: number[] = [];
        for (const t of ts) if (cuts.length === 0 || t - cuts[cuts.length - 1] > 1e-9) cuts.push(t);
        const ranges: [number, number][] = [];
        if (closed) {
            // A closed curve with no intersections is a loop through its seam.
            if (cuts.length === 0) ranges.push([curve.tmin, curve.tmax]);
            else {
                for (let k = 0; k < cuts.length - 1; k++) ranges.push([cuts[k], cuts[k + 1]]);
                ranges.push([cuts[cuts.length - 1], cuts[0] + curve.GetPeriod()]);
            }
        } else {
            for (let k = 0; k < cuts.length - 1; k++) ranges.push([cuts[k], cuts[k + 1]]);
        }
        for (const [ta, tb] of ranges) {
            const a = curve.PointOn(ta), b = curve.PointOn(tb);
            if (!curve.IsClosed() && Math.hypot(a.x - b.x, a.y - b.y) < VERTEX_EPS && pieceLength(curve, ta, tb) < VERTEX_EPS) continue;
            pieces.push({ curve, ta, tb, va: vertexAt(a), vb: vertexAt(b) });
        }
    }

    // 3. Drop duplicate pieces (overlapping curves) and dangling pieces.
    pieces = dedupePieces(pieces);
    pieces = pruneDangling(pieces);
    if (pieces.length === 0) return [];

    // 4. Half-edges sorted by angle around each vertex.
    const outgoing = new Map<number, HalfEdge[]>();
    const halfEdges: HalfEdge[] = [];
    for (const piece of pieces) {
        const fwd = makeHalfEdge(piece, true), rev = makeHalfEdge(piece, false);
        fwd.twin = rev; rev.twin = fwd;
        for (const h of [fwd, rev]) {
            halfEdges.push(h);
            if (!outgoing.has(h.from)) outgoing.set(h.from, []);
            outgoing.get(h.from)!.push(h);
        }
    }
    for (const list of outgoing.values()) {
        list.sort((a, b) => Math.abs(a.angle - b.angle) > 1e-9 ? a.angle - b.angle : a.chord - b.chord);
    }
    for (const h of halfEdges) {
        const list = outgoing.get(h.to)!;
        const k = list.indexOf(h.twin!);
        h.next = list[(k - 1 + list.length) % list.length];
    }

    // 5. Faces: cycles of half-edges. Counterclockwise ones are bounded faces, clockwise ones are outer boundaries.
    const faces: { cycle: HalfEdge[], polygon: P2[], area: number }[] = [];
    const boundaries: { cycle: HalfEdge[], polygon: P2[], area: number }[] = [];
    for (const start of halfEdges) {
        if (start.visited) continue;
        const cycle: HalfEdge[] = [];
        let h: HalfEdge | undefined = start;
        let guard = 0;
        while (h !== undefined && !h.visited && guard++ < 100000) {
            h.visited = true;
            cycle.push(h);
            h = h.next;
        }
        if (h !== start) continue;
        const polygon = cyclePolygon(cycle);
        const area = polygonArea(polygon);
        if (Math.abs(area) < EPS * EPS) continue;
        (area > 0 ? faces : boundaries).push({ cycle, polygon, area });
    }

    // 6. Holes: the outer boundary of each connected group lies in the smallest face of another group containing it.
    const component = components(pieces, vertices.length);
    const contours = faces.map(f => cycleContour(f.cycle));
    const holes = faces.map(() => [] as Contour[]);
    for (const boundary of boundaries) {
        const comp = component[boundary.cycle[0].from];
        const probe = boundary.polygon[0];
        let best = -1;
        for (const [i, face] of faces.entries()) {
            if (component[face.cycle[0].from] === comp) continue;
            if (!pointInPolygon(probe, face.polygon)) continue;
            if (best === -1 || face.area < faces[best].area) best = i;
        }
        if (best !== -1) holes[best].push(cycleContour(boundary.cycle));
    }
    for (const [i, c] of contours.entries()) holesOf.set(c, holes[i]);
    return contours;
}

function pieceLength(curve: Curve, ta: number, tb: number) {
    let length = 0;
    let prev = curve.PointOn(ta);
    for (let i = 1; i <= 8; i++) {
        const p = curve.PointOn(ta + (tb - ta) * i / 8);
        length += Math.hypot(p.x - prev.x, p.y - prev.y);
        prev = p;
    }
    return length;
}

function midpoint(piece: Piece) { return piece.curve.PointOn((piece.ta + piece.tb) / 2) }

function dedupePieces(pieces: Piece[]): Piece[] {
    const result: Piece[] = [];
    for (const piece of pieces) {
        const m = midpoint(piece);
        const dup = result.some(other => {
            const sameEnds = (other.va === piece.va && other.vb === piece.vb) || (other.va === piece.vb && other.vb === piece.va);
            if (!sameEnds) return false;
            const n = midpoint(other);
            return Math.hypot(m.x - n.x, m.y - n.y) < VERTEX_EPS;
        });
        if (!dup) result.push(piece);
    }
    return result;
}

function pruneDangling(pieces: Piece[]): Piece[] {
    let current = pieces;
    for (; ;) {
        const degree = new Map<number, number>();
        for (const p of current) {
            degree.set(p.va, (degree.get(p.va) ?? 0) + 1);
            degree.set(p.vb, (degree.get(p.vb) ?? 0) + 1);
        }
        const next = current.filter(p => degree.get(p.va)! > 1 && degree.get(p.vb)! > 1);
        if (next.length === current.length) return next;
        current = next;
    }
}

function makeHalfEdge(piece: Piece, forward: boolean): HalfEdge {
    const { curve, ta, tb } = piece;
    const [t0, t1] = forward ? [ta, tb] : [tb, ta];
    const d = curve.FirstDer(t0);
    const sign = forward ? 1 : -1;
    const angle = Math.atan2(sign * d.y, sign * d.x);
    const origin = curve.PointOn(t0);
    const near = curve.PointOn(t0 + (t1 - t0) * 1e-3);
    const chord = Math.atan2(near.y - origin.y, near.x - origin.x) - angle;
    return {
        piece, forward,
        from: forward ? piece.va : piece.vb,
        to: forward ? piece.vb : piece.va,
        angle, chord: Math.atan2(Math.sin(chord), Math.cos(chord)),
        visited: false,
    };
}

function cyclePolygon(cycle: HalfEdge[]): P2[] {
    const points: P2[] = [];
    for (const h of cycle) {
        const { curve, ta, tb } = h.piece;
        const n = 16;
        for (let i = 0; i < n; i++) {
            const u = i / n;
            const t = h.forward ? ta + (tb - ta) * u : tb + (ta - tb) * u;
            points.push(curve.PointOn(t));
        }
    }
    return points;
}

// The piece of `curve` between ta and tb as exact segments: line segments, arcs, or trimmed curves.
export function pieceCurves(curve: Curve, ta: number, tb: number, forward: boolean): Curve[] {
    if (curve instanceof Spline) {
        const piece = new TrimmedCurve(curve, ta, tb, 1);
        if (!forward) piece.Inverse();
        return [piece];
    }
    const prims = trimPrims(curve, ta, tb);
    const result = prims.map(primCurve);
    if (!forward) {
        result.reverse();
        for (const c of result) c.Inverse();
    }
    return result;
}

function primCurve(p: Prim): Curve {
    switch (p.kind) {
        case 'seg': return new LineSegment(p.a, p.b);
        case 'arc': return Arc.make(p.c, p.r, p.r, p.u, p.v, p.a0, p.a1, Math.abs(p.a1 - p.a0 - 2 * Math.PI) < 1e-12);
        case 'curve': return new TrimmedCurve(p.curve, p.t0, p.t1, 1);
    }
}

function cycleContour(cycle: HalfEdge[]): Contour {
    const segments: Curve[] = [];
    for (const h of cycle) segments.push(...pieceCurves(h.piece.curve, h.piece.ta, h.piece.tb, h.forward));
    const contour = new Contour(segments, true);
    contour.InitClosed(true);
    return contour;
}

function components(pieces: Piece[], n: number): number[] {
    const parent = [...Array(n).keys()];
    const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]));
    for (const p of pieces) parent[find(p.va)] = find(p.vb);
    return parent.map((_, i) => find(i));
}

export function pointInPolygon(p: P2, polygon: P2[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

// Regions from closed contours: each counterclockwise contour becomes a region; contours nested inside it become its holes.
export function correctRegions(contours: Contour[]): Region[] {
    const known = contours.filter(c => holesOf.has(c));
    if (known.length === contours.length) {
        return contours.map(c => {
            const region = new Region([c, ...holesOf.get(c)!]);
            region.SetCorrect();
            return region;
        });
    }

    // Generic nesting by containment depth.
    const infos = contours.filter(c => c.IsClosed()).map(c => {
        const polygon = c.polyline(0);
        return { contour: c, polygon, area: Math.abs(polygonArea(polygon)) };
    });
    infos.sort((a, b) => b.area - a.area);
    const parent = infos.map(() => -1);
    const depth = infos.map(() => 0);
    for (let i = 0; i < infos.length; i++) {
        for (let j = i - 1; j >= 0; j--) {
            if (pointInPolygon(infos[i].polygon[0], infos[j].polygon)) {
                if (parent[i] === -1 || infos[j].area < infos[parent[i]].area) parent[i] = j;
            }
        }
        depth[i] = parent[i] === -1 ? 0 : depth[parent[i]] + 1;
    }
    const regions = new Map<number, Region>();
    for (let i = 0; i < infos.length; i++) {
        if (depth[i] % 2 === 0) regions.set(i, new Region([infos[i].contour.Duplicate()]));
    }
    for (let i = 0; i < infos.length; i++) {
        if (depth[i] % 2 === 1) regions.get(parent[i])!.contours.push(infos[i].contour.Duplicate());
    }
    const result = [...regions.values()];
    for (const r of result) r.SetCorrect();
    return result;
}
