import * as THREE from "three";
import c3d from '../../kernel/kernel';
import { GeometryFactory, NoOpError, ValidationError } from '../../command/GeometryFactory';
import { groupBy, MultiGeometryFactory } from '../../command/MultiFactory';
import { DatabaseLike } from "../../editor/DatabaseLike";
import { EditorSignals } from "../../editor/EditorSignals";
import MaterialDatabase from "../../editor/MaterialDatabase";
import { ConstructionPlane, ConstructionPlaneSnap } from "../../editor/snaps/ConstructionPlaneSnap";
import { composeMainName, point2point, unit, vec2vec } from '../../util/Conversion';
import * as visual from '../../visual_model/VisualModel';

export interface OffsetCurveParams {
    distance: number;
}

export interface OffsetImprintParams extends OffsetCurveParams {
    gapFill: c3d.OffsetGapFill;
}

// An offset to make on a face: a curve lying on it, and a point on the curve with the direction across the face to
// offset towards.
type Offset = { curve: c3d.Curve3D, face: c3d.Face, origin: THREE.Vector3, across: THREE.Vector3 };

// Offsets curves across planar faces of a solid and imprints them, dividing the faces with new edges.
abstract class OffsetImprintFactory extends GeometryFactory implements OffsetImprintParams {
    distance = 0;
    gapFill = c3d.OffsetGapFill.Natural;

    protected solid!: visual.Solid;
    protected model!: c3d.Solid;

    // Where the gizmo goes, and the way a positive distance goes from there
    abstract get center(): THREE.Vector3;
    abstract get normal(): THREE.Vector3;

    protected abstract offsets(): Offset[];

    // The curves of the last result, which are its new edges
    private imprinted: c3d.Curve3D[] = [];

    private readonly names = new c3d.SNameMaker(composeMainName(c3d.CreatorType.CuttingSolid, this.db.version), c3d.ESides.SideNone, 0);

    async calculate() {
        const { model, names, gapFill } = this;
        if (this.distance === 0) throw new NoOpError();

        const curves = [];
        const faces = new Set<c3d.Face>();
        for (const { curve, face, origin, across } of this.offsets()) {
            const axis = new c3d.Axis3D(point2point(origin), vec2vec(across, 1));
            const params = new c3d.SurfaceOffsetCurveParams(face, axis, unit(Math.abs(this.distance)), names, gapFill);
            const offset = await c3d.ActionSurfaceCurve.OffsetSurfaceCurve_async(curve, params);
            curves.push(...offset.GetCurves());
            faces.add(face);
        }
        const result = await c3d.ActionSolid.SplitSolidBySpaceItem_async(model, c3d.CopyMode.Copy, curves, false, [...faces], new c3d.MergingFlags(true, true), names);
        this.imprinted = curves;
        return result;
    }

    get originalItem() { return this.solid }

    // The edges of a result that run along the imprinted curves
    newEdges(result: visual.Solid): visual.CurveEdge[] {
        const { imprinted } = this;
        const onImprint = (p: c3d.CartPoint3D) => imprinted.some(curve => {
            const { t } = curve.NearPointProjection(p, false);
            return point2point(curve.PointOn(t)).distanceTo(point2point(p)) < PROBE;
        });
        return [...result.edges].filter(edge => {
            const model = this.db.lookupTopologyItem(edge);
            return [0.25, 0.5, 0.75].every(t => onImprint(model.Point(t)));
        });
    }
}

// Offsets every loop of planar faces into the face (Offset Face Loop).
export class OffsetFaceLoopFactory extends OffsetImprintFactory {
    private models!: c3d.Face[];
    private _center!: THREE.Vector3;
    private _normal!: THREE.Vector3;
    get center() { return this._center }
    get normal() { return this._normal }

    set faces(faces: visual.Face[]) {
        this.solid = faces[0].parentItem;
        this.model = this.db.lookup(this.solid);
        this.models = faces.map(face => this.db.lookupTopologyItem(face));

        // On the longest edge of the first face's outer loop, pointing into the face
        const face = this.models[0];
        const longest = loopEdges(face.GetLoop(0)!).reduce((a, b) => length(b) > length(a) ? b : a);
        this._center = point2point(longest.Point(0.5));
        this._normal = inward(face, longest, 0.5);
    }

    protected offsets() {
        if (this.distance < 0) throw new ValidationError("A face loop is offset into the face");
        const result: Offset[] = [];
        for (const face of this.models) {
            for (let i = 0, l = face.GetLoopsCount(); i < l; i++) {
                const edges = loopEdges(face.GetLoop(i)!);
                if (edges.length === 0) continue;
                const [curve] = c3d.ActionCurve3D.CreateContours(edges.map(e => e.MakeCurve()!), CHAIN_TOLERANCE);
                result.push({ curve, face, origin: point2point(edges[0].Point(0.5)), across: inward(face, edges[0], 0.5) });
            }
        }
        return result;
    }
}

// Offsets chains of edges across one of their faces (Offset Edge). A positive distance goes into the faces that face
// `toward` more (the camera, say), a negative one into the faces on the other side; each edge into its own face there.
export class OffsetEdgeFactory extends OffsetImprintFactory {
    toward = new THREE.Vector3(0, 0, 1);

    private chains!: Chain[];
    private _center!: THREE.Vector3;
    private _normal!: THREE.Vector3;
    get center() { return this._center }
    get normal() { return this._normal }

    set edges(edges: visual.CurveEdge[]) {
        this.solid = edges[0].parentItem;
        this.model = this.db.lookup(this.solid);
        this.chains = chainsOf(edges.map(edge => this.db.lookupTopologyItem(edge)), this.toward);

        // On the middle edge of the first chain, pointing into its face on the positive side
        const chain = this.chains[0];
        const link = chain.links[Math.floor(chain.links.length / 2)];
        const side = link.sides.get(chain.positive);
        if (side === undefined) throw new ValidationError("The edge has no face to offset into");
        this._center = point2point(link.edge.Point(0.5));
        this._normal = side.across;
    }

    protected offsets() {
        const result: Offset[] = [];
        for (const chain of this.chains) {
            const sign = Math.sign(this.distance) * chain.positive;
            for (const run of runsOf(chain, sign)) {
                const edges = run.map(link => link.edge);
                const [curve] = c3d.ActionCurve3D.CreateContours(edges.map(e => e.MakeCurve()!), CHAIN_TOLERANCE);
                const middle = run[Math.floor(run.length / 2)];
                const { face, across } = middle.sides.get(sign)!;
                result.push({ curve, face, origin: point2point(middle.edge.Point(0.5)), across });
            }
        }
        return result;
    }
}

// Faces or edges of several solids, one factory per solid.
export class MultiOffsetImprintFactory extends MultiGeometryFactory<OffsetImprintFactory> implements OffsetImprintParams {
    static faceLoops(db: DatabaseLike, materials: MaterialDatabase, signals: EditorSignals, faces: visual.Face[]) {
        const multi = new MultiOffsetImprintFactory(db, materials, signals);
        multi.factories = [...groupBy('parentItem', faces).values()].map(faces => {
            const factory = new OffsetFaceLoopFactory(db, materials, signals);
            factory.faces = faces;
            return factory;
        });
        return multi;
    }

    static edges(db: DatabaseLike, materials: MaterialDatabase, signals: EditorSignals, edges: visual.CurveEdge[], toward: THREE.Vector3) {
        const multi = new MultiOffsetImprintFactory(db, materials, signals);
        multi.factories = [...groupBy('parentItem', edges).values()].map(edges => {
            const factory = new OffsetEdgeFactory(db, materials, signals);
            factory.toward = toward;
            factory.edges = edges;
            return factory;
        });
        return multi;
    }

    get distance() { return this.factories[0]?.distance ?? 0 }
    set distance(d: number) { for (const factory of this.factories) factory.distance = d }

    get gapFill() { return this.factories[0]?.gapFill ?? c3d.OffsetGapFill.Natural }
    set gapFill(gapFill: c3d.OffsetGapFill) { for (const factory of this.factories) factory.gapFill = gapFill }

    get center() { return this.factories[0].center }
    get normal() { return this.factories[0].normal }

    // The new edges of the results, which come in the order of the factories
    newEdges(results: visual.Solid[]) {
        return this.factories.flatMap((factory, i) => factory.newEdges(results[i]));
    }
}

// How near points count as the same, in the app's units
const PROBE = 1e-3;
const CHAIN_TOLERANCE = unit(1e-4);

function length(edge: c3d.CurveEdge) { return point2point(edge.GetBegPoint()).distanceTo(point2point(edge.Point(0.5))) + point2point(edge.Point(0.5)).distanceTo(point2point(edge.GetEndPoint())) }

function loopEdges(loop: c3d.Loop): c3d.CurveEdge[] {
    const edges = [];
    for (let j = 0, l = loop.GetEdgesCount(); j < l; j++) {
        const edge = loop.GetOrientedEdge(j)!.GetCurveEdge();
        if (edge.IsSeam() || edge.IsPole()) continue;
        edges.push(edge);
    }
    return edges;
}

// Into a face from a point on its boundary edge: along the face, square to the edge. Of the two ways, it is the one a
// step stays nearer the face along; a step out ends as far from the face as it went. The step is well above the
// tolerance of the edge, within which points count as on it.
function inward(face: c3d.Face, edge: c3d.CurveEdge, t: number): THREE.Vector3 {
    const p = point2point(edge.Point(t));
    const tangent = vec2vec(edge.Tangent(t), 1);
    const n = vec2vec(face.NearPointProjection(point2point(p)).normal, 1);
    const w = n.cross(tangent).normalize();
    const step = Math.max(length(edge) / 100, 50 * PROBE);
    const off = (sign: number) => distanceToFace(face, p.clone().addScaledVector(w, sign * step));
    return off(1) <= off(-1) ? w : w.negate();
}

function distanceToFace(face: c3d.Face, q: THREE.Vector3) {
    const { u, v } = face.NearPointProjection(point2point(q));
    return point2point(face.GetSurface().PointOn(new c3d.CartPoint(u, v))).distanceTo(q);
}

// An edge as it runs along a chain, with the faces on its two sides (+1 and -1, the same sides all along the chain)
type Link = { edge: c3d.CurveEdge, forward: boolean, sides: Map<number, { face: c3d.Face, across: THREE.Vector3 }> };
// Edges joined end to end; positive is the side a positive distance goes to
type Chain = { links: Link[], closed: boolean, positive: number };

function chainsOf(edges: c3d.CurveEdge[], toward: THREE.Vector3): Chain[] {
    const ends = (edge: c3d.CurveEdge, forward: boolean) => {
        const [a, b] = [point2point(edge.GetBegPoint()), point2point(edge.GetEndPoint())];
        return forward ? [a, b] : [b, a];
    };
    const remaining = [...edges];
    const chains: Chain[] = [];
    while (remaining.length > 0) {
        const links = [{ edge: remaining.shift()!, forward: true }];
        let grew = true;
        while (grew) {
            grew = false;
            const head = ends(links[0].edge, links[0].forward)[0];
            const tail = ends(links[links.length - 1].edge, links[links.length - 1].forward)[1];
            if (links.length > 1 && head.distanceTo(tail) < PROBE) break;
            for (const [i, edge] of remaining.entries()) {
                const [a, b] = ends(edge, true);
                if (a.distanceTo(tail) < PROBE) links.push({ edge, forward: true });
                else if (b.distanceTo(tail) < PROBE) links.push({ edge, forward: false });
                else if (b.distanceTo(head) < PROBE) links.unshift({ edge, forward: true });
                else if (a.distanceTo(head) < PROBE) links.unshift({ edge, forward: false });
                else continue;
                remaining.splice(i, 1);
                grew = true;
                break;
            }
        }
        const head = ends(links[0].edge, links[0].forward)[0];
        const tail = ends(links[links.length - 1].edge, links[links.length - 1].forward)[1];
        const sided = links.map(({ edge, forward }) => ({ edge, forward, sides: sidesOf(edge, forward) }));
        chains.push({ links: sided, closed: head.distanceTo(tail) < PROBE, positive: positiveSide(sided[0], toward) });
    }
    return chains;
}

// The faces either side of an edge: which side a face is on is where its way into the face leans, looking along the
// edge as the chain runs with the faces' average normal up
function sidesOf(edge: c3d.CurveEdge, forward: boolean): Link['sides'] {
    const faces = [edge.GetFacePlus(), edge.GetFaceMinus()].filter((f): f is c3d.Face => f !== null);
    const p = point2point(edge.Point(0.5));
    const tangent = vec2vec(edge.Tangent(0.5), 1).multiplyScalar(forward ? 1 : -1);
    const up = new THREE.Vector3();
    for (const face of faces) up.add(vec2vec(face.NearPointProjection(point2point(p)).normal, 1));
    const left = up.normalize().cross(tangent);
    const sides: Link['sides'] = new Map();
    for (const face of faces) {
        const across = inward(face, edge, 0.5);
        sides.set(across.dot(left) >= 0 ? -1 : 1, { face, across });
    }
    return sides;
}

function positiveSide(link: Link, toward: THREE.Vector3) {
    const facing = (side: number) => {
        const s = link.sides.get(side);
        if (s === undefined) return -Infinity;
        return vec2vec(s.face.NearPointProjection(link.edge.Point(0.5)).normal, 1).dot(toward);
    };
    return facing(1) >= facing(-1) ? 1 : -1;
}

// The chain cut where the face on the given side changes; a closed chain's last run joins its first if they share it
function runsOf(chain: Chain, side: number): Link[][] {
    const runs: Link[][] = [];
    for (const link of chain.links) {
        const face = link.sides.get(side)?.face;
        if (face === undefined) throw new ValidationError("An edge has no face to offset into on that side");
        const last = runs[runs.length - 1];
        if (last !== undefined && last[0].sides.get(side)!.face === face) last.push(link);
        else runs.push([link]);
    }
    if (chain.closed && runs.length > 1 && runs[0][0].sides.get(side)!.face === runs[runs.length - 1][0].sides.get(side)!.face) {
        runs[0].unshift(...runs.pop()!);
    }
    return runs;
}

export class OffsetSpaceCurveFactory extends GeometryFactory {
    constructionPlane: ConstructionPlane = new ConstructionPlaneSnap();
    distance = 0;

    private _center!: THREE.Vector3;
    get center() { return this._center }

    private _normal!: THREE.Vector3;
    get normal() { return this._normal }

    get hasCurve() { return this.model !== undefined }

    private model!: c3d.Curve3D;
    private _curve!: visual.SpaceInstance<visual.Curve3D>;
    get curve() { return this._curve }
    set curve(curve: visual.SpaceInstance<visual.Curve3D>) {
        this._curve = curve;
        const inst = this.db.lookup(curve);
        const item = inst.GetSpaceItem()!;
        const model = item.Cast<c3d.Curve3D>(item.IsA());
        this.model = model;

        const { center, normal } = this.getCenterAndNormal(model);
        this._center = center;
        this._normal = normal;
    }

    private getCenterAndNormal(model: c3d.Curve3D) {
        if (model.IsStraight()) {
            const [start, end] = [point2point(model.GetLimitPoint(1)), point2point(model.GetLimitPoint(2))];
            const center = start.clone().add(end).multiplyScalar(0.5);
            const normal = start.clone().sub(end).normalize().cross(this.constructionPlane.n).normalize();
            return { center, normal };
        } else {
            const t = (model.GetTMin() + model.GetTMax()) / 2;
            const center = point2point(model.PointOn(t));
            const normal = vec2vec(model.Normal(t), 1);
            return { center, normal };
        }
    }

    private names = new c3d.SNameMaker(composeMainName(c3d.CreatorType.Curve3DCreator, this.db.version), c3d.ESides.SideNone, 0)

    private readonly distVec = new THREE.Vector3();
    async calculate() {
        const { model: curve, distance, names } = this;
        const { distVec } = this;
        if (distance === 0) return new c3d.SpaceInstance(curve);
        const dist = unit(distance);

        if (curve.IsStraight()) {
            const dup = curve.Duplicate().Cast<c3d.Curve3D>(curve.IsA());
            dup.Move(vec2vec(distVec.copy(this._normal).multiplyScalar(dist), 1));
            return new c3d.SpaceInstance(dup);
        } if (curve.IsPlanar()) {
            const result = await c3d.ActionSurfaceCurve.OffsetPlaneCurve_async(curve, dist);
            return new c3d.SpaceInstance(result);
        } else {
            const vec = new c3d.Vector3D(dist, 0, 0);
            const params = new c3d.SpatialOffsetCurveParams(vec, names);
            const wireframe = await c3d.ActionSurfaceCurve.OffsetCurve_async(curve, params);
            return new c3d.SpaceInstance(wireframe.GetCurves()[0]);
        }
    }
}
