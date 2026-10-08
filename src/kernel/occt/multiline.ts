// Multilines: curves running at fixed distances alongside a planar curve, closed off at its ends by tips.

import { PlaneItem } from './base';
import { Arc, Contour, Curve, LineSegment } from './curve2d';
import { curve2dTo3d } from './curve3d';
import { KObject, Matrix, Placement3D } from './math';
import { offsetPlaneCurve } from './offset';
import { KernelError } from './solid';

export class VertexOfMultilineInfo extends KObject { }

const MLTipType = { UndefTip: 0, LinearTip: 1, ArcTip: 2, PolylineTip: 3, ObliqueTip: 4 };

export class MLTipParams extends KObject {
    constructor(readonly tipType = MLTipType.UndefTip, readonly tipParam = 0) { super() }
}

type P2 = { x: number, y: number };

// radii are signed distances to the left of the basis curve; corners stay sharp. An arc tip is a half circle around
// the end of the basis curve (between the outermost curves), a linear tip a straight line across.
export class Multiline extends PlaneItem {
    private readonly curves: Contour[] = [];
    private begTip: Contour | null = null;
    private endTip: Contour | null = null;

    constructor(basis?: Contour, _vertInfo?: VertexOfMultilineInfo, radii: number[] = [], begTip = new MLTipParams(), endTip = new MLTipParams(), _processClosed = true, _isTransparent = false) {
        super();
        if (basis === undefined) return;
        if (radii.length === 0) throw new KernelError("A multiline needs at least one distance");
        const place = new Placement3D();
        const path = curve2dTo3d(basis, place);
        for (const r of radii) {
            const curve = r === 0 ? path.Duplicate() : offsetPlaneCurve(path, r, place);
            const flat = curve.to2d(place);
            this.curves.push(flat instanceof Contour ? flat : new Contour([flat], true));
        }
        if (basis.IsClosed()) return;
        const lo = Math.min(...radii), hi = Math.max(...radii);
        this.begTip = tip(basis, basis.tmin, lo, hi, begTip, -1);
        this.endTip = tip(basis, basis.tmax, lo, hi, endTip, 1);
    }

    IsA(): number { return 0 }
    GetCurvesCount() { return this.curves.length }
    GetCurve(i: number) { return this.curves[i] ?? null }
    GetBegTipCurve() { return this.begTip }
    GetEndTipCurve() { return this.endTip }
    Transform(m: Matrix) { for (const c of this.curves) c.Transform(m); this.begTip?.Transform(m); this.endTip?.Transform(m) }
    Duplicate(): Multiline {
        const result = new Multiline();
        result.curves.push(...this.curves.map(c => c.Duplicate() as Contour));
        result.begTip = this.begTip?.Duplicate() as Contour ?? null;
        result.endTip = this.endTip?.Duplicate() as Contour ?? null;
        return result;
    }
}

// The tip across the end of the basis at t, between the curves at distances lo and hi; `outward` is -1 at the start
// (the tip bulges back) and +1 at the end.
function tip(basis: Curve, t: number, lo: number, hi: number, params: MLTipParams, outward: number): Contour | null {
    if (params.tipType === MLTipType.UndefTip) return null;
    const p = basis.PointOn(t), d = basis.Tangent(t);
    const n = { x: -d.y, y: d.x };
    const at = (r: number): P2 => ({ x: p.x + n.x * r, y: p.y + n.y * r });
    if (params.tipType !== MLTipType.ArcTip || hi - lo < 1e-12) return new Contour([new LineSegment(at(lo), at(hi))], true);
    const r = (hi - lo) / 2;
    const c = at((lo + hi) / 2);
    // From the curve at lo, round the far side of the end, to the curve at hi
    const u = { x: -n.x, y: -n.y }, v = { x: d.x * outward, y: d.y * outward };
    return new Contour([Arc.make(c, r, r, u, v, 0, Math.PI, false)], true);
}
