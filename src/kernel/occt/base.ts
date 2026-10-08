import { PlaneType, SpaceType } from './constants';
import { Axis3D, Cube, KObject, Matrix, Matrix3D, Rect, Vector, Vector3D } from './math';

export class RefItem extends KObject {
    GetUseCount() { return 1 }
    AddRef() { }
}

export abstract class PlaneItem extends RefItem {
    abstract IsA(): number;
    Type(): number { return this.IsA() }
    Family(): number { return PlaneType.Curve }
    Cast<T>(_t: number): T { return this as unknown as T }

    abstract Transform(matrix: Matrix): void;
    abstract Duplicate(): PlaneItem;

    Move(to: Vector) {
        const m = new Matrix();
        m.m[2][0] = to.x; m.m[2][1] = to.y;
        this.Transform(m);
    }

    AddYourGabaritTo(_rect: Rect) { }
}

export abstract class SpaceItem extends RefItem {
    abstract IsA(): number;
    Type(): number { return this.IsA() }
    Family(): number { return this.IsA() }
    Cast<T>(_t: number): T { return this as unknown as T }

    abstract Transform(matrix: Matrix3D): void;
    abstract Duplicate(): SpaceItem;

    Move(v: Vector3D) {
        const m = new Matrix3D();
        m.Move(v);
        this.Transform(m);
    }

    Rotate(axis: Axis3D, angle: number) {
        this.Transform(new Matrix3D().Rotate(axis, angle));
    }

    Refresh() { }

    AddYourGabaritTo(_cube: Cube) { }

    GetCube(): Cube {
        const cube = new Cube();
        this.AddYourGabaritTo(cube);
        return cube;
    }
}

export class TopItem extends RefItem { }

// Attributes shared by model items (style, color, name).
export abstract class Item extends SpaceItem {
    protected style = 0;
    protected color = 0;
    protected itemName = 0;

    Family(): number { return SpaceType.Item }

    GetItemName() { return this.itemName }
    SetItemName(name: number) { this.itemName = name }
    SetStyle(s: number) { this.style = s }
    GetStyle() { return this.style }
    SetColor(c: number) { this.color = c }
    GetColor() { return this.color }
    AttributesConvert(_other: unknown) { }

    GetCreatorsCount() { return 0 }
    GetCreator(_ind: number): RefItem | null { return null }
    GetCreators(): RefItem[] { return [] }
    GetActiveCreatorsCount() { return 0 }
    AddCreator(_creator: unknown, _addSame?: boolean) { return false }
}
