import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { AbstractGizmo, EditorLike, Intersector, Mode, MovementInfo } from "../../command/AbstractGizmo";
import { CompositeGizmo } from "../../command/CompositeGizmo";
import { KeyboardInterpreter, TextCalculator } from "../../command/KeyboardInterpreter";
import { lineGeometry, MagnitudeStateMachine, NumberHelper, sphereGeometry } from "../../command/MiniGizmos";
import { CancellablePromise } from "../../util/CancellablePromise";
import { deg2rad, rad2deg, roundToStep } from "../../util/Conversion";
import { Helper } from "../../util/Helpers";
import { fromLengthUnit } from "../../util/Units";
import { EditPolygonParams, minDiameter } from "./PolygonFactory";

// Sits at the polygon's centre, with its XY in the drawing plane
export class EditPolygonGizmo extends CompositeGizmo<EditPolygonParams> {
    private readonly vertexGizmo = new PolygonVertexGizmo("polygon:diameter", this.editor);

    protected prepare(mode: Mode) {
        const { vertexGizmo, params } = this;
        vertexGizmo.relativeScale.setScalar(0.8);
        this.render(params);
        this.add(vertexGizmo);
    }

    execute(cb: (params: EditPolygonParams) => void, finishFast: Mode = Mode.Persistent): CancellablePromise<void> {
        const { vertexGizmo, params } = this;

        this.addGizmo(vertexGizmo, diameter => {
            params.diameter = diameter;
            params.degrees = rad2deg(vertexGizmo.angle);
        });

        return super.execute(cb, finishFast);
    }

    get shouldRescaleOnZoom() { return false }

    render(params: EditPolygonParams) {
        this.vertexGizmo.angle = deg2rad(params.degrees);
        this.vertexGizmo.value = params.diameter;
    }
}

const planeGeometry = new THREE.PlaneGeometry(100_000, 100_000, 2, 2);

// A pin from a polygon's centre to the vertex it was drawn to. Dragging the ball works like the drawing drag: in the
// gizmo's XY, its distance sets the diameter (the value) and its direction the angle from X. The pin is in world units,
// while the ball keeps a constant size on screen.
class PolygonVertexGizmo extends AbstractGizmo<number> {
    readonly state = new MagnitudeStateMachine(0);
    readonly helper = new NumberHelper();
    private readonly material = this.editor.gizmos.default;
    private readonly shaft = new Line2(lineGeometry, this.material.line2);
    private readonly tip = new THREE.Mesh(sphereGeometry, this.material.mesh);
    private readonly knob = new THREE.Mesh(new THREE.SphereGeometry(0.2), this.editor.gizmos.invisible);
    private readonly plane = new THREE.Mesh(planeGeometry, this.editor.gizmos.invisible);
    private mode: 'pointer' | 'keyboard' = 'pointer';

    // From the pointer to the ball when grabbed, so the ball doesn't jump to the pointer; and the angle it had then
    private readonly grab = new THREE.Vector3();
    private startAngle = 0;

    constructor(name: string, editor: EditorLike) {
        super(name.split(':')[0], editor);
        this.state.min = minDiameter;
        this.knob.userData.command = [`gizmo:${name}`, () => { }];
        this.handle.add(this.shaft, this.tip);
        this.picker.add(this.knob);
        this.add(this.helper);
        this.render(this.state.current);
    }

    private _angle = 0;
    get angle() { return this._angle }
    set angle(angle: number) {
        this._angle = angle;
        this.render(this.state.current);
    }

    get value() { return this.state.current }
    set value(diameter: number) {
        this.state.original = diameter;
        this.render(this.state.current);
    }

    render(diameter: number) {
        const { tip, knob, shaft, helper, angle } = this;
        const radius = diameter / 2;
        tip.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
        knob.position.copy(tip.position);
        helper.position.copy(tip.position);
        shaft.rotation.z = angle - Math.PI / 2;
        shaft.scale.y = radius;
    }

    onPointerEnter(intersect: Intersector) {
        this.tip.material = this.material.hover.mesh;
    }

    onPointerLeave(intersect: Intersector) {
        this.tip.material = this.material.mesh;
    }

    onPointerDown(cb: (diameter: number) => void, intersect: Intersector, info: MovementInfo) {
        const point = this.pointerPoint(intersect);
        if (point === undefined) this.grab.set(0, 0, 0);
        else this.grab.copy(this.tip.position).sub(point);
        this.startAngle = this.angle;
    }

    onPointerMove(cb: (diameter: number) => void, intersect: Intersector, info: MovementInfo): number | undefined {
        if (this.mode !== 'pointer') return this.state.current;
        const point = this.pointerPoint(intersect);
        if (point === undefined) return this.state.current;

        point.add(this.grab);
        this._angle = this.stepAngle(Math.atan2(point.y, point.x), info.event);
        this.state.current = this.stepLength(2 * Math.hypot(point.x, point.y), info.event);
        this.render(this.state.current);
        cb(this.state.current);
        return this.state.current;
    }

    onPointerUp(cb: (diameter: number) => void, intersect: Intersector, info: MovementInfo) {
        this.state.push();
        this.mode = 'pointer';
        this.tip.material = this.material.mesh;
    }

    onInterrupt(cb: (diameter: number) => void) {
        this.state.push();
    }

    // Typed in the length unit
    override onKeyPress(cb: (diameter: number) => void, text: KeyboardInterpreter) {
        const typed = TextCalculator.calculate(text.state);
        const diameter = typed === undefined ? undefined : fromLengthUnit(typed);
        if (diameter === undefined) {
            this.mode = 'pointer';
            return this.state.current;
        }

        this.state.current = diameter;
        this.render(this.state.current);
        cb(this.state.current);
        this.mode = 'keyboard';
        return this.state.current;
    }

    // While gizmo snapping is on, the diameter steps by the length step, counted from where the drag started
    private stepLength(diameter: number, event: MouseEvent) {
        const { snaps } = this.editor;
        if (!snaps.gizmoSnapping) return diameter;
        const start = this.state.original;
        return start + roundToStep(diameter - start, snaps.lengthStep);
    }

    // While angle snapping is on, the angle steps by the angle step, counted from where the drag started
    private stepAngle(angle: number, event: MouseEvent) {
        const { snaps } = this.editor;
        if (!snaps.angleSnapping) return angle;
        const start = this.startAngle;
        const delta = Math.atan2(Math.sin(angle - start), Math.cos(angle - start));
        return start + deg2rad(roundToStep(rad2deg(delta), snaps.angleStep));
    }

    // The pointer in the gizmo's XY, in its coordinates; undefined when that plane is edge-on
    private pointerPoint(intersect: Intersector): THREE.Vector3 | undefined {
        const { plane } = this;
        this.getWorldPosition(plane.position);
        this.getWorldQuaternion(plane.quaternion);
        plane.updateMatrixWorld();
        const hit = intersect.raycast(plane);
        if (hit === undefined) return;
        const local = this.worldToLocal(hit.point.clone());
        local.z = 0;
        return local;
    }

    // Only the ball keeps a constant screen size; the gizmo itself stays in world units so the ball sits on the vertex
    protected override scaleIndependentOfZoom(camera: THREE.Camera, worldPosition: THREE.Vector3) {
        const { relativeScale, tip, knob } = this;
        tip.scale.copy(relativeScale);
        knob.scale.copy(relativeScale);
        Helper.scaleIndependentOfZoom(tip, camera, worldPosition);
        Helper.scaleIndependentOfZoom(knob, camera, worldPosition);
    }
}
