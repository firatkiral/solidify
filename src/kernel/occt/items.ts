import * as THREE from 'three';
import { Item, PlaneItem, RefItem, SpaceItem } from './base';
import { SpaceType } from './constants';
import { Contour, Curve, Region } from './curve2d';
import { Curve3D } from './curve3d';
import { Cube, Matrix3D, Placement3D } from './math';

// How finely to mesh: solids follow the sag (the largest distance between the mesh and the surface) and the angle (the
// most a mesh segment may turn, in radians); the length and count limits are kept for callers but OCCT's mesher doesn't
// use them.
export class StepData extends RefItem {
    private angle = 0.3;
    private length = 0;
    private maxCount = 0;
    constructor(private stepType = 1, private sag = 0.1) { super() }
    Init(stepType: number, sag: number, angle: number, length: number, maxCount = 0) {
        this.stepType = stepType; this.sag = sag; this.angle = angle; this.length = length; this.maxCount = maxCount;
    }
    GetSag() { return this.sag }
    SetSag(sag: number) { this.sag = sag }
    GetAngle() { return this.angle }
    SetAngle(angle: number) { this.angle = angle }
    GetLength() { return this.length }
    SetLength(length: number) { this.length = length }
    GetMaxCount() { return this.maxCount }
    SetMaxCount(count: number) { this.maxCount = count }
    GetStepType() { return this.stepType }
    SetStepType(t: number, add = false) { this.stepType = add ? this.stepType | t : t }
}

export class FormNote extends RefItem {
    constructor(private wire = true, private grid = true, private seam = false, private exact = false, private quad = false) { super() }
    Wire() { return this.wire }
    Grid() { return this.grid }
    Seam() { return this.seam }
    Exact() { return this.exact }
    Quad() { return this.quad }
    Fair() { return false }
}

export class Primitive extends RefItem {
    protected style = 0;
    protected primitiveName = 0;
    protected primitiveType = 0;
    protected item: unknown = null;
    visible = true;

    SetStyle(s: number) { this.style = s }
    GetStyle() { return this.style }
    SetPrimitiveName(n: number) { this.primitiveName = n }
    GetPrimitiveName() { return this.primitiveName }
    SetPrimitiveType(t: number) { this.primitiveType = t }
    GetPrimitiveType() { return this.primitiveType }
    SetItem(item: unknown) { this.item = item }
    TopItem() { return this.item }
    SetStepData(_sd: StepData) { }
    IsVisible() { return this.visible }
    SetVisible(v: boolean) { this.visible = v }
}

export class Grid extends Primitive {
    index = new Uint32Array(0);
    position = new Float32Array(0);
    normal = new Float32Array(0);

    set(index: Uint32Array, position: Float32Array, normal: Float32Array) {
        this.index = index; this.position = position; this.normal = normal;
    }

    GetBuffers() { return { index: this.index, position: this.position, normal: this.normal } }

    GetCube() {
        const cube = new Cube();
        const p = this.position;
        for (let i = 0; i < p.length; i += 3) cube.include({ x: p[i], y: p[i + 1], z: p[i + 2] });
        return cube;
    }

    // Nearest intersection of a ray with the triangles (Möller–Trumbore).
    intersect(origin: { x: number, y: number, z: number }, dir: { x: number, y: number, z: number }): number | undefined {
        const { index, position: p } = this;
        let best: number | undefined;
        for (let i = 0; i < index.length; i += 3) {
            const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
            const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
            const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
            const hx = dir.y * e2z - dir.z * e2y, hy = dir.z * e2x - dir.x * e2z, hz = dir.x * e2y - dir.y * e2x;
            const det = e1x * hx + e1y * hy + e1z * hz;
            if (Math.abs(det) < 1e-12) continue;
            const f = 1 / det;
            const sx = origin.x - p[a], sy = origin.y - p[a + 1], sz = origin.z - p[a + 2];
            const u = f * (sx * hx + sy * hy + sz * hz);
            if (u < 0 || u > 1) continue;
            const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
            const v = f * (dir.x * qx + dir.y * qy + dir.z * qz);
            if (v < 0 || u + v > 1) continue;
            const t = f * (e2x * qx + e2y * qy + e2z * qz);
            if (t < 0) continue;
            if (best === undefined || t < best) best = t;
        }
        return best;
    }
}

export class Polygon3D extends Primitive {
    constructor(public points = new Float32Array(0)) { super() }
    Count() { return this.points.length / 3 }
}

export class Mesh extends Item {
    grids: Grid[] = [];
    polygons: Polygon3D[] = [];

    constructor(_closed = false) { super() }

    IsA(): number { return SpaceType.Mesh }
    AddGrid() { const g = new Grid(); this.grids.push(g); return g }
    AddPolygon(points: Float32Array, item?: unknown) {
        const p = new Polygon3D(points);
        if (item !== undefined) p.SetItem(item);
        this.polygons.push(p);
        return p;
    }

    GetBuffers() {
        const result = [];
        for (const [i, grid] of this.grids.entries()) {
            if (!grid.IsVisible()) continue;
            result.push({
                index: grid.index, position: grid.position, normal: grid.normal,
                style: grid.GetStyle(), simpleName: grid.GetPrimitiveName(), i, grid, model: grid.TopItem(),
            });
        }
        return result;
    }

    GetEdges(outlinesOnly = false) {
        const result = [];
        for (const polygon of this.polygons) {
            if (!polygon.IsVisible()) continue;
            const item = polygon.TopItem() as { IsSeam?(): boolean, IsPole?(): boolean, GetNameHash?(): number } | null;
            const info: { position: Float32Array, simpleName?: number } = { position: polygon.points };
            if (outlinesOnly) {
                if (item === null || item.IsSeam === undefined) continue;
                if (item.IsSeam() || item.IsPole!()) continue;
                info.simpleName = item.GetNameHash!();
            }
            result.push(info);
        }
        return result;
    }

    GetApexes() { return new Float32Array(0) }

    Transform(m: Matrix3D) {
        for (const p of this.polygons) p.points = transformFloats(p.points, m);
        for (const g of this.grids) g.position = transformFloats(g.position, m);
    }

    Duplicate() {
        const result = new Mesh();
        result.grids = this.grids;
        result.polygons = this.polygons;
        return result;
    }
}

function transformFloats(points: Float32Array, m: Matrix3D) {
    const result = new Float32Array(points.length);
    for (let i = 0; i < points.length; i += 3) {
        const p = m.applyPoint({ x: points[i], y: points[i + 1], z: points[i + 2] });
        result[i] = p.x; result[i + 1] = p.y; result[i + 2] = p.z;
    }
    return result;
}

export function floats(points: { x: number, y: number, z: number }[]) {
    const result = new Float32Array(points.length * 3);
    for (const [i, p] of points.entries()) { result[i * 3] = p.x; result[i * 3 + 1] = p.y; result[i * 3 + 2] = p.z }
    return result;
}

export class SpaceInstance extends Item {
    private item: SpaceItem;

    constructor(item: SpaceItem) {
        super();
        this.item = item;
    }

    IsA(): number { return SpaceType.SpaceInstance }
    GetSpaceItem() { return this.item }
    SetSpaceItem(item: SpaceItem) { this.item = item }

    CreateMesh(stepData: StepData, _note: FormNote) {
        const mesh = new Mesh();
        const item = this.item;
        // Surfaces that can be shown have a grid of triangles
        const surface = item as unknown as { grid?(sag: number): { index: Uint32Array, position: Float32Array, normal: Float32Array } };
        if (item instanceof Curve3D) {
            mesh.AddPolygon(floats(item.polyline(stepData.GetSag())));
        } else if (surface.grid !== undefined) {
            const { index, position, normal } = surface.grid(stepData.GetSag());
            mesh.AddGrid().set(index, position, normal);
        } else {
            throw new Error(`Meshing ${item.constructor.name} is not implemented by the OCCT kernel`);
        }
        return mesh;
    }

    CalculateMesh(stepData: StepData, note: FormNote) { return this.CreateMesh(stepData, note) }

    Transform(m: Matrix3D) { this.item.Transform(m) }
    Duplicate() {
        const result = new SpaceInstance(this.item.Duplicate());
        result.SetStyle(this.GetStyle());
        return result;
    }
    AddYourGabaritTo(cube: Cube) { this.item.AddYourGabaritTo(cube) }
}

export class PlaneInstance extends Item {
    private items: PlaneItem[];
    private placement: Placement3D;

    constructor(item: PlaneItem, placement: Placement3D) {
        super();
        this.items = [item];
        this.placement = new Placement3D(placement);
    }

    IsA(): number { return SpaceType.PlaneInstance }
    GetPlacement() { return this.placement.clone() }
    PlaneItemsCount() { return this.items.length }
    GetPlaneItem(ind = 0) { return this.items[ind] ?? null }
    AddPlaneItem(item: PlaneItem) { this.items.push(item) }

    CreateMesh(stepData: StepData, _note: FormNote) {
        const mesh = new Mesh();
        const grid = mesh.AddGrid();
        const sag = stepData.GetSag();
        const index: number[] = [], position: number[] = [], normal: number[] = [];
        const Z = this.placement.GetAxisZ();
        for (const item of this.items) {
            if (!(item instanceof Region)) throw new Error(`Meshing ${item.constructor.name} is not implemented by the OCCT kernel`);
            const [outer, ...holes] = item.contours.map(c => contourPoints(c, sag));
            const triangles = THREE.ShapeUtils.triangulateShape(outer, holes);
            const offset = position.length / 3;
            for (const p of [outer, ...holes].flat()) {
                const q = this.placement.GetPointFrom(p.x, p.y, 0);
                position.push(q.x, q.y, q.z);
                normal.push(Z.x, Z.y, Z.z);
            }
            for (const [a, b, c] of triangles) index.push(offset + a, offset + b, offset + c);
        }
        grid.set(new Uint32Array(index), new Float32Array(position), new Float32Array(normal));
        return mesh;
    }

    CalculateMesh(stepData: StepData, note: FormNote) { return this.CreateMesh(stepData, note) }

    Transform(m: Matrix3D) { this.placement.Transform(m) }
    Duplicate() { return new PlaneInstance(this.items[0].Duplicate(), this.placement) }

    AddYourGabaritTo(cube: Cube) {
        for (const item of this.items) {
            if (!(item instanceof Region)) continue;
            for (const c of item.contours) for (const p of c.polyline(0)) cube.include(this.placement.GetPointFrom(p.x, p.y, 0));
        }
    }
}

// Points along a closed contour, without repeating the first point at the end.
function contourPoints(c: Contour | Curve, sag: number): THREE.Vector2[] {
    const points = c.polyline(sag).map(p => new THREE.Vector2(p.x, p.y));
    if (points.length > 1 && points[0].distanceTo(points[points.length - 1]) < 1e-9) points.pop();
    return points;
}

export class Model extends Item {
    private items: Item[] = [];

    IsA(): number { return SpaceType.Item }
    AddItem(item: Item, n?: number) {
        if (n !== undefined) item.SetItemName(n);
        this.items.push(item);
        return item;
    }
    ItemsCount() { return this.items.length }
    GetItems() { return [...this.items] }
    DetachItem(item: Item) { const i = this.items.indexOf(item); if (i >= 0) this.items.splice(i, 1); return i >= 0 }
    DeleteItem(item: Item) { this.DetachItem(item) }
    GetItemByName(n: number) { return { item: this.items.find(i => i.GetItemName() === n) ?? null, path: null, from: new Matrix3D() } }
    Transform(m: Matrix3D) { for (const i of this.items) i.Transform(m) }
    Duplicate() { const r = new Model(); for (const i of this.items) r.AddItem(i.Duplicate() as Item, i.GetItemName()); return r }
}

export class Assembly extends Item {
    constructor(private items: Item[] = []) { super() }
    IsA(): number { return SpaceType.Assembly }
    GetItems() { return [...this.items] }
    Transform(m: Matrix3D) { for (const i of this.items) i.Transform(m) }
    Duplicate() { return new Assembly(this.items.map(i => i.Duplicate() as Item)) }
}

export class Instance extends Item {
    constructor(private item: Item, private placement = new Placement3D()) { super() }
    IsA(): number { return SpaceType.Instance }
    GetItem() { return this.item }
    GetPlacement() { return this.placement.clone() }
    Transform(m: Matrix3D) { this.item.Transform(m) }
    Duplicate() { return new Instance(this.item.Duplicate() as Item, this.placement) }
}

