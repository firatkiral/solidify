import { CompositeDisposable } from "event-kit";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { EditorLike, Intersector, Mode, MovementInfo } from "../../command/AbstractGizmo";
import { CompositeGizmo } from "../../command/CompositeGizmo";
import { AbstractAxialScaleGizmo, AbstractAxisGizmo, arrowGeometry, AxisHelper, CompositeHelper, lineGeometry, MagnitudeStateMachine, Measure, NumberHelper, sphereGeometry } from "../../command/MiniGizmos";
import { CancellablePromise } from "../../util/CancellablePromise";
import { Helper } from "../../util/Helpers";
import { AdvancedGizmoTriggerStrategy } from "../../command/AdvancedGizmoTriggerStrategy";
import { ModifyContourParams } from "./ModifyContourFactory";

const Y = new THREE.Vector3(0, 1, 0);

export class ModifyContourGizmo extends CompositeGizmo<ModifyContourParams> {
    private readonly filletAll = new FilletCornerGizmo("modify-contour:fillet-all", this.editor, true);
    private readonly segments: PushCurveGizmo[] = [];
    private readonly corners: FilletCornerHandleGizmo[] = [];

    private readonly segmentTrigger = new AdvancedGizmoTriggerStrategy<number, void>(this.editor);
    private readonly filletTrigger = new AdvancedGizmoTriggerStrategy<number, void>(this.editor);

    constructor(params: ModifyContourParams, editor: EditorLike) {
        super(params, editor);

        for (const [i, segment] of params.segmentAngles.entries()) {
            if (!segment.pushable) continue;
            const gizmo = new PushCurveGizmo("modify-contour:segment", this.editor);
            gizmo.userData.index = i;
            gizmo.trigger = this.segmentTrigger;
            this.segments.push(gizmo);
        }

        for (const corner of params.cornerAngles) {
            const gizmo = new FilletCornerHandleGizmo("modify-contour:fillet", this.editor);
            gizmo.userData.index = corner.index;
            gizmo.trigger = this.filletTrigger;
            this.corners.push(gizmo);
        }
    }

    prepare() {
        const { filletAll, segments, corners, params } = this;

        filletAll.visible = false;

        for (const segment of segments) segment.relativeScale.setScalar(0.8);

        const quat = new THREE.Quaternion();
        for (const gizmo of segments) {
            const segment = params.segmentAngles[gizmo.userData.index];
            gizmo.relativeScale.setScalar(0.5);
            quat.setFromUnitVectors(Y, segment.normal);
            gizmo.quaternion.copy(quat);
            gizmo.position.copy(segment.origin);
        }

        const centroid = new THREE.Vector3();
        for (const [i, corner] of params.cornerAngles.entries()) {
            const gizmo = corners[i];
            gizmo.relativeScale.setScalar(0.8);
            quat.setFromUnitVectors(Y, corner.tau.cross(corner.axis));
            gizmo.quaternion.copy(quat);
            gizmo.position.copy(corner.origin);
            centroid.add(corner.origin);
        }

        if (params.cornerAngles.length > 0) {
            centroid.divideScalar(params.cornerAngles.length);
            filletAll.position.copy(centroid);
        }

        this.add(filletAll);
        for (const segment of segments) this.add(segment);
        for (const corner of corners) this.add(corner);
    }

    execute(cb: (params: ModifyContourParams) => void, mode: Mode = Mode.None): CancellablePromise<void> {
        const { filletAll, segments, params, corners } = this;
        const { segmentTrigger, filletTrigger } = this;

        const disposable = new CompositeDisposable();
        disposable.add(segmentTrigger.execute());
        disposable.add(filletTrigger.execute());

        // Each handle shows the size it changes, where there is one; from the start when it is the only one
        const measures = segments.map(segment => params.segmentMeasures[segment.userData.index]);
        const pinned = measures.filter(m => m !== undefined).length === 1;
        for (const [i, measure] of measures.entries()) {
            if (measure !== undefined) segments[i].setMeasure(new Measure(measure.label, measure.base, measure.rate), pinned);
        }

        for (const segment of segments) {
            this.addGizmo(segment, d => {
                this.disableCorners();
                this.disableSegments(segment);

                params.mode = 'offset';
                params.segment = segment.userData.index;
                params.distance = d;
            });
        }


        if (params.cornerAngles.length > 0) {
            this.addGizmo(filletAll, d => {
                this.disableSegments();

                params.mode = 'fillet';
                for (const [i, corner] of params.cornerAngles.entries()) {
                    params.radiuses[corner.index] = d;
                    corners[i].value = d;
                }
            });
        }

        for (const corner of corners) {
            this.addGizmo(corner, d => {
                this.disableSegments();

                params.mode = 'fillet';
                params.radiuses[corner.userData.index] = d;
            });
        }

        return super.execute(cb, mode, disposable);
    }

    private disableSegments(except?: PushCurveGizmo) {
        for (const segment of this.segments) {
            if (segment === except) continue;
            segment.stateMachine!.isEnabled = false;
            segment.visible = false;
        }
    }

    private disableCorners() {
        if (this.corners.length > 0) this.filletAll.stateMachine!.isEnabled = false;
        for (const corners of this.corners) {
            corners.stateMachine!.isEnabled = false;
            corners.visible = false;
        }
    }

    get shouldRescaleOnZoom() { return false }
}

class PushCurveGizmo extends AbstractAxisGizmo {
    readonly state = new MagnitudeStateMachine(0, false);
    protected material = this.editor.gizmos.default;
    readonly helper = new CompositeHelper([new AxisHelper(this.material.line), new NumberHelper()]);
    readonly tip = new THREE.Mesh(arrowGeometry, this.editor.gizmos.default.mesh);
    protected readonly shaft = new Line2(lineGeometry, this.editor.gizmos.default.line2);
    protected readonly knob = new THREE.Mesh(new THREE.SphereGeometry(0.2), this.editor.gizmos.invisible);
    protected readonly hasCommand = false;

    constructor(name: string, editor: EditorLike) {
        super(name, editor);
        this.setup();
        this.add(this.helper);
    }

    // render(length: number) { super.render(-length - 0.35) }

    protected accumulate(original: number, sign: number, dist: number): number {
        return original + dist
    }

    // Only the arrow keeps a constant screen size; the gizmo itself stays in world units so the arrow follows the pushed segment
    protected override scaleIndependentOfZoom(camera: THREE.Camera, worldPosition: THREE.Vector3) {
        const { relativeScale, tip, knob } = this;
        tip.scale.copy(relativeScale);
        knob.scale.copy(relativeScale);
        Helper.scaleIndependentOfZoom(tip, camera, worldPosition);
        Helper.scaleIndependentOfZoom(knob, camera, worldPosition);
    }
}

export class FilletCornerGizmo extends AbstractAxialScaleGizmo {
    handleLength = -0.35;
    readonly state = new MagnitudeStateMachine(0);
    readonly tip: THREE.Mesh<any, any> = new THREE.Mesh(sphereGeometry, this.material.mesh);
    protected readonly shaft = new Line2(lineGeometry, this.material.line2);
    protected readonly knob = new THREE.Mesh(new THREE.SphereGeometry(0.2), this.editor.gizmos.invisible);

    constructor(name: string, editor: EditorLike, protected readonly hasCommand = false) {
        super(name, editor, editor.gizmos.default);
        this.setup();
    }

    protected accumulate(original: number, dist: number, denom: number, sign: number = 1): number {
        return Math.max(0, sign * (original + dist - denom))
    }

    get shouldRescaleOnZoom() { return true }
}

// A corner's sphere starts a short, screen-constant distance from the corner along its side and moves out along that side
// by the radius, so it stays under the pointer while dragging
export class FilletCornerHandleGizmo extends FilletCornerGizmo {
    private readonly startPoint = new THREE.Vector3();
    private readonly away = new THREE.Vector3();
    private radius = 0;
    private factor?: number;

    override onPointerDown(cb: (radius: number) => void, intersect: Intersector, info: MovementInfo) {
        super.onPointerDown(cb, intersect, info);
        const hit = intersect.raycast(this.plane);
        if (hit !== undefined) this.startPoint.copy(hit.point);
    }

    override onPointerMove(cb: (radius: number) => void, intersect: Intersector, info: MovementInfo): number {
        if (this.mode !== 'pointer') return this.state.current;
        const point = intersect.raycast(this.plane)?.point;
        if (point === undefined) return this.state.current;

        const away = this.away.set(0, -1, 0).applyQuaternion(this.worldQuaternion);
        const radius = this.stepLength(Math.max(0, this.state.original + point.sub(this.startPoint).dot(away)), info.event);
        this.state.current = radius;
        this.render(radius);
        cb(radius);
        return radius;
    }

    render(radius: number) {
        this.radius = radius;
        this.place();
    }

    protected override scaleIndependentOfZoom(camera: THREE.Camera, worldPosition: THREE.Vector3) {
        const { relativeScale, tip, knob } = this;
        tip.scale.copy(relativeScale);
        knob.scale.copy(relativeScale);
        Helper.scaleIndependentOfZoom(tip, camera, worldPosition);
        this.factor = Helper.scaleIndependentOfZoom(knob, camera, worldPosition);
        this.place();
    }

    private place() {
        // NOTE: render() runs from the base constructor, before this class's fields are initialized
        const y = this.handleLength * this.relativeScale.y * (this.factor ?? 1) - this.radius;
        this.shaft.scale.y = y;
        this.tip.position.set(0, y, 0);
        this.knob.position.copy(this.tip.position);
    }
}