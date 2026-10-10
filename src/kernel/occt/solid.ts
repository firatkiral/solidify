import { Item, TopItem } from './base';
import { ElementaryShellType, OperationType, SpaceType, TopologyType } from './constants';
import { Contour, Curve, Region, Spline, TrimmedCurve } from './curve2d';
import { Arc3D, ConeSpiral, Contour3D, ContourOnSurface, Curve3D, Line3D, LineSegment3D, Plane, PlaneCurve, Polyline3D, Spline3D, Surface, TrimmedCurve3D } from './curve3d';
import { FormNote, Grid, Mesh, StepData } from './items';
import { arbitraryPerpendicular, CartPoint, CartPoint3D, cross, Cube, dot, Matrix3D, normalized, Placement3D, Vector3D } from './math';
import { EdgeFacesIndexes, ExtrusionValues, KFunction, MergingFlags, SmoothValues, SweptData } from './misc';
import { oc } from './occt';
import { correctRegions } from './regions';
import { BSpline, Pole } from './spline';
import { affineShape } from './affine';
import { copyHistory, Creator, ProcessState } from './history';
import { components, offsetFeature } from './features';

export type Shape = any;

// OCCT objects are freed when the wrapper that owns them is garbage collected.
const registry = new FinalizationRegistry<{ delete(): void }>(o => { try { o.delete() } catch (e) { } });
function own<T extends object>(owner: object, o: T): T {
    registry.register(owner, o as unknown as { delete(): void });
    return o;
}

export class KernelError extends Error {
    readonly isC3dError = true;
    constructor(message: string, readonly code = 0) { super(message) }
}

const ANGULAR_DEFLECTION = 0.3;

export function gpPnt(p: { x: number, y: number, z: number }) { return new oc.gp_Pnt(p.x, p.y, p.z) }
export function gpDir(v: { x: number, y: number, z: number }) { return new oc.gp_Dir(v.x, v.y, v.z) }
export function gpVec(v: { x: number, y: number, z: number }) { return new oc.gp_Vec(v.x, v.y, v.z) }
export function cart(p: any) { return new CartPoint3D(p.X(), p.Y(), p.Z()) }
export function vec(v: any) { return new Vector3D(v.X(), v.Y(), v.Z()) }
function hash(s: Shape) { return oc.ReplicadShapeHasher.HashCode(s, 2147483647) }

// A 63-bit hash of a string (two independent 32-bit multiplicative hashes). Not 64: ids pass through a BigInt64Array
// (SolidDuplicate.GetBuffers), which would turn a 64th bit into a sign.
function hash63(s: string): bigint {
    let a = 0x811c9dc5, b = 0x9747b28c;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193);
        b = Math.imul(b ^ c, 0x5bd1e995);
    }
    return (BigInt(a >>> 1) << BigInt(32)) | BigInt(b >>> 0);
}

type FaceMesh ={ index: Uint32Array, position: Float32Array, normal: Float32Array };
type MeshData = { faces: FaceMesh[], edges: Float32Array[] };

class Topology {
    faces: Face[] = [];
    edges: CurveEdge[] = [];
    faceEdges: number[][] = [];
    edgeFaces: number[][] = [];
    seams = new Set<number>();
}

// The topology with its faces and edges numbered as `numbering` says (see Solid.numbering).
function renumber(solid: Solid, explored: Topology, numbering: { faces: number[], edges: number[] }): Topology {
    if (numbering.faces.length !== explored.faces.length || numbering.edges.length !== explored.edges.length) return explored;
    const faceOf = new Map(numbering.faces.map((m, i) => [m, i])), edgeOf = new Map(numbering.edges.map((m, i) => [m, i]));
    const result = new Topology();
    // Each wrapper frees its shape when collected, so the renumbered ones need handles of their own: the explored
    // wrappers are dropped after this and would free shapes still in use.
    result.faces = numbering.faces.map((m, i) => new Face(solid, i, oc.TopoDS.Face(explored.faces[m].shape), m));
    result.edges = numbering.edges.map((m, i) => new CurveEdge(solid, i, oc.TopoDS.Edge(explored.edges[m].shape), m));
    result.faceEdges = numbering.faces.map(m => explored.faceEdges[m].map(e => edgeOf.get(e)!));
    result.edgeFaces = numbering.edges.map(m => explored.edgeFaces[m].map(f => faceOf.get(f)!));
    result.seams = new Set([...explored.seams].map(e => edgeOf.get(e)!));
    return result;
}

// For each expected position, the index of the item nearest it (each item used once); undefined if any is missing.
function matchByPosition(items: CartPoint3D[], expected: CartPoint3D[]): number[] | undefined {
    if (items.length !== expected.length) return undefined;
    const used = new Set<number>();
    const result: number[] = [];
    for (const p of expected) {
        let best = -1, bd = Infinity;
        for (const [i, q] of items.entries()) {
            if (used.has(i)) continue;
            const d = p.distanceTo(q);
            if (d < bd) { bd = d; best = i }
        }
        if (best < 0) return undefined;
        used.add(best);
        result.push(best);
    }
    return result;
}

export class Solid extends Item {
    private _shape: Shape;
    private topology?: Topology;
    private meshes = new Map<string, MeshData>();
    private shell?: FaceShell;

    constructor(shape?: Shape) {
        super();
        if (shape instanceof FaceShell) shape = shape.solid.shape;
        this._shape = shape === undefined ? undefined : own(this, copyHandle(shape));
    }

    get shape() { return this._shape }
    set shape(shape: Shape) {
        this._shape = own(this, copyHandle(shape));
        this.topology = undefined; this.shell = undefined;
        this.meshes.clear();
        this.numbering = undefined;
    }

    // C3D's numbering of the faces and edges, where it differs from OCCT's exploration order: for each C3D index, the
    // index in exploration order (which the meshes follow). Only elementary solids have one.
    private _numbering?: { faces: number[], edges: number[] };
    get numbering() { return this._numbering }
    set numbering(numbering: { faces: number[], edges: number[] } | undefined) {
        this._numbering = numbering;
        this.topology = undefined; this.shell = undefined;
    }

    IsA(): number { return SpaceType.Solid }

    private topo(): Topology {
        if (this.topology !== undefined) return this.topology;
        const topology = new Topology();
        const edgeIndex = new Map<number, number[]>();
        const findEdge = (e: Shape): number | undefined => {
            for (const j of edgeIndex.get(hash(e)) ?? []) if (topology.edges[j].shape.IsSame(e)) return j;
            return undefined;
        };
        const ex = new oc.TopExp_Explorer(this.shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        for (; ex.More(); ex.Next()) {
            const e = ex.Current();
            if (findEdge(e) !== undefined) continue;
            const index = topology.edges.length;
            topology.edges.push(new CurveEdge(this, index, oc.TopoDS.Edge(e.Oriented(oc.TopAbs_Orientation.TopAbs_FORWARD))));
            topology.edgeFaces.push([]);
            const h = hash(e);
            edgeIndex.set(h, [...(edgeIndex.get(h) ?? []), index]);
        }
        ex.delete();
        const fx = new oc.TopExp_Explorer(this.shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        for (; fx.More(); fx.Next()) {
            const f = oc.TopoDS.Face(fx.Current());
            const index = topology.faces.length;
            topology.faces.push(new Face(this, index, f));
            const edges: number[] = [];
            const ex2 = new oc.TopExp_Explorer(f, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
            for (; ex2.More(); ex2.Next()) {
                const j = findEdge(ex2.Current());
                if (j === undefined) continue;
                if (edges.includes(j)) topology.seams.add(j);
                else edges.push(j);
                if (!topology.edgeFaces[j].includes(index)) topology.edgeFaces[j].push(index);
            }
            ex2.delete();
            topology.faceEdges.push(edges);
        }
        fx.delete();
        this.topology = this.numbering === undefined ? topology : renumber(this, topology, this.numbering);
        return this.topology;
    }

    faceEdges(face: Face) { return this.topo().faceEdges[face.index].map(i => this.topo().edges[i]) }
    edgeFaces(edge: CurveEdge) { return this.topo().edgeFaces[edge.index].map(i => this.topo().faces[i]) }
    isSeam(edge: CurveEdge) { return this.topo().seams.has(edge.index) }

    GetShell() { return this.shell ??= new FaceShell(this) }
    GetFaces() { return [...this.topo().faces] }
    GetFacesCount() { return this.topo().faces.length }
    GetFace(i: number) { return this.topo().faces[i] ?? null }
    GetEdges() { return [...this.topo().edges] }
    GetEdgesCount() { return this.topo().edges.length }
    GetEdge(i: number) { return this.topo().edges[i] ?? null }
    GetFaceIndex(face: Face) { return face.index }
    GetEdgeIndex(edge: CurveEdge) { return edge.index }

    mesh(sag: number, angle = ANGULAR_DEFLECTION): MeshData {
        const key = `${sag} ${angle}`;
        const cached = this.meshes.get(key);
        if (cached !== undefined) return cached;
        const data = oc.ReplicadMeshExtractor.extract(this.shape, sag, angle, false);
        const memory = () => oc.wasmMemory.buffer as ArrayBuffer;
        const vertices = new Float32Array(memory(), data.getVerticesPtr(), data.getVerticesSize()).slice();
        const normals = new Float32Array(memory(), data.getNormalsPtr(), data.getNormalsSize()).slice();
        const triangles = new Uint32Array(memory(), data.getTrianglesPtr(), data.getTrianglesSize()).slice();
        const groups = new Int32Array(memory(), data.getFaceGroupsPtr(), data.getFaceGroupsSize()).slice();
        data.delete();

        const faces: FaceMesh[] = [];
        for (let i = 0; i < groups.length; i += 3) {
            const tri = triangles.subarray(groups[i], groups[i] + groups[i + 1]);
            let lo = Infinity, hi = -1;
            for (const v of tri) { if (v < lo) lo = v; if (v > hi) hi = v }
            if (hi < 0) { faces.push({ index: new Uint32Array(0), position: new Float32Array(0), normal: new Float32Array(0) }); continue }
            const index = new Uint32Array(tri.length);
            for (let k = 0; k < tri.length; k++) index[k] = tri[k] - lo;
            faces.push({ index, position: vertices.slice(lo * 3, (hi + 1) * 3), normal: normals.slice(lo * 3, (hi + 1) * 3) });
        }

        const edgeData = oc.ReplicadEdgeMeshExtractor.extract(this.shape, sag, angle);
        const lines = new Float32Array(memory(), edgeData.getLinesPtr(), edgeData.getLinesSize()).slice();
        const edgeGroups = new Int32Array(memory(), edgeData.getEdgeGroupsPtr(), edgeData.getEdgeGroupsSize()).slice();
        edgeData.delete();
        const edges: Float32Array[] = [];
        for (let i = 0; i < edgeGroups.length; i += 3) {
            edges.push(lines.slice(edgeGroups[i] * 3, (edgeGroups[i] + edgeGroups[i + 1]) * 3));
        }

        const result = { faces, edges };
        this.meshes.set(key, result);
        return result;
    }

    CreateMesh(stepData: StepData, _note: FormNote) {
        const mesh = new Mesh();
        const { faces, edges } = this.mesh(stepData.GetSag(), stepData.GetAngle());
        for (const face of this.GetFaces()) {
            const grid = mesh.AddGrid();
            grid.SetItem(face);
            grid.SetPrimitiveName(face.GetNameHash());
            const data = faces[face.meshIndex];
            if (data !== undefined) grid.set(data.index, data.position, data.normal);
        }
        for (const edge of this.GetEdges()) {
            const data = edges[edge.meshIndex];
            if (data !== undefined) mesh.AddPolygon(data, edge);
        }
        return mesh;
    }

    CalculateMesh(stepData: StepData, note: FormNote) { return this.CreateMesh(stepData, note) }

    AddYourGabaritTo(cube: Cube) { addBounds(this.shape, cube) }

    Transform(m: Matrix3D) {
        const { numbering } = this;
        this.shape = transformShape(this.shape, m);
        this.numbering = numbering;
        for (const c of this.creators) c.moved(m);
    }
    Duplicate() {
        const result = new Solid(this.shape);
        result.creators = copyHistory(this.creators);
        result.numbering = this.numbering;
        return result;
    }

    IsClosed() { return true }

    // The operations that built the solid, oldest first (see history.ts).
    creators: Creator[] = [];
    GetCreatorsCount() { return this.creators.length }
    GetCreator(index: number) { return this.creators[index] ?? null }
    GetCreators() { return [...this.creators] }
    GetActiveCreatorsCount() { return this.creators.filter(c => c.GetStatus() === ProcessState.Success).length }
    AddCreator(creator: Creator, _same?: boolean) { this.creators = [...copyHistory(this.creators), creator.copy()]; return true }
    // The solid as the last of its leading run of performed operations left it.
    RebuildItem(_copyMode?: number, ..._rest: unknown[]) {
        let last = -1;
        while (last + 1 < this.creators.length && this.creators[last + 1].GetStatus() === ProcessState.Success) last++;
        if (last < 0) return false;
        const creators = this.creators;
        this.shape = creators[last].shape(transformShape);
        this.creators = creators;
        return true;
    }
    GetOwnChanged() { return false }

    SolidClassification(other: Solid) {
        return intersects(this, other) ? 1 : 2;
    }
}

function addBounds(shape: Shape, cube: Cube) {
    const box = new oc.Bnd_Box();
    oc.BRepBndLib.Add(shape, box, false);
    if (!box.IsVoid()) {
        cube.include({ x: box.GetXMin(), y: box.GetYMin(), z: box.GetZMin() });
        cube.include({ x: box.GetXMax(), y: box.GetYMax(), z: box.GetZMax() });
    }
    box.delete();
}

// Rotation, translation, mirroring and uniform scaling (what an OCCT gp_Trsf can represent).
function isSimilarity(m: Matrix3D): boolean {
    const rows = [0, 1, 2].map(i => m.m[i].slice(0, 3));
    const lengths = rows.map(r => Math.hypot(r[0], r[1], r[2]));
    const s = lengths[0];
    if (lengths.some(l => Math.abs(l - s) > 1e-9 * Math.max(1, s))) return false;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        const d = rows[i][0] * rows[j][0] + rows[i][1] * rows[j][1] + rows[i][2] * rows[j][2];
        if (Math.abs(d) > 1e-9 * s * s) return false;
    }
    return true;
}

function copyHandle(shape: Shape): Shape {
    return shape.Oriented(shape.Orientation());
}

export function transformShape(shape: Shape, m: Matrix3D): Shape {
    if (!isSimilarity(m)) return occ("Transformation", () => affineShape(shape, m));
    const trsf = new oc.gp_Trsf();
    const a = m.m;
    // C3D matrices transform row vectors; OCCT's gp_Trsf transforms column vectors.
    trsf.SetValues(
        a[0][0], a[1][0], a[2][0], a[3][0],
        a[0][1], a[1][1], a[2][1], a[3][1],
        a[0][2], a[1][2], a[2][2], a[3][2]);
    const t = new oc.BRepBuilderAPI_Transform(shape, trsf, true, false);
    const result = t.Shape();
    t.delete(); trsf.delete();
    return result;
}

export class FaceShell extends TopItem {
    constructor(readonly solid: Solid) { super() }
    IsA(): number { return TopologyType.FaceShell }
    GetFaces() { return this.solid.GetFaces() }
    GetFacesCount() { return this.solid.GetFacesCount() }
    GetFace(i: number) { return this.solid.GetFace(i) }
    GetEdges() { return this.solid.GetEdges() }
    GetEdge(index: number) { return this.solid.GetEdge(index) }
    GetBoundaryEdges() { return this.solid.GetEdges().filter(e => this.solid.edgeFaces(e).length < 2) }
    IsClosed() { return true }

    // Identifies edges by index so the same edges can be found again in a copy of the solid.
    FindFacesIndexByEdges(init: EdgeFunction[]) {
        const indexes = init.map(ef => {
            const edge = ef.Edge();
            const faces = this.solid.edgeFaces(edge);
            const result = new EdgeFacesIndexes();
            result.edgeIndex = edge.index;
            result.facePIndex = faces[0]?.index ?? -1;
            result.faceMIndex = faces[1]?.index ?? -1;
            return result;
        });
        return { functions: init.map(ef => ef.Function()), slideways: [] as Curve3D[], indexes };
    }

    FindEdgesByFacesIndex(indexes: EdgeFacesIndexes[], initFunctions: KFunction[], initSlideways: Curve3D[]) {
        const initCurves = indexes.map(x => {
            const edge = this.solid.GetEdge(x.edgeIndex);
            if (edge === null) throw new KernelError("Edge not found in the copy of the solid");
            return edge;
        });
        return { functions: initFunctions, slideways: initSlideways, initCurves };
    }
}

export class EdgeFunction {
    constructor(private readonly edge: CurveEdge, private readonly fn: KFunction) { }
    Edge() { return this.edge }
    Function() { return this.fn }
    Id() { return BigInt(0) }
}

// Copies of a solid for operations that modify their input (OCCT operations never do, so a copy shares the shape).
export class SolidPool {
    constructor(private readonly original: Solid) { }
    Alloc(_n: number) { }
    Count() { return Number.MAX_SAFE_INTEGER }
    Pop() { return new SolidDuplicate(this.original) }
}

export class SolidDuplicate {
    private readonly copy: Solid;
    constructor(private readonly original: Solid) { this.copy = original.Duplicate() }
    GetCopy() { return this.copy }
    GetBuffers() {
        const ids = (items: { Id(): bigint }[]) => BigInt64Array.from(items.map(i => i.Id()));
        return {
            originalFaceIds: ids(this.original.GetFaces()), copyFaceIds: ids(this.copy.GetFaces()),
            originalEdgeIds: ids(this.original.GetEdges()), copyEdgeIds: ids(this.copy.GetEdges()),
        };
    }
}

export abstract class TopologyItem extends TopItem {
    abstract IsA(): number;
    Type() { return this.IsA() }
    Cast<T>(_t: number): T { return this as unknown as T }
    protected style = 0;
    GetStyle() { return this.style }
    SetStyle(s: number) { this.style = s }
    AttributesConvert(_grid: Grid) { }
}

export class Vertex extends TopologyItem {
    constructor(readonly point: CartPoint3D) { super() }
    IsA(): number { return TopologyType.Vertex }
    GetCartPoint() { return this.point.clone() }
}

export abstract class Edge extends TopologyItem { }

export class CurveEdge extends Edge {
    private adaptor?: any;

    // index is the number the app uses; meshIndex the position in exploration order
    constructor(readonly solid: Solid, readonly index: number, readonly shape: Shape, readonly meshIndex = index) {
        super();
        own(this, shape);
    }

    IsA(): number { return TopologyType.CurveEdge }
    GetNameHash() { return this.index + 1 }
    AddYourGabaritTo(cube: Cube) { addBounds(this.shape, cube) }
    GetOwnChanged() { return false }

    private curve() { return this.adaptor ??= own(this, new oc.BRepAdaptor_Curve(this.shape)) }
    private range(): [number, number] { const c = this.curve(); return [c.FirstParameter(), c.LastParameter()] }
    // Edge curve parameter of the normalized parameter t in [0,1].
    edgeParam(t: number) { const [a, b] = this.range(); return a + (b - a) * t }

    Point(t: number) { return cart(this.curve().Value(this.edgeParam(t))) }
    GetBegPoint() { return this.Point(0) }
    GetEndPoint() { return this.Point(1) }

    Tangent(t: number) {
        const c = this.curve();
        const p = new oc.gp_Pnt(), v = new oc.gp_Vec();
        c.D1(this.edgeParam(t), p, v);
        const result = normalized(vec(v));
        p.delete(); v.delete();
        return result;
    }
    GetBegTangent() { return this.Tangent(0) }
    GetEndTangent() { return this.Tangent(1) }

    // Normalized parameter of the point nearest to `p`.
    PointProjection(p: CartPoint3D) {
        const curve = this.GetSpaceCurve();
        const { t } = curve.NearPointProjection(p, false);
        return (t - curve.tmin) / (curve.tmax - curve.tmin);
    }

    IsSeam() { return this.solid.isSeam(this) }
    IsPole() { return oc.BRep_Tool.Degenerated(this.shape) }

    GetFacePlus() { return this.solid.edgeFaces(this)[0] ?? null }
    GetFaceMinus() { return this.solid.edgeFaces(this)[1] ?? null }

    private spaceCurve?: Curve3D;
    // The edge's curve as a kernel curve, parametrized like the edge (normalized to [0,1] for non-analytic curves).
    GetSpaceCurve(): Curve3D {
        return this.spaceCurve ??= curveOfEdge(this.shape);
    }

    // The faces on both sides meet tangentially along the edge.
    IsSmooth() {
        const faces = this.solid.edgeFaces(this);
        if (faces.length !== 2) return false;
        for (const t of [0.25, 0.5, 0.75]) {
            const p = this.Point(t);
            const n1 = faces[0].NearPointProjection(p).normal, n2 = faces[1].NearPointProjection(p).normal;
            if (dot(n1, n2) < Math.cos(0.01)) return false;
        }
        return true;
    }

    MakeCurve(): Curve3D { return this.GetSpaceCurve().Duplicate() }
    GetIntersectionCurve(): Curve3D { return this.MakeCurve() }

    // The loop of the face on one side of the edge that contains it.
    private findLoop(face: Face | null) {
        const loops = face?.loops() ?? [];
        const loopIndex = loops.findIndex(loop => loop.GetEdges().includes(this));
        const findLoop = loops[loopIndex];
        return { success: findLoop !== undefined, loopIndex, findLoop, edgeIndex: findLoop?.GetEdges().indexOf(this) ?? -1 };
    }
    FindOrientedEdgePlus() { return this.findLoop(this.GetFacePlus()) }
    FindOrientedEdgeMinus() { return this.findLoop(this.GetFaceMinus()) }

    CalculateMesh(stepData: StepData, _note: FormNote) {
        const mesh = new Mesh();
        const { edges } = this.solid.mesh(stepData.GetSag(), stepData.GetAngle());
        const data = edges[this.meshIndex];
        if (data !== undefined) mesh.AddPolygon(data, this);
        return mesh;
    }

    EdgeNormal(t: number) {
        const faces = this.solid.edgeFaces(this);
        const p = this.Point(t);
        let n = new Vector3D(0, 0, 0);
        for (const f of faces) { const fn = f.NearPointProjection(p).normal; n = new Vector3D(n.x + fn.x, n.y + fn.y, n.z + fn.z) }
        return normalized(n);
    }
}

export class Face extends TopologyItem {
    private surfaceAdaptor?: any;
    private bounds?: { UMin: number, UMax: number, VMin: number, VMax: number };

    // index is the number the app uses; meshIndex the position in exploration order
    constructor(readonly solid: Solid, readonly index: number, readonly shape: Shape, readonly meshIndex = index) {
        super();
        own(this, shape);
    }

    IsA(): number { return TopologyType.Face }
    GetNameHash() { return this.index + 1 }
    AddYourGabaritTo(cube: Cube) { addBounds(this.shape, cube) }
    GetOwnChanged() { return false }
    GetEdges() { return this.solid.faceEdges(this) }

    // A face is identified by its geometry: the faces an operation leaves alone keep their Id in its result (which the
    // mesh cache relies on, see SolidCopier), while changed and new faces get new ones.
    private geometryId?: bigint;
    Id(): bigint { return this.geometryId ??= this.hashGeometry() }

    // Hash of the surface (sampled over the face's bounds) and the boundary edges, quantized so that it is stable.
    private hashGeometry(): bigint {
        const q = (p: { x: number, y: number, z: number }) => [p.x, p.y, p.z].map(x => Math.round(x * 1e6)).join(' ');
        const parts = [String(this.GetSurface().IsA())];
        for (const fv of [0, 0.5, 1]) for (const fu of [0, 0.5, 1]) parts.push(q(this.Point(fu, fv)));
        parts.push(q(this.Normal(0.5, 0.5)));
        const edges: string[] = [];
        const ex = new oc.TopExp_Explorer(this.shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        for (; ex.More(); ex.Next()) {
            const c = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(ex.Current()));
            const a = c.FirstParameter(), b = c.LastParameter();
            const ends = [q(cart(c.Value(a))), q(cart(c.Value(b)))].sort();
            edges.push([...ends, q(cart(c.Value((a + b) / 2)))].join(' '));
            c.delete();
        }
        ex.delete();
        parts.push(...edges.sort());
        return hash63(parts.join(','));
    }

    private adaptor() { return this.surfaceAdaptor ??= own(this, new oc.BRepAdaptor_Surface(this.shape, true)) }
    private uv() { return this.bounds ??= oc.BRepTools.UVBounds(this.shape, 0, 0, 0, 0) }
    private reversed() { return this.shape.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED }
    // Whether the face's normal is its surface's
    IsSameSense() { return !this.reversed() }

    private surfacePoint(u: number, v: number) { return cart(this.adaptor().Value(u, v)) }

    private surfaceNormal(u: number, v: number) {
        const p = new oc.gp_Pnt(), du = new oc.gp_Vec(), dv = new oc.gp_Vec();
        this.adaptor().D1(u, v, p, du, dv);
        let n = normalized(vec(du.Crossed(dv)));
        if (this.reversed()) n = new Vector3D(-n.x, -n.y, -n.z);
        p.delete(); du.delete(); dv.delete();
        return n;
    }

    // Face parameters are normalized to [0,1] over the face's bounds.
    private toSurface(fu: number, fv: number): [number, number] {
        const b = this.uv();
        return [b.UMin + (b.UMax - b.UMin) * fu, b.VMin + (b.VMax - b.VMin) * fv];
    }

    Point(fu: number, fv: number) { return this.surfacePoint(...this.toSurface(fu, fv)) }
    Normal(fu: number, fv: number) { return this.surfaceNormal(...this.toSurface(fu, fv)) }

    GetFaceParam(u: number, v: number) {
        const b = this.uv();
        return { faceU: (u - b.UMin) / (b.UMax - b.UMin || 1), faceV: (v - b.VMin) / (b.VMax - b.VMin || 1) };
    }

    // Surface parameters of the point of the face nearest to `p` (within the face's bounds, as in C3D), and the
    // normal there.
    NearPointProjection(p: CartPoint3D): { u: number, v: number, normal: Vector3D } {
        const surface = oc.BRep_Tool.Surface(this.shape);
        const vertex = new oc.BRepBuilderAPI_MakeVertex(gpPnt(p)).Vertex();
        const nearest = new oc.BRepExtrema_DistShapeShape(vertex, this.shape);
        const target = nearest.IsDone() && nearest.NbSolution() > 0 ? cart(nearest.PointOnShape2(1)) : p;
        nearest.delete();
        const projector = new oc.GeomAPI_ProjectPointOnSurf(gpPnt(target), surface);
        let u = 0, v = 0;
        if (projector.NbPoints() > 0) ({ U: u, V: v } = projector.LowerDistanceParameters(0, 0));
        projector.delete();
        return { u, v, normal: this.surfaceNormal(u, v) };
    }

    IsPlanar() { return this.adaptor().GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Plane }
    surfaceType() { return this.adaptor().GetType() }

    GetAnyPointOn() {
        const [u, v] = this.toSurface(0.5, 0.5);
        return { point: this.surfacePoint(u, v), normal: this.surfaceNormal(u, v) };
    }

    // A placement at a point of the face with its X axis along the normal (OrientPlacement turns the normal into Y).
    GetControlPlacement() {
        const { point, normal } = this.GetAnyPointOn();
        const placement = new Placement3D();
        placement.origin = point;
        placement.axisX = normal;
        placement.axisY = arbitraryPerpendicular(normal);
        placement.axisZ = cross(placement.axisX, placement.axisY);
        return placement;
    }

    // Turns a placement at a point of the face so that its Y axis is the face normal there.
    OrientPlacement(placement: Placement3D) {
        const { normal } = this.NearPointProjection(placement.origin);
        const Z = arbitraryPerpendicular(normal);
        placement.axisY = normal;
        placement.axisZ = Z;
        placement.axisX = cross(normal, Z);
    }

    // A placement in the face's surface with its Z axis along the normal.
    GetSurfacePlacement() {
        if (this.IsPlanar()) return this.planePlacement();
        const { point, normal } = this.GetAnyPointOn();
        return new Placement3D(point, normal, false);
    }

    GetOuterEdges(): CurveEdge[] {
        const wire = oc.BRepTools.OuterWire(this.shape);
        const own = this.solid.faceEdges(this);
        const result: CurveEdge[] = [];
        const ex = new oc.TopExp_Explorer(wire, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        for (; ex.More(); ex.Next()) {
            const edge = own.find(e => e.shape.IsSame(ex.Current()));
            if (edge !== undefined && !result.includes(edge)) result.push(edge);
        }
        ex.delete();
        return result;
    }

    GetNeighborFaces(): Face[] {
        const result: Face[] = [];
        for (const edge of this.GetEdges()) {
            for (const face of this.solid.edgeFaces(edge)) {
                if (face !== this && !result.includes(face)) result.push(face);
            }
        }
        return result;
    }

    GetPlacement() { return this.GetControlPlacement() }

    // OCCT faces are never modified in place, so a face is its own copy.
    DataDuplicate(): Face { return this }

    // The face's boundary loops, the outer one first.
    private _loops?: Loop[];
    loops(): Loop[] {
        if (this._loops !== undefined) return this._loops;
        const own = this.solid.faceEdges(this);
        const outer = oc.BRepTools.OuterWire(this.shape);
        const wires: Shape[] = [outer];
        const wx = new oc.TopExp_Explorer(this.shape, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        for (; wx.More(); wx.Next()) if (!wx.Current().IsSame(outer)) wires.push(wx.Current());
        wx.delete();
        return this._loops = wires.map(wire => {
            const edges: OrientedEdge[] = [];
            const ex = new oc.TopExp_Explorer(wire, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
            for (; ex.More(); ex.Next()) {
                const edge = own.find(e => e.shape.IsSame(ex.Current()));
                if (edge !== undefined) edges.push(new OrientedEdge(edge, ex.Current().Orientation() !== oc.TopAbs_Orientation.TopAbs_REVERSED));
            }
            ex.delete();
            return new Loop(this.ordered(edges));
        });
    }
    // A loop's edges end to end, anticlockwise about the outward normal of a planar face, from its lowest-numbered edge
    // (as C3D lists them).
    private ordered(edges: OrientedEdge[]): OrientedEdge[] {
        if (edges.length < 2) return edges;
        const ends = (e: OrientedEdge) => { const c = e.GetCurveEdge(); return e.orientation ? [c.GetBegPoint(), c.GetEndPoint()] : [c.GetEndPoint(), c.GetBegPoint()] };
        const rest = [...edges];
        let chain = [rest.shift()!];
        while (rest.length > 0) {
            const end = ends(chain[chain.length - 1])[1];
            let i = rest.findIndex(e => ends(e)[0].distanceTo(end) < 1e-6);
            if (i < 0) i = rest.findIndex(e => ends(e)[1].distanceTo(end) < 1e-6);
            if (i < 0) return edges;
            const [next] = rest.splice(i, 1);
            chain.push(ends(next)[0].distanceTo(end) < 1e-6 ? next : new OrientedEdge(next.GetCurveEdge(), !next.orientation));
        }
        if (this.IsPlanar()) {
            const points = chain.flatMap(e => [ends(e)[0], e.GetCurveEdge().Point(0.5)]);
            let nx = 0, ny = 0, nz = 0;
            for (let i = 0; i < points.length; i++) {
                const p = points[i], q = points[(i + 1) % points.length];
                nx += (p.y - q.y) * (p.z + q.z); ny += (p.z - q.z) * (p.x + q.x); nz += (p.x - q.x) * (p.y + q.y);
            }
            const { normal } = this.GetAnyPointOn();
            if (nx * normal.x + ny * normal.y + nz * normal.z < 0) chain = chain.reverse().map(e => new OrientedEdge(e.GetCurveEdge(), !e.orientation));
        }
        const first = chain.reduce((best, e, i) => e.GetCurveEdge().index < chain[best].GetCurveEdge().index ? i : best, 0);
        return [...chain.slice(first), ...chain.slice(0, first)];
    }

    GetLoopsCount() { return this.loops().length }
    GetLoop(index: number): Loop | null { return this.loops()[index] ?? null }

    GetSurface() { return new FaceSurface(this) }

    // The face as a plane and 2D contours on it (planar faces only).
    GetSurfaceCurvesData(): { surface: Plane, contours: Contour[] } {
        if (!this.IsPlanar()) throw new KernelError("Only planar faces are supported by the OCCT kernel");
        const placement = this.planePlacement();
        const surface = new Plane(placement, 0);
        const contours: Contour[] = [];
        const wx = new oc.TopExp_Explorer(this.shape, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        for (; wx.More(); wx.Next()) {
            const segments: Curve[] = [];
            const ex = new oc.TopExp_Explorer(wx.Current(), oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
            for (; ex.More(); ex.Next()) {
                const e = oc.TopoDS.Edge(ex.Current());
                segments.push(edgeTo2d(e, placement));
            }
            ex.delete();
            contours.push(new Contour(chain(segments), true));
        }
        wx.delete();
        const regions = correctRegions(contours);
        return { surface, contours: regions.flatMap(r => r.contours) };
    }

    planePlacement(): Placement3D {
        const pln = this.adaptor().Plane();
        const ax = pln.Position();
        const placement = new Placement3D();
        placement.origin = cart(ax.Location());
        // The surface's normal is X × Y, which is opposite to the axis of a plane with a left-handed placement.
        placement.axisX = vec(ax.XDirection()); placement.axisY = vec(ax.YDirection()); placement.axisZ = cross(placement.axisX, placement.axisY);
        if (this.reversed()) { placement.axisZ.Invert(); placement.axisY.Invert() }
        return placement;
    }
}

// An edge as it runs around a face's loop.
export class OrientedEdge {
    constructor(private readonly edge: CurveEdge, readonly orientation: boolean) { }
    GetCurveEdge() { return this.edge }
    GetOrientation() { return this.orientation }
    Id() { return this.edge.Id() }
}

// A closed chain of edges bounding a face.
export class Loop extends TopItem {
    constructor(private readonly edges: OrientedEdge[]) { super() }
    GetEdgesCount() { return this.edges.length }
    GetOrientedEdge(index: number): OrientedEdge | null { return this.edges[index] ?? null }
    GetEdges(_findSame?: boolean): CurveEdge[] { return this.edges.map(e => e.GetCurveEdge()) }
    Id() { return BigInt(0) }
}

// The surface of a face, parametrized like the face's underlying surface.
export class FaceSurface extends Surface {
    constructor(readonly face: Face) { super() }
    // The kind of surface, by C3D's codes
    IsA(): number {
        const T = oc.GeomAbs_SurfaceType;
        switch (this.face.surfaceType()) {
            case T.GeomAbs_Plane: return SpaceType.Plane;
            case T.GeomAbs_Cone: return SpaceType.ConeSurface;
            case T.GeomAbs_Cylinder: return SpaceType.CylinderSurface;
            case T.GeomAbs_Sphere: return SpaceType.SphereSurface;
            case T.GeomAbs_Torus: return SpaceType.TorusSurface;
            case T.GeomAbs_SurfaceOfExtrusion: return SpaceType.ExtrusionSurface;
            case T.GeomAbs_SurfaceOfRevolution: return SpaceType.RevolutionSurface;
            case T.GeomAbs_OffsetSurface: return SpaceType.OffsetSurface;
            default: return SpaceType.SplineSurface;
        }
    }
    Cast<T>(_type: number): T { return this as unknown as T }
    Duplicate() { return this }
    Transform(_m: Matrix3D) { throw new KernelError("The surface of a face cannot be transformed on its own") }
    // Shown as the face's own triangles
    grid(sag: number) {
        const data = this.face.solid.mesh(sag).faces[this.face.meshIndex];
        if (data === undefined) throw new KernelError("The face could not be meshed");
        return data;
    }
    AddYourGabaritTo(cube: Cube) { this.face.AddYourGabaritTo(cube) }
    private b() { return oc.BRepTools.UVBounds(this.face.shape, 0, 0, 0, 0) }
    GetUMid() { const b = this.b(); return (b.UMin + b.UMax) / 2 }
    GetVMid() { const b = this.b(); return (b.VMin + b.VMax) / 2 }
    GetUMin() { return this.b().UMin }
    GetUMax() { return this.b().UMax }
    GetVMin() { return this.b().VMin }
    GetVMax() { return this.b().VMax }
    PointOn(uv: CartPoint) { const { faceU, faceV } = this.face.GetFaceParam(uv.x, uv.y); return this.face.Point(faceU, faceV) }
    // The surface's own normal, whichever way the face faces (as for C3D surfaces)
    Normal(u: number, v: number) {
        const { faceU, faceV } = this.face.GetFaceParam(u, v);
        const n = this.face.Normal(faceU, faceV);
        return this.face.IsSameSense() ? n : new Vector3D(-n.x, -n.y, -n.z);
    }
    GetSurface() { return this }
}

// Orders 2D segments so each starts where the previous one ends.
function chain(segments: Curve[]): Curve[] {
    if (segments.length < 2) return segments;
    const result = [segments[0]];
    const rest = segments.slice(1);
    while (rest.length > 0) {
        const end = result[result.length - 1].GetLimitPoint(2);
        let found = false;
        for (const [i, s] of rest.entries()) {
            const a = s.GetLimitPoint(1), b = s.GetLimitPoint(2);
            if (Math.hypot(a.x - end.x, a.y - end.y) < 1e-6) { result.push(s); rest.splice(i, 1); found = true; break }
            if (Math.hypot(b.x - end.x, b.y - end.y) < 1e-6) { s.Inverse(); result.push(s); rest.splice(i, 1); found = true; break }
        }
        if (!found) { result.push(...rest); break }
    }
    return result;
}

function edgeTo2d(e: Shape, placement: Placement3D): Curve {
    const c = new oc.BRepAdaptor_Curve(e);
    const a = c.FirstParameter(), b = c.LastParameter();
    const forward = e.Orientation() !== oc.TopAbs_Orientation.TopAbs_REVERSED;
    let result: Curve;
    if (c.GetType() === oc.GeomAbs_CurveType.GeomAbs_Circle) {
        const circ = c.Circle();
        const ax = circ.Position();
        const p = new Placement3D();
        p.origin = cart(ax.Location());
        p.axisX = vec(ax.XDirection()); p.axisY = vec(ax.YDirection()); p.axisZ = vec(ax.Direction());
        const arc = new Arc3D(p, circ.Radius(), circ.Radius(), 0);
        arc.MakeTrimmed(a, b);
        result = arc.to2d(placement);
    } else if (c.GetType() === oc.GeomAbs_CurveType.GeomAbs_Line) {
        result = new Polyline3D([cart(c.Value(a)), cart(c.Value(b))], false).to2d(placement);
    } else {
        const points = [];
        for (let i = 0; i <= 64; i++) points.push(cart(c.Value(a + (b - a) * i / 64)));
        result = new Polyline3D(points, false).to2d(placement);
    }
    c.delete();
    if (!forward) result.Inverse();
    return result;
}

// An OCCT edge as a kernel curve: lines and circles exactly, other curves as polylines.
export function curveOfEdge(e: Shape): Curve3D {
    const c = new oc.BRepAdaptor_Curve(e);
    const a = c.FirstParameter(), b = c.LastParameter();
    const type = c.GetType();
    let result: Curve3D;
    if (type === oc.GeomAbs_CurveType.GeomAbs_Line) {
        result = new Polyline3D([cart(c.Value(a)), cart(c.Value(b))], false);
    } else if (type === oc.GeomAbs_CurveType.GeomAbs_Circle) {
        const circ = c.Circle();
        const ax = circ.Position();
        const placement = new Placement3D();
        placement.origin = cart(ax.Location());
        placement.axisX = vec(ax.XDirection()); placement.axisY = vec(ax.YDirection()); placement.axisZ = vec(ax.Direction());
        const arc = new Arc3D(placement, circ.Radius(), circ.Radius(), 0);
        arc.MakeTrimmed(a, b);
        result = arc;
    } else {
        const n = 64;
        const points = [];
        for (let i = 0; i <= n; i++) points.push(cart(c.Value(a + (b - a) * i / n)));
        result = new Polyline3D(points, false);
    }
    c.delete();
    return result;
}

// ---- Conversion of kernel curves to OCCT ----

export function edgesOf2d(curve: Curve, place: Placement3D): Shape[] {
    if (curve instanceof Contour) return curve.segments.flatMap(s => edgesOf2d(s, place));
    if (curve instanceof Spline) return splineEdges(curve, place, curve.tmin, curve.tmax);
    if (curve instanceof TrimmedCurve && curve.basis instanceof Spline) {
        const edges = splineEdges(curve.basis, place, curve.t1, curve.t2);
        return curve.sense > 0 ? edges : edges.reverse().map(e => e.Reversed());
    }
    const result: Shape[] = [];
    for (const p of curve.prims()) {
        switch (p.kind) {
            case 'seg': {
                const a = place.point3d(p.a), b = place.point3d(p.b);
                if (a.distanceTo(b) < 1e-9) break;
                result.push(new oc.BRepBuilderAPI_MakeEdge(gpPnt(a), gpPnt(b)).Edge());
                break;
            }
            case 'arc': {
                const center = place.point3d(p.c);
                const U = place.GetVectorFrom(p.u.x, p.u.y, 0), V = place.GetVectorFrom(p.v.x, p.v.y, 0);
                const N = normalized(new Vector3D(U.y * V.z - U.z * V.y, U.z * V.x - U.x * V.z, U.x * V.y - U.y * V.x));
                const circ = new oc.gp_Circ(new oc.gp_Ax2(gpPnt(center), gpDir(N), gpDir(U)), p.r);
                const full = Math.abs(p.a1 - p.a0 - 2 * Math.PI) < 1e-9;
                result.push((full ? new oc.BRepBuilderAPI_MakeEdge(circ) : new oc.BRepBuilderAPI_MakeEdge(circ, p.a0, p.a1)).Edge());
                break;
            }
            case 'curve': {
                if (p.curve instanceof Spline) {
                    result.push(splineEdge(p.curve, place, p.t0, p.t1));
                    break;
                }
                if (p.curve instanceof Contour) {
                    // A piece of one of the contour's segments, in the contour's parameter.
                    const mid = (p.t0 + p.t1) / 2, [segment, u] = p.curve.locate(mid);
                    result.push(...edgesOf2d(new TrimmedCurve(segment, p.t0 + u - mid, p.t1 + u - mid, 1), place));
                    break;
                }
                // Approximate with a polyline of short segments
                const n = 64;
                let prev = place.point3d(p.curve._PointOn(p.t0));
                for (let i = 1; i <= n; i++) {
                    const next = place.point3d(p.curve._PointOn(p.t0 + (p.t1 - p.t0) * i / n));
                    result.push(new oc.BRepBuilderAPI_MakeEdge(gpPnt(prev), gpPnt(next)).Edge());
                    prev = next;
                }
                break;
            }
        }
    }
    return result;
}

// Edges for the parameter range [t1, t2] of a spline, which may wrap around the seam of a closed spline.
function splineEdges(curve: Spline, place: Placement3D, t1: number, t2: number): Shape[] {
    return bsplineEdges(curve.bspline(), ([x, y]) => place.GetPointFrom(x, y, 0), curve.IsPeriodic(), t1, t2);
}

function splineEdge(curve: Spline, place: Placement3D, t0: number, t1: number): Shape {
    return bsplineEdge(curve.bspline(), ([x, y]) => place.GetPointFrom(x, y, 0), t0, t1);
}

type P3 = { x: number, y: number, z: number };

function bsplineEdges(bspline: BSpline, pole: (p: Pole) => P3, periodic: boolean, t1: number, t2: number): Shape[] {
    const { tmin, tmax } = bspline;
    if (periodic && t2 > tmax + 1e-12) {
        const period = tmax - tmin;
        return [bsplineEdge(bspline, pole, t1, tmax), bsplineEdge(bspline, pole, tmin, t2 - period)];
    }
    return [bsplineEdge(bspline, pole, t1, t2)];
}

// A B-spline as an exact OCCT B-spline edge, trimmed to [t0, t1].
function bsplineEdge(bspline: BSpline, pole: (p: Pole) => P3, t0: number, t1: number): Shape {
    const { knots, mults } = bspline.uniqueKnots();
    const poles = new oc.NCollection_Array1_gp_Pnt(1, bspline.poles.length);
    for (const [i, p] of bspline.poles.entries()) poles.SetValue(i + 1, gpPnt(pole(p)));
    const K = new oc.NCollection_Array1_double(1, knots.length);
    const M = new oc.NCollection_Array1_int(1, mults.length);
    knots.forEach((k, i) => K.SetValue(i + 1, k));
    mults.forEach((m, i) => M.SetValue(i + 1, m));
    const geom = new oc.Geom_BSplineCurve(poles, K, M, bspline.degree, false);
    const full = Math.abs(t0 - bspline.tmin) < 1e-12 && Math.abs(t1 - bspline.tmax) < 1e-12;
    const maker = full ? new oc.BRepBuilderAPI_MakeEdge(geom) : new oc.BRepBuilderAPI_MakeEdge(geom, t0, t1);
    const edge = maker.Edge();
    maker.delete(); poles.delete(); K.delete(); M.delete();
    return edge;
}

// Edges of a 3D curve: exact for lines, polylines, arcs, ellipses, splines and planar curves.
export function edgesOf3d(curve: Curve3D): Shape[] {
    if (curve instanceof Contour3D) return curve.segments.flatMap(edgesOf3d);
    if (curve instanceof ContourOnSurface) return edgesOf2d(curve.contour, curve.surface.placement);
    if (curve instanceof TrimmedCurve3D) {
        const edges = rangeEdges3d(curve.basis, curve.t1, curve.t2);
        return curve.sense > 0 ? edges : edges.reverse().map(e => e.Reversed());
    }
    return rangeEdges3d(curve, curve.tmin, curve.tmax);
}

export function segmentEdge(a: CartPoint3D, b: CartPoint3D): Shape[] {
    if (a.distanceTo(b) < 1e-9) return [];
    return [new oc.BRepBuilderAPI_MakeEdge(gpPnt(a), gpPnt(b)).Edge()];
}

function rangeEdges3d(curve: Curve3D, t1: number, t2: number): Shape[] {
    const whole = Math.abs(t1 - curve.tmin) < 1e-12 && Math.abs(t2 - curve.tmax) < 1e-12;
    if (curve instanceof LineSegment3D || curve instanceof Line3D) return segmentEdge(curve._PointOn(t1), curve._PointOn(t2));
    if (curve instanceof Spline3D) return bsplineEdges(curve.bspline(), ([x, y, z]) => ({ x, y, z }), curve.IsPeriodic(), t1, t2);
    if (curve instanceof Polyline3D) {
        const n = curve.points.length;
        const points = [curve.PointOn(t1)];
        for (let k = Math.floor(t1) + 1; k < t2 - 1e-9; k++) points.push(curve.points[k % n].clone());
        points.push(whole && curve.closed ? curve.points[0].clone() : curve.PointOn(t2));
        const result: Shape[] = [];
        for (let i = 0; i < points.length - 1; i++) result.push(...segmentEdge(points[i], points[i + 1]));
        return result;
    }
    if (curve instanceof Arc3D) return [arcEdge(curve, t1, t2)];
    // A helix: the cubic B-spline through 48 of its points per turn, with the same parametrization.
    if (curve instanceof ConeSpiral) return [interpolatedEdge(curve, t1, t2, Math.max(8, Math.ceil(Math.abs(t2 - t1) / (Math.PI / 24))))];
    if (curve instanceof PlaneCurve) return edgesOf2d(whole ? curve.curve : new TrimmedCurve(curve.curve, t1, t2, 1), curve.placement);
    if (whole && (curve instanceof TrimmedCurve3D || curve instanceof Contour3D || curve instanceof ContourOnSurface)) return edgesOf3d(curve);
    // Anything else: an approximating B-spline through points of the curve.
    const n = 64;
    const points = new oc.NCollection_Array1_gp_Pnt(1, n + 1);
    for (let i = 0; i <= n; i++) points.SetValue(i + 1, gpPnt(curve.PointOn(t1 + (t2 - t1) * i / n)));
    const approx = new oc.GeomAPI_PointsToBSpline(points, 3, 8, oc.GeomAbs_Shape.GeomAbs_C2, 1e-6);
    const edge = new oc.BRepBuilderAPI_MakeEdge(approx.Curve()).Edge();
    approx.delete(); points.delete();
    return [edge];
}

// The interpolating cubic B-spline through n + 1 points of the curve, at the curve's own parameters.
function interpolatedEdge(curve: Curve3D, t1: number, t2: number, n: number): Shape {
    const points = new oc.NCollection_Array1_gp_Pnt(1, n + 1), params = new oc.NCollection_Array1_double(1, n + 1);
    for (let i = 0; i <= n; i++) {
        const t = t1 + (t2 - t1) * i / n;
        points.SetValue(i + 1, gpPnt(curve._PointOn(t)));
        params.SetValue(i + 1, t);
    }
    const hPoints = new oc.NCollection_HArray1_gp_Pnt(points), hParams = new oc.NCollection_HArray1_double(params);
    const interpolate = new oc.GeomAPI_Interpolate(hPoints, hParams, false, 1e-9);
    // The exact end derivatives; without them the natural end conditions make the ends the least accurate part.
    const a = curve._FirstDer(t1), b = curve._FirstDer(t2);
    interpolate.Load(new oc.gp_Vec(a.x, a.y, a.z), new oc.gp_Vec(b.x, b.y, b.z), false);
    interpolate.Perform();
    if (!interpolate.IsDone()) { interpolate.delete(); throw new KernelError("Could not convert the curve") }
    const edge = new oc.BRepBuilderAPI_MakeEdge(interpolate.Curve()).Edge();
    interpolate.delete(); points.delete(); params.delete();
    return edge;
}

// A circle or ellipse arc, a·cos(t)·X + b·sin(t)·Y around the centre, for t in [t1, t2].
function arcEdge(arc: Arc3D, t1: number, t2: number): Shape {
    const P = arc.placement;
    let X = P.axisX, Y = P.axisY, a = arc.a, b = arc.b, shift = 0;
    if (b > a + 1e-12) {
        // OCCT ellipses have their major axis along X: with t' = t - π/2 the same points are b·cos(t')·Y + a·sin(t')·(-X).
        [X, Y] = [Y, new Vector3D(-X.x, -X.y, -X.z)];
        [a, b] = [b, a];
        shift = -Math.PI / 2;
    }
    const ax2 = new oc.gp_Ax2(gpPnt(P.origin), gpDir(cross(X, Y)), gpDir(X));
    const geom = Math.abs(a - b) < 1e-12 ? new oc.gp_Circ(ax2, a) : new oc.gp_Elips(ax2, a, b);
    const full = Math.abs(t2 - t1 - 2 * Math.PI) < 1e-9;
    const maker = full ? new oc.BRepBuilderAPI_MakeEdge(geom) : new oc.BRepBuilderAPI_MakeEdge(geom, t1 + shift, t2 + shift);
    const edge = maker.Edge();
    maker.delete();
    return edge;
}

export function wireOf(edges: Shape[]): Shape {
    const builder = new oc.BRepBuilderAPI_MakeWire();
    for (const e of edges) builder.Add(oc.TopoDS.Edge(e));
    if (!builder.IsDone()) throw new KernelError("Could not build a wire from the curve: its pieces do not connect");
    const wire = builder.Wire();
    builder.delete();
    return wire;
}

export function wireOf2d(contour: Curve, place: Placement3D): Shape { return wireOf(edgesOf2d(contour, place)) }
export function wireOf3d(curve: Curve3D): Shape { return wireOf(edgesOf3d(curve)) }

export function faceOfRegion(region: Region, place: Placement3D): Shape {
    region.SetCorrect();
    const [outer, ...holes] = region.contours;
    const outerWire = wireOf2d(outer, place);
    const pln = new oc.gp_Pln(new oc.gp_Ax3(gpPnt(place.origin), gpDir(place.axisZ), gpDir(place.axisX)));
    const builder = new oc.BRepBuilderAPI_MakeFace(pln, outerWire, true);
    for (const hole of holes) builder.Add(wireOf2d(hole, place));
    if (!builder.IsDone()) throw new KernelError("Could not build a face from the region");
    let face = builder.Face();
    builder.delete();
    const fix = new oc.ShapeFix_Face(face);
    fix.Perform();
    face = fix.Face();
    fix.delete();
    return face;
}

export function volume(shape: Shape) {
    const props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
    const v = props.Mass();
    props.delete();
    return v;
}

export function prism(face: Shape, direction: Vector3D, from: number, to: number): Shape {
    if (Math.abs(to - from) < 1e-9) throw new KernelError("Extrusion distance is zero");
    let start = face;
    if (Math.abs(from) > 0) {
        const m = new Matrix3D();
        m.Move(new Vector3D(direction.x * from, direction.y * from, direction.z * from));
        start = transformShape(face, m);
    }
    const length = to - from;
    const maker = new oc.BRepPrimAPI_MakePrism(start, gpVec(new Vector3D(direction.x * length, direction.y * length, direction.z * length)), false, true);
    const result = maker.Shape();
    maker.delete();
    return orient(result);
}

// Solids built by sweeping can come out inside out (negative volume); turn them the right way.
export function orient(shape: Shape): Shape {
    return volume(shape) < 0 ? shape.Reversed() : shape;
}

export function compound(shapes: Shape[]): Shape {
    if (shapes.length === 1) return shapes[0];
    const builder = new oc.TopoDS_Builder();
    const c = new oc.TopoDS_Compound();
    builder.MakeCompound(c);
    for (const s of shapes) builder.Add(c, s);
    builder.delete();
    return c;
}

// The planar profile of a sweep: its closed contours as regions, and its open curves.
export type Profile = { placement: Placement3D, regions: Region[], open: Curve[] };

export function sweptProfile(data: SweptData, what: string): Profile {
    if (data.contours.length > 0) {
        const placement = data.placement ?? (data.surface instanceof Plane ? data.surface.GetPlacement() : undefined);
        if (placement === undefined) throw new KernelError(`Only planar profiles can be ${what} by the OCCT kernel`);
        const closed = data.contours.filter(c => c.IsClosed());
        const open = data.contours.filter(c => !c.IsClosed());
        return { placement, regions: closed.length > 0 ? correctRegions(closed) : [], open };
    }
    if (data.curve3d !== undefined) {
        const curve = data.curve3d;
        if (!curve.IsPlanar()) throw new KernelError(`Only planar profiles can be ${what} by the OCCT kernel`);
        const { curve2d, placement } = curve.GetPlaneCurve(false);
        if (curve.IsClosed()) return { placement, regions: correctRegions([new Contour([curve2d], true)]), open: [] };
        return { placement, regions: [], open: [curve2d] };
    }
    throw new KernelError(`Nothing to be ${what}`);
}

export function hasThickness(params: { thickness1: number, thickness2: number }) {
    return params.thickness1 !== 0 || params.thickness2 !== 0;
}

export function unionAll(shapes: Shape[]): Shape {
    let shape = shapes[0];
    for (const s of shapes.slice(1)) shape = boolean(shape, s, OperationType.Union);
    return shape;
}

// Extrudes from -side2 to side1 along the direction. Each side's draft angle (rake, in radians) tilts the sides of
// the extrusion: positive narrows the profile going away from its plane, negative widens it.
export function extrude(data: SweptData, direction: Vector3D, params: ExtrusionValues): Solid {
    const { regions, open, placement } = sweptProfile(data, "extruded");
    const thin = hasThickness(params);
    if (open.length > 0 && !thin) throw new KernelError("Extruding open curves into surfaces is not implemented by the OCCT kernel; give the extrusion a thickness to make a wall");
    const rake1 = params.side1.rake, rake2 = params.side2.rake;
    for (const rake of [rake1, rake2]) if (Math.abs(rake) >= Math.PI / 2 - 1e-6) throw new KernelError("Draft angles must be less than 90°");
    const dir = normalized(direction);
    const from = Math.min(-params.side2.scalarValue, params.side1.scalarValue), to = Math.max(-params.side2.scalarValue, params.side1.scalarValue);
    if (to - from < 1e-9) throw new KernelError("Extrusion distance is zero");
    // The extent is split at the profile's plane, since the two sides may have different draft angles. Without draft
    // it is one prism, so that an extrusion to both sides has whole faces with no seam along the profile's plane.
    const segments: [number, number, number][] = [];
    if (Math.abs(rake1) < 1e-12 && Math.abs(rake2) < 1e-12) segments.push([from, to, 0]);
    else {
        if (from < 0) segments.push([from, Math.min(to, 0), rake2]);
        if (to > 0) segments.push([Math.max(from, 0), to, rake1]);
    }
    return occ("Extrusion", () => {
        // Each profile is given as its cross-section at an inward offset (by which a draft angle narrows it).
        const profiles: ((inward: number) => Shape[])[] = [];
        for (const region of regions) {
            const face = faceOfRegion(region, placement);
            const tapered = (inward: number) => {
                if (Math.abs(inward) < 1e-12) return face;
                const faces = offsetFace2d(face, inward);
                if (faces.length !== 1) throw new KernelError("The draft angle is too large for this profile");
                return faces[0];
            };
            // A thin-walled extrusion: the band around the profile's boundary, extruded; open at both ends.
            profiles.push(inward => thin ? wallFaces(tapered(inward), params.thickness1, params.thickness2) : [tapered(inward)]);
        }
        // A wall along an open curve: the band from thickness1 on its right to thickness2 on its left, extruded
        // (a draft angle leans it to the left).
        for (const curve of open) {
            const wire = wireOf2d(curve, placement);
            profiles.push(inward => [openBand(Math.abs(inward) < 1e-12 ? wire : offsetOpenWire(wire, inward), params.thickness1, params.thickness2)]);
        }
        const parts: Shape[] = [];
        for (const profile of profiles) for (const [a, b, rake] of segments) parts.push(...taperedPrism(profile, dir, a, b, rake));
        return new Solid(checked(unionAll(parts), "Extrusion"));
    });
}

// A profile extruded between distances a < b along dir, with its sides tilted so that at distance t the
// cross-section is the profile offset inwards by |t|·tan(rake).
export function taperedPrism(profile: (inward: number) => Shape[], dir: Vector3D, a: number, b: number, rake: number): Shape[] {
    if (Math.abs(rake) < 1e-12) return profile(0).map(face => prism(face, dir, a, b));
    const section = (t: number) => profile(-Math.abs(t) * Math.tan(rake)).map(face => {
        const m = new Matrix3D();
        m.Move(new Vector3D(dir.x * t, dir.y * t, dir.z * t));
        return transformShape(face, m);
    });
    const starts = section(a), ends = section(b);
    if (starts.length !== ends.length) throw new KernelError("The draft angle is too large for this profile");
    // Each face of the start section continues in the end section's face whose centre is nearest, seen along dir.
    const faceCentre = (f: Shape) => {
        const props = new oc.GProp_GProps();
        oc.BRepGProp.SurfaceProperties(f, props, false, false);
        const c = cart(props.CentreOfMass());
        props.delete();
        return c;
    };
    const across = (p: CartPoint3D, q: CartPoint3D) => {
        const d = new Vector3D(q.x - p.x, q.y - p.y, q.z - p.z);
        const along = dot(d, dir);
        return Math.hypot(d.x - along * dir.x, d.y - along * dir.y, d.z - along * dir.z);
    };
    const remainingEnds = [...ends];
    return starts.map(start => {
        const c = faceCentre(start);
        remainingEnds.sort((x, y) => across(c, faceCentre(x)) - across(c, faceCentre(y)));
        return taperedSolid(start, remainingEnds.shift()!, dir);
    });
}

// The ruled solid between two corresponding planar faces.
function taperedSolid(start: Shape, end: Shape, dir: Vector3D): Shape {
    const holesOf = (f: Shape) => {
        const outer = oc.BRepTools.OuterWire(oc.TopoDS.Face(f));
        return { outer, holes: explore(f, oc.TopAbs_ShapeEnum.TopAbs_WIRE).filter(w => !w.IsSame(outer)) };
    };
    const s = holesOf(start), e = holesOf(end);
    if (s.holes.length !== e.holes.length) throw new KernelError("The draft angle is too large for this profile");
    // Each hole of the start section continues in the end section's hole whose centre is nearest, seen along dir.
    const centre = (w: Shape) => {
        const props = new oc.GProp_GProps();
        oc.BRepGProp.LinearProperties(w, props, false, false);
        const c = cart(props.CentreOfMass());
        props.delete();
        return c;
    };
    const across = (p: CartPoint3D, q: CartPoint3D) => {
        const d = new Vector3D(q.x - p.x, q.y - p.y, q.z - p.z);
        const along = dot(d, dir);
        return Math.hypot(d.x - along * dir.x, d.y - along * dir.y, d.z - along * dir.z);
    };
    const remaining = [...e.holes];
    let solid = ruledLoft(s.outer, e.outer);
    for (const hole of s.holes) {
        const c = centre(hole);
        remaining.sort((x, y) => across(c, centre(x)) - across(c, centre(y)));
        solid = boolean(solid, ruledLoft(hole, remaining.shift()!), OperationType.Difference);
    }
    return solid;
}

function ruledLoft(w0: Shape, w1: Shape): Shape {
    const maker = new oc.BRepOffsetAPI_ThruSections(true, true, 1e-6);
    maker.AddWire(oc.TopoDS.Wire(w0));
    maker.AddWire(oc.TopoDS.Wire(w1));
    maker.CheckCompatibility(true);
    maker.Build(new oc.Message_ProgressRange());
    if (!maker.IsDone()) { maker.delete(); throw new KernelError("The draft angle is too large for this profile") }
    const result = maker.Shape();
    maker.delete();
    return solidOf(result);
}

// A wire of one edge as two edges: OCCT's planar offset cannot offset a single open edge.
function splitSingleEdge(wire: Shape): Shape {
    const edges = explore(wire, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
    if (edges.length !== 1) return wire;
    const { returnValue: curve, First: a, Last: b } = oc.BRep_Tool.Curve(oc.TopoDS.Edge(edges[0]), 0, 0);
    const m = (a + b) / 2;
    const halves = [new oc.BRepBuilderAPI_MakeEdge(curve, a, m).Edge(), new oc.BRepBuilderAPI_MakeEdge(curve, m, b).Edge()];
    return wireOf(edges[0].Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? halves.reverse().map(h => h.Reversed()) : halves);
}

// The planar band along an open wire, from `right` on its right side to `left` on its left side.
// An open planar wire offset sideways within its plane: to its right for positive d.
export function offsetOpenWire(wire: Shape, d: number): Shape {
    const maker = new oc.BRepOffsetAPI_MakeOffset(oc.TopoDS.Wire(splitSingleEdge(wire)), oc.GeomAbs_JoinType.GeomAbs_Intersection, true);
    maker.Perform(d, 0);
    if (!maker.IsDone()) { maker.delete(); throw new KernelError("The thickness is too large for this curve") }
    const wires = explore(maker.Shape(), oc.TopAbs_ShapeEnum.TopAbs_WIRE);
    maker.delete();
    if (wires.length !== 1) throw new KernelError("The thickness is too large for this curve");
    return wires[0];
}

export function openBand(wire: Shape, right: number, left: number): Shape {
    const offset = (d: number) => Math.abs(d) < 1e-12 ? wire : offsetOpenWire(wire, d);
    const ends = (w: Shape) => {
        const vertices = explore(w, oc.TopAbs_ShapeEnum.TopAbs_VERTEX);
        const unique: Shape[] = [];
        for (const v of vertices) if (!unique.some(u => u.IsSame(v))) unique.push(v);
        return unique.filter(u => vertices.filter(v => v.IsSame(u)).length === 1).map(v => cart(oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(v))));
    };
    const [start, end] = ends(wire);
    const r = offset(right), l = offset(-left);
    const nearest = (points: CartPoint3D[], p: CartPoint3D) => points.reduce((best, q) => q.distanceTo(p) < best.distanceTo(p) ? q : best);
    const rs = nearest(ends(r), start), re = nearest(ends(r), end), ls = nearest(ends(l), start), le = nearest(ends(l), end);
    // The two sides and the straight ends between them; the list form of Add joins edges in any order.
    const list = new oc.NCollection_List_TopoDS_Shape();
    for (const e of [...explore(r, oc.TopAbs_ShapeEnum.TopAbs_EDGE), ...segmentEdge(re, le), ...explore(l, oc.TopAbs_ShapeEnum.TopAbs_EDGE), ...segmentEdge(ls, rs)]) list.Append(e);
    const builder = new oc.BRepBuilderAPI_MakeWire();
    builder.Add(list);
    list.delete();
    if (!builder.IsDone()) { builder.delete(); throw new KernelError("The thickness is too large for this curve") }
    const closed = builder.Wire();
    builder.delete();
    const faceMaker = new oc.BRepBuilderAPI_MakeFace(closed, true);
    if (!faceMaker.IsDone()) { faceMaker.delete(); throw new KernelError("The thickness is too large for this curve") }
    const fix = new oc.ShapeFix_Face(faceMaker.Face());
    faceMaker.delete();
    fix.Perform(new oc.Message_ProgressRange());
    const face = fix.Face();
    fix.delete();
    return face;
}

export type PlaneSpec = { origin: CartPoint3D, normal: Vector3D };

// Planar faces of a shape that lie in one of the given planes: the end caps of a sweep.
export function capFaces(shape: Shape, planes: PlaneSpec[]): Shape[] {
    const result: Shape[] = [];
    const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) {
        const face = oc.TopoDS.Face(ex.Current());
        const adaptor = new oc.BRepAdaptor_Surface(face, true);
        if (adaptor.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
            const ax = adaptor.Plane().Position();
            const origin = cart(ax.Location()), normal = vec(ax.Direction());
            const inPlane = planes.some(p => {
                const parallel = Math.abs(Math.abs(dot(normal, p.normal)) - 1) < 1e-9;
                const d = dot(new Vector3D(origin.x - p.origin.x, origin.y - p.origin.y, origin.z - p.origin.z), p.normal);
                return parallel && Math.abs(d) < 1e-6;
            });
            if (inPlane) result.push(face);
        }
        adaptor.delete();
    }
    ex.delete();
    return result;
}

// ---- Offsets: thin-walled solids, offset faces, thickened sheets ----

function area(face: Shape) {
    const props = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(face, props, false, false);
    const a = props.Mass();
    props.delete();
    return a;
}

export function distanceToShape(p: { x: number, y: number, z: number }, shape: Shape) {
    const vertex = new oc.BRepBuilderAPI_MakeVertex(gpPnt(p)).Vertex();
    const dist = new oc.BRepExtrema_DistShapeShape(vertex, shape);
    const result = dist.IsDone() ? dist.Value() : Infinity;
    dist.delete();
    return result;
}

export function explore(shape: Shape, type: any, avoid: any = oc.TopAbs_ShapeEnum.TopAbs_SHAPE): Shape[] {
    const result: Shape[] = [];
    const ex = new oc.TopExp_Explorer(shape, type, avoid);
    for (; ex.More(); ex.Next()) result.push(ex.Current());
    ex.delete();
    return result;
}

// Faces bounded by closed planar wires; wires nested in an odd number of others are holes.
export function facesOfWires(wires: Shape[]): Shape[] {
    const items = wires.map(w => {
        const face = new oc.BRepBuilderAPI_MakeFace(oc.TopoDS.Wire(w), true).Face();
        const vertex = explore(w, oc.TopAbs_ShapeEnum.TopAbs_VERTEX)[0];
        return { face, area: Math.abs(area(face)), point: cart(oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(vertex))) };
    }).sort((a, b) => b.area - a.area);
    const parents = items.map((item, i) => items.slice(0, i).filter(other => distanceToShape(item.point, other.face) < 1e-7));
    const result: Shape[] = [];
    for (const [i, item] of items.entries()) {
        if (parents[i].length % 2 === 1) continue;
        let face = item.face;
        for (const [j, hole] of items.entries()) {
            if (parents[j].length === parents[i].length + 1 && parents[j].includes(item)) face = boolean(face, hole.face, OperationType.Difference);
        }
        result.push(...explore(face, oc.TopAbs_ShapeEnum.TopAbs_FACE));
    }
    return result;
}

// A planar face grown (d > 0) or shrunk (d < 0) within its plane; empty if it shrinks away. Corners stay sharp.
export function offsetFace2d(face: Shape, d: number): Shape[] {
    if (Math.abs(d) < 1e-12) return [face];
    const maker = new oc.BRepOffsetAPI_MakeOffset(oc.TopoDS.Face(splitClosedEdges(face)), oc.GeomAbs_JoinType.GeomAbs_Intersection, false);
    maker.Perform(d, 0);
    if (!maker.IsDone()) {
        maker.delete();
        if (d < 0) return [];
        throw new KernelError("The thickness is too large for this profile");
    }
    const wires = explore(maker.Shape(), oc.TopAbs_ShapeEnum.TopAbs_WIRE);
    maker.delete();
    return wires.length === 0 ? [] : facesOfWires(wires);
}

// The same planar face with every boundary made of a single closed edge (a whole circle) split into two edges:
// OCCT's planar offset cannot shrink a boundary that has only one edge.
// (The face is rebuilt either way: OCCT's planar offset also fails on some faces that come out of booleans.)
function splitClosedEdges(face: Shape): Shape {
    const forward = oc.TopoDS.Face(face.Oriented(oc.TopAbs_Orientation.TopAbs_FORWARD));
    const wires = explore(forward, oc.TopAbs_ShapeEnum.TopAbs_WIRE);
    const outer = oc.BRepTools.OuterWire(forward);
    const rebuilt = wires.map(w => {
        const edges = explore(w, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
        if (edges.length !== 1) return w;
        const edge = oc.TopoDS.Edge(edges[0]);
        const { returnValue: curve, First: a, Last: b } = oc.BRep_Tool.Curve(edge, 0, 0);
        const m = (a + b) / 2;
        const halves = [new oc.BRepBuilderAPI_MakeEdge(curve, a, m).Edge(), new oc.BRepBuilderAPI_MakeEdge(curve, m, b).Edge()];
        const list = new oc.NCollection_List_TopoDS_Shape();
        for (const h of halves) list.Append(h.Oriented(edges[0].Orientation()));
        const builder = new oc.BRepBuilderAPI_MakeWire();
        builder.Add(list);
        list.delete();
        const wire = builder.Wire();
        builder.delete();
        return wire;
    });
    const fix = new oc.ShapeFix_Face();
    fix.Init(oc.BRep_Tool.Surface(forward), 1e-7, true);
    const outerIndex = wires.findIndex(w => w.IsSame(outer));
    fix.Add(oc.TopoDS.Wire(rebuilt[outerIndex]));
    for (const [i, w] of rebuilt.entries()) if (i !== outerIndex) fix.Add(oc.TopoDS.Wire(w));
    fix.Perform(new oc.Message_ProgressRange());
    const result = fix.Face();
    fix.delete();
    return face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? result.Reversed() : result;
}

// The band along the boundary of a planar face, from thickness2 inside to thickness1 outside.
export function wallFaces(face: Shape, thickness1: number, thickness2: number): Shape[] {
    const hi = Math.max(thickness1, -thickness2), lo = Math.min(thickness1, -thickness2);
    if (hi - lo < 1e-9) throw new KernelError("Thickness must not be zero");
    const outer = offsetFace2d(face, hi), inner = offsetFace2d(face, lo);
    if (outer.length === 0) throw new KernelError("The thickness is too large for this profile");
    const band = inner.length === 0 ? compound(outer) : boolean(compound(outer), compound(inner), OperationType.Difference);
    return explore(band, oc.TopAbs_ShapeEnum.TopAbs_FACE);
}

// The single closed outer wire of a planar section offset by d within its plane.
export function offsetWire2d(wire: Shape, d: number): Shape {
    const faces = offsetFace2d(new oc.BRepBuilderAPI_MakeFace(oc.TopoDS.Wire(wire), true).Face(), d);
    if (faces.length !== 1) throw new KernelError("The thickness is too large for this profile");
    return oc.BRepTools.OuterWire(oc.TopoDS.Face(faces[0]));
}

const OFFSET_TOLERANCE = 1e-6;

export function shapeList(shapes: Shape[]) {
    const list = new oc.NCollection_List_TopoDS_Shape();
    for (const s of shapes) list.Append(s);
    return list;
}

// The whole solid offset outward by `d` (inward when negative), keeping sharp edges sharp.
function offsetShape(shape: Shape, d: number): Shape {
    const maker = new oc.BRepOffsetAPI_MakeOffsetShape();
    maker.PerformByJoin(shape, d, OFFSET_TOLERANCE, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Intersection, false, new oc.Message_ProgressRange());
    if (!maker.IsDone()) { maker.delete(); throw new KernelError("The offset is too large for this shape") }
    const result = maker.Shape();
    maker.delete();
    return solidOf(result);
}

// Walls of thickness |d| along the faces of the solid that are not removed: outside the solid when d > 0, inside when d < 0.
// Faces offset from the `kept` faces come first in the result, in that order.
function thick(shape: Shape, removed: Shape[], d: number, kept: Shape[] = []): Shape {
    const maker = new oc.BRepOffsetAPI_MakeThickSolid();
    const list = shapeList(removed);
    maker.MakeThickSolidByJoin(shape, list, d, OFFSET_TOLERANCE, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Intersection, false, new oc.Message_ProgressRange());
    list.delete();
    if (!maker.IsDone()) { maker.delete(); throw new KernelError("The thickness is too large for this shape") }
    let result = solidOf(maker.Shape());
    const first: Shape[] = [];
    for (const face of kept) {
        const generated = new oc.NCollection_List_TopoDS_Shape(maker.Generated(face));
        while (!generated.IsEmpty()) {
            const g = generated.First();
            if (g.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_FACE) first.push(g);
            generated.RemoveFirst();
        }
        generated.delete();
    }
    maker.delete();
    if (first.length > 0) result = facesFirst(result, first);
    return result;
}

// The single solid in a shape, the right way out.
export function solidOf(shape: Shape): Shape {
    const solids = solidsOf(shape);
    if (solids.length === 1) return orient(solids[0]);
    if (solids.length > 1) return orient(compound(solids));
    const shells: Shape[] = [];
    const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) shells.push(oc.TopoDS.Shell(ex.Current()));
    ex.delete();
    if (shells.length === 0) throw new KernelError("The operation did not produce a solid");
    const fix = new oc.ShapeFix_Solid();
    const result = orient(fix.SolidFromShell(shells[0]));
    fix.delete();
    return result;
}

// The same solid with its faces reordered so that `first` come first (faces are numbered in shell order).
function facesFirst(solid: Shape, first: Shape[]): Shape {
    const shells: Shape[] = [];
    const sx = new oc.TopExp_Explorer(solid, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; sx.More(); sx.Next()) shells.push(sx.Current());
    sx.delete();
    if (shells.length !== 1) return solid;
    const faces: Shape[] = [];
    const fx = new oc.TopExp_Explorer(shells[0], oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; fx.More(); fx.Next()) faces.push(fx.Current());
    fx.delete();
    const head: Shape[] = [];
    for (const f of first) {
        const g = faces.find(g => g.IsSame(f));
        if (g !== undefined && !head.includes(g)) head.push(g);
    }
    const tail = faces.filter(f => !head.includes(f));
    const builder = new oc.TopoDS_Builder();
    const shell = new oc.TopoDS_Shell();
    builder.MakeShell(shell);
    // Faces taken from the explored shell carry its orientation; undo it so the rebuilt shell can apply it again.
    for (const f of [...head, ...tail]) builder.Add(shell, shells[0].Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? f.Reversed() : f);
    shell.Closed(true);
    const result = new oc.TopoDS_Solid();
    builder.MakeSolid(result);
    builder.Add(result, shell.Oriented(shells[0].Orientation()));
    builder.delete();
    return isValid(result) ? orient(result) : solid;
}

// A thin-walled solid: walls from thickness2 inside to thickness1 outside the surface of the solid, open where faces are removed.
export function thinShape(shape: Shape, removed: Shape[], thickness1: number, thickness2: number, kept: Shape[] = []): Shape {
    const hi = Math.max(thickness1, -thickness2), lo = Math.min(thickness1, -thickness2);
    if (hi - lo < 1e-9) throw new KernelError("Thickness must not be zero");
    if (lo > 1e-12 || hi < -1e-12) throw new KernelError("The two thicknesses must be on opposite sides of the surface");
    if (removed.length === 0) {
        // A closed hollow solid.
        const outside = hi > 1e-12 ? offsetShape(shape, hi) : shape;
        const inside = lo < -1e-12 ? offsetShape(shape, lo) : shape;
        return boolean(outside, inside, OperationType.Difference);
    }
    if (lo > -1e-12) return thick(shape, removed, hi, kept);
    if (hi < 1e-12) return thick(shape, removed, lo, kept);
    const both = boolean(thick(shape, removed, hi), thick(shape, removed, lo), OperationType.Union);
    return unify(both, new MergingFlags(true, true));
}

export function thinSolid(solid: Solid, removed: Face[], thickness1: number, thickness2: number): Solid {
    return occ("Shell", () => {
        const kept = solid.GetFaces().filter(f => !removed.includes(f));
        try {
            return new Solid(checked(thinShape(solid.shape, removed.map(f => f.shape), thickness1, thickness2, kept.map(f => f.shape)), "Shell"));
        } catch (e) {
            // OCCT's thick solid fails on many shapes. Walls on faces that do not touch each other are just their slabs.
            const t = thickness2 === 0 ? thickness1 : thickness1 === 0 ? -thickness2 : 0;
            const separate = kept.every(f => f.GetNeighborFaces().every(g => !kept.includes(g)));
            if (removed.length === 0 || t === 0 || !separate) throw e;
            const slabs = kept.map(f => faceSlab(solid, f, t));
            if (slabs.some(s => s === undefined)) throw e;
            // Offset faces first, in the order of the kept faces.
            const result = new Solid(checked(unionAll(slabs), "Shell"));
            const first = kept.map(f => {
                const { point, normal } = f.GetAnyPointOn();
                const target = new CartPoint3D(point.x + normal.x * t, point.y + normal.y * t, point.z + normal.z * t);
                return faceAt(result, target, t > 0 ? normal : new Vector3D(-normal.x, -normal.y, -normal.z))?.shape;
            }).filter(f => f !== undefined);
            return new Solid(facesFirst(result.shape, first));
        }
    });
}

function distanceToFace(face: Face, p: CartPoint3D) {
    const vertex = new oc.BRepBuilderAPI_MakeVertex(gpPnt(p)).Vertex();
    const dist = new oc.BRepExtrema_DistShapeShape(vertex, face.shape);
    const result = dist.IsDone() ? dist.Value() : Infinity;
    dist.delete();
    return result;
}

// The face of a solid through a point, with the given normal there.
export function faceAt(solid: Solid, p: CartPoint3D, normal: Vector3D): Face | undefined {
    return solid.GetFaces().find(f => distanceToFace(f, p) < 1e-6 && dot(f.NearPointProjection(p).normal, normal) > 1 - 1e-6);
}

// The slab between a planar face and its offset by d along its normal, bounded by the extended surfaces of its neighbours;
// undefined for faces this cannot be built for.
export function faceSlab(solid: Solid, face: Face, d: number): Shape | undefined {
    if (!face.IsPlanar()) return undefined;
    const place = face.planePlacement();
    const n = place.axisZ;
    const neighbours: { edge: CurveEdge, other: Face }[] = [];
    for (const edge of solid.faceEdges(face)) {
        const other = solid.edgeFaces(edge).find(f => f !== face);
        if (other === undefined) return undefined;
        neighbours.push({ edge, other });
    }
    // Neighbours that run along the normal (walls of a box or an extrusion, holes), or that lie in the face's own plane
    // (the rest of a face divided by an offset loop or an imprint): the slab is a prism.
    const along = neighbours.every(({ edge, other }) => [0.2, 0.5, 0.8].every(t => {
        const c = Math.abs(dot(other.NearPointProjection(edge.Point(t)).normal, n));
        return c < 1e-7 || (c > 1 - 1e-7 && other.IsPlanar());
    }));
    if (along) {
        const copy = transformShape(face.shape, new Matrix3D());
        return prism(copy, n, Math.min(0, d), Math.max(0, d));
    }
    return planesSlab(face, place, neighbours, d);
}

// Solves for the point on three planes (point·normal = offset); undefined if two of them are parallel.
export function threePlanes(planes: { normal: Vector3D, offset: number }[]): CartPoint3D | undefined {
    const [a, b, c] = planes.map(p => p.normal);
    const det = dot(a, cross(b, c));
    if (Math.abs(det) < 1e-9) return undefined;
    const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b);
    const [da, db, dc] = planes.map(p => p.offset);
    return new CartPoint3D((da * bc.x + db * ca.x + dc * ab.x) / det, (da * bc.y + db * ca.y + dc * ab.y) / det, (da * bc.z + db * ca.z + dc * ab.z) / det);
}

function loopsFace(loops: CartPoint3D[][], normal: Vector3D): Shape | undefined {
    const wires = loops.map(loop => {
        const edges: Shape[] = [];
        for (let i = 0; i < loop.length; i++) edges.push(...segmentEdge(loop[i], loop[(i + 1) % loop.length]));
        return edges.length >= 3 ? wireOf(edges) : undefined;
    });
    if (wires[0] === undefined) return undefined;
    const p = loops[0][0];
    const pln = new oc.gp_Pln(gpPnt(p), gpDir(normal));
    const builder = new oc.BRepBuilderAPI_MakeFace(pln, wires[0], true);
    for (const w of wires.slice(1)) if (w !== undefined) builder.Add(w);
    if (!builder.IsDone()) { builder.delete(); return undefined }
    const fix = new oc.ShapeFix_Face(builder.Face());
    builder.delete();
    fix.Perform();
    const face = fix.Face();
    fix.delete();
    return face;
}

// The slab of a planar face whose edges are straight and whose neighbours are planes: each corner moves along the
// line where its two neighbouring planes meet.
function planesSlab(face: Face, place: Placement3D, neighbours: { edge: CurveEdge, other: Face }[], d: number): Shape | undefined {
    const n = place.axisZ;
    const top = { normal: n, offset: dot(n, place.origin) + d };
    const bottomLoops: CartPoint3D[][] = [], topLoops: CartPoint3D[][] = [];
    const sides: Shape[] = [];
    const { contours } = face.GetSurfaceCurvesData();
    for (const contour of contours) {
        const segments: { a: CartPoint3D, b: CartPoint3D, plane: { normal: Vector3D, offset: number } }[] = [];
        for (const s of contour.segments) {
            if (!s.IsStraight()) return undefined;
            const a = place.point3d(s.GetLimitPoint(1)), b = place.point3d(s.GetLimitPoint(2));
            if (a.distanceTo(b) < 1e-9) continue;
            const mid = new CartPoint3D((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
            const neighbour = neighbours.find(({ edge }) => edge.Point(edge.PointProjection(mid)).distanceTo(mid) < 1e-6);
            if (neighbour === undefined || !neighbour.other.IsPlanar()) return undefined;
            const g = neighbour.other.planePlacement();
            segments.push({ a, b, plane: { normal: g.axisZ, offset: dot(g.axisZ, g.origin) } });
        }
        const k = segments.length;
        const moved = segments.map((s, i) => {
            const prev = segments[(i - 1 + k) % k];
            const corner = threePlanes([top, prev.plane, s.plane]);
            if (corner !== undefined) return corner;
            // Collinear neighbours: the corner moves within the plane across the edge.
            const t = normalized(new Vector3D(s.b.x - s.a.x, s.b.y - s.a.y, s.b.z - s.a.z));
            return threePlanes([top, s.plane, { normal: t, offset: dot(t, s.a) }]);
        });
        if (moved.some(p => p === undefined)) return undefined;
        const loop = segments.map(s => s.a), movedLoop = moved as CartPoint3D[];
        for (let i = 0; i < k; i++) {
            const j = (i + 1) % k;
            const quad = [loop[i], loop[j], movedLoop[j], movedLoop[i]].filter((p, m, all) => p.distanceTo(all[(m + 1) % all.length]) > 1e-9);
            if (quad.length < 3) continue;
            const side = loopsFace([quad], segments[i].plane.normal);
            if (side === undefined) return undefined;
            sides.push(side);
        }
        bottomLoops.push(loop); topLoops.push(movedLoop);
    }
    const bottom = loopsFace(bottomLoops, n), cap = loopsFace(topLoops, n);
    if (bottom === undefined || cap === undefined) return undefined;
    const sewing = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
    for (const f of [bottom, cap, ...sides]) sewing.Add(f);
    sewing.Perform(new oc.Message_ProgressRange());
    const sewn = sewing.SewedShape();
    sewing.delete();
    try {
        const slab = solidOf(sewn);
        return isValid(slab) ? slab : undefined;
    } catch (e) {
        return undefined;
    }
}

// A sheet (an open shell or face) thickened into a solid: thickness1 along the sheet's normal, thickness2 against it.
export function thickenSheet(sheet: Shape, thickness1: number, thickness2: number): Shape {
    const hi = Math.max(thickness1, -thickness2), lo = Math.min(thickness1, -thickness2);
    if (hi - lo < 1e-9) throw new KernelError("Thickness must not be zero");
    let start = sheet;
    if (Math.abs(hi) > 1e-12) {
        const shift = new oc.BRepOffsetAPI_MakeOffsetShape();
        shift.PerformBySimple(sheet, hi);
        if (!shift.IsDone()) { shift.delete(); throw new KernelError("The thickness is too large for this shape") }
        start = shift.Shape();
        shift.delete();
    }
    const maker = new oc.BRepOffsetAPI_MakeThickSolid();
    maker.MakeThickSolidBySimple(start, lo - hi);
    if (!maker.IsDone()) { maker.delete(); throw new KernelError("The thickness is too large for this shape") }
    const result = solidOf(maker.Shape());
    maker.delete();
    return result;
}

// Offsets faces of a solid along their normals by `distance` (outward when positive), extending or trimming the neighbouring faces.
export function offsetFaces(solid: Solid, faces: Face[], distance: number): Solid {
    if (Math.abs(distance) < 1e-9) throw new KernelError("Offset distance is zero");
    return occ("Offset face", () => {
        if (faces.length === solid.GetFacesCount()) return new Solid(checked(offsetShape(solid.shape, distance), "Offset face"));
        const operation = distance > 0 ? OperationType.Union : OperationType.Difference;
        // Planar faces get a slab between the face and its offset, added or cut away. They are offset one after
        // another, each found again in the previous result, so that offset neighbours extend each other.
        const planar = faces.filter(f => f.IsPlanar());
        const targets = planar.map(f => f.GetAnyPointOn());
        let current = solid;
        for (const [i, { point, normal }] of targets.entries()) {
            const face = i === 0 ? planar[0] : faceAt(current, point, normal);
            if (face === undefined) throw new KernelError("Offset face failed: the offset of one face consumes another");
            const slab = faceSlab(current, face, distance) ?? thick(current.shape, current.GetFaces().filter(f => f !== face).map(f => f.shape), distance);
            const result = boolean(current.shape, slab, operation);
            // (C3D leaves a shell of no thickness when a face is moved exactly onto the far side; that is not a solid.)
            if (solidsOf(result).length === 0) throw new KernelError("The offset removes the whole solid");
            // Merge the slab's sides into the faces they continue, so the next face is found whole.
            current = new Solid(unify(result, new MergingFlags(true, true)));
        }
        // Curved faces: the walls of holes and bosses get an offset cross-section; any others get OCCT's offset bounded by their neighbours.
        for (const group of components(faces.filter(f => !f.IsPlanar()))) {
            const found = group.map(f => f.GetAnyPointOn()).map(({ point, normal }) => faceAt(current, point, normal));
            if (found.some(f => f === undefined)) throw new KernelError("Offset face failed: the offset of one face consumes another");
            const groupFaces = found as Face[];
            const rebuilt = offsetFeature(current, groupFaces, distance);
            if (rebuilt !== undefined) { current = rebuilt; continue }
            const others = current.GetFaces().filter(f => !groupFaces.includes(f));
            const slab = thick(current.shape, others.map(f => f.shape), distance);
            const result = boolean(current.shape, slab, operation);
            if (solidsOf(result).length === 0) throw new KernelError("The offset removes the whole solid");
            current = new Solid(unify(result, new MergingFlags(true, true)));
        }
        return new Solid(checked(unify(current.shape, new MergingFlags(true, true)), "Offset face"));
    });
}

// Tilts faces by `angle` around their intersection with the neutral plane; the pull direction is the plane's normal.
export function draft(solid: Solid, neutral: Placement3D, angle: number, faces: Face[], reverse: boolean): Solid {
    if (Math.abs(angle) < 1e-12) throw new KernelError("Draft angle is zero");
    return occ("Draft", () => {
        const Z = neutral.axisZ;
        const direction = gpDir(reverse ? new Vector3D(-Z.x, -Z.y, -Z.z) : Z);
        const plane = new oc.gp_Pln(gpPnt(neutral.origin), gpDir(Z));
        const maker = new oc.BRepOffsetAPI_DraftAngle(solid.shape);
        for (const face of faces) {
            maker.Add(face.shape, direction, angle, plane, true);
            if (!maker.AddDone()) { maker.delete(); throw new KernelError("Only planar, cylindrical and conical faces can be drafted by the OCCT kernel") }
        }
        maker.Build(new oc.Message_ProgressRange());
        if (!maker.IsDone()) { maker.delete(); throw new KernelError("Draft failed: the angle may be too large") }
        const result = maker.Shape();
        maker.delete();
        return new Solid(checked(result, "Draft"));
    });
}

// Results that OCCT reports as done can still be broken (self-intersecting); they must not reach the app, which would hang meshing them.
export function checked(shape: Shape, what: string): Shape {
    if (!isValid(shape)) throw new KernelError(`${what} failed: the result is not a valid solid`);
    if (Math.abs(volume(shape)) < 1e-9) throw new KernelError(`${what} failed: the result has no volume`);
    return shape;
}

export function boolean(a: Shape, b: Shape, type: number): Shape {
    const range = new oc.Message_ProgressRange();
    let op;
    switch (type) {
        case OperationType.Union: op = new oc.BRepAlgoAPI_Fuse(a, b, range); break;
        case OperationType.Difference: op = new oc.BRepAlgoAPI_Cut(a, b, range); break;
        case OperationType.Intersect: op = new oc.BRepAlgoAPI_Common(a, b, range); break;
        default: throw new KernelError(`Boolean operation ${type} is not implemented by the OCCT kernel`);
    }
    if (op.HasErrors()) { op.delete(); throw new KernelError("Boolean operation failed") }
    const result = op.Shape();
    op.delete(); range.delete();
    return result;
}

// Merges faces and edges that lie on the same surface or curve. Merging can break a solid (e.g. the two halves of a
// sphere glued along its seam); then the solid is kept as it is.
export function unify(shape: Shape, flags?: MergingFlags): Shape {
    if (flags === undefined || (!flags.mergeFaces && !flags.mergeEdges)) return shape;
    const u = new oc.ShapeUpgrade_UnifySameDomain(shape, flags.mergeEdges, flags.mergeFaces, false);
    u.Build();
    const result = u.Shape();
    u.delete();
    if (!isValid(result) && isValid(shape)) return shape;
    return result;
}

// Runs an OCCT operation, turning OCCT exceptions (raised from WebAssembly) into kernel errors.
export function occ<T>(what: string, f: () => T): T {
    try {
        return f();
    } catch (e) {
        if (e instanceof KernelError) throw e;
        let detail = '';
        try { detail = typeof e === 'number' || (typeof e === 'object' && e !== null && !(e instanceof Error)) ? String(oc.getExceptionMessage(e as any)) : String((e as Error).message ?? e) } catch (_) { }
        throw new KernelError(`${what} failed${detail ? ': ' + detail : ''}`);
    }
}

// OCCT can return self-intersecting solids (e.g. for fillets that are too large), which then never finish meshing.
export function isValid(shape: Shape): boolean {
    const analyzer = new oc.BRepCheck_Analyzer(shape, true, false, false);
    const result = analyzer.IsValid();
    analyzer.delete();
    return result;
}

export function fillet(solid: Solid, edgeFunctions: EdgeFunction[], params: SmoothValues): Solid {
    const r = params.distance1;
    if (!(r > 0)) throw new KernelError("Fillet radius must be positive");
    const constant = (ef: EdgeFunction) => ef.Function().knots().every(([, v]) => Math.abs(v - 1) < 1e-12);
    return occ("Fillet", () => {
        try {
            const maker = new oc.BRepFilletAPI_MakeFillet(solid.shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
            for (const ef of edgeFunctions) {
                const edge = ef.Edge();
                if (constant(ef)) {
                    maker.Add(r, edge.shape);
                } else {
                    const knots = ef.Function().knots();
                    const values = new oc.NCollection_Array1_gp_Pnt2d(1, knots.length);
                    knots.forEach(([t, v], i) => values.SetValue(i + 1, new oc.gp_Pnt2d(edge.edgeParam(t), r * v)));
                    maker.Add(values, edge.shape);
                }
            }
            maker.Build(new oc.Message_ProgressRange());
            if (!maker.IsDone()) { maker.delete(); throw new KernelError("Fillet failed: the radius may be too large") }
            const result = maker.Shape();
            maker.delete();
            if (!isValid(result)) throw new KernelError("Fillet failed: the radius is too large");
            return new Solid(result);
        } catch (e) {
            // OCCT cannot round an edge whose fillet takes up a whole neighbouring face (a radius equal to the width
            // of a box, say), which C3D can: between planar faces the rounding is cut from the solid instead.
            const rounded = edgeFunctions.every(constant) ? roundStraightEdges(solid, edgeFunctions.map(ef => ef.Edge()), r) : undefined;
            if (rounded === undefined) throw e;
            return new Solid(rounded);
        }
    });
}

// Rounds straight edges between planar faces by cutting away the material between each edge and the cylinder of
// radius r tangent to both of its faces (adding it at a concave edge); the rounding may take up whole faces.
// Undefined for edges it cannot handle.
function roundStraightEdges(solid: Solid, edges: CurveEdge[], r: number): Shape | undefined {
    const tools: { tool: Shape, convex: boolean }[] = [];
    for (const edge of edges) {
        const tool = roundingTool(solid, edge, r);
        if (tool === undefined) return undefined;
        tools.push(tool);
    }
    let shape = solid.shape;
    for (const { tool, convex } of tools) shape = boolean(shape, tool, convex ? OperationType.Difference : OperationType.Union);
    if (solidsOf(shape).length !== 1) throw new KernelError("Fillet failed: the radius is too large");
    // Material added at a concave edge ends in faces coplanar with the faces at the ends of the edge.
    if (tools.some(t => !t.convex)) shape = unify(shape, new MergingFlags(true, true));
    return checked(solidOf(shape), "Fillet");
}

// The material between a straight edge and its rounding, along the whole edge: a prism on the kite between the edge
// and the lines where the rounding meets its two faces, less the cylinder. Undefined when the edge is not straight,
// a face is not planar, the rounding would not fit on the faces, or the faces at the ends of the edge are not square
// to it (a fillet would not end there the way the prism does).
function roundingTool(solid: Solid, edge: CurveEdge, r: number): { tool: Shape, convex: boolean } | undefined {
    const faces = solid.edgeFaces(edge);
    if (faces.length !== 2 || !faces.every(f => f.IsPlanar())) return undefined;
    const curve = new oc.BRepAdaptor_Curve(edge.shape);
    const straight = curve.GetType() === oc.GeomAbs_CurveType.GeomAbs_Line;
    curve.delete();
    if (!straight) return undefined;
    const C = edge.GetBegPoint(), E = edge.GetEndPoint();
    const along = new Vector3D(E.x - C.x, E.y - C.y, E.z - C.z);
    const length = Math.hypot(along.x, along.y, along.z);
    if (length < 1e-9) return undefined;
    const e = normalized(along);
    // Into each face from the edge, square to it: to the left of the edge as the face's loop runs along it.
    const into: Vector3D[] = [];
    for (const [i, face] of faces.entries()) {
        const { findLoop, edgeIndex } = i === 0 ? edge.FindOrientedEdgePlus() : edge.FindOrientedEdgeMinus();
        const oriented = findLoop?.GetOrientedEdge(edgeIndex);
        if (oriented === undefined || oriented === null) return undefined;
        const t = oriented.orientation ? e : new Vector3D(-e.x, -e.y, -e.z);
        into.push(normalized(cross(face.GetAnyPointOn().normal, t)));
    }
    const [uA, uB] = into;
    const nA = faces[0].GetAnyPointOn().normal;
    const alpha = Math.acos(Math.max(-1, Math.min(1, dot(uA, uB))));
    if (alpha < 1e-6 || alpha > Math.PI - 1e-6) return undefined;
    const convex = dot(uB, nA) < 0;
    // The rounding meets each face at distance d from the edge; a face exactly d wide is taken up whole.
    let d = r / Math.tan(alpha / 2);
    const width = Math.min(...faces.map((f, i) => extentFrom(f, C, into[i])));
    if (d > width * (1 + 1e-5)) return undefined;
    if (d > width * (1 - 1e-5)) { d = width; r = d * Math.tan(alpha / 2) }
    for (const end of [C, E]) {
        for (const face of solid.GetFaces()) {
            if (faces.includes(face) || !hasVertexAt(face, end)) continue;
            if (!face.IsPlanar() || Math.abs(dot(face.GetAnyPointOn().normal, e)) < 1 - 1e-6) return undefined;
        }
    }
    const h = r / Math.sin(alpha / 2);
    const bisector = normalized(new Vector3D(uA.x + uB.x, uA.y + uB.y, uA.z + uB.z));
    const O = new CartPoint3D(C.x + bisector.x * h, C.y + bisector.y * h, C.z + bisector.z * h);
    const TA = new CartPoint3D(C.x + uA.x * d, C.y + uA.y * d, C.z + uA.z * d);
    const TB = new CartPoint3D(C.x + uB.x * d, C.y + uB.y * d, C.z + uB.z * d);
    // The short arc from TA to TB about O runs anticlockwise about +e or -e.
    const turn = dot(cross(new Vector3D(TA.x - O.x, TA.y - O.y, TA.z - O.z), new Vector3D(TB.x - O.x, TB.y - O.y, TB.z - O.z)), e);
    const circle = new oc.gp_Circ(new oc.gp_Ax2(gpPnt(O), gpDir(turn > 0 ? e : new Vector3D(-e.x, -e.y, -e.z))), r);
    const section = new oc.BRepBuilderAPI_MakeFace(wireOf([
        new oc.BRepBuilderAPI_MakeEdge(gpPnt(C), gpPnt(TA)).Edge(),
        new oc.BRepBuilderAPI_MakeEdge(circle, gpPnt(TA), gpPnt(TB)).Edge(),
        new oc.BRepBuilderAPI_MakeEdge(gpPnt(TB), gpPnt(C)).Edge(),
    ]), true).Face();
    return { tool: prism(section, e, 0, length), convex };
}

// How far a face reaches from point p in direction u.
function extentFrom(face: Face, p: CartPoint3D, u: Vector3D): number {
    let result = 0;
    for (const v of explore(face.shape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX)) {
        const q = cart(oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(v)));
        result = Math.max(result, (q.x - p.x) * u.x + (q.y - p.y) * u.y + (q.z - p.z) * u.z);
    }
    return result;
}

function hasVertexAt(face: Face, p: CartPoint3D): boolean {
    return explore(face.shape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX).some(v => cart(oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(v))).distanceTo(p) < 1e-6);
}

export function chamfer(solid: Solid, edges: CurveEdge[], params: SmoothValues): Solid {
    const d1 = Math.abs(params.distance1), d2 = Math.abs(params.distance2 || params.distance1);
    if (d1 === 0) throw new KernelError("Chamfer distance must not be zero");
    return occ("Chamfer", () => {
        const maker = new oc.BRepFilletAPI_MakeChamfer(solid.shape);
        for (const edge of edges) {
            const face = edge.GetFacePlus();
            if (Math.abs(d1 - d2) < 1e-9 || face === null) maker.Add(d1, edge.shape);
            else maker.Add(d1, d2, edge.shape, face.shape);
        }
        maker.Build(new oc.Message_ProgressRange());
        if (!maker.IsDone()) { maker.delete(); throw new KernelError("Chamfer failed: the distance may be too large") }
        const result = maker.Shape();
        maker.delete();
        if (!isValid(result)) throw new KernelError("Chamfer failed: the distance is too large");
        return new Solid(result);
    });
}

export function polygonFace(points: CartPoint3D[]): Shape {
    const wire = new oc.BRepBuilderAPI_MakeWire();
    for (let i = 0; i < points.length; i++) {
        wire.Add(new oc.BRepBuilderAPI_MakeEdge(gpPnt(points[i]), gpPnt(points[(i + 1) % points.length])).Edge());
    }
    const face = new oc.BRepBuilderAPI_MakeFace(wire.Wire(), true).Face();
    wire.delete();
    return face;
}

// Box, cylinder and sphere from the defining points used by the app (C3D's ElementarySolid conventions).
export function elementary(points: CartPoint3D[], type: number): Solid {
    const v = (a: CartPoint3D, b: CartPoint3D) => new Vector3D(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = (a: Vector3D) => Math.hypot(a.x, a.y, a.z);
    switch (type) {
        case ElementaryShellType.Block: {
            // p1→p2 is the width; the length is p2→p3 square to it; the height is how far p4 is from p3 square to both,
            // always measured along width × length (as in C3D: callers swap p1 and p2 for the other side).
            const [p1, p2, p3, p4] = points;
            const X = v(p1, p2);
            if (len(X) < 1e-9) throw new KernelError("Box dimensions must not be zero");
            const x = normalized(X);
            const Y0 = v(p2, p3), along = dot(Y0, x);
            const Y = new Vector3D(Y0.x - along * x.x, Y0.y - along * x.y, Y0.z - along * x.z);
            if (len(Y) < 1e-9) throw new KernelError("Box dimensions must not be zero");
            const n = normalized(cross(x, normalized(Y)));
            const h = Math.abs(dot(v(p3, p4), n));
            if (Math.abs(h) < 1e-9) throw new KernelError("Box dimensions must not be zero");
            const at = (a: Vector3D, b: Vector3D) => new CartPoint3D(p1.x + a.x + b.x, p1.y + a.y + b.y, p1.z + a.z + b.z);
            const zero = new Vector3D(0, 0, 0);
            const face = polygonFace([at(zero, zero), at(X, zero), at(X, Y), at(zero, Y)]);
            const solid = new Solid(prism(face, n, 0, h));
            // C3D's numbering: faces bottom (the defining points'), top, then the sides from p1→p2 round to p0→p1;
            // edges as they first appear going round those faces, each anticlockwise about its outward normal.
            const Z = new Vector3D(n.x * h, n.y * h, n.z * h);
            const half = (v: Vector3D) => new Vector3D(v.x / 2, v.y / 2, v.z / 2);
            const plus = (...vs: Vector3D[]) => vs.reduce((a, b) => new Vector3D(a.x + b.x, a.y + b.y, a.z + b.z), zero);
            const point = (...vs: Vector3D[]) => at(plus(...vs), zero);
            const [hX, hY, hZ] = [half(X), half(Y), half(Z)];
            const faces = [point(hX, hY), point(hX, hY, Z), point(hX, hZ), point(X, hY, hZ), point(hX, Y, hZ), point(hY, hZ)];
            const edges = [
                point(hY), point(Y, hX), point(X, hY), point(hX),
                point(Z, hX), point(Z, X, hY), point(Z, Y, hX), point(Z, hY),
                point(X, hZ), point(hZ), point(X, Y, hZ), point(Y, hZ),
            ];
            const faceOrder = matchByPosition(solid.GetFaces().map(f => f.GetAnyPointOn().point), faces);
            const edgeOrder = matchByPosition(solid.GetEdges().map(e => e.Point(0.5)), edges);
            if (faceOrder !== undefined && edgeOrder !== undefined) solid.numbering = { faces: faceOrder, edges: edgeOrder };
            return solid;
        }
        case ElementaryShellType.Cylinder: {
            const [base, top, rim] = points;
            const axis = v(base, top), radial = v(base, rim);
            const h = len(axis), r = len(radial);
            if (h < 1e-9 || r < 1e-9) throw new KernelError("Cylinder height and radius must not be zero");
            const Z = normalized(axis);
            const ax = new oc.gp_Ax2(gpPnt(base), gpDir(Z), gpDir(perpendicularTo(Z, radial)));
            const solid = new Solid(occ("Cylinder", () => new oc.BRepPrimAPI_MakeCylinder(ax, r, h).Shape()));
            // C3D's numbering: faces side, base, top; edges base circle, seam, top circle.
            const height = (p: CartPoint3D) => (p.x - base.x) * Z.x + (p.y - base.y) * Z.y + (p.z - base.z) * Z.z;
            const faces = solid.GetFaces(), edges = solid.GetEdges();
            const side = faces.findIndex(f => !f.IsPlanar());
            const disks = faces.map((f, i) => i).filter(i => i !== side).sort((a, b) => height(faces[a].GetAnyPointOn().point) - height(faces[b].GetAnyPointOn().point));
            const seam = edges.findIndex(e => e.IsSeam());
            const circles = edges.map((e, i) => i).filter(i => i !== seam).sort((a, b) => height(edges[a].Point(0.5)) - height(edges[b].Point(0.5)));
            if (side >= 0 && disks.length === 2 && seam >= 0 && circles.length === 2) solid.numbering = { faces: [side, ...disks], edges: [circles[0], seam, circles[1]] };
            return solid;
        }
        case ElementaryShellType.Sphere: {
            const [center, xPoint, zPoint] = points;
            const axis = v(center, zPoint);
            const r = len(axis);
            if (r < 1e-9) throw new KernelError("Sphere radius must not be zero");
            const Z = normalized(axis);
            const ax = new oc.gp_Ax2(gpPnt(center), gpDir(Z), gpDir(perpendicularTo(Z, v(center, xPoint))));
            return new Solid(occ("Sphere", () => new oc.BRepPrimAPI_MakeSphere(ax, r).Shape()));
        }
    }
    throw new KernelError(`Elementary solids of type ${type} are not implemented by the OCCT kernel`);
}

// The component of `v` perpendicular to unit vector Z (or any perpendicular if v is parallel to Z).
function perpendicularTo(Z: Vector3D, v: Vector3D): Vector3D {
    const d = v.x * Z.x + v.y * Z.y + v.z * Z.z;
    const p = new Vector3D(v.x - d * Z.x, v.y - d * Z.y, v.z - d * Z.z);
    if (Math.hypot(p.x, p.y, p.z) > 1e-9) return normalized(p);
    return arbitraryPerpendicular(Z);
}

export function solidsOf(shape: Shape): Shape[] {
    const result: Shape[] = [];
    const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) result.push(oc.TopoDS.Solid(ex.Current()));
    ex.delete();
    return result;
}

export function union(solid: Solid, tools: Solid[], type: number, flags?: MergingFlags): Solid {
    let shape = solid.shape;
    for (const tool of tools) shape = boolean(shape, tool.shape, type);
    if (solidsOf(shape).length === 0) throw new KernelError("The result of the boolean operation is empty", 25);
    return new Solid(unify(shape, flags));
}

export function intersects(a: Solid, b: Solid): boolean {
    const ca = a.GetCube(), cb = b.GetCube();
    if (!ca.Intersect(cb, 1e-6)) return false;
    const dist = new oc.BRepExtrema_DistShapeShape(a.shape, b.shape);
    const result = dist.IsDone() && (dist.Value() < 1e-6 || dist.InnerSolution());
    dist.delete();
    return result;
}

export function detachParts(solid: Solid): Solid[] {
    const parts = solidsOf(solid.shape);
    if (parts.length <= 1) {
        if (parts.length === 1 && solid.shape.ShapeType() !== oc.TopAbs_ShapeEnum.TopAbs_SOLID) solid.shape = parts[0];
        return [];
    }
    solid.shape = parts[0];
    return parts.slice(1).map(p => new Solid(p));
}

