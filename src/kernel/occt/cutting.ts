// Cutting solids with sheets, splitting faces, and mirroring.

import { Contour, Curve } from './curve2d';
import { Plane } from './curve3d';
import { CartPoint, CartPoint3D, Cube, dot, Matrix3D, normalized, Placement3D, Vector3D } from './math';
import { MergingFlags } from './misc';
import { oc } from './occt';
import { cart, checked, edgesOf2d, explore, Face, FaceSurface, gpVec, KernelError, occ, orient, segmentEdge, shapeList, Shape, Solid, solidOf, solidsOf, transformShape, unify, volume as volumeOf, wireOf } from './solid';

// How to cut a solid: by a 2D contour on a placement, swept along the placement's Z (or `direction`), or by a surface.
export class ShellCuttingParams {
    place?: Placement3D;
    contour?: Contour;
    direction?: Vector3D;
    surface?: FaceSurface | Plane;
    part = 0;
    closed = true;
    prolong = 0;

    constructor(...args: any[]) {
        if (args[0] instanceof Placement3D) {
            // (place, contour, sameContour, dir, [part], mergingFlags, cutAsClosed, names)
            this.place = args[0]; this.contour = args[1]; this.direction = args[3];
            if (args.length >= 8) { this.part = args[4]; this.closed = args[6] } else this.closed = args[5];
        } else {
            // (surface, sameSurface, [part], mergingFlags, cutAsClosed, names)
            this.surface = args[0];
            if (args.length >= 6) { this.part = args[2]; this.closed = args[4] } else this.closed = args[3];
        }
    }

    SetSurfaceProlongType(type: number) { this.prolong = type }
    AddSurfaceProlongType(type: number) { this.prolong |= type }
}

// A length that reaches across a box from anywhere near it.
function reach(box: Cube, from: CartPoint3D) {
    const { pmin, pmax } = box;
    const centre = { x: (pmin.x + pmax.x) / 2, y: (pmin.y + pmax.y) / 2, z: (pmin.z + pmax.z) / 2 };
    const diagonal = Math.hypot(pmax.x - pmin.x, pmax.y - pmin.y, pmax.z - pmin.z);
    return 2 * (diagonal + Math.hypot(from.x - centre.x, from.y - centre.y, from.z - centre.z)) + 1;
}

// The contour swept both ways through the box; an open contour is first extended along its end tangents.
function contourSheet(contour: Curve, place: Placement3D, direction: Vector3D | undefined, box: Cube): Shape {
    const L = reach(box, place.origin);
    const edges = edgesOf2d(contour, place);
    if (!contour.IsClosed()) {
        const p3 = (p: { x: number, y: number }) => place.point3d(p);
        const a = contour.GetLimitPoint(1), b = contour.GetLimitPoint(2);
        const ta = contour.Tangent(contour.tmin), tb = contour.Tangent(contour.tmax);
        edges.unshift(...segmentEdge(p3({ x: a.x - ta.x * L, y: a.y - ta.y * L }), p3(a)));
        edges.push(...segmentEdge(p3(b), p3({ x: b.x + tb.x * L, y: b.y + tb.y * L })));
    }
    const wire = wireOf(edges);
    const d = direction !== undefined && Math.hypot(direction.x, direction.y, direction.z) > 1e-12 ? normalized(direction) : place.axisZ;
    const m = new Matrix3D();
    m.Move(new Vector3D(-d.x * L, -d.y * L, -d.z * L));
    const start = transformShape(wire, m);
    const maker = new oc.BRepPrimAPI_MakePrism(start, gpVec(new Vector3D(d.x * 2 * L, d.y * 2 * L, d.z * 2 * L)), false, true);
    const sheet = maker.Shape();
    maker.delete();
    return sheet;
}

// A face's surface (or a plane), extended to reach across the box.
function surfaceSheet(surface: FaceSurface | Plane, box: Cube): Shape {
    if (surface instanceof Plane || surface.face.IsPlanar()) {
        const place = surface instanceof Plane ? surface.GetPlacement() : surface.face.planePlacement();
        const L = reach(box, place.origin);
        const corners = [[-L, -L], [L, -L], [L, L], [-L, L]].map(([u, v]) => place.GetPointFrom(u, v, 0));
        const wire = wireOf(corners.flatMap((p, i) => segmentEdge(p, corners[(i + 1) % 4])));
        const maker = new oc.BRepBuilderAPI_MakeFace(wire, true);
        const face = maker.Face();
        maker.delete();
        return face;
    }
    const face = surface.face;
    const geom = oc.BRep_Tool.Surface(face.shape);
    const bounds = oc.BRepTools.UVBounds(face.shape, 0, 0, 0, 0);
    const L = reach(box, face.GetAnyPointOn().point);
    const extend = (periodic: boolean, period: number, lo: number, hi: number): [number, number] =>
        periodic ? [lo, lo + period] : [lo - L, hi + L];
    const [u1, u2] = extend(geom.IsUPeriodic(), geom.IsUPeriodic() ? geom.UPeriod() : 0, bounds.UMin, bounds.UMax);
    const [v1, v2] = extend(geom.IsVPeriodic(), geom.IsVPeriodic() ? geom.VPeriod() : 0, bounds.VMin, bounds.VMax);
    const maker = new oc.BRepBuilderAPI_MakeFace(geom, u1, u2, v1, v2, 1e-6);
    if (!maker.IsDone()) { maker.delete(); throw new KernelError("Could not extend the cutting surface") }
    const result = maker.Face();
    maker.delete();
    return result;
}

function sheetOf(params: ShellCuttingParams, box: Cube): Shape {
    if (params.surface !== undefined) return surfaceSheet(params.surface, box);
    return contourSheet(params.contour!, params.place!, params.direction, box);
}

function split(shapes: Shape[], tools: Shape[]): Shape {
    const splitter = new oc.BRepAlgoAPI_Splitter();
    splitter.SetArguments(shapeList(shapes));
    splitter.SetTools(shapeList(tools));
    splitter.Build(new oc.Message_ProgressRange());
    if (splitter.HasErrors()) { splitter.delete(); throw new KernelError("Cutting failed") }
    const result = splitter.Shape();
    splitter.delete();
    return result;
}

function centroid(shape: Shape): CartPoint3D {
    const props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
    const c = cart(props.CentreOfMass());
    props.delete();
    return c;
}

// Which side of the cutting sheet a part is on: positive on the left of the contour (looking down its placement's Z),
// or in front of the surface.
function side(params: ShellCuttingParams, p: CartPoint3D): number {
    if (params.surface !== undefined) {
        if (params.surface instanceof Plane) return Math.sign(params.surface.placement.distance(p));
        const { u, v, normal } = params.surface.face.NearPointProjection(p);
        const on = params.surface.face.GetSurface().PointOn(new CartPoint(u, v));
        return Math.sign(dot(new Vector3D(p.x - on.x, p.y - on.y, p.z - on.z), normal));
    }
    const place = params.place!, contour = params.contour!;
    const q = place.PointProjection(p);
    let best = contour.tmin, bd = Infinity;
    const n = 256;
    for (let i = 0; i <= n; i++) {
        const t = contour.tmin + (contour.tmax - contour.tmin) * i / n;
        const c = contour._PointOn(t);
        const d = Math.hypot(c.x - q.x, c.y - q.y);
        if (d < bd) { bd = d; best = t }
    }
    const c = contour._PointOn(best), d = contour._Tangent(best);
    return Math.sign(d.x * (q.y - c.y) - d.y * (q.x - c.x));
}

// The pieces of a solid cut by a sheet: those on the right of the cut first, then those on the left.
export function solidCutting(solid: Solid, params: ShellCuttingParams, flags = new MergingFlags(true, true)): Solid[] {
    return occ("Cutting", () => {
        const box = solid.GetCube();
        const sheet = sheetOf(params, box);
        const parts = solidsOf(split([solid.shape], [sheet]));
        if (parts.length < 2) throw new KernelError("The cut does not divide the solid", 25);
        const sided = parts.map(shape => ({ shape, side: side(params, centroid(shape)) }));
        const ordered = [...sided.filter(p => p.side <= 0), ...sided.filter(p => p.side > 0)];
        const chosen = params.part === 0 ? ordered : ordered.filter(p => Math.sign(params.part) === (p.side > 0 ? 1 : -1));
        return chosen.map(p => new Solid(unify(orient(p.shape), flags)));
    });
}

// The solid with the chosen faces divided where the sheets cross them.
export function splitFaces(solid: Solid, sheets: Shape[], faces: Face[], flags: MergingFlags): Solid {
    return occ("Splitting faces", () => {
        if (faces.length === 0) throw new KernelError("No faces to split");
        const chosen = faces.map(f => f.shape);
        const pieces = explore(split(chosen, sheets), oc.TopAbs_ShapeEnum.TopAbs_FACE);
        const others = solid.GetFaces().filter(f => !faces.includes(f)).map(f => f.shape);
        const sewing = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
        for (const f of [...others, ...pieces]) sewing.Add(f);
        sewing.Perform(new oc.Message_ProgressRange());
        const sewn = sewing.SewedShape();
        sewing.delete();
        const result = solidOf(sewn);
        return new Solid(flags.mergeEdges ? unify(result, new MergingFlags(false, true)) : result);
    });
}

export function contourSheets(place: Placement3D, contours: Contour[], solid: Solid): Shape[] {
    const box = solid.GetCube();
    return contours.map(c => contourSheet(c, place, undefined, box));
}

export function surfaceSheets(items: (FaceSurface | Plane)[], solid: Solid): Shape[] {
    const box = solid.GetCube();
    return items.map(s => surfaceSheet(s, box));
}

// The reflection in the XY plane of a placement.
export function mirrorMatrix(place: Placement3D): Matrix3D {
    const n = normalized(place.axisZ), o = place.origin;
    const k = 2 * dot(new Vector3D(o.x, o.y, o.z), n);
    return Matrix3D.fromRows([
        [1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, 0],
        [-2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, 0],
        [-2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, 0],
        [k * n.x, k * n.y, k * n.z, 1],
    ]);
}

export function mirrorSolid(solid: Solid, place: Placement3D): Solid {
    return new Solid(orient(transformShape(solid.shape, mirrorMatrix(place))));
}

// The part of the solid behind the placement's XY plane (along -Z, the side C3D keeps), glued to its mirror image.
// The half is the solid's intersection with a box behind the plane: splitting along the plane fails when the plane
// runs along a seam of the solid (e.g. through the poles of a sphere).
export function symmetrySolid(solid: Solid, place: Placement3D): Solid {
    return occ("Symmetry", () => {
        const L = reach(solid.GetCube(), place.origin);
        const corners = [[-L, -L], [L, -L], [L, L], [-L, L]].map(([u, v]) => place.GetPointFrom(u, v, 0));
        const face = new oc.BRepBuilderAPI_MakeFace(wireOf(corners.flatMap((p, i) => segmentEdge(p, corners[(i + 1) % 4]))), true).Face();
        const Z = place.axisZ;
        const back = new oc.BRepPrimAPI_MakePrism(face, gpVec(new Vector3D(-Z.x * L, -Z.y * L, -Z.z * L)), false, true).Shape();
        const half = booleanOf(new oc.BRepAlgoAPI_Common(solid.shape, orient(back), new oc.Message_ProgressRange()));
        if (solidsOf(half).length === 0 || Math.abs(volumeOf(half)) < 1e-9) throw new KernelError("Nothing of the solid is on the kept side of the symmetry plane", 25);
        if (Math.abs(volumeOf(half) - Math.abs(volumeOf(solid.shape))) < 1e-9 * Math.max(1, Math.abs(volumeOf(solid.shape)))) {
            throw new KernelError("The symmetry plane does not cut the solid", 25);
        }
        const mirrored = orient(transformShape(half, mirrorMatrix(place)));
        const result = unify(booleanOf(new oc.BRepAlgoAPI_Fuse(half, mirrored, new oc.Message_ProgressRange())), new MergingFlags(true, true));
        return new Solid(checked(result, "Symmetry"));
    });
}

function booleanOf(op: any): Shape {
    if (op.HasErrors()) { op.delete(); throw new KernelError("Symmetry failed") }
    const result = op.Shape();
    op.delete();
    return result;
}
