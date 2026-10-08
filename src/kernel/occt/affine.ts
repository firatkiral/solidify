// General affine transformations of solids (non-uniform scaling, shear), which OCCT's gp_Trsf cannot represent.
// Every face is rebuilt: planes stay planes, curved surfaces become B-spline surfaces whose control points are
// transformed (exact, since affine maps preserve NURBS), and edges become transformed B-spline curves.

import { CartPoint3D, Matrix3D } from './math';
import { oc } from './occt';
import { cart, explore, KernelError, orient, Shape } from './solid';


export function affineShape(shape: Shape, m: Matrix3D): Shape {
    const map = (p: any) => { const q = m.applyPoint(cart(p)); return new oc.gp_Pnt(q.x, q.y, q.z) };
    const range = () => new oc.Message_ProgressRange();

    const edges: [Shape, Shape | null][] = [];
    const mapEdge = (e: Shape): Shape | null => {
        for (const [original, image] of edges) if (original.IsSame(e)) return image;
        const edge = oc.TopoDS.Edge(e.Oriented(oc.TopAbs_Orientation.TopAbs_FORWARD));
        const image = oc.BRep_Tool.Degenerated(edge) ? null : new oc.BRepBuilderAPI_MakeEdge(curveImage(edge, map)).Edge();
        edges.push([e, image]);
        return image;
    };
    const wiresOf = (face: Shape) => explore(face, oc.TopAbs_ShapeEnum.TopAbs_WIRE).map(w => {
        // The edges of a wire are not explored end to end; the list form of Add connects them in any order.
        const list = new oc.NCollection_List_TopoDS_Shape();
        for (const e of explore(w, oc.TopAbs_ShapeEnum.TopAbs_EDGE)) {
            const image = mapEdge(e);
            if (image !== null) list.Append(image.Oriented(e.Orientation()));
        }
        const builder = new oc.BRepBuilderAPI_MakeWire();
        builder.Add(list);
        list.delete();
        if (!builder.IsDone()) throw new KernelError("Transforming the solid failed: a boundary could not be rebuilt");
        const wire = builder.Wire();
        builder.delete();
        return wire;
    });

    const faces: Shape[] = [];
    for (const f of explore(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE)) {
        const face = oc.TopoDS.Face(f);
        const forward = oc.TopoDS.Face(face.Oriented(oc.TopAbs_Orientation.TopAbs_FORWARD));
        const adaptor = new oc.BRepAdaptor_Surface(forward, true);
        let image: Shape;
        if (adaptor.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
            // A plane maps to a plane through the images of three of its points.
            const b = oc.BRepTools.UVBounds(forward, 0, 0, 0, 0);
            const p0 = map(adaptor.Value(b.UMin, b.VMin)), p1 = map(adaptor.Value(b.UMax, b.VMin)), p2 = map(adaptor.Value(b.UMin, b.VMax));
            const u = new oc.gp_Vec(p0, p1), v = new oc.gp_Vec(p0, p2);
            const pln = new oc.gp_Pln(new oc.gp_Ax3(p0, new oc.gp_Dir(u.Crossed(v)), new oc.gp_Dir(u)));
            const [outer, ...holes] = wiresOf(forward);
            const builder = new oc.BRepBuilderAPI_MakeFace(pln, outer, true);
            for (const w of holes) builder.Add(w);
            const fix = new oc.ShapeFix_Face(builder.Face());
            builder.delete();
            fix.Perform(range());
            image = fix.Face();
            fix.delete();
        } else {
            const surface = surfaceImage(forward, adaptor, map);
            // Faces bounded only by seams and poles (whole spheres, tori) take the natural bounds of the new surface.
            const faceEdges = explore(forward, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
            const natural = faceEdges.every(e => oc.BRep_Tool.Degenerated(oc.TopoDS.Edge(e)) || faceEdges.filter(x => x.IsSame(e)).length === 2);
            if (natural) {
                image = new oc.BRepBuilderAPI_MakeFace(surface, 1e-7).Face();
            } else {
                const fix = new oc.ShapeFix_Face();
                fix.Init(surface, 1e-7, true);
                for (const w of wiresOf(forward)) fix.Add(w);
                fix.Perform(range());
                image = fix.Face();
                fix.delete();
            }
        }
        adaptor.delete();
        faces.push(face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? image.Reversed() : image);
    }

    const sewing = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
    for (const f of faces) sewing.Add(f);
    sewing.Perform(range());
    const sewn = sewing.SewedShape();
    sewing.delete();
    let shells = explore(sewn, oc.TopAbs_ShapeEnum.TopAbs_SHELL);
    if (shells.length === 0) {
        const builder = new oc.TopoDS_Builder();
        const shell = new oc.TopoDS_Shell();
        builder.MakeShell(shell);
        for (const f of explore(sewn, oc.TopAbs_ShapeEnum.TopAbs_FACE)) builder.Add(shell, f);
        shell.Closed(true);
        builder.delete();
        shells = [shell];
    }
    const solids = shells.map(s => {
        const fix = new oc.ShapeFix_Solid();
        const solid = fix.SolidFromShell(oc.TopoDS.Shell(s));
        fix.delete();
        return orient(solid);
    });
    if (solids.length === 1) return solids[0];
    const builder = new oc.TopoDS_Builder();
    const compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);
    for (const s of solids) builder.Add(compound, s);
    builder.delete();
    return compound;
}

// The edge's curve as a B-spline (exact for every curve type OCCT converts) with its control points transformed.
function curveImage(edge: Shape, map: (p: any) => any) {
    const { returnValue: curve, First: a, Last: b } = oc.BRep_Tool.Curve(edge, 0, 0);
    const bspline = oc.GeomConvert.CurveToBSplineCurve(new oc.Geom_TrimmedCurve(curve, a, b, true, true));
    for (let i = 1; i <= bspline.NbPoles(); i++) bspline.SetPole(i, map(bspline.Pole(i)));
    return bspline;
}

function surfaceImage(face: Shape, adaptor: any, map: (p: any) => any) {
    const b = oc.BRepTools.UVBounds(face, 0, 0, 0, 0);
    if (adaptor.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
        // An exact patch of the cylinder over the face's height, all the way round from where the face starts: its
        // circles are converted the same way as the face's edges, so the edges lie on it with the same parameters.
        const surface = oc.BRep_Tool.Surface(face);
        const Z = cart(adaptor.Cylinder().Position().Direction());
        const margin = (b.VMax - b.VMin) * 0.01;
        const vs = [b.VMin - margin, b.VMax + margin];
        const circle = oc.GeomConvert.CurveToBSplineCurve(new oc.Geom_TrimmedCurve(surface.VIso(vs[0]), b.UMin, b.UMin + 2 * Math.PI, true, true));
        const n = circle.NbPoles(), height = vs[1] - vs[0];
        const poles = new oc.NCollection_Array2_gp_Pnt(1, n, 1, 2);
        const weights = new oc.NCollection_Array2_double(1, n, 1, 2);
        for (let i = 1; i <= n; i++) {
            const p = cart(circle.Pole(i));
            const top = new CartPoint3D(p.x + Z.x * height, p.y + Z.y * height, p.z + Z.z * height);
            poles.SetValue(i, 1, map(circle.Pole(i)));
            poles.SetValue(i, 2, map(new oc.gp_Pnt(top.x, top.y, top.z)));
            weights.SetValue(i, 1, circle.Weight(i));
            weights.SetValue(i, 2, circle.Weight(i));
        }
        const vKnots = array1(vs), vMults = array1i([2, 2]);
        return periodic(new oc.Geom_BSplineSurface(poles, weights, circle.Knots(), vKnots, circle.Multiplicities(), vMults, circle.Degree(), 1, false, false));
    }
    try {
        // Bounded surfaces (spheres, tori, B-splines, surfaces of revolution) convert exactly.
        const bspline = oc.GeomConvert.SurfaceToBSplineSurface(oc.BRep_Tool.Surface(face));
        for (let i = 1; i <= bspline.NbUPoles(); i++) for (let j = 1; j <= bspline.NbVPoles(); j++) bspline.SetPole(i, j, map(bspline.Pole(i, j)));
        return periodic(bspline);
    } catch (e) {
        // Unbounded ones (cones, extrusions): a close approximation over the face.
        const nu = 33, nv = 17;
        const grid = new oc.NCollection_Array2_gp_Pnt(1, nu, 1, nv);
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
            grid.SetValue(i + 1, j + 1, map(adaptor.Value(b.UMin + (b.UMax - b.UMin) * i / (nu - 1), b.VMin + (b.VMax - b.VMin) * j / (nv - 1))));
        }
        const fit = new oc.GeomAPI_PointsToBSplineSurface(grid, 3, 8, oc.GeomAbs_Shape.GeomAbs_C2, 1e-7);
        return fit.Surface();
    }
}

// Closed surfaces made periodic, so that boundaries projected onto them past the seam stay on the surface.
function periodic(surface: any) {
    try { if (surface.IsUClosed() && !surface.IsUPeriodic()) surface.SetUPeriodic() } catch (e) { }
    try { if (surface.IsVClosed() && !surface.IsVPeriodic()) surface.SetVPeriodic() } catch (e) { }
    return surface;
}

function array1(values: number[]) {
    const a = new oc.NCollection_Array1_double(1, values.length);
    values.forEach((v, i) => a.SetValue(i + 1, v));
    return a;
}

function array1i(values: number[]) {
    const a = new oc.NCollection_Array1_int(1, values.length);
    values.forEach((v, i) => a.SetValue(i + 1, v));
    return a;
}
