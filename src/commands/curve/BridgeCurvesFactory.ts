import * as THREE from "three";
import c3d from '../../kernel/kernel';
import * as visual from '../../visual_model/VisualModel';
import { GeometryFactory, NoOpError, ValidationError } from '../../command/GeometryFactory';
import { inst2curve, point2point, vec2vec } from '../../util/Conversion';

export interface BridgeCurvesParams {
    // Where the bridge attaches, as a fraction of each curve's length from its start
    t1: number;
    t2: number;
    // On, the bridge leaves the curve the default way (see chooseDirections); off, the other way
    direction1: boolean;
    direction2: boolean;
    // [start, end]: how far the bridge follows each curve's direction
    tension1: number[];
    // [start, end]: how far the second control point sits along each tangent (G2 and up)
    tension2: number[];
    // Continuity with each curve: 0–3 for G0–G3
    startCurvature: number;
    endCurvature: number;
    // Cut each curve back to where the bridge leaves it
    trim: boolean;
}

interface End {
    view: visual.SpaceInstance<visual.Curve3D>;
    model: c3d.Curve3D;
    param: number;
    // Which way along the curve's parameter the bridge heads off when its direction toggle is on
    defaultSense: number;
}

interface Kept { view: visual.SpaceInstance<visual.Curve3D>, model: c3d.Curve3D, from: number, to: number }

export default class BridgeCurvesFactory extends GeometryFactory implements BridgeCurvesParams {
    private end1?: End;
    private end2?: End;

    direction1 = true;
    direction2 = true;
    tension1 = [1, 1];
    tension2 = [1, 1];
    startCurvature = 2;
    endCurvature = 2;
    trim = true;

    // The picked points: a curve and a parameter on it
    setStart(view: visual.SpaceInstance<visual.Curve3D>, param: number) { this.end1 = this.end(view, param) }
    setEnd(view: visual.SpaceInstance<visual.Curve3D>, param: number) { this.end2 = this.end(view, param) }
    get hasEnd() { return this.end2 !== undefined }

    private end(view: visual.SpaceInstance<visual.Curve3D>, param: number): End {
        view = view.underlying.fragmentInfo?.untrimmedAncestor ?? view;
        const model = inst2curve(this.db.lookup(view))!;
        return { view, model, param, defaultSense: 1 };
    }

    get t1() { return this.end1 === undefined ? 0 : fraction(this.end1) }
    set t1(t1: number) { if (this.end1 !== undefined) this.end1.param = paramAt(this.end1.model, t1) }
    get t2() { return this.end2 === undefined ? 0 : fraction(this.end2) }
    set t2(t2: number) { if (this.end2 !== undefined) this.end2.param = paramAt(this.end2.model, t2) }

    // The default way to leave each curve: off its nearer end, continuing the longer part; on a closed curve, towards
    // the other end of the bridge. Called while picking, so scrubbing T afterwards doesn't flip it.
    chooseDirections() {
        const { end1, end2 } = this;
        if (end1 !== undefined) end1.defaultSense = defaultSense(end1, end2);
        if (end2 !== undefined) end2.defaultSense = defaultSense(end2, end1);
    }

    private get sense1() { return this.direction1 ? this.end1!.defaultSense : -this.end1!.defaultSense }
    private get sense2() { return this.direction2 ? this.end2!.defaultSense : -this.end2!.defaultSense }

    // Where the bridge leaves the first curve and which way, in view units
    get startFrame(): { position: THREE.Vector3, direction: THREE.Vector3 } | undefined {
        const { end1, end2 } = this;
        if (end1 === undefined || end2 === undefined) return undefined;
        const position = point2point(end1.model.PointOn(end1.param));
        const direction = vec2vec(end1.model.Tangent(end1.param), 1).multiplyScalar(this.sense1).normalize();
        return { position, direction };
    }

    async calculate() {
        const { end1, end2, tension1, tension2 } = this;
        if (end1 === undefined || end2 === undefined) throw new ValidationError("Pick two points on curves");
        if (end1.view === end2.view && Math.abs(end1.param - end2.param) < 1e-9) throw new NoOpError();
        const p1 = end1.model.PointOn(end1.param), p2 = end2.model.PointOn(end2.param);
        if (Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z) < 1e-6) throw new ValidationError("The ends of the bridge coincide");

        const bridge = await c3d.ActionSurfaceCurve.BlendCurve_async(
            end1.model, end1.param, this.sense1, this.startCurvature, [tension1[0], tension2[0]],
            end2.model, end2.param, this.sense2, this.endCurvature, [tension1[1], tension2[1]]);
        // In the order of originalItem, so each trimmed curve replaces its original; the bridge is added
        const trimmed = this.kept().map(({ model, from, to }) => new c3d.SpaceInstance(model.Trimmed(from, to, 1)!));
        return [...trimmed, new c3d.SpaceInstance(bridge)];
    }

    protected get originalItem() { return this.kept().map(k => k.view) }

    // What trimming keeps of each picked curve: the part the bridge continues. Curves that would lose nothing, or
    // everything, are left alone.
    private kept(): Kept[] {
        const { end1, end2 } = this;
        if (!this.trim || end1 === undefined || end2 === undefined) return [];
        const { sense1, sense2 } = this;
        if (end1.view === end2.view) {
            const kept = keptOfOne(end1.model, end1.param, sense1, end2.param, sense2);
            return kept === undefined ? [] : [{ view: end1.view, model: end1.model, ...kept }];
        }
        const result: Kept[] = [];
        for (const [end, sense] of [[end1, sense1], [end2, sense2]] as const) {
            if (end.model.IsClosed()) continue;
            const kept = useful(end.model, keptSide(end.model, end.param, sense));
            if (kept !== undefined) result.push({ view: end.view, model: end.model, ...kept });
        }
        return result;
    }
}

function fraction({ model, param }: End) {
    const length = model.GetMetricLength();
    if (!(length > 0)) return 0;
    return Math.min(1, Math.max(0, model.CalculateLength(model.GetTMin(), param) / length));
}

function paramAt(model: c3d.Curve3D, fraction: number) {
    const f = Math.min(1, Math.max(0, fraction));
    return model.DistanceAlong(model.GetTMin(), f * model.GetMetricLength(), 1).t;
}

function defaultSense(end: End, other: End | undefined) {
    const { model, param } = end;
    if (!model.IsClosed()) return fraction(end) < 0.5 ? -1 : 1;
    if (other === undefined) return 1;
    const p = model.PointOn(param), q = other.model.PointOn(other.param), tau = model.Tangent(param);
    return (q.x - p.x) * tau.x + (q.y - p.y) * tau.y + (q.z - p.z) * tau.z < 0 ? -1 : 1;
}

// The part on the far side of where the bridge heads off
function keptSide(model: c3d.Curve3D, param: number, sense: number) {
    return sense > 0 ? { from: model.GetTMin(), to: param } : { from: param, to: model.GetTMax() };
}

// Undefined when keeping it would remove nothing or everything
function useful(model: c3d.Curve3D, kept: { from: number, to: number }) {
    const tmin = model.GetTMin(), tmax = model.GetTMax();
    const eps = 1e-9 * Math.max(1, tmax - tmin);
    if (kept.to - kept.from < eps) return undefined;
    if (kept.from <= tmin + eps && kept.to >= tmax - eps) return undefined;
    return kept;
}

// Both ends on one curve: an open curve keeps what both sides keep; a closed one keeps the arc running from the end
// whose bridge heads back (keeping what follows it) to the end whose bridge heads forward.
function keptOfOne(model: c3d.Curve3D, param1: number, sense1: number, param2: number, sense2: number) {
    if (model.IsClosed()) {
        if (sense1 === sense2) return undefined;
        const [from, to] = sense1 < 0 ? [param1, param2] : [param2, param1];
        return { from, to };
    }
    const a = keptSide(model, param1, sense1), b = keptSide(model, param2, sense2);
    return useful(model, { from: Math.max(a.from, b.from), to: Math.min(a.to, b.to) });
}
