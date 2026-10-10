import * as THREE from "three";
import c3d from '../../kernel/kernel';
import { GeometryFactory } from '../../command/GeometryFactory';
import { point2point, vec2vec } from "../../util/Conversion";
import { CenterCircleFactory, Mode } from "../circle/CircleFactory";
import { X, Y, Z } from "../../util/Constants";
import * as visual from "../../visual_model/VisualModel";

export class PolygonFactory extends GeometryFactory {
    mode = Mode.Horizontal;
    toggleMode() {
        this.mode = this.mode === Mode.Vertical ? Mode.Horizontal : Mode.Vertical;
    }
    
    center!: THREE.Vector3;
    p2!: THREE.Vector3;
    private _vertexCount = 5;
    orientation = new THREE.Quaternion();

    get vertexCount() { return this._vertexCount }
    set vertexCount(count: number) {
        this._vertexCount = Math.max(0, count);
    }

    async calculate() {
        const { center, p2, vertexCount, normal } = this;
        const [,,z] = CenterCircleFactory.orientHorizontalOrVertical(this.p2, this.center, normal, this.mode);
        const polygon = c3d.ActionCurve3D.RegularPolygon(point2point(center), point2point(p2), vec2vec(z, 1), vertexCount, false);

        return new c3d.SpaceInstance(polygon);
    }

    private readonly _normal = new THREE.Vector3();
    private get normal() {
        return this._normal.copy(Z).applyQuaternion(this.orientation);
    }
}

export const minRadius = 0.005;

export interface EditPolygonParams {
    vertexCount: number;
    radius: number;
    degrees: number;
}

// Edits a regular polygon with what drawing it set: the vertex count, and the vertex it was dragged to, as the radius
// of its circumscribed circle and that vertex's rotation around the drawing plane's normal, from the plane's X. The
// centre and mode stay as drawn.
export class EditPolygonFactory extends PolygonFactory implements EditPolygonParams {
    get vertexCount() { return super.vertexCount }
    set vertexCount(count: number) { super.vertexCount = Math.max(3, count) }

    get radius() { return this.p2.distanceTo(this.center) }
    set radius(radius: number) { this.place(Math.max(radius, minRadius), this.angle) }

    // In [0, 2π)
    get angle() {
        const { x, y } = this.axes;
        const d = this.p2.clone().sub(this.center);
        const angle = Math.atan2(d.dot(y), d.dot(x));
        return angle < 0 ? angle + 2 * Math.PI : angle;
    }
    set angle(angle: number) { this.place(this.radius, angle) }

    get degrees() { return THREE.MathUtils.radToDeg(this.angle) }
    set degrees(degrees: number) { this.angle = THREE.MathUtils.degToRad(degrees) }

    // The drawing plane's X and Y, which the vertex was dragged in
    private get axes() {
        return { x: X.clone().applyQuaternion(this.orientation), y: Y.clone().applyQuaternion(this.orientation) };
    }

    private place(radius: number, angle: number) {
        const { x, y } = this.axes;
        this.p2 = this.center.clone().addScaledVector(x, radius * Math.cos(angle)).addScaledVector(y, radius * Math.sin(angle));
    }

    private _polygon!: visual.SpaceInstance<visual.Curve3D>;
    set polygon(polygon: visual.SpaceInstance<visual.Curve3D>) { this._polygon = polygon }
    get originalItem() { return this._polygon }
}
