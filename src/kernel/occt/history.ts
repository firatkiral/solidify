// The history of a solid: one record per operation that built it, each keeping the solid as that operation left it
// (OCCT shapes are immutable, so a record costs a reference). Rebuilding a solid switches it back to a record.

import { RefItem, SpaceItem } from './base';
import { Matrix3D } from './math';
import { oc } from './occt';

type Shape = any;

const ProcessState = { Skip: -2, Success: 0 };

// What an operation made: the faces and edges of its result that were not in the result of the operation before it,
// told apart by their size and position.
class CreatorNames extends RefItem {
    constructor(private readonly creator: Creator) { super() }
    IsChild(topology: { shape?: Shape }) {
        if (topology.shape === undefined) return false;
        const key = signature(topology.shape);
        return this.creator.signatures().has(key) && !(this.creator.previous?.signatures().has(key) ?? false);
    }
}

export class Creator extends RefItem {
    status = ProcessState.Success;
    matrix = new Matrix3D();
    previous?: Creator;
    private _signatures?: Set<string>;

    constructor(readonly type: number, readonly bases: SpaceItem[], readonly snapshot: Shape) { super() }

    IsA() { return this.type }
    Type() { return this.type }
    Cast<T>(_type: number): T { return this as unknown as T }
    SetStatus(status: number) { this.status = status }
    GetStatus() { return this.status }
    GetBasisItems() { return [...this.bases] }
    GetYourNameMaker() { return new CreatorNames(this) }
    // Re-applying an operation to another shape is not supported: the result keeps no history of this operation.
    CreateShell(_shell: unknown, _copyMode: number) { return { success: false, shell: null } }

    // The solid was moved: so is what this operation left.
    moved(m: Matrix3D) { this.matrix = Matrix3D.fromRows(this.matrix.m).multiply(m); this._signatures = undefined }

    // The solid as this operation left it, moved along with the solid since.
    shape(transform: (shape: Shape, m: Matrix3D) => Shape): Shape {
        return this.matrix.isIdentity() ? this.snapshot : transform(this.snapshot, this.matrix);
    }

    signatures(): Set<string> {
        if (this._signatures !== undefined) return this._signatures;
        const result = new Set<string>();
        for (const type of [oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_EDGE]) {
            const ex = new oc.TopExp_Explorer(this.snapshot, type, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
            for (; ex.More(); ex.Next()) result.add(signature(ex.Current(), this.matrix));
            ex.delete();
        }
        return this._signatures = result;
    }

    copy(): Creator {
        const result = new Creator(this.type, this.bases, this.snapshot);
        result.status = this.status;
        result.matrix = Matrix3D.fromRows(this.matrix.m);
        return result;
    }
}

// A face or edge by its size and the position of its centre, rounded.
function signature(shape: Shape, matrix?: Matrix3D): string {
    const props = new oc.GProp_GProps();
    const isFace = shape.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_FACE;
    if (isFace) oc.BRepGProp.SurfaceProperties(shape, props, false, false);
    else oc.BRepGProp.LinearProperties(shape, props, false, false);
    const c = props.CentreOfMass();
    let p = { x: c.X(), y: c.Y(), z: c.Z() };
    if (matrix !== undefined && !matrix.isIdentity()) p = matrix.applyPoint(p);
    const size = props.Mass();
    props.delete();
    const r = (v: number) => Math.round(v * 1e3) / 1e3;
    return `${isFace ? 'f' : 'e'}${r(size)}:${r(p.x)},${r(p.y)},${r(p.z)}`;
}

// Chains a new record onto a history.
export function extend(history: Creator[], type: number, bases: SpaceItem[], snapshot: Shape): Creator[] {
    const result = history.map(c => c.copy());
    for (let i = 1; i < result.length; i++) result[i].previous = result[i - 1];
    const creator = new Creator(type, bases, snapshot);
    creator.previous = result[result.length - 1];
    result.push(creator);
    return result;
}

export function copyHistory(history: Creator[]): Creator[] {
    const result = history.map(c => c.copy());
    for (let i = 1; i < result.length; i++) result[i].previous = result[i - 1];
    return result;
}

export { ProcessState };
