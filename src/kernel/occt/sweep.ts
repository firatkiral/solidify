// Revolution, loft and sweep (evolution) of planar profiles.

import { Contour, Curve, LineSegment } from './curve2d';
import { ConeSpiral, curve2dTo3d, Curve3D, TrimmedCurve3D } from './curve3d';
import { Axis3D, CartPoint3D, cross, dot, normalized, Placement3D, Vector3D } from './math';
import { EvolutionValues, LoftedValues, RevolutionValues, SweptData } from './misc';
import { oc } from './occt';
import { offsetBand } from './offset';
import { correctRegions } from './regions';
import { boolean, capFaces, cart, checked, explore, faceOfRegion, gpDir, gpPnt, hasThickness, KernelError, occ, offsetWire2d, orient, PlaneSpec, Shape, Solid, solidOf, sweptProfile, thickenSheet, thinShape, unionAll, vec, wallFaces, wireOf2d, wireOf3d } from './solid';
import { OperationType } from './constants';

const TWO_PI = 2 * Math.PI;

// The plane of a planar face, or of the face bounded by a planar wire.
function planeOfShape(shape: Shape): PlaneSpec {
    let face: Shape;
    const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    if (ex.More()) face = oc.TopoDS.Face(ex.Current());
    else {
        const maker = new oc.BRepBuilderAPI_MakeFace(oc.TopoDS.Wire(shape), true);
        if (!maker.IsDone()) { maker.delete(); ex.delete(); throw new KernelError("The end of the sweep is not planar") }
        face = maker.Face();
        maker.delete();
    }
    ex.delete();
    const adaptor = new oc.BRepAdaptor_Surface(face, true);
    if (adaptor.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) { adaptor.delete(); throw new KernelError("The end of the sweep is not planar") }
    const ax = adaptor.Plane().Position();
    const result = { origin: cart(ax.Location()), normal: vec(ax.Direction()) };
    adaptor.delete();
    return result;
}

function segmentsOf(curve: Curve): Curve[] {
    const copy = curve.Duplicate() as Curve;
    return copy instanceof Contour ? copy.segments : [copy];
}

function closedContour(segments: Curve[]): Contour {
    const contour = new Contour(segments.filter(s => {
        const a = s.GetLimitPoint(1), b = s.GetLimitPoint(2);
        return !(s instanceof LineSegment) || Math.hypot(a.x - b.x, a.y - b.y) > 1e-9;
    }), true);
    contour.InitClosed(true);
    return contour;
}

// Closes an open revolution profile: with a straight segment between its ends (torus), or down to the axis (sphere).
function closeProfile(curve: Curve, placement: Placement3D, axis: Axis3D, shape: number): Contour {
    const p0 = curve.GetLimitPoint(1), p1 = curve.GetLimitPoint(2);
    if (shape === 0) return closedContour([...segmentsOf(curve), new LineSegment(p1, p0)]);
    const dir = normalized(axis.direction);
    const o = axis.origin;
    if (Math.abs(dot(dir, placement.axisZ)) > 1e-9 || Math.abs(placement.distance(o)) > 1e-6) {
        throw new KernelError("To revolve an open curve into a sphere-like solid, the axis must lie in the plane of the curve");
    }
    const foot = (p: { x: number, y: number }) => {
        const q = placement.point3d(p);
        const t = dot(new Vector3D(q.x - o.x, q.y - o.y, q.z - o.z), dir);
        return placement.point2d(new CartPoint3D(o.x + dir.x * t, o.y + dir.y * t, o.z + dir.z * t));
    };
    const f0 = foot(p0), f1 = foot(p1);
    return closedContour([...segmentsOf(curve), new LineSegment(p1, f1), new LineSegment(f1, f0), new LineSegment(f0, p0)]);
}

export function revolve(data: SweptData, axis: Axis3D, params: RevolutionValues): Solid {
    const a = -params.side2.scalarValue, b = params.side1.scalarValue;
    let from = Math.min(a, b), angle = Math.abs(b - a);
    if (angle < 1e-9) throw new KernelError("Revolution angle is zero");
    const full = angle >= TWO_PI - 1e-9;
    if (full) { from = 0; angle = TWO_PI }
    const thin = hasThickness(params);
    const dir = normalized(axis.direction);
    return occ("Revolution", () => {
        const ax1 = new oc.gp_Ax1(gpPnt(axis.origin), gpDir(dir));
        const revol = (shape: Shape) => {
            if (from !== 0) {
                const trsf = new oc.gp_Trsf();
                trsf.SetRotation(ax1, from);
                const t = new oc.BRepBuilderAPI_Transform(shape, trsf, true, false);
                shape = t.Shape();
                t.delete(); trsf.delete();
            }
            const maker = new oc.BRepPrimAPI_MakeRevol(shape, ax1, angle, false);
            const result = maker.Shape();
            maker.delete();
            return result;
        };

        // A non-planar curve can only become a thin wall.
        if (data.curve3d !== undefined && !data.curve3d.IsPlanar()) {
            if (!thin) throw new KernelError("Only planar profiles can be revolved into solids; give the revolution a thickness to make a wall");
            return new Solid(checked(thickenSheet(revol(wireOf3d(data.curve3d)), params.thickness1, params.thickness2), "Revolution"));
        }

        const { regions, open, placement } = sweptProfile(data, "revolved");
        // A profile on both sides of an axis in its plane would revolve into a self-intersecting solid.
        const inPlane = Math.abs(dot(dir, placement.axisZ)) < 1e-9 && Math.abs(placement.distance(axis.origin)) < 1e-6;
        if (inPlane && !thin) {
            const o = axis.origin;
            let lo = 0, hi = 0;
            for (const contour of regions.flatMap(r => r.contours)) {
                for (const p of contour.polyline(0)) {
                    const q = placement.point3d(p);
                    const side = dot(cross(dir, new Vector3D(q.x - o.x, q.y - o.y, q.z - o.z)), placement.axisZ);
                    lo = Math.min(lo, side); hi = Math.max(hi, side);
                }
            }
            if (lo < -1e-6 && hi > 1e-6) throw new KernelError("The profile crosses the axis of revolution");
        }
        const solidOfRegions = (rs: typeof regions) => orient(unionAll(rs.map(r => revol(faceOfRegion(r, placement)))));
        const parts: Shape[] = [];
        for (const region of regions) {
            const face = faceOfRegion(region, placement);
            // A thin-walled revolution: the band around the profile's boundary, revolved.
            const faces = thin ? wallFaces(face, params.thickness1, params.thickness2) : [face];
            parts.push(...faces.map(f => orient(revol(f))));
        }
        for (const curve of open) {
            if (thin) {
                // A thin-walled revolution of an open curve: the band around the curve, revolved. (OCCT cannot thicken
                // the revolved sheet itself where the curve ends on the axis, at a pole of the sheet.)
                const hi = Math.max(params.thickness1, -params.thickness2), lo = Math.min(params.thickness1, -params.thickness2);
                const band = offsetBand(curve2dTo3d(curve, placement), lo, hi, placement, inPlane ? axis : undefined);
                const maker = new oc.BRepBuilderAPI_MakeFace(wireOf3d(band), true);
                if (!maker.IsDone()) { maker.delete(); throw new KernelError("The thickness is too large for this profile") }
                const face = maker.Face();
                maker.delete();
                parts.push(orient(revol(face)));
            }
            else parts.push(solidOfRegions(correctRegions([closeProfile(curve, placement, axis, params.shape)])));
        }
        const result = unionAll(parts);
        try { return new Solid(checked(result, "Revolution")) }
        catch (e) {
            if (e instanceof KernelError && /not a valid solid/.test(e.message)) throw new KernelError("Revolution failed: the profile may cross the axis");
            throw e;
        }
    });
}

export function loft(placements: Placement3D[], contours: Contour[], spine: Curve3D | null, params: LoftedValues): Solid {
    if (contours.length < 2) throw new KernelError("Lofting needs at least two profiles");
    const closedProfiles = contours.every(c => c.IsClosed());
    const openProfiles = contours.every(c => !c.IsClosed());
    if (!closedProfiles && !openProfiles) throw new KernelError("Loft profiles must be all closed or all open");
    const thin = hasThickness(params);
    if (openProfiles && !thin) throw new KernelError("Lofting open curves into surfaces is not implemented by the OCCT kernel; give the loft a thickness to make a wall");
    return occ("Loft", () => {
        const wires = contours.map((c, i) => wireOf2d(c, placements[i]));
        let shape: Shape;
        let ends: PlaneSpec[] = [];
        if (spine !== null) {
            const maker = new oc.BRepOffsetAPI_MakePipeShell(wireOf3d(spine));
            maker.SetMode(false);
            for (const w of wires) maker.Add(w, false, false);
            maker.Build(new oc.Message_ProgressRange());
            if (!maker.IsDone()) { maker.delete(); throw new KernelError("Loft along the spine failed") }
            if (closedProfiles) maker.MakeSolid();
            shape = maker.Shape();
            if (!spine.IsClosed()) ends = [planeOfShape(maker.FirstShape()), planeOfShape(maker.LastShape())];
            maker.delete();
        } else {
            if (params.closed && wires.length < 3) throw new KernelError("A closed loft needs at least three profiles");
            const maker = new oc.BRepOffsetAPI_ThruSections(closedProfiles, false, 1e-6);
            for (const w of wires) maker.AddWire(w);
            if (params.closed) maker.AddWire(wires[0]);
            maker.CheckCompatibility(true);
            maker.Build(new oc.Message_ProgressRange());
            if (!maker.IsDone()) { maker.delete(); throw new KernelError("Loft failed") }
            shape = maker.Shape();
            maker.delete();
            if (!params.closed) ends = [placements[0], placements[placements.length - 1]].map(p => ({ origin: p.origin, normal: p.axisZ }));
        }
        if (openProfiles) return new Solid(checked(thickenSheet(shape, params.thickness1, params.thickness2), "Loft"));
        let solid = solidOf(shape);
        if (thin) {
            try {
                solid = checked(thinShape(solid, capFaces(solid, ends), params.thickness1, params.thickness2), "Loft");
            } catch (e) {
                // Where OCCT cannot offset the lofted surface, loft the profiles' offsets instead (the wall is then measured in the profiles' planes).
                const hi = Math.max(params.thickness1, -params.thickness2), lo = Math.min(params.thickness1, -params.thickness2);
                const outer = loftWires(wires.map(w => offsetWire2d(w, hi)), spine, params.closed);
                const inner = lo < -1e-12 || lo > 1e-12 ? loftWires(wires.map(w => offsetWire2d(w, lo)), spine, params.closed) : solid;
                solid = boolean(outer, inner, OperationType.Difference);
            }
        }
        return new Solid(checked(solid, "Loft"));
    });
}

function loftWires(wires: Shape[], spine: Curve3D | null, closed: boolean): Shape {
    if (spine !== null) {
        const maker = new oc.BRepOffsetAPI_MakePipeShell(wireOf3d(spine));
        maker.SetMode(false);
        for (const w of wires) maker.Add(w, false, false);
        maker.Build(new oc.Message_ProgressRange());
        if (!maker.IsDone()) { maker.delete(); throw new KernelError("Loft along the spine failed") }
        maker.MakeSolid();
        const shape = maker.Shape();
        maker.delete();
        return solidOf(shape);
    }
    const maker = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
    for (const w of wires) maker.AddWire(w);
    if (closed) maker.AddWire(wires[0]);
    maker.CheckCompatibility(true);
    maker.Build(new oc.Message_ProgressRange());
    if (!maker.IsDone()) { maker.delete(); throw new KernelError("Loft failed") }
    const shape = maker.Shape();
    maker.delete();
    return solidOf(shape);
}

// Sweeps planar profiles along a spine. Parallel keeps the profile parallel to itself, keeping-angle keeps its angle to
// the spine, and orthogonal first turns it perpendicular to the spine.
export function evolution(data: SweptData, spine: Curve3D, params: EvolutionValues): Solid {
    const { regions, open, placement } = sweptProfile(data, "swept");
    const thin = hasThickness(params);
    if (open.length > 0 && !thin) throw new KernelError("Sweeping open curves into surfaces is not implemented by the OCCT kernel; give the sweep a thickness to make a wall");
    return occ("Sweep", () => {
        const spineWire = wireOf3d(spine);
        // Orthogonal: turn the profile about the start of the spine until it is perpendicular to it.
        let turn: Shape | undefined;
        if (params.mode === 'orthogonal') {
            const start = spine.PointOn(spine.tmin), tangent = spine.Tangent(spine.tmin), n = placement.axisZ;
            const axis = cross(n, tangent);
            const sin = Math.hypot(axis.x, axis.y, axis.z), cos = dot(n, tangent);
            if (sin > 1e-9 || cos < 0) {
                turn = new oc.gp_Trsf();
                const direction = sin > 1e-9 ? normalized(axis) : placement.axisX;
                turn.SetRotation(new oc.gp_Ax1(gpPnt(start), gpDir(direction)), Math.atan2(sin, cos));
            }
        }
        const turned = (shape: Shape) => {
            if (turn === undefined) return shape;
            const t = new oc.BRepBuilderAPI_Transform(shape, turn, true, false);
            const result = t.Shape();
            t.delete();
            return result;
        };
        // The corrected Frenet frame avoids flipping where the spine straightens. Along a helix the Frenet frame is the one
        // that turns with it about its axis, keeping e.g. a thread's profile in the axial plane; the corrected one drifts
        // away from it, and fails on longer helices. Elsewhere the Frenet frame is the fallback when the corrected one fails.
        const helix = spine instanceof ConeSpiral || (spine instanceof TrimmedCurve3D && spine.basis instanceof ConeSpiral);
        const sweepWire = (wire: Shape, solid: boolean) => {
            const build = (frenet: boolean) => {
                const maker = new oc.BRepOffsetAPI_MakePipeShell(spineWire);
                if (params.mode === 'parallel') maker.SetMode(new oc.gp_Ax2(gpPnt(placement.origin), gpDir(placement.axisZ), gpDir(placement.axisX)));
                else maker.SetMode(frenet);
                maker.SetTransitionMode(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner);
                maker.Add(turned(wire), false, false);
                maker.Build(new oc.Message_ProgressRange());
                if (!maker.IsDone()) { maker.delete(); return undefined }
                if (solid) maker.MakeSolid();
                const shape = maker.Shape();
                maker.delete();
                return shape;
            };
            const shape = build(helix) ?? (params.mode !== 'parallel' && !helix ? build(true) : undefined);
            if (shape === undefined) throw new KernelError("Sweep failed: the profile may intersect itself along the spine");
            return solid ? solidOf(shape) : shape;
        };
        // A face is swept as its outer boundary minus its holes.
        const sweepFace = (face: Shape) => {
            const outer = oc.BRepTools.OuterWire(oc.TopoDS.Face(face));
            let solid = sweepWire(outer, true);
            for (const w of explore(face, oc.TopAbs_ShapeEnum.TopAbs_WIRE)) {
                if (!w.IsSame(outer)) solid = boolean(solid, sweepWire(w, true), OperationType.Difference);
            }
            return solid;
        };
        const parts: Shape[] = [];
        for (const region of regions) {
            const face = faceOfRegion(region, placement);
            // A thin-walled sweep: the band around the profile's boundary, swept.
            const faces = thin ? wallFaces(face, params.thickness1, params.thickness2) : [face];
            parts.push(...faces.map(sweepFace));
        }
        for (const curve of open) parts.push(thickenSheet(sweepWire(wireOf2d(curve, placement), false), params.thickness1, params.thickness2));
        return new Solid(checked(unionAll(parts), "Sweep"));
    });
}
