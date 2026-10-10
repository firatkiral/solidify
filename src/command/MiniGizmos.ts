import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry";
import { ProxyCamera } from "../components/viewport/ProxyCamera";
import { Viewport } from "../components/viewport/Viewport";
import { CancellablePromise } from "../util/CancellablePromise";
import { CancellableRegisterable } from "../util/CancellableRegisterable";
import { CancellableRegistor } from "../util/CancellableRegistor";
import { deg2rad, rad2deg, roundToStep } from "../util/Conversion";
import { formatAngle, formatLength, fromLengthUnit, lengthUnit } from "../util/Units";
import { Helper } from "../util/Helpers";
import { CircleGeometry } from "../util/Util";
import { AbstractGizmo, EditorLike, GizmoHelper, Intersector, Mode, MovementInfo } from "./AbstractGizmo";
import { GizmoMaterial } from "./GizmoMaterials";
import { KeyboardInterpreter, TextCalculator } from "./KeyboardInterpreter";

/**
 * In this file are a collection of "mini" gizmos that can be used alone or composed into a more complex gizmo.
 * Gizmos rely on two state machines: 1), the state machine that is part of AbstractGizmo, which handles user
 * interaction dealing with mousedown, mousemove, mouseup, etc. and 2) the AbstractValueStateMachine, which keeps
 * track of the current value of the widget (which could be scalar or vector), and allows rolling back to
 * previous values.
 * 
 * At the moment there are Circular gizmos (angles, movement in screen space), Axial gizmos (move/scale
 * in x/y/z, fillet and push/pull handles), and planar gizmos (move/scale in the XY plane, etc.)
 * 
 * This file only has a few concrete gizmos (Angle, Length, Magnitude) but it exports abstract classes for
 * circular, axial, and planar gizmos to subclass.
 */

const radius = 1;

class AbstractValueStateMachine<T> {
    private currentMagnitude: T;

    constructor(private originalMagnitude: T, private readonly interruptShouldRevert = true) {
        this.currentMagnitude = originalMagnitude;
    }

    get original() { return this.originalMagnitude }
    set original(magnitude: T) {
        this.originalMagnitude = this.currentMagnitude = magnitude;
    }

    get current() { return this.currentMagnitude }
    set current(magnitude: T) { this.currentMagnitude = magnitude }

    start() { }
    push() { this.original = this.currentMagnitude }
    revert() { this.current = this.original }
    interrupt() { if (this.interruptShouldRevert) this.revert() }
}

export class MagnitudeStateMachine extends AbstractValueStateMachine<number> {
    min = Number.NEGATIVE_INFINITY;
    get current() { return Math.max(super.current, this.min) }
    set current(magnitude: number) { super.current = magnitude }
}

export class VectorStateMachine extends AbstractValueStateMachine<THREE.Vector3> { }

export class QuaternionStateMachine extends AbstractValueStateMachine<THREE.Quaternion> { }

const circleGeometry = new LineGeometry();
circleGeometry.setPositions(CircleGeometry(radius, 64));

export abstract class CircularGizmo<T> extends AbstractGizmo<T> {
    protected readonly hasCommand: boolean = true;
    get value() { return this.state.current }
    set value(m: T) { this.state.original = m }

    protected readonly circle = new Line2(circleGeometry, this.material.line2);
    protected readonly torus = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.15, 4, 24), this.editor.gizmos.invisible);
    readonly helper?: GizmoHelper<T> = new DashedLineMagnitudeHelper();

    constructor(private readonly longName: string, editor: EditorLike, protected readonly material: GizmoMaterial, readonly state: AbstractValueStateMachine<T>) {
        super(longName.split(':')[0], editor);
    }

    protected setup() {
        if (this.hasCommand) this.torus.userData.command = [`gizmo:${this.longName}`, () => { }];
        this.handle.add(this.circle);
        this.picker.add(this.torus);
    }

    onInterrupt(cb: (value: T) => void) {
        this.state.interrupt();
        cb(this.state.current);
    }

    onPointerDown(cb: (n: T) => void, intersect: Intersector, info: MovementInfo) {
        this.state.start();
    }

    onPointerEnter(intersect: Intersector) {
        this.circle.material = this.material.hover.line2;
    }

    onPointerLeave(intersect: Intersector) {
        this.circle.material = this.material.line2;
    }

    onPointerUp(cb: (n: T) => void, intersect: Intersector, info: MovementInfo) {
        this.state.push();
        this.circle.material = this.material.line2;
    }

    get shouldLookAtCamera() { return true }

    update(camera: THREE.Camera) {
        if (this.shouldLookAtCamera) {
            this.quaternion.identity();
            super.update(camera);
            this.quaternion.multiplyQuaternions(this.worldQuaternionInv, camera.quaternion);
        } else {
            super.update(camera);
        }
    }

    onDeactivate() {
        this.visible = false;
    }

    onActivate() {
        if (!this.stateMachine?.isEnabled) return;
        this.visible = true;
    }
}

type InputMode = 'keyboard' | 'pointer';

export class AngleGizmo extends CircularGizmo<number> {
    protected mode: InputMode = 'pointer';
    override readonly helper = new CompositeHelper([new DashedLineMagnitudeHelper(), new NumberHelper(formatAngle)]);

    private _camera!: THREE.Camera;
    get camera() { return this._camera }

    constructor(name: string, editor: EditorLike, material?: GizmoMaterial) {
        super(name, editor, material ?? editor.gizmos.white, new MagnitudeStateMachine(0));
        this.setup();
        this.add(this.helper);
    }

    override onPointerDown(cb: (angle: number) => void, intersect: Intersector, info: MovementInfo) {
    }

    onPointerMove(cb: (angle: number) => void, intersect: Intersector, info: MovementInfo): number | undefined {
        if (this.mode !== 'pointer') return this.state.current;

        const angle = info.angle + this.state.original;
        this.state.current = this.truncate(angle, info.event);
        this._camera = info.viewport.camera;
        cb(this.state.current);
        return this.state.current;
    }

    override onPointerUp(cb: (n: number) => void, intersect: Intersector, info: MovementInfo): void {
        super.onPointerUp(cb, intersect, info);
        this.mode = 'pointer';
    }

    // Angles step to multiples of the angle step while angle snapping is on.
    protected truncate(angle: number, event: MouseEvent): number {
        const { snaps } = this.editor;
        if (!snaps.angleSnapping) return angle;
        return deg2rad(roundToStep(rad2deg(angle), snaps.angleStep));
    }

    override onKeyPress(cb: (angle: number) => void, text: KeyboardInterpreter) {
        const number = TextCalculator.calculate(text.state);
        if (number === undefined) {
            this.mode = 'pointer';
            return this.state.current;
        }

        const angle = THREE.MathUtils.degToRad(number);
        this.state.current = angle;
        cb(angle);
        this.mode = 'keyboard';
        return angle;
    }
}

export abstract class AbstractAxisGizmo extends AbstractGizmo<number>  {
    protected mode: InputMode = 'pointer';

    abstract readonly tip: THREE.Mesh;
    protected abstract readonly knob: THREE.Mesh;
    protected abstract readonly shaft: THREE.Mesh;
    protected abstract readonly material: GizmoMaterial;
    protected abstract readonly state: MagnitudeStateMachine;
    protected readonly hasCommand: boolean = true;

    protected readonly plane = new THREE.Mesh(planeGeometry, this.editor.gizmos.invisible);

    protected originalPosition!: THREE.Vector3;
    private readonly startMousePosition = new THREE.Vector3();
    private sign = 1;

    constructor(
        protected readonly longName: string,
        editor: EditorLike,
    ) {
        super(longName.split(':')[0], editor);
    }

    // Lengths step to multiples of the gizmo length step while gizmo snapping is on, as shown (see Measure); ratios
    // (scale) opt out.
    protected get stepsAsLength() { return true }
    protected stepLength(length: number, event: MouseEvent): number {
        const { snaps } = this.editor;
        if (!this.stepsAsLength || !snaps.gizmoSnapping) return length;
        const { measure } = this;
        if (measure === undefined) return roundToStep(length, snaps.lengthStep);
        return measure.value(roundToStep(measure.shown(length), snaps.lengthStep));
    }

    // The real size this handle sets, which its readout shows and typing and snapping go by. Pinned, the readout
    // shows from the start; otherwise only while dragging or typing.
    private _measure?: Measure;
    get measure() { return this._measure }
    set measure(measure: Measure | undefined) { this.setMeasure(measure, true) }
    setMeasure(measure: Measure | undefined, pinned: boolean) {
        this._measure = measure;
        const readout = findReadout(this.helper);
        if (readout === undefined) return;
        const viewport = this.editor.activeViewport ?? [...this.editor.viewports][0];
        if (measure === undefined || viewport === undefined) readout.unmeasure();
        else readout.measure(viewport, measure, () => this.state.current, pinned);
    }

    override execute(cb: (value: number) => void, mode?: Mode): CancellablePromise<void> {
        const executing = super.execute(cb, mode);
        const unmeasure = () => findReadout(this.helper)?.unmeasure();
        executing.then(unmeasure, unmeasure);
        return executing;
    }

    protected setup() {
        if (this.hasCommand) this.knob.userData.command = [`gizmo:${this.longName}`, () => { }];
        this.tip.position.set(0, 1, 0);
        this.knob.position.copy(this.tip.position);
        this.render(this.state.current);

        this.handle.add(this.tip, this.shaft);
        this.picker.add(this.knob);
    }

    onInterrupt(cb: (radius: number) => void) {
        this.state.interrupt();
        cb(this.state.current);
    }

    onPointerEnter(intersect: Intersector) {
        this.shaft.material = this.material.hover.line2;
        this.tip.material = this.material.hover.mesh;
    }

    onPointerLeave(intersect: Intersector) {
        this.shaft.material = this.material.line2;
        this.tip.material = this.material.mesh;
    }

    onPointerUp(cb: (radius: number) => void, intersect: Intersector, info: MovementInfo) {
        this.state.push();
        this.shaft.material = this.material.line2;
        this.tip.material = this.material.mesh;
        this.mode = 'pointer';
    }

    onPointerDown(cb: (radius: number) => void, intersect: Intersector, info: MovementInfo): THREE.Vector3 | void {
        const planeIntersect = intersect.raycast(this.plane);
        if (planeIntersect === undefined) return;

        this.startMousePosition.copy(planeIntersect.point);
        this.sign = Math.sign(planeIntersect.point.dot(this.localY.set(0, 1, 0).applyQuaternion(this.worldQuaternion)));
        if (this.sign === 0) this.sign = 1;

        if (this.originalPosition === undefined) this.originalPosition = this.worldPosition.clone();
        return this.originalPosition;
    }

    onPointerMove(cb: (delta: number) => void, intersect: Intersector, info: MovementInfo): number | undefined {
        if (this.mode !== 'pointer') return this.state.current;

        // Handles don't snap to objects or the grid, only by their own length step
        const localY = this.localY.set(0, 1, 0).applyQuaternion(this.worldQuaternion);
        const point = intersect.raycast(this.plane)?.point;
        if (point === undefined) return; // this only happens when the user is dragging through different viewports.

        const dist = point.sub(this.startMousePosition).dot(localY);
        const length = this.stepLength(this.accumulate(this.state.original, this.sign, dist), info.event);
        point.copy(localY).multiplyScalar(length).add(this.originalPosition);
        this.state.current = length;
        this.render(this.state.current);
        cb(this.state.current);
        return this.state.current;
    }

    // Lengths are typed in the length unit, as shown (see Measure)
    override onKeyPress(cb: (distance: number) => void, text: KeyboardInterpreter) {
        const typed = TextCalculator.calculate(text.state);
        const shown = typed !== undefined && this.stepsAsLength ? fromLengthUnit(typed) : typed;
        const distance = shown !== undefined && this.measure !== undefined ? this.measure.value(shown) : shown;
        if (distance === undefined) {
            this.mode = 'pointer';
            return this.state.current;
        }

        this.state.current = distance;
        this.render(this.state.current);
        cb(distance);
        this.mode = 'keyboard';
        return distance;
    }

    protected abstract accumulate(original: number, sign: number, dist: number): number;

    get value() { return this.state.current }
    set value(mag: number) {
        this.state.original = mag;
        this.render(this.state.current);
    }

    render(length: number) {
        this.shaft.scale.y = length;
        this.tip.position.set(0, length, 0);
        this.knob.position.copy(this.tip.position);
    }

    private localY = new THREE.Vector3();
    private dir = new THREE.Vector3();
    private align = new THREE.Vector3();
    update(camera: ProxyCamera) {
        super.update(camera);

        const { eye, worldPosition, worldQuaternion, plane, localY, align, dir } = this;

        eye.copy(camera.position).sub(worldPosition).normalize();

        const o = localY.copy(Y).applyQuaternion(worldQuaternion);
        align.copy(eye).cross(o);
        dir.copy(o).cross(align);

        const matrix = new THREE.Matrix4();
        matrix.lookAt(origin, dir, align);
        plane.quaternion.setFromRotationMatrix(matrix);
        plane.position.copy(worldPosition);
        plane.updateMatrixWorld();

        this.cameraFactorForPointerVelocity = AbstractAxisGizmo.cameraFactorForPointerVelocity(camera, this.position)
    }
    protected cameraFactorForPointerVelocity = 1;

    private static readonly o = new THREE.Vector3();
    static cameraFactorForPointerVelocity(camera: ProxyCamera, target: THREE.Vector3): number {
        const { o } = this;
        if (camera.isPerspectiveCamera) {
            o.copy(camera.position).sub(target);
            let targetDistance = o.length();

            // half of the fov is center to top of screen
            targetDistance *= Math.tan((camera.fov / 2) * Math.PI / 180.0);

            return 2 * targetDistance;
        } else if (camera.isOrthographicCamera) {
            const magicSlowDownToFeelGood = 1.5;
            return Math.min((camera.top - camera.bottom), -(camera.left - camera.right)) / camera.zoom / magicSlowDownToFeelGood;
        } else throw new Error("invalid precondition");
    }
}

const origin = new THREE.Vector3();

const arrowLength = 0.2;
export const arrowGeometry = new THREE.CylinderGeometry(0, 0.1, arrowLength, 12, 1, false);
export const lineGeometry = new LineGeometry();
lineGeometry.setPositions([0, 0, 0, 0, 1, 0]);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

const planeGeometry = new THREE.PlaneGeometry(100_000, 100_000, 2, 2);

// Both Length and Magnitude gizmos are linear gizmos. However, Length represents
// a world-space length, and thus shouldn't rescale with view. Whereas the magnitude
// gizmo is just a scalar quantity and SHOULD scale with view.
export class LengthGizmo extends AbstractAxisGizmo { // DO NOT SUBCLASS or the abstract fields won't work
    readonly state = new MagnitudeStateMachine(0);
    readonly tip: THREE.Mesh<any, any> = new THREE.Mesh(boxGeometry, this.editor.gizmos.default.mesh);
    protected readonly shaft = new Line2(lineGeometry, this.editor.gizmos.default.line2);
    protected readonly knob = new THREE.Mesh(new THREE.SphereGeometry(0.2), this.editor.gizmos.invisible);
    protected material = this.editor.gizmos.default;

    constructor(name: string, editor: EditorLike) {
        super(name, editor);
        this.state.min = 0;
        this.setup();
    }

    protected accumulate(original: number, sign: number, dist: number): number {
        return original + sign * dist
    }
}

export abstract class PlanarGizmo<T> extends AbstractGizmo<T> {
    protected originalPosition!: THREE.Vector3;
    protected denominator = 1;
    abstract readonly state: AbstractValueStateMachine<T>;
    get value() { return this.state.current }
    set value(value: T) {
        this.state.original = value;
        this.render(value);
    }

    protected readonly square = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), this.material.mesh);
    protected readonly knob = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), this.editor.gizmos.invisible);
    protected readonly plane = new THREE.Mesh(planeGeometry, this.editor.gizmos.invisible);
    protected readonly startMousePosition = new THREE.Vector3();

    constructor(
        name: string,
        editor: EditorLike,
        private readonly material: GizmoMaterial,
    ) {
        super(name.split(':')[0], editor);

        this.square.position.set(0.5, 0.5, 0);
        this.knob.position.copy(this.square.position);
        this.knob.userData.command = [`gizmo:${name}`, () => { }];
        this.picker.add(this.knob)
        this.handle.add(this.square);
    }

    onInterrupt(cb: (value: T) => void) {
        this.state.interrupt();
        cb(this.state.current);
    }

    onPointerEnter(intersect: Intersector) {
        this.square.material = this.material.hover.mesh;
    }

    onPointerLeave(intersect: Intersector) {
        this.square.material = this.material.mesh;
    }

    onPointerUp(cb: (t: T) => void, intersect: Intersector, info: MovementInfo) {
        this.state.push();
    }

    onPointerDown(cb: (t: T) => void, intersect: Intersector, info: MovementInfo) {
        this.updatePlane();
        const planeIntersect = intersect.raycast(this.plane);
        if (planeIntersect === undefined) throw new Error("invalid precondition");
        this.state.start();
        this.startMousePosition.copy(planeIntersect.point);
        this.denominator = this.startMousePosition.distanceTo(this.worldPosition);
        if (this.denominator === 0) this.denominator = 1;
        if (this.originalPosition === undefined) this.originalPosition = this.worldPosition.clone();
    }

    private updatePlane() {
        const { plane, worldPosition } = this;
        this.getWorldQuaternion(plane.quaternion);
        this.getWorldPosition(worldPosition);
        this.plane.position.copy(worldPosition);
        this.plane.updateMatrixWorld();
    }

    render(value: T) { }
}

export const sphereGeometry = new THREE.SphereGeometry(0.1, 16, 16);
export const boxGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);

// The distance gizmo is a pin with a ball on top for moving objects. It's initial length is always 1,
// unlike the length gizmo, whose length is equal to the value it emits.
export class DistanceGizmo extends AbstractAxisGizmo {
    readonly state = new MagnitudeStateMachine(0);
    readonly tip: THREE.Mesh<any, any> = new THREE.Mesh(sphereGeometry, this.editor.gizmos.default.mesh);
    protected readonly shaft = new Line2(lineGeometry, this.editor.gizmos.default.line2);
    protected readonly knob = new THREE.Mesh(new THREE.SphereGeometry(0.2), this.editor.gizmos.invisible);
    protected material = this.editor.gizmos.default;
    readonly helper = new CompositeHelper([new AxisHelper(this.material.line), new NumberHelper()]);
    protected minShaft = 0.1;

    constructor(name: string, editor: EditorLike) {
        super(name, editor);
        this.setup();
        this.add(this.helper);
    }

    private _length!: number;
    render(length: number) {
        this._length = length;
        super.render(length);
    }

    protected accumulate(original: number, sign: number, dist: number): number {
        return original + dist
    }

    protected override scaleIndependentOfZoom(camera: THREE.Camera, worldPosition: THREE.Vector3) {
        const { relativeScale, tip, knob, shaft, _length } = this;
        tip.scale.copy(relativeScale);
        knob.scale.copy(relativeScale);
        Helper.scaleIndependentOfZoom(tip, camera, worldPosition);
        const factor = Helper.scaleIndependentOfZoom(knob, camera, worldPosition);
        const shaftLength = _length + this.minShaft * factor;
        shaft.scale.y = shaftLength;
        tip.position.set(0, shaftLength, 0);
        knob.position.copy(tip.position);
    }
}

// This gizmo behaves somewhere between a scale and a move gizmo
export abstract class AbstractAxialScaleGizmo extends AbstractAxisGizmo {
    readonly helper = new CompositeHelper([new DashedLineMagnitudeHelper(), new NumberHelper()]);
    protected readonly handleLength: number = 1;
    private denominator = 1;

    constructor(name: string, editor: EditorLike, protected readonly material: GizmoMaterial) {
        super(name, editor);
        this.add(this.helper);
    }

    onInterrupt(cb: (radius: number) => void) {
        this.state.interrupt();
        cb(this.state.current);
    }

    onPointerUp(cb: (radius: number) => void, intersect: Intersector, info: MovementInfo) {
        this.state.push();
        this.mode = 'pointer';
    }

    override onPointerDown(cb: (radius: number) => void, intersect: Intersector, info: MovementInfo) {
        const { pointStart2d, center2d } = info;
        this.denominator = pointStart2d.distanceTo(center2d);
        this.state.start();
    }

    private readonly end2center = new THREE.Vector2();
    private readonly start2center = new THREE.Vector2();
    override onPointerMove(cb: (radius: number) => void, intersect: Intersector, info: MovementInfo): number {
        if (this.mode !== 'pointer') return this.state.current;

        const { pointEnd2d, center2d, pointStart2d } = info;
        const { end2center, start2center } = this;

        end2center.copy(pointEnd2d).sub(center2d);
        start2center.copy(pointStart2d).sub(center2d);
        const sign = Math.sign(end2center.dot(start2center));

        const magnitude = this.stepLength(this.accumulate(this.state.original, end2center.length() * this.cameraFactorForPointerVelocity, this.denominator * this.cameraFactorForPointerVelocity, sign), info.event);
        this.state.current = magnitude;
        this.render(this.state.current);
        cb(this.state.current);
        return this.state.current;
    }

    render(length: number) {
        this.shaft.scale.y = length + this.handleLength;
        this.tip.position.set(0, length + this.handleLength, 0);
        this.knob.position.copy(this.tip.position);
    }

    protected accumulate(original: number, dist: number, denom: number, sign: number = 1): number {
        if (original === 0) return sign > 0 ? Math.max(0, dist - denom) : -dist;
        else return sign * (original + ((dist - denom) * original) / denom);
    }
}

// "Helpers" appear when the user starts interacting with the gizmo (after click)
// For values that grow/shink a dashed line works well, and for things that move
// along axes, a line appearing showing the direction is nice.
export class DashedLineMagnitudeHelper implements GizmoHelper<any> {
    private readonly element: SVGSVGElement;
    private readonly line: SVGLineElement;
    private parentElement?: HTMLElement;
    private state: 'none' | 'started' = 'none';

    constructor() {
        this.element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.element.setAttribute('viewBox', '-1 -1 2 2');
        this.element.setAttribute('preserveAspectRatio', 'none')
        this.element.classList.add('absolute', 'top-0', 'left-0', 'w-full', 'h-full');

        this.line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        this.line.classList.add('stroke', 'stroke-black');
        this.line.setAttribute('style', 'stroke-width: 0.002; stroke-dasharray: 0.006');
        this.element.appendChild(this.line);
    }

    onStart(viewport: Viewport, position: THREE.Vector2) {
        switch (this.state) {
            case 'none':
                const parentElement = viewport.domElement;
                parentElement.appendChild(this.element);
                this.parentElement = parentElement;

                const converted = this.toSVGCoordinates(position);

                this.line.setAttribute('x1', String(converted.x));
                this.line.setAttribute('y1', String(converted.y));
                this.line.setAttribute('x2', String(converted.x));
                this.line.setAttribute('y2', String(converted.y));

                this.state = 'started';
                break;
            default: throw new Error("invalid state: " + this.state);
        }
    }

    onMove(position: THREE.Vector2) {
        switch (this.state) {
            case 'started':
                const converted = this.toSVGCoordinates(position);
                this.line.setAttribute('x2', String(converted.x));
                this.line.setAttribute('y2', String(converted.y));
                break;
            default: throw new Error("invalid state");
        }
    }

    onKeyPress(info: any): void { }

    get aspectRatio() {
        const box = this.parentElement!.parentElement!;
        const aspectRatio = box.offsetWidth / box.offsetHeight;
        return aspectRatio;
    }

    private readonly converted = new THREE.Vector2();
    toSVGCoordinates(from: THREE.Vector2): THREE.Vector2 {
        this.converted.x = from.x;
        this.converted.y = -from.y;
        return this.converted;
    }

    onEnd() {
        switch (this.state) {
            case 'started':
                this.parentElement!.removeChild(this.element);
                this.state = 'none';
        }
    }

    onInterrupt() { this.onEnd() }
}

const axisGeometry = new THREE.BufferGeometry();
const points = [];
points.push(new THREE.Vector3(0, -10_000, 0));
points.push(new THREE.Vector3(0, 10_000, 0));
axisGeometry.setFromPoints(points);

// What a handle shows instead of its own value: the real size it sets, like a face's total thickness when the
// handle's value is how far the face moves. Shown = base + rate × value. Switched to offset (by the field in the
// command's dialog that shows it too), it shows the value itself.
export class Measure {
    offset = false;
    constructor(readonly label: string, readonly base: number, readonly rate: number) { }
    get name() { return this.offset ? 'Offset' : this.label }
    shown(value: number) { return this.offset ? value : this.base + this.rate * value }
    value(shown: number) { return this.offset ? shown : (shown - this.base) / this.rate }
}

// The gizmo's value as text, with its unit: lengths by default; shown while dragging or typing. Measured, it shows the
// measure instead (see Measure); pinned, it shows all along.
export class NumberHelper<T = number> extends Helper implements GizmoHelper<T>, CancellableRegisterable {
    private readonly element = document.createElement('div');
    private readonly text = document.createElement('span');
    private viewport?: Viewport;
    private measured?: { measure: Measure, value: () => number, pinned: boolean };
    private typing = false;

    constructor(private readonly format: (t: T) => string = formatLength as unknown as (t: T) => string) {
        super();
        this.element.className = 'axis-helper';
        this.element.append(this.text);
        this.position.set(0, 2, 0);
    }

    private formatted(value: T) {
        const { measured } = this;
        return this.format((measured === undefined ? value : measured.measure.shown(value as unknown as number)) as unknown as T);
    }

    private get pinned() { return this.measured?.pinned ?? false }

    private mount(viewport: Viewport) {
        if (this.viewport !== viewport || this.element.parentNode === null) viewport.domElement.appendChild(this.element);
        this.viewport = viewport;
    }

    measure(viewport: Viewport, measure: Measure, value: () => number, pinned: boolean) {
        this.measured = { measure, value, pinned };
        if (!pinned) return;
        this.mount(viewport);
        this.text.textContent = this.formatted(value() as unknown as T);
        this.element.hidden = false;
    }

    unmeasure() {
        this.measured = undefined;
        this.element.remove();
    }

    // A pinned readout follows the handle, and shows when the handle does
    update(camera: THREE.Camera) {
        super.update(camera);
        const { measured, viewport } = this;
        if (measured === undefined || !measured.pinned || viewport === undefined || viewport.camera !== camera) return;
        let shown = true;
        for (let o: THREE.Object3D | null = this; o !== null; o = o.parent) shown &&= o.visible;
        this.element.hidden = !shown;
        if (!this.typing) this.text.textContent = this.formatted(measured.value() as unknown as T);
        this.project();
    }

    onStart(viewport: Viewport, position: THREE.Vector2) {
        this.mount(viewport);
        this.element.hidden = !this.pinned;
    }

    onMove(position: THREE.Vector2 | THREE.Vector3, value: T) {
        this.element.hidden = false;
        this.text.textContent = this.formatted(value);
        this.project();
    }

    onPointPickerMove(viewport: Viewport, value: T) {
        this.mount(viewport);
        this.element.hidden = false;
        this.text.textContent = this.formatted(value);
        this.project();
    }

    private readonly at = new THREE.Vector3();
    private project() {
        const projected = this.getWorldPosition(this.at).project(this.viewport!.camera);
        this.viewport!.denormalizeScreenPosition(projected as any);
        this.element.style.top = projected.y + 'px';
        this.element.style.left = projected.x + 'px';
    }

    onKeyPress(value: T, text: KeyboardInterpreter): void {
        this.typing = true;
        this.element.hidden = false;
        this.text.textContent = (this.format as unknown) === formatLength ? `${text.state} ${lengthUnit()}` : text.state;
        this.project();
    }

    onEnd() {
        this.typing = false;
        if (!this.pinned) this.element.remove();
        else this.text.textContent = this.formatted(this.measured!.value() as unknown as T);
    }

    onInterrupt() { this.onEnd() }

    resource(reg: CancellableRegistor): this {
        reg.resource(this);
        return this;
    }

    cancel() { this.unmeasure() }
    finish() { this.unmeasure() }
    interrupt() { this.unmeasure() }
}

// The number readout among a gizmo's helpers
function findReadout(helper: GizmoHelper<any> | undefined): NumberHelper<any> | undefined {
    if (helper instanceof NumberHelper) return helper;
    if (helper instanceof CompositeHelper) for (const h of helper.helpers) {
        const found = findReadout(h);
        if (found !== undefined) return found;
    }
}

export class AxisHelper extends Helper implements GizmoHelper<any>, CancellableRegisterable {
    private readonly line = new THREE.Line(axisGeometry, this.material);

    constructor(private readonly material: THREE.LineBasicMaterial, stateless = false) {
        super();
        this.visible = stateless;
        this.add(this.line);
    }
    
    onStart(viewport: Viewport, position: THREE.Vector2) {
        this.visible = true;
    }
    onMove(position: THREE.Vector2) { }
    onKeyPress(info: any): void { }
    onEnd() { this.visible = false }
    onInterrupt() { this.visible = false }

    resource(reg: CancellableRegistor): this {
        reg.resource(this);
        return this;
    }

    cancel() { this.removeFromParent() }
    finish() { this.removeFromParent() }
    interrupt() { this.removeFromParent() }
}

export class CompositeHelper<I> extends THREE.Object3D implements GizmoHelper<I> {
    constructor(readonly helpers: GizmoHelper<I>[]) {
        super();
        for (const helper of helpers) {
            if (helper instanceof THREE.Object3D) this.add(helper);
        }
    }

    onStart(viewport: Viewport, positionSS: THREE.Vector2) {
        for (const helper of this.helpers) {
            helper.onStart(viewport, positionSS);
        }
    }

    onMove(positionSS: THREE.Vector2, value: I) {
        for (const helper of this.helpers) {
            helper.onMove(positionSS, value);
        }
    }

    onKeyPress(info: I, text: KeyboardInterpreter): void {
        for (const helper of this.helpers) {
            helper.onKeyPress(info, text);
        }
    }

    onEnd() {
        for (const helper of this.helpers) {
            helper.onEnd();
        }
    }

    onInterrupt() {
        for (const helper of this.helpers) {
            helper.onInterrupt();
        }
    }
}