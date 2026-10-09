import * as THREE from "three";
import c3d from '../../build/Release/c3d.node';
import { MultiBooleanFactory } from "../../src/commands/boolean/BooleanFactory";
import { ThreePointBoxFactory } from "../../src/commands/box/BoxFactory";
import { CenterCircleFactory } from "../../src/commands/circle/CircleFactory";
import CurveFactory from "../../src/commands/curve/CurveFactory";
import { MultiOffsetImprintFactory, OffsetSpaceCurveFactory } from "../../src/commands/curve/OffsetContourFactory";
import CylinderFactory from "../../src/commands/cylinder/CylinderFactory";
import { EditorSignals } from '../../src/editor/EditorSignals';
import { GeometryDatabase } from '../../src/editor/GeometryDatabase';
import MaterialDatabase from '../../src/editor/MaterialDatabase';
import { ParallelMeshCreator } from "../../src/editor/MeshCreator";
import { ConstructionPlaneSnap } from "../../src/editor/snaps/ConstructionPlaneSnap";
import { SolidCopier } from "../../src/editor/SolidCopier";
import { point2point, vec2vec } from "../../src/util/Conversion";
import * as visual from '../../src/visual_model/VisualModel';
import { FakeMaterials } from "../../__mocks__/FakeMaterials";
import '../matchers';

let db: GeometryDatabase;
let materials: Required<MaterialDatabase>;
let signals: EditorSignals;

beforeEach(() => {
    materials = new FakeMaterials();
    signals = new EditorSignals();
    db = new GeometryDatabase(new ParallelMeshCreator(), new SolidCopier(), materials, signals);
})

async function box(min: THREE.Vector3, max: THREE.Vector3) {
    const makeBox = new ThreePointBoxFactory(db, materials, signals);
    makeBox.p1 = new THREE.Vector3(min.x, min.y, min.z);
    makeBox.p2 = new THREE.Vector3(max.x, min.y, min.z);
    makeBox.p3 = new THREE.Vector3(max.x, max.y, min.z);
    makeBox.p4 = new THREE.Vector3(max.x, max.y, max.z);
    return await makeBox.commit() as visual.Solid;
}

function faceFacing(solid: visual.Solid, normal: THREE.Vector3) {
    return [...solid.faces].find(face => vec2vec(db.lookupTopologyItem(face).Normal(0.5, 0.5), 1).distanceTo(normal) < 1e-6)!;
}

function edgeBetween(solid: visual.Solid, a: THREE.Vector3, b: THREE.Vector3) {
    return [...solid.edges].find(edge => {
        const model = db.lookupTopologyItem(edge);
        const [p, q] = [point2point(model.GetBegPoint()), point2point(model.GetEndPoint())];
        return (p.distanceTo(a) < 1e-6 && q.distanceTo(b) < 1e-6) || (p.distanceTo(b) < 1e-6 && q.distanceTo(a) < 1e-6);
    })!;
}

// The box round the points of edges
function bounds(edges: visual.CurveEdge[]) {
    const box = new THREE.Box3();
    for (const edge of edges) for (const t of [0, 0.25, 0.5, 0.75, 1]) box.expandByPoint(point2point(db.lookupTopologyItem(edge).Point(t)));
    return box;
}

const midpoints = (edges: visual.CurveEdge[]) => edges.map(edge => point2point(db.lookupTopologyItem(edge).Point(0.5)));

describe('Offset face loop', () => {
    let solid: visual.Solid;

    beforeEach(async () => {
        solid = await box(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
    });

    test('a box\'s top face inset into the face divides it with new edges', async () => {
        const offset = MultiOffsetImprintFactory.faceLoops(db, materials, signals, [faceFacing(solid, new THREE.Vector3(0, 0, 1))]);
        offset.distance = 0.2;

        expect(offset.normal.z).toBeCloseTo(0);
        expect(offset.center.z).toBeCloseTo(1);
        expect(offset.center.clone().addScaledVector(offset.normal, 0.1).distanceTo(new THREE.Vector3(0.5, 0.5, 1))).toBeLessThan(offset.center.distanceTo(new THREE.Vector3(0.5, 0.5, 1)));

        const [result] = await offset.commit() as visual.Solid[];
        expect([...result.faces].length).toBe(7);
        const edges = offset.newEdges([result]);
        expect(edges.length).toBe(4);
        const { min, max } = bounds(edges);
        expect(min).toApproximatelyEqual(new THREE.Vector3(0.2, 0.2, 1));
        expect(max).toApproximatelyEqual(new THREE.Vector3(0.8, 0.8, 1));
    });

    test('an offset that does not fit in the face fails', async () => {
        const offset = MultiOffsetImprintFactory.faceLoops(db, materials, signals, [faceFacing(solid, new THREE.Vector3(0, 0, 1))]);
        offset.distance = 0.6;
        await expect(offset.commit()).rejects.toThrow();
    });

    test('a negative distance fails, as the face loop goes into the face', async () => {
        const offset = MultiOffsetImprintFactory.faceLoops(db, materials, signals, [faceFacing(solid, new THREE.Vector3(0, 0, 1))]);
        offset.distance = -0.2;
        await expect(offset.commit()).rejects.toThrow();
    });

    describe('gap fill, at the inside corner of an L', () => {
        let L: visual.Solid;

        beforeEach(async () => {
            const a = await box(new THREE.Vector3(), new THREE.Vector3(2, 1, 1));
            const b = await box(new THREE.Vector3(), new THREE.Vector3(1, 2, 1));
            const union = new MultiBooleanFactory(db, materials, signals);
            union.operationType = c3d.OperationType.Union;
            union.targets = [a];
            union.tools = [b];
            [L] = await union.commit() as visual.Solid[];
        });

        const inset = async (gapFill: c3d.OffsetGapFill) => {
            const offset = MultiOffsetImprintFactory.faceLoops(db, materials, signals, [faceFacing(L, new THREE.Vector3(0, 0, 1))]);
            offset.distance = 0.2;
            offset.gapFill = gapFill;
            const [result] = await offset.commit() as visual.Solid[];
            return offset.newEdges([result]);
        }
        const corner = new THREE.Vector3(1, 1, 1);

        test('natural extends the pieces until they meet', async () => {
            const edges = await inset(c3d.OffsetGapFill.Natural);
            expect(edges.length).toBe(6);
            expect(edges.some(edge => {
                const model = db.lookupTopologyItem(edge);
                return [model.GetBegPoint(), model.GetEndPoint()].some(p => point2point(p).distanceTo(new THREE.Vector3(0.8, 0.8, 1)) < 1e-6);
            })).toBe(true);
        });

        test('round puts an arc round the corner', async () => {
            const edges = await inset(c3d.OffsetGapFill.Round);
            expect(edges.length).toBe(7);
            const arc = midpoints(edges).find(p => Math.abs(p.distanceTo(corner) - 0.2) < 1e-6 && p.x < 1 && p.y < 1)!;
            expect(arc).toBeDefined();
            expect(arc).toApproximatelyEqual(new THREE.Vector3(1 - 0.2 * Math.SQRT1_2, 1 - 0.2 * Math.SQRT1_2, 1));
        });

        test('linear bridges the corner with a straight line', async () => {
            const edges = await inset(c3d.OffsetGapFill.Linear);
            expect(edges.length).toBe(7);
            expect(midpoints(edges).some(p => p.distanceTo(new THREE.Vector3(0.9, 0.9, 1)) < 1e-6)).toBe(true);
        });
    });
});

describe('Offset edge', () => {
    let solid: visual.Solid;
    const up = new THREE.Vector3(0, 0, 1);

    beforeEach(async () => {
        solid = await box(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
    });

    const topFront = () => edgeBetween(solid, new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 1));
    const topLoop = () => [
        edgeBetween(solid, new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 1)),
        edgeBetween(solid, new THREE.Vector3(1, 0, 1), new THREE.Vector3(1, 1, 1)),
        edgeBetween(solid, new THREE.Vector3(1, 1, 1), new THREE.Vector3(0, 1, 1)),
        edgeBetween(solid, new THREE.Vector3(0, 1, 1), new THREE.Vector3(0, 0, 1)),
    ];

    test('a positive distance goes into the face turned to the camera, from side to side', async () => {
        const offset = MultiOffsetImprintFactory.edges(db, materials, signals, [topFront()], up);
        offset.distance = 0.2;

        expect(offset.center).toApproximatelyEqual(new THREE.Vector3(0.5, 0, 1));
        expect(offset.normal).toApproximatelyEqual(new THREE.Vector3(0, 1, 0));

        const [result] = await offset.commit() as visual.Solid[];
        expect([...result.faces].length).toBe(7);
        const edges = offset.newEdges([result]);
        expect(edges.length).toBe(1);
        const { min, max } = bounds(edges);
        expect(min).toApproximatelyEqual(new THREE.Vector3(0, 0.2, 1));
        expect(max).toApproximatelyEqual(new THREE.Vector3(1, 0.2, 1));
    });

    test('a negative distance goes into the face on the other side', async () => {
        const offset = MultiOffsetImprintFactory.edges(db, materials, signals, [topFront()], up);
        offset.distance = -0.2;

        const [result] = await offset.commit() as visual.Solid[];
        const { min, max } = bounds(offset.newEdges([result]));
        expect(min).toApproximatelyEqual(new THREE.Vector3(0, 0, 0.8));
        expect(max).toApproximatelyEqual(new THREE.Vector3(1, 0, 0.8));
    });

    test('with the camera in front, a positive distance goes down the front', async () => {
        const offset = MultiOffsetImprintFactory.edges(db, materials, signals, [topFront()], new THREE.Vector3(0, -1, 0));
        offset.distance = 0.2;

        expect(offset.normal).toApproximatelyEqual(new THREE.Vector3(0, 0, -1));
        const [result] = await offset.commit() as visual.Solid[];
        const { min, max } = bounds(offset.newEdges([result]));
        expect(min).toApproximatelyEqual(new THREE.Vector3(0, 0, 0.8));
        expect(max).toApproximatelyEqual(new THREE.Vector3(1, 0, 0.8));
    });

    test('a loop of edges goes into the face they bound', async () => {
        const offset = MultiOffsetImprintFactory.edges(db, materials, signals, topLoop(), up);
        offset.distance = 0.2;

        const [result] = await offset.commit() as visual.Solid[];
        expect([...result.faces].length).toBe(7);
        const { min, max } = bounds(offset.newEdges([result]));
        expect(min).toApproximatelyEqual(new THREE.Vector3(0.2, 0.2, 1));
        expect(max).toApproximatelyEqual(new THREE.Vector3(0.8, 0.8, 1));
    });

    test('the other way, each edge goes down its own side, ringing the box', async () => {
        const offset = MultiOffsetImprintFactory.edges(db, materials, signals, topLoop(), up);
        offset.distance = -0.2;

        const [result] = await offset.commit() as visual.Solid[];
        expect([...result.faces].length).toBe(10);
        const edges = offset.newEdges([result]);
        expect(edges.length).toBe(4);
        const { min, max } = bounds(edges);
        expect(min).toApproximatelyEqual(new THREE.Vector3(0, 0, 0.8));
        expect(max).toApproximatelyEqual(new THREE.Vector3(1, 1, 0.8));
    });

    describe('a cylinder\'s top edge', () => {
        let cylinder: visual.Solid;

        beforeEach(async () => {
            const makeCylinder = new CylinderFactory(db, materials, signals);
            makeCylinder.p0 = new THREE.Vector3();
            makeCylinder.p1 = new THREE.Vector3(1, 0, 0);
            makeCylinder.p2 = new THREE.Vector3(0, 0, 1);
            cylinder = await makeCylinder.commit() as visual.Solid;
        });

        const rim = () => [...cylinder.edges].find(edge => point2point(db.lookupTopologyItem(edge).Point(0.5)).z > 0.99)!;

        test('goes into the flat top as a smaller circle', async () => {
            const offset = MultiOffsetImprintFactory.edges(db, materials, signals, [rim()], up);
            offset.distance = 0.2;

            const [result] = await offset.commit() as visual.Solid[];
            const { min, max } = bounds(offset.newEdges([result]));
            expect(min).toApproximatelyEqual(new THREE.Vector3(-0.8, -0.8, 1));
            expect(max).toApproximatelyEqual(new THREE.Vector3(0.8, 0.8, 1));
        });

        test('does not go down the curved side', async () => {
            const offset = MultiOffsetImprintFactory.edges(db, materials, signals, [rim()], up);
            offset.distance = -0.2;
            await expect(offset.commit()).rejects.toThrow(/curved/);
        });
    });
});

describe(OffsetSpaceCurveFactory, () => {
    let offsetCurve: OffsetSpaceCurveFactory;

    beforeEach(() => {
        offsetCurve = new OffsetSpaceCurveFactory(db, materials, signals);
    });

    describe('planar curves', () => {
        let circle: visual.SpaceInstance<visual.Curve3D>;

        beforeEach(async () => {
            const makeCircle = new CenterCircleFactory(db, materials, signals);
            makeCircle.center = new THREE.Vector3();
            makeCircle.radius = 1;
            circle = await makeCircle.commit() as visual.SpaceInstance<visual.Curve3D>;
        })

        test('distance > 0', async () => {
            offsetCurve.curve = circle;
            offsetCurve.distance = 0.1;

            expect(offsetCurve.center).toApproximatelyEqual(new THREE.Vector3(-1, 0, 0));
            expect(offsetCurve.normal).toApproximatelyEqual(new THREE.Vector3(1, 0, 0));

            const curve = await offsetCurve.commit() as visual.SpaceInstance<visual.Curve3D>;
            const bbox = new THREE.Box3().setFromObject(curve);
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            expect(center).toApproximatelyEqual(new THREE.Vector3());
            expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-0.9, -0.9, 0));
            expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(0.9, 0.9, 0));
        });

        test('distance = 0', async () => {
            offsetCurve.curve = circle;
            offsetCurve.distance = 0;

            expect(offsetCurve.center).toApproximatelyEqual(new THREE.Vector3(-1, 0, 0));
            expect(offsetCurve.normal).toApproximatelyEqual(new THREE.Vector3(1, 0, 0));

            const curve = await offsetCurve.commit() as visual.SpaceInstance<visual.Curve3D>;
            const bbox = new THREE.Box3().setFromObject(curve);
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            expect(center).toApproximatelyEqual(new THREE.Vector3());
            expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-1, -1, 0));
            expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(1, 1, 0));
        });
    });

    describe('planar open curves', () => {
        let line: visual.SpaceInstance<visual.Curve3D>;

        beforeEach(async () => {
            const makeLine = new CurveFactory(db, materials, signals);
            makeLine.type = c3d.SpaceType.Polyline3D;
            makeLine.points.push(new THREE.Vector3());
            makeLine.points.push(new THREE.Vector3(1, 0, 0));
            makeLine.points.push(new THREE.Vector3(1, 1, 0));
            line = await makeLine.commit() as visual.SpaceInstance<visual.Curve3D>;
        })

        test('it works', async () => {
            offsetCurve.curve = line;
            offsetCurve.distance = 0.1;

            expect(offsetCurve.center).toApproximatelyEqual(new THREE.Vector3(1, 0, 0));
            expect(offsetCurve.normal).toApproximatelyEqual(new THREE.Vector3(0, 0, 0));

            const curve = await offsetCurve.commit() as visual.SpaceInstance<visual.Curve3D>;
            const bbox = new THREE.Box3().setFromObject(curve);
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            expect(center).toApproximatelyEqual(new THREE.Vector3(0.45, 0.55, 0));
            expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(0, 0.1, 0));
            expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(0.9, 1, 0));
        });
    });

    describe('straight lines', () => {
        let line: visual.SpaceInstance<visual.Curve3D>;
        
        beforeEach(async () => {
            const makeLine = new CurveFactory(db, materials, signals);
            makeLine.type = c3d.SpaceType.Polyline3D;
            makeLine.points.push(new THREE.Vector3());
            makeLine.points.push(new THREE.Vector3(1, 1, 0));
            line = await makeLine.commit() as visual.SpaceInstance<visual.Curve3D>;
        });

        test('it works', async () => {
            offsetCurve.curve = line;
            offsetCurve.distance = 0.1;
            offsetCurve.constructionPlane = new ConstructionPlaneSnap();

            expect(offsetCurve.center).toApproximatelyEqual(new THREE.Vector3(0.5, 0.5, 0));
            expect(offsetCurve.normal).toApproximatelyEqual(new THREE.Vector3(-Math.SQRT1_2, Math.SQRT1_2, 0));

            const curve = await offsetCurve.commit() as visual.SpaceInstance<visual.Curve3D>;
            const bbox = new THREE.Box3().setFromObject(curve);
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            expect(center).toApproximatelyEqual(new THREE.Vector3(0.43, 0.57, 0));
            expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-0.07, 0.07, 0));
            expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(0.929, 1.07, 0));
        });
    })
});
