import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { AbstractGizmo, EditorLike, Intersector, Mode, MovementInfo } from "../../command/AbstractGizmo";
import { CompositeGizmo } from "../../command/CompositeGizmo";
import { KeyboardInterpreter, TextCalculator } from "../../command/KeyboardInterpreter";
import { AbstractAxisGizmo, arrowGeometry, DistanceGizmo, lineGeometry, MagnitudeStateMachine, NumberHelper, sphereGeometry } from "../../command/MiniGizmos";
import { CancellablePromise } from "../../util/CancellablePromise";
import { deg2rad, rad2deg, roundToStep } from "../../util/Conversion";
import { Helper } from "../../util/Helpers";
import { formatAngle } from "../../util/Units";
import { CircleGeometry } from "../../util/Util";
import { EditCenterPointArcParams, EditThreePointArcParams, maxAngle, minAngle, minLength } from "./ArcFactory";

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

export class EditCenterPointArcGizmo extends CompositeGizmo<EditCenterPointArcParams> {
    private readonly lengthGizmo = new ArcLengthGizmo("arc:length", this.editor);
    private readonly angleGizmo = new ArcSweepGizmo("arc:angle", this.editor);

    protected prepare(mode: Mode) {
        const { lengthGizmo, angleGizmo, params } = this;
        lengthGizmo.relativeScale.setScalar(0.8);
        angleGizmo.relativeScale.setScalar(0.8);
        lengthGizmo.quaternion.setFromUnitVectors(Y, X);
        this.render(params);
        this.add(lengthGizmo, angleGizmo);
    }

    execute(cb: (params: EditCenterPointArcParams) => void, finishFast: Mode = Mode.Persistent): CancellablePromise<void> {
        const { lengthGizmo, angleGizmo, params } = this;

        this.addGizmo(lengthGizmo, length => {
            params.length = length;
            angleGizmo.radius = length;
        });

        this.addGizmo(angleGizmo, angle => {
            params.angle = angle;
        });

        return super.execute(cb, finishFast);
    }

    get shouldRescaleOnZoom() { return false }

    render(params: EditCenterPointArcParams) {
        this.lengthGizmo.value = params.length;
        this.angleGizmo.radius = params.length;
        this.angleGizmo.value = params.angle;
    }
}

export class EditThreePointArcGizmo extends CompositeGizmo<EditThreePointArcParams> {
    private readonly lengthGizmo = new ArcLengthGizmo("arc:length", this.editor);
    private readonly heightGizmo = new ArcHeightGizmo("arc:height", this.editor);

    protected prepare(mode: Mode) {
        const { lengthGizmo, heightGizmo, params } = this;
        lengthGizmo.relativeScale.setScalar(0.8);
        heightGizmo.relativeScale.setScalar(0.5);
        lengthGizmo.quaternion.setFromUnitVectors(Y, X);
        this.render(params);
        this.add(lengthGizmo, heightGizmo);
    }

    execute(cb: (params: EditThreePointArcParams) => void, finishFast: Mode = Mode.Persistent): CancellablePromise<void> {
        const { lengthGizmo, heightGizmo, params } = this;

        this.addGizmo(lengthGizmo, length => {
            params.length = length;
            this.placeHeightGizmo();
        });

        this.addGizmo(heightGizmo, height => {
            params.height = height;
        });

        return super.execute(cb, finishFast);
    }

    get shouldRescaleOnZoom() { return false }

    render(params: EditThreePointArcParams) {
        this.lengthGizmo.value = params.length;
        this.heightGizmo.value = params.height;
        this.placeHeightGizmo();
    }

    // The height arrow runs from the middle of the line between the arc's ends to the middle of the arc
    private placeHeightGizmo() {
        this.heightGizmo.position.set(this.params.length / 2, 0, 0);
    }
}

// A pin whose ball sits exactly at its length, on the arc's start or end; it stops at the minimum length
class ArcLengthGizmo extends DistanceGizmo {
    protected override minShaft = 0;

    constructor(name: string, editor: EditorLike) {
        super(name, editor);
        this.state.min = minLength;
    }

    onInterrupt(cb: (length: number) => void) {
        this.state.push();
    }
}

// An arrow from the middle of the line between an arc's ends to the middle of the arc; it stops at the minimum length
class ArcHeightGizmo extends AbstractAxisGizmo {
    readonly state = new MagnitudeStateMachine(0);
    protected material = this.editor.gizmos.default;
    readonly tip = new THREE.Mesh(arrowGeometry, this.material.mesh);
    protected readonly shaft = new Line2(lineGeometry, this.material.line2);
    protected readonly knob = new THREE.Mesh(new THREE.SphereGeometry(0.2), this.editor.gizmos.invisible);
    readonly helper = new NumberHelper();

    constructor(name: string, editor: EditorLike) {
        super(name, editor);
        this.state.min = minLength;
        this.setup();
        this.add(this.helper);
    }

    protected accumulate(original: number, sign: number, dist: number): number {
        return original + dist
    }

    onInterrupt(cb: (height: number) => void) {
        this.state.push();
    }

    // Only the arrow keeps a constant screen size; the gizmo itself stays in world units so the arrow sits on the arc
    protected override scaleIndependentOfZoom(camera: THREE.Camera, worldPosition: THREE.Vector3) {
        const { relativeScale, tip, knob } = this;
        tip.scale.copy(relativeScale);
        knob.scale.copy(relativeScale);
        Helper.scaleIndependentOfZoom(tip, camera, worldPosition);
        Helper.scaleIndependentOfZoom(knob, camera, worldPosition);
    }
}

const planeGeometry = new THREE.PlaneGeometry(100_000, 100_000, 2, 2);
const guideGeometry = new THREE.BufferGeometry();
guideGeometry.setAttribute('position', new THREE.BufferAttribute(CircleGeometry(1, 64), 3));

// The change from one angle to another, the short way round, in [-π, π)
export function angleDelta(from: number, to: number): number {
    const delta = (to - from) % (2 * Math.PI);
    if (delta >= Math.PI) return delta - 2 * Math.PI;
    if (delta < -Math.PI) return delta + 2 * Math.PI;
    return delta;
}

// A handle on an arc's end that slides around the arc's circle, setting its sweep. The gizmo sits at the arc's centre,
// with the arc running counterclockwise around its Z from its X. The handle is placed in world units, at the arc's radius,
// while the sphere keeps a constant size on screen.
export class ArcSweepGizmo extends AbstractGizmo<number> {
    readonly state = new MagnitudeStateMachine(0);
    readonly helper = new NumberHelper(formatAngle);
    private readonly material = this.editor.gizmos.default;
    private readonly tip = new THREE.Mesh(sphereGeometry, this.material.mesh);
    override get labelAnchor(): THREE.Object3D { return this.tip }
    private readonly knob = new THREE.Mesh(new THREE.SphereGeometry(0.2), this.editor.gizmos.invisible);
    private readonly guide = new THREE.Line(guideGeometry, this.material.line);
    private readonly plane = new THREE.Mesh(planeGeometry, this.editor.gizmos.invisible);
    private mode: 'pointer' | 'keyboard' = 'pointer';

    // The pointer's angle on its last move, and the sweep it has dragged to before clamping, counted across turns
    private previous = 0;
    private unclamped = 0;

    constructor(name: string, editor: EditorLike) {
        super(name.split(':')[0], editor);
        this.knob.userData.command = [`gizmo:${name}`, () => { }];
        this.guide.visible = false;
        this.handle.add(this.tip, this.guide);
        this.picker.add(this.knob);
        this.add(this.helper);
        this.render(this.state.current);
    }

    private _radius = 1;
    get radius() { return this._radius }
    set radius(radius: number) {
        this._radius = radius;
        this.render(this.state.current);
    }

    get value() { return this.state.current }
    set value(angle: number) {
        this.state.original = angle;
        this.render(angle);
    }

    render(angle: number) {
        const { tip, knob, guide, radius } = this;
        tip.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
        knob.position.copy(tip.position);
        guide.scale.setScalar(radius);
    }

    onPointerEnter(intersect: Intersector) {
        this.tip.material = this.material.hover.mesh;
    }

    onPointerLeave(intersect: Intersector) {
        this.tip.material = this.material.mesh;
    }

    onPointerDown(cb: (angle: number) => void, intersect: Intersector, info: MovementInfo) {
        this.unclamped = this.state.current;
        this.previous = this.pointerAngle(intersect) ?? this.state.current;
        this.guide.visible = true;
    }

    onPointerMove(cb: (angle: number) => void, intersect: Intersector, info: MovementInfo): number | undefined {
        if (this.mode !== 'pointer') return this.state.current;
        const angle = this.pointerAngle(intersect);
        if (angle === undefined) return this.state.current;

        // Accumulate the change, so passing the arc's start doesn't jump between 0° and 360°
        this.unclamped += angleDelta(this.previous, angle);
        this.previous = angle;
        const sweep = THREE.MathUtils.clamp(this.truncate(this.unclamped, info.event), minAngle, maxAngle);
        this.state.current = sweep;
        this.render(sweep);
        cb(sweep);
        return sweep;
    }

    onPointerUp(cb: (angle: number) => void, intersect: Intersector, info: MovementInfo) {
        this.state.push();
        this.mode = 'pointer';
        this.tip.material = this.material.mesh;
        this.guide.visible = false;
    }

    onInterrupt(cb: (angle: number) => void) {
        this.state.push();
        this.guide.visible = false;
    }

    override onKeyPress(cb: (angle: number) => void, text: KeyboardInterpreter) {
        const degrees = TextCalculator.calculate(text.state);
        if (degrees === undefined) {
            this.mode = 'pointer';
            return this.state.current;
        }

        const angle = THREE.MathUtils.clamp(deg2rad(degrees), minAngle, maxAngle);
        this.state.current = angle;
        this.render(angle);
        cb(angle);
        this.mode = 'keyboard';
        return angle;
    }

    // Angles step to multiples of the angle step while angle snapping is on.
    private truncate(angle: number, event: MouseEvent): number {
        const { snaps } = this.editor;
        if (!snaps.angleSnapping) return angle;
        return deg2rad(roundToStep(rad2deg(angle), snaps.angleStep));
    }

    // The pointer's angle around the arc's centre, in the arc's plane; undefined when the plane is edge-on
    private pointerAngle(intersect: Intersector): number | undefined {
        const { plane } = this;
        this.getWorldPosition(plane.position);
        this.getWorldQuaternion(plane.quaternion);
        plane.updateMatrixWorld();
        const hit = intersect.raycast(plane);
        if (hit === undefined) return;
        const local = this.worldToLocal(hit.point.clone());
        if (local.x === 0 && local.y === 0) return;
        return Math.atan2(local.y, local.x);
    }

    // Only the sphere keeps a constant screen size; the gizmo itself stays in world units so the sphere sits on the arc
    protected override scaleIndependentOfZoom(camera: THREE.Camera, worldPosition: THREE.Vector3) {
        const { relativeScale, tip, knob } = this;
        tip.scale.copy(relativeScale);
        knob.scale.copy(relativeScale);
        Helper.scaleIndependentOfZoom(tip, camera, worldPosition);
        Helper.scaleIndependentOfZoom(knob, camera, worldPosition);
    }
}
