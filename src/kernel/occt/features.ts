// Direct edits of solids that OCCT has no single operation for: moving faces, offsetting the curved walls of holes
// and bosses, and removing fillets and chamfers.

import { OperationType } from './constants';
import { CartPoint3D, cross, dot, Matrix3D, normalized, Vector3D } from './math';
import { CubicFunction, MergingFlags, SmoothValues } from './misc';
import { oc } from './occt';
import { boolean, cart, checked, compound, distanceToShape, EdgeFunction, explore, Face, faceAt, faceSlab, facesOfWires, fillet, gpDir, gpPnt, KernelError, offsetFace2d, prism, segmentEdge, Shape, Solid, solidsOf, threePlanes, transformShape, unify, vec, wireOf } from './solid';

type Plane = { origin: CartPoint3D, normal: Vector3D };

const sub = (a: { x: number, y: number, z: number }, b: { x: number, y: number, z: number }) => new Vector3D(a.x - b.x, a.y - b.y, a.z - b.z);
const add = (p: CartPoint3D, v: Vector3D, s = 1) => new CartPoint3D(p.x + v.x * s, p.y + v.y * s, p.z + v.z * s);
const scale = (v: Vector3D, s: number) => new Vector3D(v.x * s, v.y * s, v.z * s);

function insideSolid(p: CartPoint3D, shape: Shape): boolean {
    const vertex = new oc.BRepBuilderAPI_MakeVertex(gpPnt(p)).Vertex();
    return solidsOf(shape).some(solid => {
        const dist = new oc.BRepExtrema_DistShapeShape(vertex, solid);
        const result = dist.IsDone() && dist.InnerSolution();
        dist.delete();
        return result;
    });
}

function size(shape: Shape) {
    const box = new oc.Bnd_Box();
    oc.BRepBndLib.Add(shape, box, false);
    const d = Math.hypot(box.GetXMax() - box.GetXMin(), box.GetYMax() - box.GetYMin(), box.GetZMax() - box.GetZMin());
    box.delete();
    return d;
}

// The half of space on the side of the plane that contains `inside`.
function halfSpace(plane: Plane, inside: CartPoint3D): Shape {
    const pln = new oc.gp_Pln(gpPnt(plane.origin), gpDir(plane.normal));
    const face = new oc.BRepBuilderAPI_MakeFace(pln).Face();
    const maker = new oc.BRepPrimAPI_MakeHalfSpace(face, gpPnt(inside));
    const result = maker.Solid();
    maker.delete();
    return result;
}

// Keeps the part of a shape on one side of each plane: the side `side` (+1 or -1) of the plane's normal points to.
function clip(shape: Shape, planes: { plane: Plane, side: number }[]): Shape {
    let result = shape;
    for (const { plane, side } of planes) result = boolean(result, halfSpace(plane, add(plane.origin, plane.normal, side)), OperationType.Intersect);
    return result;
}

const sideOf = (plane: Plane, p: CartPoint3D) => dot(sub(p, plane.origin), plane.normal) > 0 ? 1 : -1;

function planeOf(face: Face): Plane {
    const p = face.planePlacement();
    return { origin: p.origin, normal: p.axisZ };
}

// The faces in `faces` grouped into sets that touch each other.
export function components(faces: Face[]): Face[][] {
    const result: Face[][] = [];
    const remaining = new Set(faces);
    for (const start of faces) {
        if (!remaining.has(start)) continue;
        const group = [start];
        remaining.delete(start);
        for (let i = 0; i < group.length; i++) {
            for (const n of group[i].GetNeighborFaces()) if (remaining.has(n)) { remaining.delete(n); group.push(n) }
        }
        result.push(group);
    }
    return result;
}

// ---- Prism-like features: holes, bosses and pockets whose walls run along one direction ----

type End = { plane: Plane, selected: boolean };
type Feature = { axis: Vector3D, section: Shape, level: CartPoint3D, ends: End[], material: boolean };

// The direction a face runs along (its surface is swept along it), if it is a plane or an extrusion.
function sweepDirection(face: Face): Vector3D | undefined {
    const adaptor = new oc.BRepAdaptor_Surface(face.shape, true);
    try {
        if (adaptor.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Plane) return undefined;
        const b = oc.BRepTools.UVBounds(face.shape, 0, 0, 0, 0);
        const span = (u: number) => sub(cart(adaptor.Value(u, b.VMax)), cart(adaptor.Value(u, b.VMin)));
        const d = span((b.UMin + b.UMax) / 2);
        if (Math.hypot(d.x, d.y, d.z) < 1e-9) return undefined;
        const axis = normalized(d);
        for (const u of [b.UMin, b.UMin + (b.UMax - b.UMin) / 3, b.UMax]) {
            const e = span(u);
            const c = cross(e, axis);
            if (Math.hypot(c.x, c.y, c.z) > 1e-7 * Math.max(1, Math.hypot(e.x, e.y, e.z))) return undefined;
        }
        // Straight along v at the middle too (not a cone or a surface of revolution).
        const mid = cart(adaptor.Value(b.UMin, (b.VMin + b.VMax) / 2)), a = cart(adaptor.Value(b.UMin, b.VMin));
        const c = cross(sub(mid, a), axis);
        if (Math.hypot(c.x, c.y, c.z) > 1e-7 * Math.max(1, Math.hypot(d.x, d.y, d.z))) return undefined;
        return axis;
    } finally {
        adaptor.delete();
    }
}

// Range of a face's points along a direction.
function extent(face: Face, axis: Vector3D): [number, number] {
    const box = new oc.Bnd_Box();
    oc.BRepBndLib.Add(face.shape, box, false);
    let lo = Infinity, hi = -Infinity;
    for (const x of [box.GetXMin(), box.GetXMax()]) for (const y of [box.GetYMin(), box.GetYMax()]) for (const z of [box.GetZMin(), box.GetZMax()]) {
        const t = x * axis.x + y * axis.y + z * axis.z;
        lo = Math.min(lo, t); hi = Math.max(hi, t);
    }
    box.delete();
    // The bounding box is loose for slanted faces; tighten with points on the face.
    const b = oc.BRepTools.UVBounds(face.shape, 0, 0, 0, 0);
    const adaptor = new oc.BRepAdaptor_Surface(face.shape, true);
    let plo = Infinity, phi = -Infinity;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
        const p = cart(adaptor.Value(b.UMin + (b.UMax - b.UMin) * i / 8, b.VMin + (b.VMax - b.VMin) * j / 8));
        if (distanceToShape(p, face.shape) > 1e-7) continue;
        const t = dot(p, axis);
        plo = Math.min(plo, t); phi = Math.max(phi, t);
    }
    adaptor.delete();
    return plo <= phi ? [Math.max(lo, plo), Math.min(hi, phi)] : [lo, hi];
}

// Closed wires from loose edges, joined end to end.
function chain(edges: Shape[]): Shape[] {
    const ends = (e: Shape) => {
        const c = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(e));
        const result = [cart(c.Value(c.FirstParameter())), cart(c.Value(c.LastParameter()))];
        c.delete();
        return result;
    };
    const items = edges.map(e => ({ edge: e, ends: ends(e) }));
    const tol = 1e-6;
    const wires: Shape[] = [];
    while (items.length > 0) {
        const first = items.shift()!;
        const builder = new oc.BRepBuilderAPI_MakeWire();
        builder.Add(oc.TopoDS.Edge(first.edge));
        const start = first.ends[0];
        let end = first.ends[1];
        while (end.distanceTo(start) > tol) {
            const i = items.findIndex(it => it.ends[0].distanceTo(end) < tol || it.ends[1].distanceTo(end) < tol);
            if (i < 0) { builder.delete(); return [] }
            const next = items.splice(i, 1)[0];
            builder.Add(oc.TopoDS.Edge(next.edge));
            end = next.ends[0].distanceTo(end) < tol ? next.ends[1] : next.ends[0];
        }
        if (!builder.IsDone()) { builder.delete(); return [] }
        wires.push(builder.Wire());
        builder.delete();
    }
    return wires;
}

// A point inside a planar face.
function pointInside(face: Shape): CartPoint3D | undefined {
    const props = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(face, props, false, false);
    const centre = cart(props.CentreOfMass());
    props.delete();
    if (distanceToShape(centre, face) < 1e-9) return centre;
    const adaptor = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(face), true);
    const b = oc.BRepTools.UVBounds(oc.TopoDS.Face(face), 0, 0, 0, 0);
    try {
        for (let i = 1; i < 16; i++) for (let j = 1; j < 16; j++) {
            const p = cart(adaptor.Value(b.UMin + (b.UMax - b.UMin) * i / 16, b.VMin + (b.VMax - b.VMin) * j / 16));
            if (distanceToShape(p, face) < 1e-9) return p;
        }
    } finally {
        adaptor.delete();
    }
    return undefined;
}

// Recognises the selected faces as the walls (and possibly ends) of a hole, pocket or boss that runs along one
// direction and is closed off by planar faces at both ends.
function prismFeature(solid: Solid, selected: Face[]): Feature | undefined {
    const curved = selected.find(f => !f.IsPlanar());
    if (curved !== undefined) {
        const axis = sweepDirection(curved);
        return axis === undefined ? undefined : prismFeatureAlong(solid, selected, axis, curved);
    }
    // Only planar faces (a pocket or a block): try the directions shared by pairs of its walls.
    const normals = selected.map(f => f.planePlacement().axisZ);
    const tried: Vector3D[] = [];
    for (let i = 0; i < normals.length; i++) for (let j = i + 1; j < normals.length; j++) {
        const c = cross(normals[i], normals[j]);
        if (Math.hypot(c.x, c.y, c.z) < 1e-6) continue;
        const axis = normalized(c);
        if (tried.some(t => Math.abs(Math.abs(dot(t, axis)) - 1) < 1e-9)) continue;
        tried.push(axis);
        const feature = prismFeatureAlong(solid, selected, axis, selected[i]);
        if (feature !== undefined) return feature;
    }
    return undefined;
}

function prismFeatureAlong(solid: Solid, selected: Face[], axis: Vector3D, curved: Face): Feature | undefined {
    const lateral: Face[] = [], selectedEnds: Face[] = [];
    for (const f of selected) {
        if (f.IsPlanar()) {
            const n = f.planePlacement().axisZ;
            if (Math.abs(dot(n, axis)) < 1e-9) lateral.push(f);
            else selectedEnds.push(f);
        } else {
            const d = sweepDirection(f);
            if (d === undefined || Math.abs(Math.abs(dot(d, axis)) - 1) > 1e-9) return undefined;
            lateral.push(f);
        }
    }
    // The faces where the walls end.
    const endFaces: Face[] = [];
    for (const f of lateral) for (const n of f.GetNeighborFaces()) {
        if (lateral.includes(n) || endFaces.includes(n)) continue;
        if (!n.IsPlanar() || Math.abs(dot(n.planePlacement().axisZ, axis)) < 1e-9) return undefined;
        endFaces.push(n);
    }
    if (endFaces.length === 0) return undefined;
    // Cut the walls where they all exist.
    let lo = -Infinity, hi = Infinity;
    for (const f of lateral) { const [a, b] = extent(f, axis); lo = Math.max(lo, a); hi = Math.min(hi, b) }
    if (!(hi - lo > 1e-6)) return undefined;
    const t = (lo + hi) / 2;
    const anchor = curved.GetAnyPointOn().point;
    const shift = t - dot(anchor, axis);
    const levelPoint = add(anchor, axis, shift);
    const section = new oc.BRepAlgoAPI_Section(compound(lateral.map(f => f.shape)), new oc.gp_Pln(gpPnt(levelPoint), gpDir(axis)), true);
    const edges = explore(section.Shape(), oc.TopAbs_ShapeEnum.TopAbs_EDGE);
    section.delete();
    const wires = chain(edges);
    if (wires.length === 0) return undefined;
    const faces = facesOfWires(wires);
    if (faces.length !== 1) return undefined;
    const inside = pointInside(faces[0]);
    if (inside === undefined) return undefined;
    const ends = endFaces.map(f => ({ plane: planeOf(f), selected: false }));
    for (const f of selectedEnds) ends.push({ plane: planeOf(f), selected: true });
    return { axis, section: faces[0], level: inside, ends, material: insideSolid(inside, solid.shape) };
}

// The feature's volume for a cross-section, bounded by its end planes (each kept on the side the feature was on).
function featureVolume(feature: Feature, section: Shape, ends: Plane[], length: number): Shape {
    const swept = prism(section, feature.axis, -length, length);
    return clip(swept, ends.map((plane, i) => ({ plane, side: sideOf(feature.ends[i].plane, feature.level) })));
}

// Replaces a feature by another version of it: the walls take a new cross-section and the selected ends move.
function rebuildFeature(solid: Solid, feature: Feature, section: Shape, endShift: (end: End) => Vector3D): Solid {
    const length = 4 * size(solid.shape);
    const before = featureVolume(feature, feature.section, feature.ends.map(e => e.plane), length);
    const ends = feature.ends.map(e => ({ origin: add(e.plane.origin, endShift(e)), normal: e.plane.normal }));
    const after = featureVolume(feature, section, ends, length);
    let shape: Shape;
    if (feature.material) {
        const without = boolean(solid.shape, before, OperationType.Difference);
        shape = solidsOf(without).length === 0 ? after : boolean(without, after, OperationType.Union);
    } else {
        shape = boolean(boolean(solid.shape, before, OperationType.Union), after, OperationType.Difference);
    }
    if (solidsOf(shape).length === 0) throw new KernelError("The change removes the whole solid");
    return new Solid(unify(shape, new MergingFlags(true, true)));
}

// Offsets the walls of a hole or boss by d along their normals (a boss grows, a hole shrinks for positive d).
export function offsetFeature(solid: Solid, faces: Face[], d: number): Solid | undefined {
    const feature = prismFeature(solid, faces);
    if (feature === undefined) return undefined;
    const sections = offsetFace2d(feature.section, feature.material ? d : -d);
    if (sections.length !== 1) throw new KernelError("The offset is too large for this face");
    // Selected end faces move along their own normals, which point out of the material.
    return rebuildFeature(solid, feature, sections[0], e => e.selected ? scale(e.plane.normal, d) : new Vector3D(0, 0, 0));
}

// ---- Moving faces ----

// Moves faces by v; their neighbours stretch to follow. Planar faces move along their normals; the walls of holes,
// pockets and bosses move as a whole.
export function moveFaces(solid: Solid, faces: Face[], v: Vector3D): Solid {
    let current = solid;
    for (const group of components(faces)) {
        const targets = group.map(f => f.GetAnyPointOn());
        const found = targets.map(({ point, normal }) => faceAt(current, point, normal));
        if (found.some(f => f === undefined)) throw new KernelError("Moving the faces failed: moving one face consumes another");
        const groupFaces = found as Face[];
        if (groupFaces.every(f => f.IsPlanar())) {
            for (const [i, { point, normal }] of targets.entries()) {
                const face = i === 0 ? groupFaces[0] : faceAt(current, point, normal);
                if (face === undefined) throw new KernelError("Moving the faces failed: moving one face consumes another");
                const d = dot(v, face.planePlacement().axisZ);
                if (Math.abs(d) < 1e-9) continue;
                const slab = faceSlab(current, face, d);
                if (slab === undefined) throw new KernelError("Moving this face is not implemented by the OCCT kernel");
                const result = boolean(current.shape, slab, d > 0 ? OperationType.Union : OperationType.Difference);
                if (solidsOf(result).length === 0) throw new KernelError("Moving the face removes the whole solid");
                current = new Solid(unify(result, new MergingFlags(true, true)));
            }
        } else {
            const feature = prismFeature(current, groupFaces);
            if (feature === undefined) throw new KernelError("Moving these faces is not implemented by the OCCT kernel: select all the walls of a hole, pocket or boss");
            const along = dot(v, feature.axis);
            const across = new Vector3D(v.x - along * feature.axis.x, v.y - along * feature.axis.y, v.z - along * feature.axis.z);
            const m = new Matrix3D();
            m.Move(across);
            const section = transformShape(feature.section, m);
            current = rebuildFeature(current, feature, section, e => e.selected ? v : new Vector3D(0, 0, 0));
        }
    }
    return new Solid(checked(current.shape, "Moving faces"));
}

// ---- Removing fillets and chamfers ----

type Blend = { supports: [Face, Face], corner: { point: CartPoint3D, direction: Vector3D } };

function straightEdgeDirection(edge: { GetSpaceCurve(): any, GetBegPoint(): CartPoint3D, GetEndPoint(): CartPoint3D }): Vector3D | undefined {
    const c = edge.GetSpaceCurve();
    if (!c.IsStraight(true)) return undefined;
    return normalized(sub(edge.GetEndPoint(), edge.GetBegPoint()));
}

// The two planar faces a fillet or chamfer face replaces the edge between.
function blendOf(solid: Solid, face: Face): Blend | undefined {
    const adaptor = new oc.BRepAdaptor_Surface(face.shape, true);
    const type = adaptor.GetType();
    let axis: Vector3D | undefined;
    if (type === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) axis = vec(adaptor.Cylinder().Position().Direction());
    adaptor.delete();
    if (type !== oc.GeomAbs_SurfaceType.GeomAbs_Cylinder && type !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) return undefined;
    // Neighbours along straight edges in the blend's direction.
    const candidates: { face: Face, direction: Vector3D }[] = [];
    for (const edge of solid.faceEdges(face)) {
        const d = straightEdgeDirection(edge);
        if (d === undefined) continue;
        const other = solid.edgeFaces(edge).find(f => f !== face);
        if (other === undefined || !other.IsPlanar()) continue;
        candidates.push({ face: other, direction: d });
    }
    // The supports meet along a line parallel to their edges with the blend.
    const p = face.GetAnyPointOn().point;
    for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i], b = candidates[j];
        if (a.face === b.face) continue;
        if (Math.abs(Math.abs(dot(a.direction, b.direction)) - 1) > 1e-7) continue;
        if (axis !== undefined && Math.abs(Math.abs(dot(a.direction, axis)) - 1) > 1e-7) continue;
        const A = planeOf(a.face), B = planeOf(b.face);
        if (axis === undefined) {
            const n = planeOf(face).normal;
            if (dot(n, A.normal) < 1e-3 || dot(n, B.normal) < 1e-3) continue;
        }
        const n = cross(A.normal, B.normal);
        if (Math.hypot(n.x, n.y, n.z) < 1e-9) continue;
        const direction = normalized(n);
        if (Math.abs(Math.abs(dot(direction, a.direction)) - 1) > 1e-7) continue;
        const point = threePlanes([
            { normal: A.normal, offset: dot(A.normal, A.origin) },
            { normal: B.normal, offset: dot(B.normal, B.origin) },
            { normal: direction, offset: dot(direction, p) },
        ]);
        if (point === undefined) continue;
        return { supports: [a.face, b.face], corner: { point, direction } };
    }
    return undefined;
}

// The volume between a fillet or chamfer face and the sharp edge it replaced, clipped where the edge ended.
function blendWedge(solid: Solid, face: Face, blend: Blend): Shape {
    const { corner: { point: c, direction: t } } = blend;
    const p = face.GetAnyPointOn().point;
    const across = dot(sub(p, c), t);
    // The blend's curve in the cross-section plane through its middle.
    const section = new oc.BRepAlgoAPI_Section(face.shape, new oc.gp_Pln(gpPnt(add(c, t, across)), gpDir(t)), true);
    const edges = explore(section.Shape(), oc.TopAbs_ShapeEnum.TopAbs_EDGE);
    section.delete();
    if (edges.length !== 1) throw new KernelError("Removing this fillet is not implemented by the OCCT kernel");
    const curve = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(edges[0]));
    const s1 = cart(curve.Value(curve.FirstParameter())), s2 = cart(curve.Value(curve.LastParameter()));
    curve.delete();
    const corner = add(c, t, across);
    // The cross-section: the face's curve closed by the two straight lines to the corner.
    const wire = wireOf([edges[0], ...segmentEdge(s2, corner), ...segmentEdge(corner, s1)]);
    const faceMaker = new oc.BRepBuilderAPI_MakeFace(oc.TopoDS.Wire(wire), true);
    if (!faceMaker.IsDone()) { faceMaker.delete(); throw new KernelError("Removing this fillet is not implemented by the OCCT kernel") }
    const crossSection = faceMaker.Face();
    faceMaker.delete();
    const length = 4 * size(solid.shape);
    const swept = prism(crossSection, t, -length, length);
    // Clip where the original sharp edge ended: at the nearest planar face on each side that the edge's line runs
    // into (the face itself may stop short of the line by about the blend's size, where other blends cut it back).
    const reach = 2 * Math.max(corner.distanceTo(s1), corner.distanceTo(s2));
    const here = dot(sub(corner, c), t);
    let before: { plane: Plane, at: number } | undefined, after: { plane: Plane, at: number } | undefined;
    for (const g of solid.GetFaces()) {
        if (g === face || blend.supports.includes(g) || !g.IsPlanar()) continue;
        const plane = planeOf(g);
        const cos = dot(plane.normal, t);
        if (Math.abs(cos) < 1e-7) continue;
        const at = dot(sub(plane.origin, c), plane.normal) / cos;
        const q = add(c, t, at);
        if (distanceToShape(q, g.shape) > reach) continue;
        if (at > here && (after === undefined || at < after.at)) after = { plane, at };
        if (at < here && (before === undefined || at > before.at)) before = { plane, at };
    }
    if (before === undefined || after === undefined) throw new KernelError("Removing this fillet is not implemented by the OCCT kernel: its edge has no flat face at one of its ends");
    const middle = new CartPoint3D((s1.x + s2.x + corner.x) / 3, (s1.y + s2.y + corner.y) / 3, (s1.z + s2.z + corner.z) / 3);
    return clip(swept, [before.plane, after.plane].map(plane => ({ plane, side: sideOf(plane, middle) })));
}

export function isBlend(face: Face): boolean {
    return blendOf(face.solid, face) !== undefined;
}

// Removes faces and heals the solid: the walls of a hole or pocket are filled in, a boss is cut away, and fillets
// and chamfers give way to the sharp edge they replaced.
export function removeFaces(solid: Solid, faces: Face[]): Solid {
    let current = solid;
    for (const group of components(faces)) {
        const found = group.map(f => f.GetAnyPointOn()).map(({ point, normal }) => faceAt(current, point, normal));
        if (found.some(f => f === undefined)) continue;
        const groupFaces = found as Face[];
        const feature = prismFeature(current, groupFaces);
        if (feature !== undefined) {
            const volume = featureVolume(feature, feature.section, feature.ends.map(e => e.plane), 4 * size(current.shape));
            const result = boolean(current.shape, volume, feature.material ? OperationType.Difference : OperationType.Union);
            if (solidsOf(result).length === 0) throw new KernelError("Removing the faces removes the whole solid");
            current = new Solid(unify(result, new MergingFlags(true, true)));
        } else if (groupFaces.every(f => blendOf(current, f) !== undefined)) {
            current = removeBlends(current, groupFaces);
        } else {
            throw new KernelError("Removing these faces is not implemented by the OCCT kernel: select all the walls of a hole, pocket or boss, or fillets and chamfers");
        }
    }
    return new Solid(checked(current.shape, "Removing faces"));
}

// Changes the radius of fillet faces by `delta`: the fillets are removed and the sharp edges filleted again.
export function refillet(solid: Solid, faces: Face[], delta: number): Solid {
    const fillets = faces.map(face => {
        const adaptor = new oc.BRepAdaptor_Surface(face.shape, true);
        const radius = adaptor.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder ? adaptor.Cylinder().Radius() : undefined;
        adaptor.delete();
        const blend = blendOf(solid, face);
        if (radius === undefined || blend === undefined) throw new KernelError("Changing this fillet is not implemented by the OCCT kernel: only round fillets between two flat faces can be changed");
        if (radius + delta <= 0) throw new KernelError("The fillet radius must stay positive");
        return { line: blend.corner, radius: radius + delta };
    });
    let current = removeBlends(solid, faces);
    for (const radius of [...new Set(fillets.map(f => f.radius))]) {
        const lines = fillets.filter(f => f.radius === radius).map(f => f.line);
        const onLine = (p: CartPoint3D) => lines.some(({ point, direction }) => {
            const d = sub(p, point);
            const c = cross(d, direction);
            return Math.hypot(c.x, c.y, c.z) < 1e-6;
        });
        const edges = current.GetEdges().filter(e => e.GetSpaceCurve().IsStraight(true) && onLine(e.GetBegPoint()) && onLine(e.GetEndPoint()));
        if (edges.length === 0) throw new KernelError("Changing the fillet failed: the sharp edge could not be found");
        current = fillet(current, edges.map(e => new EdgeFunction(e, new CubicFunction(1, 1))), new SmoothValues(radius, radius));
    }
    return current;
}

// Removes fillet and chamfer faces whose two neighbours are planar, restoring the sharp edge between them.
export function removeBlends(solid: Solid, faces: Face[]): Solid {
    const targets = faces.map(f => f.GetAnyPointOn());
    let current = solid;
    for (const [i, { point, normal }] of targets.entries()) {
        const face = i === 0 ? faces[0] : faceAt(current, point, normal);
        if (face === undefined) continue; // already filled in by a neighbouring blend
        const blend = blendOf(current, face);
        if (blend === undefined) throw new KernelError("Removing this fillet is not implemented by the OCCT kernel: only fillets and chamfers between two flat faces can be removed");
        const wedge = blendWedge(current, face, blend);
        // A rounded outside edge leaves its wedge outside the solid (fill it); an inside one leaves it inside (cut it).
        const probe = (() => {
            const c = blend.corner.point, p = face.GetAnyPointOn().point;
            const along = dot(sub(p, c), blend.corner.direction);
            const corner = add(c, blend.corner.direction, along);
            return new CartPoint3D((p.x + corner.x) / 2, (p.y + corner.y) / 2, (p.z + corner.z) / 2);
        })();
        const operation = insideSolid(probe, current.shape) ? OperationType.Difference : OperationType.Union;
        const result = boolean(current.shape, wedge, operation);
        if (solidsOf(result).length === 0) throw new KernelError("Removing the fillet removes the whole solid");
        current = new Solid(unify(result, new MergingFlags(true, true)));
    }
    return new Solid(checked(current.shape, "Removing fillets"));
}
