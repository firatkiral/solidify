// Every static function module implemented by the OCCT kernel, by its c3d name.

import { ModifyingType, PlaneType, SpaceType } from './constants';
import { Arc, Bezier, Contour, CubicSpline, Curve, Hermit, Line, LineSegment, Nurbs, Polyline } from './curve2d';
import { Arc3D, Bezier3D, ConeSpiral, Contour3D, CubicSpline3D, Curve3D, ExtrusionSurface, Hermit3D, LineSegment3D, Nurbs3D, Plane, PlaneCurve, Polyline3D } from './curve3d';
import { Item } from './base';
import { exportIntoBuffer, importFromBuffer, meshForPrinting } from './exchange';
import { intersectCurves } from './intersect2d';
import { Grid, Model, StepData } from './items';
import { Axis3D, CartPoint, CartPoint3D, cross, dot, FloatPoint3D, normalized, Placement3D, Vector3D } from './math';
import { CrossPoint, EvolutionValues, ExtrusionValues, LoftedValues, MergingFlags, ModifyValues, PointOnCurve, RevolutionValues, SmoothValues, SNameMaker, SweptData, SweptValues, TransformValues } from './misc';
import { buildContours, correctRegions } from './regions';
import { readItems, writeItems } from './serialize';
import { chamfer, CurveEdge, detachParts, draft, EdgeFunction, elementary, extrude, Face, FaceShell, FaceSurface, fillet, intersects, KernelError, occ, offsetFaces, Solid, thinSolid, transformShape, union } from './solid';
import { evolution, loft, revolve } from './sweep';
import { isBlend, moveFaces, refillet, removeBlends, removeFaces } from './features';
import { commonTangents, tangentsFromPoint } from './tangent';
import { contourFillets } from './fillets';
import { offsetPlaneCurve } from './offset';
import { blendCurve } from './blend';
import { extend } from './history';
import { contourSheets, mirrorSolid, ShellCuttingParams, solidCutting, splitFaces, surfaceSheets, symmetrySolid } from './cutting';

export const Mutex = {
    EnterParallelRegion() { },
    ExitParallelRegion() { },
};

export const ActionSolid = {
    ExtrusionSolid(sweptData: SweptData, direction: Vector3D, solid1: Solid | null, solid2: Solid | null, _checkIntersection: boolean, params: ExtrusionValues, _names: SNameMaker, _ns: SNameMaker[]): Solid {
        if (solid1 !== null || solid2 !== null) throw new KernelError("Extruding up to a solid is not implemented by the OCCT kernel");
        return extrude(sweptData, direction, params);
    },

    ExtrusionResult(solid: Solid, _sameShell: number, sweptData: SweptData, direction: Vector3D, params: ExtrusionValues, oType: number, _names: SNameMaker, _ns: SNameMaker[]): Solid {
        const tool = extrude(sweptData, direction, params);
        return union(solid, [tool], oType, new MergingFlags(true, true));
    },

    UnionResult(solid: Solid, _sameShell: number, solids: Solid[], _sameShells: number, oType: number, _checkIntersect: boolean, flags: MergingFlags, _names: SNameMaker, _isArray: boolean) {
        return { result: union(solid, solids, oType, flags), notGluedSolids: [] as Solid[] };
    },

    BooleanResult(solid1: Solid, _sameShell1: number, solid2: Solid, _sameShell2: number, oType: number, flags: MergingFlags, _names: SNameMaker): Solid {
        return union(solid1, [solid2], oType, flags);
    },

    ElementarySolid(points: CartPoint3D[], solidType: number, _names: SNameMaker): Solid {
        return elementary(points, solidType);
    },

    FilletSolid(solid: Solid, _sameShell: number, initCurves: EdgeFunction[], _initBounds: Face[], params: SmoothValues, _names: SNameMaker): Solid {
        return fillet(solid, initCurves, params);
    },

    ChamferSolid(solid: Solid, _sameShell: number, edges: CurveEdge[], params: SmoothValues, _names: SNameMaker): Solid {
        return chamfer(solid, edges, params);
    },

    DetachParts(solid: Solid, _sort: boolean, _names: SNameMaker) {
        const parts = detachParts(solid);
        return { count: parts.length, parts };
    },

    RevolutionSolid(sweptData: SweptData, axis: Axis3D, params: RevolutionValues, _operNames: SNameMaker, _contoursNames: SNameMaker[]): Solid {
        return revolve(sweptData, axis, params);
    },

    LoftedSolid(placements: Placement3D[], contours: Contour[], spine: Curve3D | null, params: LoftedValues, guidePoints: CartPoint3D[] | null, _names: SNameMaker, _ns: SNameMaker[]): Solid {
        if (guidePoints !== null && guidePoints.length > 0) throw new KernelError("Lofting through guide points is not implemented by the OCCT kernel");
        return loft(placements, contours, spine, params);
    },

    EvolutionSolid(sweptData: SweptData, spine: Curve3D, params: EvolutionValues, _operNames: SNameMaker, _contoursNames: SNameMaker[], _spineNames: SNameMaker): Solid {
        return evolution(sweptData, spine, params);
    },

    // A thin-walled solid: outFaces are removed (the openings), the other faces become walls.
    ThinSolid(solid: Solid, _sameShell: number, outFaces: Face[], offFaces: Face[], _offDists: number[], params: SweptValues, _names: SNameMaker, _copyFaceAttrs: boolean): Solid {
        if (offFaces.length > 0) throw new KernelError("Individual wall thicknesses are not implemented by the OCCT kernel");
        return thinSolid(solid, outFaces, params.thickness1, params.thickness2);
    },

    DraftSolid(solid: Solid, _sameShell: number, neutralPlace: Placement3D, angle: number, faces: Face[], _fp: number, reverse: boolean, _names: SNameMaker): Solid {
        return draft(solid, neutralPlace, angle, faces, reverse);
    },

    // The pieces of the solid on either side of a cutting sheet (right side first).
    SolidCutting(solid: Solid, _sameShell: number, params: ShellCuttingParams): Solid[] {
        return solidCutting(solid, params);
    },

    // The solid with the chosen faces divided by contours swept along the placement's Z.
    SplitSolid(solid: Solid, _sameShell: number, place: Placement3D, _sense: number, contours: Contour[], _same: boolean, faces: Face[], flags: MergingFlags, _names: SNameMaker): Solid {
        return splitFaces(solid, contourSheets(place, contours, solid), faces, flags);
    },

    SplitSolidBySpaceItem(solid: Solid, _sameShell: number, items: (FaceSurface | Plane)[], _same: boolean, faces: Face[], flags: MergingFlags, _names: SNameMaker): Solid {
        return splitFaces(solid, surfaceSheets(items, solid), faces, flags);
    },

    // The mirror image of the solid in the placement's XY plane.
    MirrorSolid(solid: Solid, place: Placement3D, _names: SNameMaker): Solid {
        return mirrorSolid(solid, place);
    },

    // The solid cut by the placement's XY plane, with the half behind it (along -Z) glued to its mirror image.
    SymmetrySolid(solid: Solid, _sameShell: number, place: Placement3D, _names: SNameMaker): Solid {
        return symmetrySolid(solid, place);
    },
};

const modifyingNames = Object.fromEntries(Object.entries(ModifyingType).map(([k, v]) => [v, k]));

export const ActionDirect = {
    TransformedSolid(solid: Solid, _sameShell: number, params: TransformValues, _names: SNameMaker): Solid {
        return new Solid(transformShape(solid.shape, params.GetMatrix()));
    },

    FaceModifiedSolid(solid: Solid, _sameShell: number, params: ModifyValues, faces: Face[], _names: SNameMaker): Solid {
        switch (params.way) {
            case ModifyingType.Offset: return offsetFaces(solid, faces, params.direction.x);
            case ModifyingType.Action: return occ("Moving faces", () => moveFaces(solid, faces, params.direction));
            case ModifyingType.Purify: return occ("Removing fillets", () => removeBlends(solid, faces));
            case ModifyingType.Remove: return occ("Removing faces", () => removeFaces(solid, faces));
            case ModifyingType.Fillet: return occ("Changing the fillet", () => refillet(solid, faces, params.direction.x));
        }
        throw new KernelError(`Modifying faces (${modifyingNames[params.way] ?? params.way}) is not implemented by the OCCT kernel`);
    },
};

// Each operation on solids adds itself, as the C3D creator type it stands for, to the history of its results
// (see history.ts): the history of the solid it worked on, plus one record.
const creatorTypes: Record<string, number> = {
    ElementarySolid: 503, ExtrusionSolid: 505, ExtrusionResult: 505, RevolutionSolid: 506, EvolutionSolid: 507,
    LoftedSolid: 508, BooleanResult: 509, UnionResult: 509, SolidCutting: 510, SymmetrySolid: 511,
    ChamferSolid: 514, FilletSolid: 515, ThinSolid: 517, DraftSolid: 518, FaceModifiedSolid: 522,
    TransformedSolid: 525, MirrorSolid: 525, SplitSolid: 531, SplitSolidBySpaceItem: 531,
};

function recordHistory(module: Record<string, any>) {
    for (const [name, type] of Object.entries(creatorTypes)) {
        const operation = module[name];
        if (typeof operation !== 'function') continue;
        module[name] = function (this: unknown, ...args: any[]) {
            const result = operation.apply(this, args);
            const solidsIn = (x: any): Solid[] => x instanceof Solid ? [x] : Array.isArray(x) ? x.filter(y => y instanceof Solid) : [];
            const input = args.find(a => a instanceof Solid) as Solid | undefined;
            const bases = args.flatMap(solidsIn).filter(s => s !== input);
            const outputs: Solid[] = result instanceof Solid ? [result]
                : Array.isArray(result) ? result.filter(r => r instanceof Solid)
                    : result?.result instanceof Solid ? [result.result] : [];
            for (const out of outputs) out.creators = extend(input?.creators ?? [], type, bases, out.shape);
            return result;
        };
    }
}
recordHistory(ActionSolid);
recordHistory(ActionDirect);

export const Action = {
    IsSolidsIntersectionFast(solid1: Solid, solid2: Solid, _names: SNameMaker): boolean {
        return intersects(solid1, solid2);
    },

    // Fillet and chamfer faces: round or flat faces in place of the edge between two planar faces.
    FindFilletFaces(faces: Face[], _accuracy: number): Face[] {
        return faces.filter(isBlend);
    },

    // How far the shell's bounding box reaches in front of (dPlus) and behind (dMinus) the placement's XY plane.
    GetDistanceToCube(place: Placement3D, shell: FaceShell, _findMax?: boolean) {
        const { pmin, pmax } = shell.solid.GetCube();
        let dPlus = 0, dMinus = 0;
        for (const x of [pmin.x, pmax.x]) for (const y of [pmin.y, pmax.y]) for (const z of [pmin.z, pmax.z]) {
            const d = place.distance({ x, y, z });
            dPlus = Math.max(dPlus, d); dMinus = Math.min(dMinus, d);
        }
        return { dPlus, dMinus, isFound: true };
    },
};

export const TriFace = {
    CalculateGrid(face: Face, stepData: StepData, grid: Grid, _dualSeams?: boolean, _quad?: boolean, _fair?: boolean) {
        const data = face.solid.mesh(stepData.GetSag(), stepData.GetAngle()).faces[face.meshIndex];
        if (data !== undefined) grid.set(data.index, data.position, data.normal);
    },
};

function regularPolygon(centre: CartPoint3D, point: CartPoint3D, axisZ: Vector3D, vertexCount: number, describe: boolean): CartPoint3D[] {
    const Z = normalized(axisZ);
    const radial = new Vector3D(point.x - centre.x, point.y - centre.y, point.z - centre.z);
    const along = dot(radial, Z);
    const X0 = new Vector3D(radial.x - along * Z.x, radial.y - along * Z.y, radial.z - along * Z.z);
    let r = Math.hypot(X0.x, X0.y, X0.z);
    const X = normalized(X0), Y = cross(Z, X);
    if (describe) r /= Math.cos(Math.PI / vertexCount);
    const offset = describe ? Math.PI / vertexCount : 0;
    const points = [];
    for (let i = 0; i < vertexCount; i++) {
        const a = offset + 2 * Math.PI * i / vertexCount;
        const c = Math.cos(a) * r, s = Math.sin(a) * r;
        points.push(new CartPoint3D(centre.x + c * X.x + s * Y.x, centre.y + c * X.y + s * Y.y, centre.z + c * X.z + s * Y.z));
    }
    return points;
}

export const ActionCurve3D = {
    SplineCurve(points: CartPoint3D[], closed: boolean, curveType: number): Curve3D {
        switch (curveType) {
            case SpaceType.Polyline3D: return new Polyline3D(points, closed);
            case SpaceType.Hermit3D: return new Hermit3D(points, closed);
            case SpaceType.CubicSpline3D: return new CubicSpline3D(points, closed);
            case SpaceType.Bezier3D: return new Bezier3D(points, closed);
            case SpaceType.Nurbs3D: return new Nurbs3D(points, closed);
        }
        throw new KernelError(`Curves of type ${curveType} are not implemented by the OCCT kernel yet`);
    },

    Segment(point1: CartPoint3D, point2: CartPoint3D): Curve3D {
        return new LineSegment3D(point1, point2);
    },

    PlaneCurve(place: Placement3D, curve: Curve): Curve3D {
        return new PlaneCurve(place, curve, false);
    },

    // A helix around the axis from point0 to point1, starting towards point2, rising `step` per turn; a non-zero angle
    // makes it conical, its radius growing by tan(angle) per unit along the axis.
    SpiralCurve(point0: CartPoint3D, point1: CartPoint3D, point2: CartPoint3D, radius: number, step: number, angle: number, lawCurve: Curve | null, _spiralAxis: boolean): Curve3D {
        if (lawCurve !== null) throw new KernelError("Spirals following a law curve are not implemented by the OCCT kernel");
        const height = point0.distanceTo(point1);
        if (height < 1e-9) throw new KernelError("The spiral's axis has no length");
        if (!(step > 1e-9)) throw new KernelError("The spiral's step must be positive");
        if (!(radius >= 0)) throw new KernelError("The spiral's radius must not be negative");
        if (Math.abs(angle) >= Math.PI / 2 - 1e-9) throw new KernelError("The spiral's angle must be less than 90°");
        const tgAlpha = Math.tan(angle);
        if (radius + tgAlpha * height < 0) throw new KernelError("The spiral's angle makes its radius negative before the end of the axis");
        return ConeSpiral.make(point0, point1, point2, radius, step, tgAlpha);
    },

    // Fewer than 3 vertices makes a circle through the point.
    RegularPolygon(centre: CartPoint3D, point: CartPoint3D, axisZ: Vector3D, vertexCount: number, describe: boolean): Curve3D {
        if (vertexCount < 3) return new Arc3D(centre, point, point, normalized(axisZ), 1);
        return new Polyline3D(regularPolygon(centre, point, axisZ, vertexCount, describe), true);
    },

    CreateContour(curve: Curve3D): Contour3D {
        if (curve instanceof Contour3D) return curve.Duplicate();
        return Contour3D.of([curve.Duplicate()]);
    },

    // Chains curves that touch end to end into contours. A curve that touches the start of a contour is added after
    // reversing the contour, as C3D does, so the contour starts at the far end of its first curve.
    CreateContours(curves: Curve3D[], metricEps: number, _onlySmoothConnected?: boolean): Contour3D[] {
        const remaining = curves.map(c => c.Duplicate());
        const result: Contour3D[] = [];
        const append = (contour: Contour3D, c: Curve3D) => {
            try { contour.AddCurveWithRuledCheck(c, metricEps, true); return true } catch (e) { return false }
        };
        while (remaining.length > 0) {
            const contour = Contour3D.of([remaining.shift()!]);
            let grew = true;
            while (grew && !contour.IsClosed()) {
                grew = false;
                for (const [i, c] of remaining.entries()) {
                    if (!append(contour, c)) {
                        contour.Inverse();
                        if (!append(contour, c)) { contour.Inverse(); continue }
                    }
                    remaining.splice(i, 1);
                    grew = true;
                    break;
                }
            }
            result.push(contour);
        }
        return result;
    },
};

export const ActionSurface = {
    // The surface swept by moving a curve along a vector.
    ExtrusionSurface(curve: Curve3D, direction: Vector3D, _simplify: boolean) {
        return new ExtrusionSurface(curve.Duplicate(), direction.clone());
    },
};

const CONNECTING_FILLET = 0;

export const ActionSurfaceCurve = {
    // Round fillets at the corners of a planar contour; radiuses[i] is for the corner at the end of segment i.
    CreateContourFillets(contour: Contour3D, radiuses: number[], type: number): Curve3D {
        if (type !== CONNECTING_FILLET) throw new KernelError("Only round fillets of contours are implemented by the OCCT kernel");
        return contourFillets(contour, radiuses);
    },

    // The curve moved `dist` to its left within its plane.
    OffsetPlaneCurve(curve: Curve3D, dist: number): Curve3D {
        return offsetPlaneCurve(curve, dist);
    },

    // A Bézier bridge from curve1 at t1 to curve2 at t2 (see blend.ts). For each end: sense is which way along the
    // curve's parameter the bridge heads off, continuity is 0–3 for G0–G3, and tensions are [tension 1, tension 2].
    BlendCurve(curve1: Curve3D, t1: number, sense1: number, continuity1: number, tensions1: number[], curve2: Curve3D, t2: number, sense2: number, continuity2: number, tensions2: number[]): Curve3D {
        return blendCurve(
            { curve: curve1, t: t1, sense: sense1, continuity: continuity1, tension1: tensions1[0], tension2: tensions1[1] },
            { curve: curve2, t: t2, sense: sense2, continuity: continuity2, tension1: tensions2[0], tension2: tensions2[1] });
    },
};

export const ActionCurve = {
    SplineCurve(points: CartPoint[], closed: boolean, curveType: number): Curve {
        switch (curveType) {
            case PlaneType.Polyline: return new Polyline(points, closed);
            case PlaneType.Hermit: return new Hermit(points, closed);
            case PlaneType.CubicSpline: return new CubicSpline(points, closed);
            case PlaneType.Bezier: return new Bezier(points, closed);
            case PlaneType.Nurbs: return new Nurbs(points, closed);
        }
        throw new KernelError(`Planar curves of type ${curveType} are not implemented by the OCCT kernel yet`);
    },

    Segment(point1: CartPoint, point2: CartPoint): Curve {
        return new LineSegment(point1, point2);
    },

    // Fewer than 3 vertices makes a circle through the point.
    RegularPolygon(centre: CartPoint, point: CartPoint, vertexCount: number, describe: boolean): Curve {
        if (vertexCount < 3) {
            const r = Math.hypot(point.x - centre.x, point.y - centre.y);
            const u = { x: (point.x - centre.x) / r, y: (point.y - centre.y) / r };
            return Arc.make(centre, r, r, u, { x: -u.y, y: u.x }, 0, 2 * Math.PI, true);
        }
        const points = regularPolygon(new CartPoint3D(centre.x, centre.y, 0), new CartPoint3D(point.x, point.y, 0), new Vector3D(0, 0, 1), vertexCount, describe);
        return new Polyline(points.map(p => new CartPoint(p.x, p.y)), true);
    },
};

function pairsToResult(pairs: [number, number][]) {
    return { count: pairs.length, result1: pairs.map(p => p[0]), result2: pairs.map(p => p[1]) };
}

export const ActionPoint = {
    // Intersections of coplanar 3D curves (non-coplanar curves are only intersected when both are straight).
    CurveCurveIntersection3D(curve1: Curve3D, curve2: Curve3D, mEps: number) {
        const place = curve1.planeOf() ?? curve2.planeOf() ?? planeOfLines(curve1, curve2);
        if (place === undefined) return pairsToResult(skewLines(curve1, curve2, mEps));
        if (!liesIn(curve1, place, mEps) || !liesIn(curve2, place, mEps)) return pairsToResult([]);
        return pairsToResult(intersectCurves(curve1.to2d(place), curve2.to2d(place), Math.min(mEps, 1e-6)));
    },

    CurveCurveIntersection2D(curve1: Curve, curve2: Curve, _xEpsilon: number, _yEpsilon: number, _touchInclude: boolean, _allowInaccuracy?: boolean) {
        return pairsToResult(intersectCurves(curve1, curve2));
    },
};

function liesIn(curve: Curve3D, place: Placement3D, eps: number) {
    if (!curve.IsBounded()) return Math.abs(place.distance(curve.GetLimitPoint(1))) <= eps && Math.abs(place.distance(curve.GetLimitPoint(2))) <= eps;
    for (const p of curve.polyline(0)) if (Math.abs(place.distance(p)) > Math.max(eps, 1e-6)) return false;
    return true;
}

// The plane through two straight curves, if they are coplanar and not parallel.
function planeOfLines(c1: Curve3D, c2: Curve3D): Placement3D | undefined {
    const a = c1.GetLimitPoint(1), b = c1.GetLimitPoint(2), c = c2.GetLimitPoint(1);
    const d1 = new Vector3D(b.x - a.x, b.y - a.y, b.z - a.z);
    const d2 = c2.Tangent(c2.tmin);
    const n = cross(d1, d2);
    if (Math.hypot(n.x, n.y, n.z) < 1e-12) return undefined;
    const N = normalized(n);
    const offset = dot(new Vector3D(c.x - a.x, c.y - a.y, c.z - a.z), N);
    if (Math.abs(offset) > 1e-6) return undefined;
    return new Placement3D(a, N, normalized(d1), false);
}

function skewLines(c1: Curve3D, c2: Curve3D, eps: number): [number, number][] {
    if (!c1.IsStraight(true) || !c2.IsStraight(true)) return [];
    // Closest points of two lines; report if within eps
    const p = c1.GetLimitPoint(1), q = c2.GetLimitPoint(1);
    const d1 = c1.Tangent(c1.tmin), d2 = c2.Tangent(c2.tmin);
    const w = new Vector3D(p.x - q.x, p.y - q.y, p.z - q.z);
    const b = dot(d1, d2), d = dot(d1, w), e = dot(d2, w);
    const denom = 1 - b * b;
    if (Math.abs(denom) < 1e-12) return [];
    const s = (b * e - d) / denom, t = (e - b * d) / denom;
    const x = new CartPoint3D(p.x + d1.x * s, p.y + d1.y * s, p.z + d1.z * s);
    const y = new CartPoint3D(q.x + d2.x * t, q.y + d2.y * t, q.z + d2.z * t);
    if (x.distanceTo(y) > eps) return [];
    const t1 = c1.nearest(x, false), t2 = c2.nearest(y, false);
    if (c1._PointOn(t1).distanceTo(x) > eps || c2._PointOn(t2).distanceTo(y) > eps) return [];
    return [[t1, t2]];
}

export const CurveTangent = {
    // Lines through a point, tangent to a curve.
    LinePointTangentCurve(pnt: CartPoint, curve: Curve, _lineAsCurve?: boolean): Line[] {
        return tangentsFromPoint(curve, pnt);
    },

    // Lines tangent to two curves, and their points of tangency on the second curve.
    LineTangentTwoCurves(curve1: Curve, curve2: Curve) {
        const { lines, points } = commonTangents(curve1, curve2);
        return { pLine: lines, secondPoint: points };
    },
};

export const CurveEnvelope = {
    IntersectWithAll(selectCurve: Curve, fromCurves: Curve[], self: boolean): CrossPoint[] {
        const result: CrossPoint[] = [];
        for (const other of fromCurves) {
            if (other === selectCurve && !self) continue;
            for (const [t, s] of intersectCurves(selectCurve, other)) {
                result.push(new CrossPoint(selectCurve.PointOn(t), new PointOnCurve(t, selectCurve), new PointOnCurve(s, other)));
            }
        }
        return result;
    },
};

export const ContourGraph = {
    OuterContoursBuilder(curveList: Curve[], _accuracy?: number, _strict?: boolean) {
        return { graph: null, contours: buildContours(curveList) };
    },
};

export const ActionRegion = {
    GetCorrectRegions(contours: Contour[], _sameContours: boolean) {
        return correctRegions(contours);
    },
};

export const MeshGrid = {
    LineGridIntersect(grid: Grid, line: Axis3D) {
        const { origin, direction } = line;
        const t = grid.intersect(origin, direction);
        if (t === undefined) return { intersected: false, crossPoint: new FloatPoint3D(0, 0, 0), tRes: 0 };
        const crossPoint = new FloatPoint3D(origin.x + direction.x * t, origin.y + direction.y * t, origin.z + direction.z * t);
        return { intersected: true, crossPoint, tRes: t };
    },
};

export const Writer = {
    WriteItems(model: Model) { return writeItems(model) },
    ReadItems(memory: Uint8Array) { return readItems(memory) },
};

export const Conversion = {
    ImportFromBuffer(fileName: string, data: Uint8Array) { return importFromBuffer(fileName, data) },
    ExportIntoBuffer(model: Model, fileName: string, units?: 'mm' | 'in') { return exportIntoBuffer(model, fileName, units) },
    MeshForPrinting(items: Item[], tolerance: number, angle: number) { return meshForPrinting(items, tolerance, angle) },
};
