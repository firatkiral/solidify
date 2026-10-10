import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2";
import c3d from '../../kernel/kernel';
import { EditorLike, Mode } from "../../command/AbstractGizmo";
import { CompositeGizmo } from "../../command/CompositeGizmo";
import { AbstractAxisGizmo, AngleGizmo, arrowGeometry, AxisHelper, CompositeHelper, lineGeometry, MagnitudeStateMachine, Measure, NumberHelper, sphereGeometry } from "../../command/MiniGizmos";
import { CancellablePromise } from "../../util/CancellablePromise";
import { deunit, point2point, vec2vec } from "../../util/Conversion";
import { OffsetFaceParams } from "./OffsetFaceFactory";

export class OffsetFaceGizmo extends CompositeGizmo<OffsetFaceParams> {
    private readonly distance = new ExtrudeLikeGizmo("offset-face:distance", this.editor);
    private readonly angle = new AngleGizmo("offset-face:angle", this.editor, this.editor.gizmos.ring);

    constructor(params: OffsetFaceParams, editor: EditorLike, private readonly hint?: THREE.Vector3) {
        super(params, editor);
        this.distance.state.min = Number.NEGATIVE_INFINITY;
    }

    prepare() {
        this.distance.relativeScale.setScalar(0.8);
        this.angle.relativeScale.setScalar(0.3);
    }

    execute(cb: (params: OffsetFaceParams) => void, finishFast: Mode = Mode.Persistent): CancellablePromise<void> {
        const { distance, angle, params } = this;

        const { point, normal } = this.placement(this.hint);
        this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        this.position.copy(point);
        this.point.copy(point);
        distance.measure = this.measureAt(point);

        this.add(distance);
        distance.add(angle);

        this.addGizmo(distance, distance => {
            params.distance = distance;
            this.position.set(0, distance, 0).applyQuaternion(this.quaternion).add(point);
        });

        this.addGizmo(angle, angle => {
            params.angle = angle;
        });

        return super.execute(cb, finishFast);
    }

    private readonly point = new THREE.Vector3();

    // Shows values set elsewhere, such as in the dialog
    render(params: OffsetFaceParams) {
        this.distance.value = params.distance;
        this.angle.value = params.angle;
        this.position.set(0, params.distance, 0).applyQuaternion(this.quaternion).add(this.point);
    }

    // The faces can change while it runs (see OffsetFaceCommand)
    remeasure() { this.distance.measure = this.measureAt(this.point) }
    get measure() { return this.distance.measure }

    // With one face, the handle shows the size it sets, as Shapr3D does: a flat face's total thickness back to the face
    // opposite it, a round wall's radius (a boss grows and a hole shrinks as the face moves out). Several faces, or
    // other faces, show the offset.
    private measureAt(point: THREE.Vector3): Measure | undefined {
        const { params: { faces }, editor: { db } } = this;
        if (faces.length !== 1) return undefined;
        const face = db.lookupTopologyItem(faces[0]);
        const thickness = face.GetThickness(point2point(point));
        if (thickness !== undefined) return new Measure('Total', deunit(thickness), 1);
        const cylinder = face.GetCylinder();
        if (cylinder !== undefined) return new Measure('Radius', deunit(cylinder.radius), cylinder.boss ? 1 : -1);
    }

    private placement(point?: THREE.Vector3): { point: THREE.Vector3, normal: THREE.Vector3 } {
        const { params: { faces }, editor: { db } } = this;
        const models = faces.map(view => db.lookupTopologyItem(view));
        const face = models[models.length - 1];

        return OffsetFaceGizmo.placement(face, point);
    }

    static placement(face: c3d.Face, hint?: THREE.Vector3): { point: THREE.Vector3, normal: THREE.Vector3 } {
        if (hint !== undefined) {
            const { u, v, normal } = face.NearPointProjection(point2point(hint));
            const { faceU, faceV } = face.GetFaceParam(u, v);
            const projected = point2point(face.Point(faceU, faceV));
            return { point: projected, normal: vec2vec(normal, 1) };
        } else {
            const { normal, point } = face.GetAnyPointOn();
            return { point: point2point(point), normal: vec2vec(normal, 1) };
        }
    }
}

export class ExtrudeLikeGizmo extends AbstractAxisGizmo {
    readonly state = new MagnitudeStateMachine(0, false);
    protected material = this.editor.gizmos.default;
    readonly helper = new CompositeHelper([new AxisHelper(this.material.line), new NumberHelper()]);
    readonly tip: THREE.Mesh<any, any> = new THREE.Mesh(sphereGeometry, this.editor.gizmos.default.mesh);
    protected readonly shaft = new Line2(lineGeometry, this.editor.gizmos.default.line2);
    protected readonly knob = new THREE.Mesh(new THREE.SphereGeometry(0.2), this.editor.gizmos.invisible);

    // An arrow where it pushes a face along its normal; a sphere where it sets a radius (see RefilletGizmo)
    constructor(name: string, editor: EditorLike, tip: THREE.BufferGeometry = arrowGeometry) {
        super(name, editor);
        this.tip.geometry = tip;
        this.setup();
        this.add(this.helper);
    }

    // The handle has constant length
    render(length: number) {
        super.render(1);
    }

    protected accumulate(original: number, sign: number, dist: number): number {
        return original + dist
    }
}