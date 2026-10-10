import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import c3d from '../../kernel/kernel';
import { EditorLike, Mode } from "../../command/AbstractGizmo";
import { CompositeGizmo } from "../../command/CompositeGizmo";
import { AbstractAxialScaleGizmo, AbstractAxisGizmo, AngleGizmo, AxisHelper, CompositeHelper, lineGeometry, MagnitudeStateMachine, NumberHelper, sphereGeometry } from "../../command/MiniGizmos";
import { groupBy } from "../../command/MultiFactory";
import { CancellablePromise } from "../../util/CancellablePromise";
import { point2point, vec2vec } from "../../util/Conversion";
import { Helper } from "../../util/Helpers";
import { formatAngle, formatLength } from "../../util/Units";
import * as fillet from './FilletFactory';
import { FilletParams } from './FilletFactory';
import { Y } from "../../util/Constants";


export class FilletSolidGizmo extends CompositeGizmo<FilletParams> {
    private readonly main = new FilletMagnitudeGizmo("fillet-solid:distance", this.editor, value => this.readout(value));
    private readonly stretchFillet = new FilletStretchGizmo("fillet-solid:fillet", this.editor);
    private readonly stretchChamfer = new ChamferStretchGizmo("fillet-solid:chamfer", this.editor);
    private readonly angle = new FilletAngleGizmo("fillet-solid:angle", this.editor, this.editor.gizmos.ring);
    private readonly variables: FilletMagnitudeGizmo[] = [];
    private readonly profile = new FilletProfile(this.editor);

    private mode: fillet.Mode = c3d.CreatorType.FilletSolid;

    constructor(params: FilletParams, editor: EditorLike, private readonly hint?: THREE.Vector3) {
        super(params, editor);
    }

    prepare() {
        const { main, angle, stretchFillet: stretchFillet, stretchChamfer } = this;
        const { point, normal, across } = this.placement(this.hint);

        main.quaternion.setFromUnitVectors(Y, normal);
        main.position.copy(point);
        this.profile.position.copy(point);
        this.profile.setFaces(...across);
        stretchFillet.position.copy(point);
        stretchChamfer.position.copy(point);

        main.relativeScale.setScalar(0.8);
        angle.relativeScale.setScalar(0.5);

        this.add(main, stretchFillet, stretchChamfer, this.profile);
        main.tip.add(angle);

        this.toggle(this.mode);
    }

    execute(cb: (params: FilletParams) => void): CancellablePromise<void> {
        const { main, angle, stretchFillet: stretchFillet, stretchChamfer, params } = this;

        angle.value = Math.PI / 4;

        this.addGizmo(main, length => {
            if (this.mode === c3d.CreatorType.ChamferSolid) {
                params.distance1 = length;
                params.distance2 = params.distance1 * Math.tan(angle.value);
                stretchFillet.value = -length;
                stretchChamfer.value = length;
            } else {
                params.distance = length;
                stretchFillet.value = length;
                stretchChamfer.value = -length;
            }
            angle.stateMachine!.isEnabled = this.shouldShowAngle;
            this.profile.draw(params.distance1, params.distance2);
        });

        this.addGizmo(stretchFillet, length => {
            params.distance = length;
            main.value = length;
            stretchChamfer.value = -length;
            angle.stateMachine!.isEnabled = this.shouldShowAngle;
            this.profile.draw(params.distance1, params.distance2);
        });

        this.addGizmo(stretchChamfer, length => {
            params.distance = length;
            main.value = length;
            stretchFillet.value = -length;
            angle.stateMachine!.isEnabled = this.shouldShowAngle;
            this.profile.draw(params.distance1, params.distance2);
        });

        this.addGizmo(angle, angle => {
            params.distance2 = params.distance1 * Math.tan(angle);
            this.profile.draw(params.distance1, params.distance2);
        }, false);

        return super.execute(cb, Mode.Persistent);
    }

    toggle(mode: fillet.Mode) {
        const { variables } = this;
        this.mode = mode;
        if (mode === c3d.CreatorType.ChamferSolid) {
            for (const variable of variables) {
                variable.visible = false;
                variable.stateMachine!.isEnabled = false;
            }
        } else if (mode === c3d.CreatorType.FilletSolid) {
            for (const variable of variables) {
                variable.visible = true;
                variable.stateMachine!.isEnabled = true;
            }
        }
    }

    get shouldShowAngle(): boolean {
        return Math.abs(this.params.distance1) + Math.abs(this.params.distance2) > 0
    }

    private placement(point?: THREE.Vector3): { point: THREE.Vector3, normal: THREE.Vector3, across: [THREE.Vector3, THREE.Vector3] } {
        const { params: { edges }, editor: { db } } = this;
        const models = edges.map(view => db.lookupTopologyItem(view));
        const curveEdge = models[models.length - 1];

        if (point !== undefined) {
            const t = curveEdge.PointProjection(point2point(point))
            const normal = vec2vec(curveEdge.EdgeNormal(t), 1);
            const projected = point2point(curveEdge.Point(t));
            return { point: projected, normal, across: acrossFaces(curveEdge, t) };
        } else {
            const normal = vec2vec(curveEdge.EdgeNormal(0.5), 1);
            point = point2point(curveEdge.Point(0.5));
            return { point, normal, across: acrossFaces(curveEdge, 0.5) };
        }
    }

    // The distance as a fillet's radius, or a chamfer's distance and angle
    private readout(value: number) {
        if (value < 0) return `C ${formatLength(-value)} · ${formatAngle(this.angle.value)}`;
        return `R ${formatLength(value)}`;
    }

    // Shows distances set elsewhere, such as in the dialog: the handles at the first distance (negative for a chamfer),
    // and a chamfer's angle from its two distances
    render(params: FilletParams) {
        const { main, stretchFillet, stretchChamfer, angle } = this;
        const { distance1, distance2 } = params;
        main.value = distance1;
        stretchFillet.value = distance1;
        stretchChamfer.value = -distance1;
        if (distance1 !== 0 && distance2 !== 0) angle.value = Math.atan2(Math.abs(distance2), Math.abs(distance1));
        // Before it runs, the dialog can already change it
        if (angle.stateMachine !== undefined) angle.stateMachine.isEnabled = this.shouldShowAngle;
        this.profile.draw(distance1, distance2);
    }

    addVariable(point: THREE.Vector3, edge: c3d.CurveEdge, t: number): FilletMagnitudeGizmo {
        const normal = edge.EdgeNormal(t);
        const gizmo = new FilletMagnitudeGizmo(`fillet:distance:${this.variables.length}`, this.editor);
        gizmo.relativeScale.setScalar(0.5);
        gizmo.value = 1;
        gizmo.position.copy(point);
        gizmo.quaternion.setFromUnitVectors(Y, vec2vec(normal, 1));
        this.variables.push(gizmo);

        return gizmo;
    }

    private edges: THREE.Object3D[] = [];
    showEdges() {
        for (const edge of this.edges) edge.removeFromParent();

        const map = groupBy('parentItem', this.params.edges);
        const views = [];
        for (const [solid, edges] of map.entries()) {
            const view = solid.edges.slice(edges);
            view.material = this.editor.materials.lineDashed();
            view.computeLineDistances();
            this.add(view);
            views.push(view);
        }
        this.edges = views;
    }

    get shouldRescaleOnZoom() { return false }
}

// Which way each face at the edge runs away from it at t, square to the edge: of the two ways across a face, the one
// that stays on it (a step the other way lands off the face, nearest the edge). An edge without two faces at an angle
// gets a right-angled corner around its normal.
export function acrossFaces(edge: c3d.CurveEdge, t: number): [THREE.Vector3, THREE.Vector3] {
    const point = point2point(edge.Point(t));
    const tangent = vec2vec(edge.Tangent(t), 1).normalize();
    const face1 = edge.GetFacePlus(), face2 = edge.GetFaceMinus();
    if (face1 !== null && face2 !== null) {
        const across1 = acrossFace(face1, point, tangent), across2 = acrossFace(face2, point, tangent);
        const angle = across1.angleTo(across2);
        if (angle > 1e-3 && angle < Math.PI - 1e-3) return [across1, across2];
    }
    const inward = vec2vec(edge.EdgeNormal(t), 1).normalize().negate();
    const side = new THREE.Vector3().crossVectors(tangent, inward).normalize();
    return [inward.clone().sub(side).normalize(), inward.clone().add(side).normalize()];
}

const probe = 1e-3;
function acrossFace(face: c3d.Face, point: THREE.Vector3, tangent: THREE.Vector3): THREE.Vector3 {
    const { normal } = face.NearPointProjection(point2point(point));
    const across = vec2vec(normal, 1).cross(tangent).normalize();
    const offFace = (direction: THREE.Vector3) => {
        const step = point.clone().addScaledVector(direction, probe);
        const { u, v } = face.NearPointProjection(point2point(step));
        const { faceU, faceV } = face.GetFaceParam(u, v);
        return point2point(face.Point(faceU, faceV)).distanceTo(step);
    }
    return offFace(across) <= offFace(across.clone().negate()) ? across : across.negate();
}

// What the fillet or chamfer cuts, drawn at the handle's point of the edge: a fillet's arc, tangent to both faces, or
// a chamfer's straight cut, each with a mark along the edge where it meets a face. At zero, the corner, with a faint arc
// to drag towards. Only a drawing: the handles are unchanged.
export class FilletProfile extends Helper {
    private readonly cut = new Line2(new LineGeometry(), this.editor.gizmos.default.line2);
    private readonly marks = new LineSegments2(new LineSegmentsGeometry(), this.editor.gizmos.default.line2);
    private readonly hint = new Line2(new LineGeometry(), this.editor.gizmos.hint.line2);
    private readonly across1 = new THREE.Vector3(0, 1, 0);
    private readonly across2 = new THREE.Vector3(0, 0, -1);
    private distance1 = 0;
    private distance2 = 0;
    // The size of a handle, in world units, as the camera has it
    private unit = 1;
    private readonly scratch = new THREE.Object3D();

    constructor(private readonly editor: EditorLike) {
        super();
        this.add(this.cut, this.marks, this.hint);
    }

    setFaces(across1: THREE.Vector3, across2: THREE.Vector3) {
        this.across1.copy(across1);
        this.across2.copy(across2);
        this.redraw();
    }

    draw(distance1: number, distance2: number) {
        this.distance1 = distance1;
        this.distance2 = distance2;
        this.redraw();
    }

    private redraw() {
        const { across1, across2, distance1, distance2, unit, cut, marks, hint } = this;
        const half = across1.angleTo(across2) / 2;
        const ends: THREE.Vector3[] = [];
        if (distance1 > 0) {
            const points = arc(across1, across2, half, distance1);
            replace(cut, new LineGeometry().setPositions(points.flatMap(p => p.toArray())));
            ends.push(points[0], points[points.length - 1]);
        } else if (distance1 < 0) {
            const a = across1.clone().multiplyScalar(-distance1), b = across2.clone().multiplyScalar(Math.abs(distance2));
            replace(cut, new LineGeometry().setPositions([...a.toArray(), ...b.toArray()]));
            ends.push(a, b);
        } else {
            const leg = 0.4 * unit;
            replace(cut, new LineGeometry().setPositions([...across1.clone().multiplyScalar(leg).toArray(), 0, 0, 0, ...across2.clone().multiplyScalar(leg).toArray()]));
            replace(hint, new LineGeometry().setPositions(arc(across1, across2, half, leg * Math.tan(half)).flatMap(p => p.toArray())));
        }
        hint.visible = distance1 === 0;
        const along = new THREE.Vector3().crossVectors(across1, across2).normalize().multiplyScalar(0.25 * unit);
        if (ends.length > 0) replace(marks, new LineSegmentsGeometry().setPositions(ends.flatMap(end => [...end.clone().sub(along).toArray(), ...end.clone().add(along).toArray()])));
        marks.visible = ends.length > 0;
    }

    // The cut is in world units; the corner, the hint and the marks keep a size on screen
    protected override scaleIndependentOfZoom(camera: THREE.Camera, worldPosition: THREE.Vector3) {
        this.scratch.scale.setScalar(1);
        const unit = Helper.scaleIndependentOfZoom(this.scratch, camera, worldPosition) * 0.8;
        if (unit === this.unit) return;
        this.unit = unit;
        this.redraw();
    }
}

// A fillet's arc of the radius at the corner between the two directions across the faces, from where it meets the
// first face to where it meets the second
function arc(across1: THREE.Vector3, across2: THREE.Vector3, half: number, radius: number, segments = 32): THREE.Vector3[] {
    const setback = radius / Math.tan(half);
    const center = across1.clone().add(across2).normalize().multiplyScalar(radius / Math.sin(half));
    const from = across1.clone().multiplyScalar(setback).sub(center), to = across2.clone().multiplyScalar(setback).sub(center);
    const axis = new THREE.Vector3().crossVectors(from, to).normalize(), span = from.angleTo(to);
    const points = [];
    for (let i = 0; i <= segments; i++) points.push(center.clone().add(from.clone().applyAxisAngle(axis, span * i / segments)));
    return points;
}

// A line's new shape, in new geometry: three keeps how many segments a line's geometry had when first drawn
function replace(line: Line2 | LineSegments2, geometry: LineSegmentsGeometry) {
    line.geometry.dispose();
    line.geometry = geometry;
}

export class FilletMagnitudeGizmo extends AbstractAxisGizmo {
    readonly state = new MagnitudeStateMachine(0);
    protected material = this.editor.gizmos.default;
    readonly helper: CompositeHelper<number>;
    readonly tip: THREE.Mesh<any, any> = new THREE.Mesh(sphereGeometry, this.material.mesh);
    protected readonly shaft = new THREE.Mesh();
    protected readonly knob = new THREE.Mesh(new THREE.SphereGeometry(0.2), this.editor.gizmos.invisible);
    private readonly line = new Line2(lineGeometry, this.material.line2);

    // The readout shows lengths, unless given another format
    constructor(name: string, editor: EditorLike, format?: (value: number) => string) {
        super(name, editor);
        this.helper = new CompositeHelper<number>([new AxisHelper(this.material.line), new NumberHelper(format)]);
        this.setup();
        this.add(this.helper);
        this.tip.add(this.line);
        this.line.position.set(0, - 0.5, 0);
    }

    onInterrupt(cb: (radius: number) => void) {
        this.state.push();
    }

    render(length: number) {
        const approxDist = length * Math.sin(Math.PI / 4);
        this.tip.position.set(0, approxDist, 0);
        this.knob.position.copy(this.tip.position);
    }

    protected accumulate(original: number, sign: number, dist: number): number {
        return original + dist
    }

    protected override scaleIndependentOfZoom(camera: THREE.Camera) {
        // Rather than scaling the parent, we scale the children, so that the position (set in render)
        // is in world space
        this.tip.scale.copy(this.relativeScale);
        this.knob.scale.copy(this.relativeScale);
        this.helper.scale.copy(this.relativeScale);
        Helper.scaleIndependentOfZoom(this.tip, camera, this.worldPosition);
        Helper.scaleIndependentOfZoom(this.knob, camera, this.worldPosition);
        Helper.scaleIndependentOfZoom(this.helper, camera, this.worldPosition);
    }
}

class FilletAngleGizmo extends AngleGizmo {
    onInterrupt(cb: (radius: number) => void) {
        this.state.push();
    }

    get shouldRescaleOnZoom() { return false }

    onEnabled() { this.visible = true }
    onDisabled() { this.visible = false }
}

class FilletStretchGizmo extends AbstractAxialScaleGizmo {
    readonly state = new MagnitudeStateMachine(0);
    readonly tip = new THREE.Mesh();
    protected readonly shaft = new THREE.Mesh();
    protected readonly knob = new THREE.Mesh();

    constructor(name: string, editor: EditorLike) {
        super(name, editor, editor.gizmos.default);
        this.setup();
    }

    onInterrupt(cb: (radius: number) => void) {
        this.state.push();
    }

    protected accumulate(original: number, dist: number, denom: number, _: number = 1): number {
        if (original === 0) return Math.max(0, dist - denom);
        else return (original + ((dist - denom) * original) / denom);
    }

    override get shouldRescaleOnZoom(): boolean {
        return true;
    }
}

class ChamferStretchGizmo extends FilletStretchGizmo {
    protected accumulate(original: number, dist: number, denom: number, sign: number = 1): number {
        return -Math.abs(super.accumulate(original, dist, denom, sign));
    }

    override get shouldRescaleOnZoom(): boolean {
        return true;
    }
}