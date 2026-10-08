import c3d from '../../build/Release/c3d.node';
import BridgeCurvesFactory from "../../src/commands/curve/BridgeCurvesFactory";
import { ValidationError } from "../../src/command/GeometryFactory";
import { EditorSignals } from '../../src/editor/EditorSignals';
import { GeometryDatabase } from '../../src/editor/GeometryDatabase';
import MaterialDatabase from '../../src/editor/MaterialDatabase';
import { ParallelMeshCreator } from "../../src/editor/MeshCreator";
import { SolidCopier } from "../../src/editor/SolidCopier";
import { inst2curve } from "../../src/util/Conversion";
import * as visual from '../../src/visual_model/VisualModel';
import { FakeMaterials } from "../../__mocks__/FakeMaterials";
import '../matchers';

type V = { x: number, y: number, z: number };
const add = (a: V, b: V) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: V, b: V) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: V, s: number) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: V) => Math.hypot(a.x, a.y, a.z);
const P = (x: number, y: number, z = 0) => new c3d.CartPoint3D(x, y, z);

function expectClose(a: V, b: V, tolerance: number) {
    expect(norm(sub(a, b))).toBeLessThan(tolerance);
}

// The arc-length invariants at a point from the parameter derivatives there, with the parameter running in direction
// `orient`: unit tangent, curvature vector, and the curvature vector's rate of change.
function invariants([, d1, d2, d3]: V[], orient: number) {
    d1 = scale(d1, orient); d3 = scale(d3, orient);
    const v = norm(d1), T = scale(d1, 1 / v), a = dot(d2, T);
    const w = sub(d2, scale(T, a));
    const K = scale(w, 1 / (v * v));
    const dw = sub(sub(d3, scale(T, dot(d3, T) + dot(d2, w) / v)), scale(w, a / v));
    const J = scale(sub(scale(dw, 1 / (v * v)), scale(w, 2 * a / (v * v * v))), 1 / v);
    return { T, K, J };
}

const derivatives = (curve: c3d.Curve3D, t: number, side: number): V[] => (curve as any).derivatives(t, side);

// The bridge leaves `curve` at t heading in direction `sense` (at the bridge's start) or arrives into it (at its end)
function expectContinuity(bridge: c3d.Curve3D, curve: c3d.Curve3D, t: number, sense: number, atStart: boolean, k: number, chord: number) {
    const kept = derivatives(curve, t, -sense);
    const ours = derivatives(bridge, atStart ? 0 : 1, atStart ? 1 : -1);
    expectClose(ours[0], kept[0], 1e-6 * chord);
    if (k < 1) return;
    const a = invariants(kept, atStart ? sense : -sense), b = invariants(ours, 1);
    expectClose(b.T, a.T, 1e-7);
    if (k < 2) return;
    expectClose(b.K, a.K, 1e-6 / chord);
    if (k < 3) return;
    expectClose(b.J, a.J, 1e-5 / (chord * chord));
}

describe('BlendCurve', () => {
    // A quarter circle ending at (0, 100) heading -x, and a non-planar cubic spline
    const arc = () => new c3d.Arc3D(P(0, 0), P(100, 0), P(0, 100), 1);
    const spline = () => new c3d.CubicSpline3D([P(-300, 0, 50), P(-250, 80, 0), P(-200, 150, 20), P(-150, 260, 0)], false);

    const cases = [[0, 0], [1, 1], [2, 2], [3, 3], [1, 3], [3, 0], [2, 1]];
    test.each(cases)('G%i at the start and G%i at the end', (k1, k2) => {
        const curve1 = arc(), curve2 = spline();
        const t1 = curve1.GetTMax(), t2 = 1.3;
        const bridge = c3d.ActionSurfaceCurve.BlendCurve(curve1, t1, 1, k1, [1.3, 1.5], curve2, t2, -1, k2, [0.8, 0.7]);
        expect((bridge as any).GetPoints().length).toBe(k1 + k2 + 2);
        const chord = norm(sub(curve1.PointOn(t1), curve2.PointOn(t2)));
        expectContinuity(bridge, curve1, t1, 1, true, k1, chord);
        expectContinuity(bridge, curve2, t2, -1, false, k2, chord);
    });

    test('sense picks which way the bridge leaves', () => {
        const curve1 = arc(), curve2 = spline();
        const forward = c3d.ActionSurfaceCurve.BlendCurve(curve1, 0.5, 1, 1, [1, 1], curve2, 1.3, -1, 1, [1, 1]);
        const backward = c3d.ActionSurfaceCurve.BlendCurve(curve1, 0.5, -1, 1, [1, 1], curve2, 1.3, -1, 1, [1, 1]);
        const tau = curve1.Tangent(0.5);
        expect(dot(forward.Tangent(0), tau)).toBeCloseTo(1);
        expect(dot(backward.Tangent(0), tau)).toBeCloseTo(-1);
    });

    test('tension 1 scales the first leg; tension 2 slides the second pole along the tangent', () => {
        const curve1 = arc(), curve2 = spline();
        const t1 = curve1.GetTMax(), t2 = 1.3;
        const chord = norm(sub(curve1.PointOn(t1), curve2.PointOn(t2)));
        const plain = (c3d.ActionSurfaceCurve.BlendCurve(curve1, t1, 1, 2, [1, 1], curve2, t2, -1, 2, [1, 1]) as any).GetPoints();
        const tense = (c3d.ActionSurfaceCurve.BlendCurve(curve1, t1, 1, 2, [2, 1], curve2, t2, -1, 2, [1, 1]) as any).GetPoints();
        const slid = (c3d.ActionSurfaceCurve.BlendCurve(curve1, t1, 1, 2, [1, 3], curve2, t2, -1, 2, [1, 1]) as any).GetPoints();
        const n = plain.length - 1;
        expect(norm(sub(plain[1], plain[0]))).toBeCloseTo(chord / n);
        expect(norm(sub(tense[1], tense[0]))).toBeCloseTo(2 * chord / n);
        const T = curve1.Tangent(t1);
        const moved = sub(slid[2], plain[2]);
        expect(norm(moved)).toBeGreaterThan(1);
        expect(Math.abs(dot(moved, T))).toBeCloseTo(norm(moved));
    });

    test('ends at the same point', () => {
        const curve1 = arc();
        expect(() => c3d.ActionSurfaceCurve.BlendCurve(curve1, 0.2, 1, 1, [1, 1], curve1.Duplicate() as c3d.Curve3D, 0.2, -1, 1, [1, 1])).toThrow();
    });
});

describe('one-sided derivatives', () => {
    test('at a polyline corner', () => {
        const polyline = new c3d.Polyline3D([P(0, 0), P(100, 0), P(100, 100)], false);
        expectClose(derivatives(polyline, 1, -1)[1], { x: 100, y: 0, z: 0 }, 1e-9);
        expectClose(derivatives(polyline, 1, 1)[1], { x: 0, y: 100, z: 0 }, 1e-9);
    });

    test('at a contour corner, and across the seam of a closed one', () => {
        const contour = new (c3d as any).Contour3D();
        contour.AddCurveWithRuledCheck(new c3d.Polyline3D([P(0, 0), P(100, 0)], false));
        contour.AddCurveWithRuledCheck(new c3d.Polyline3D([P(100, 0), P(100, 100)], false));
        contour.AddCurveWithRuledCheck(new c3d.Polyline3D([P(100, 100), P(0, 0)], false));
        expectClose(derivatives(contour, 1, -1)[1], { x: 100, y: 0, z: 0 }, 1e-9);
        expectClose(derivatives(contour, 1, 1)[1], { x: 0, y: 100, z: 0 }, 1e-9);
        expectClose(derivatives(contour, 0, -1)[1], { x: -100, y: -100, z: 0 }, 1e-9);
        expectClose(derivatives(contour, 3, 1)[1], { x: 100, y: 0, z: 0 }, 1e-9);
    });

    test('at a cubic spline knot, where the third derivative jumps', () => {
        const curve = new c3d.CubicSpline3D([P(0, 0), P(100, 80), P(200, -40), P(300, 60)], false);
        const below = derivatives(curve, 1, -1), above = derivatives(curve, 1, 1);
        expectClose(below[2], above[2], 1e-6);
        expect(norm(sub(below[3], above[3]))).toBeGreaterThan(1);
        expectClose(below[3], derivatives(curve, 1 - 1e-9, 1)[3], 1e-3);
        expectClose(above[3], derivatives(curve, 1 + 1e-9, 1)[3], 1e-3);
    });

    test('by finite differences for other curves', () => {
        const spiral = (c3d as any).ConeSpiral.make(P(0, 0), P(0, 0, 300), P(100, 0), 100, 50, 0.1);
        const [, d1] = derivatives(spiral, 2, 1);
        const exact = spiral._FirstDer(2);
        expect(norm(sub(d1, exact)) / norm(exact)).toBeLessThan(1e-6);
        // At the start there is only one side to take
        const [, start] = derivatives(spiral, 0, -1);
        const exactStart = spiral._FirstDer(0);
        expect(norm(sub(start, exactStart)) / norm(exactStart)).toBeLessThan(1e-6);
    });
});

describe('lengths', () => {
    test('polyline', () => {
        const polyline = new c3d.Polyline3D([P(0, 0), P(300, 0), P(300, 400)], false);
        expect(polyline.GetMetricLength()).toBeCloseTo(700);
        expect(polyline.CalculateLength(0, 1.5)).toBeCloseTo(500);
        expect(polyline.DistanceAlong(0, 500, 1).t).toBeCloseTo(1.5);
        expect(polyline.DistanceAlong(2, 100, -1).t).toBeCloseTo(1.75);
        expect(polyline.DistanceAlong(0, 800, 1)).toEqual({ result: false, t: 2 });
    });

    test('arc', () => {
        const arc = new c3d.Arc3D(P(0, 0), P(100, 0), P(0, 100), 1);
        expect(arc.GetMetricLength()).toBeCloseTo(50 * Math.PI, 6);
        expect(arc.DistanceAlong(0, 25 * Math.PI, 1).t).toBeCloseTo(Math.PI / 4, 6);
    });
});

describe(BridgeCurvesFactory, () => {
    let db: GeometryDatabase;
    let materials: MaterialDatabase;
    let signals: EditorSignals;
    let bridge: BridgeCurvesFactory;

    beforeEach(() => {
        materials = new FakeMaterials();
        signals = new EditorSignals();
        db = new GeometryDatabase(new ParallelMeshCreator(), new SolidCopier(), materials, signals);
        bridge = new BridgeCurvesFactory(db, materials, signals);
    });

    const add = async (curve: c3d.Curve3D) => await db.addItem(new c3d.SpaceInstance(curve)) as visual.SpaceInstance<visual.Curve3D>;
    const model = (view: visual.SpaceInstance<visual.Curve3D>) => inst2curve(db.lookup(view))!;
    const curves = () => db.find(visual.SpaceInstance, true);

    describe('two open curves', () => {
        let a: visual.SpaceInstance<visual.Curve3D>, b: visual.SpaceInstance<visual.Curve3D>;

        // a runs from (-300, 0) to (-100, 0) (200 long); b from (100, 50) to (300, 200) (250 long)
        beforeEach(async () => {
            a = await add(new c3d.Polyline3D([P(-300, 0), P(-100, 0)], false));
            b = await add(new c3d.Polyline3D([P(100, 50), P(300, 200)], false));
            bridge.setStart(a, 0.9);
            bridge.setEnd(b, 0.1);
            bridge.chooseDirections();
        });

        test('T is the fraction of each curve\'s length', () => {
            expect(bridge.t1).toBeCloseTo(0.9);
            expect(bridge.t2).toBeCloseTo(0.1);
            bridge.t1 = 0.5;
            expect(bridge.t1).toBeCloseTo(0.5);
        });

        test('trims the curves back to the bridge and adds it', async () => {
            const results = await bridge.commit() as visual.SpaceInstance<visual.Curve3D>[];
            expect(results.length).toBe(3);
            expect(curves().length).toBe(3);
            const [trimmedA, trimmedB, made] = results.map(model);
            expect(trimmedA.GetMetricLength()).toBeCloseTo(180);
            expect(trimmedB.GetMetricLength()).toBeCloseTo(225);
            expectClose(made.PointOn(made.GetTMin()), P(-120, 0), 1e-6);
            expectClose(made.PointOn(made.GetTMax()), P(120, 65), 1e-6);
            // Off a's nearer end, so it continues along +x
            expect(made.Tangent(made.GetTMin()).x).toBeCloseTo(1);
        });

        test('without trim, only adds the bridge', async () => {
            bridge.trim = false;
            const results = await bridge.commit() as visual.SpaceInstance<visual.Curve3D>[];
            expect(results.length).toBe(1);
            expect(curves().length).toBe(3);
            expect(model(a).GetMetricLength()).toBeCloseTo(200);
        });

        test('a direction toggle flips that end', async () => {
            bridge.trim = false;
            bridge.direction1 = false;
            const [made] = (await bridge.commit() as visual.SpaceInstance<visual.Curve3D>[]).map(model);
            expect(made.Tangent(made.GetTMin()).x).toBeCloseTo(-1);
        });

        test('continuity and tensions reach the curve', async () => {
            bridge.trim = false;
            bridge.startCurvature = 3;
            bridge.endCurvature = 0;
            const [made] = (await bridge.commit() as visual.SpaceInstance<visual.Curve3D>[]).map(model);
            expect((made as any).GetPoints().length).toBe(5);
        });
    });

    test('ends that coincide', async () => {
        const a = await add(new c3d.Polyline3D([P(0, 0), P(100, 0)], false));
        const b = await add(new c3d.Polyline3D([P(100, 0), P(100, 100)], false));
        bridge.setStart(a, 1);
        bridge.setEnd(b, 0);
        bridge.chooseDirections();
        await expect(bridge.calculate()).rejects.toThrow(ValidationError);
    });

    test('both ends on one closed curve keep the arc between them', async () => {
        const circle = await add(new c3d.Arc3D(P(100, 0), P(0, 100), P(-100, 0), 0, true));
        bridge.setStart(circle, 0);
        bridge.setEnd(circle, Math.PI / 2);
        bridge.chooseDirections();
        const results = await bridge.commit() as visual.SpaceInstance<visual.Curve3D>[];
        expect(results.length).toBe(2);
        expect(curves().length).toBe(2);
        const [kept, made] = results.map(model);
        expect(kept.GetMetricLength()).toBeCloseTo(150 * Math.PI, 4);
        // The bridge stands in for the quarter that was cut, leaving and arriving along the circle
        expect(made.Tangent(made.GetTMin()).y).toBeCloseTo(1);
        expect(made.Tangent(made.GetTMax()).x).toBeCloseTo(-1);
    });

    test('a single pick on a closed curve trims nothing', async () => {
        const circle = await add(new c3d.Arc3D(P(100, 0), P(0, 100), P(-100, 0), 0, true));
        const line = await add(new c3d.Polyline3D([P(300, 0), P(400, 0)], false));
        bridge.setStart(circle, 0);
        bridge.setEnd(line, 0);
        bridge.chooseDirections();
        const results = await bridge.commit() as visual.SpaceInstance<visual.Curve3D>[];
        // The line loses nothing either: the bridge arrives at its start and continues along it
        expect(results.length).toBe(1);
        expect(curves().length).toBe(3);
    });
});
