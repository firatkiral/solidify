import * as THREE from "three";
import c3d from '../../build/Release/c3d.node';
import { CenterPointArcFactory, EditCenterPointArcFactory, EditThreePointArcFactory, ThreePointArcFactory } from "../../src/commands/arc/ArcFactory";
import { angleDelta } from "../../src/commands/arc/ArcGizmo";
import { EditorSignals } from '../../src/editor/EditorSignals';
import { GeometryDatabase } from '../../src/editor/GeometryDatabase';
import MaterialDatabase from '../../src/editor/MaterialDatabase';
import { ParallelMeshCreator } from "../../src/editor/MeshCreator";
import { SolidCopier } from "../../src/editor/SolidCopier";
import { inst2curve, point2point } from "../../src/util/Conversion";
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

describe(CenterPointArcFactory, () => {
    let makeArc: CenterPointArcFactory;

    beforeEach(() => {
        makeArc = new CenterPointArcFactory(db, materials, signals);
    })

    test('commit', async () => {
        makeArc.center = new THREE.Vector3();
        makeArc.p2 = new THREE.Vector3(-1, 0, 0);
        makeArc.p3 = new THREE.Vector3(0, 1, 0);
        const item = await makeArc.commit() as visual.SpaceInstance<visual.Curve3D>;
        const bbox = new THREE.Box3().setFromObject(item);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        expect(center).toApproximatelyEqual(new THREE.Vector3(-0.5, 0.5, 0));
        expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-1, 0, 0));
        expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(0, 1, 0));
    });

})

describe(ThreePointArcFactory, () => {
    test('middle is the middle of the arc, wherever the point it passes through is', () => {
        const makeArc = new ThreePointArcFactory(db, materials, signals);
        makeArc.p1 = new THREE.Vector3(1, 0, 0);
        makeArc.p3 = new THREE.Vector3(0, 1, 0);
        makeArc.p2 = new THREE.Vector3(Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0);
        expect(makeArc.middle).toApproximatelyEqual(new THREE.Vector3(Math.SQRT1_2, Math.SQRT1_2, 0));

        // Through (-1,0), the arc runs the long way round, so its middle is opposite
        makeArc.p2 = new THREE.Vector3(-1, 0, 0);
        expect(makeArc.middle).toApproximatelyEqual(new THREE.Vector3(-Math.SQRT1_2, -Math.SQRT1_2, 0));
    });
});

function arcOf(item: visual.SpaceInstance<visual.Curve3D>) {
    const model = inst2curve(db.lookup(item)) as c3d.Arc3D;
    expect(model.IsA()).toBe(c3d.SpaceType.Arc3D);
    return {
        start: point2point(model.GetLimitPoint(1)),
        end: point2point(model.GetLimitPoint(2)),
        middle: point2point(model.PointOn((model.GetTMin() + model.GetTMax()) / 2)),
        centre: point2point(model.GetCentre()),
        radius: model.GetRadius() / 100,
        angle: model.GetAngle(),
    };
}

describe(EditCenterPointArcFactory, () => {
    // A quarter arc around the origin, clockwise from (-1,0) to (0,1)
    let edit: EditCenterPointArcFactory;

    beforeEach(async () => {
        const makeArc = new CenterPointArcFactory(db, materials, signals);
        makeArc.center = new THREE.Vector3();
        makeArc.p2 = new THREE.Vector3(-1, 0, 0);
        makeArc.p3 = new THREE.Vector3(0, 1, 0);
        const arc = await makeArc.commit() as visual.SpaceInstance<visual.Curve3D>;
        edit = new EditCenterPointArcFactory(db, materials, signals);
        edit.arc = arc;
    });

    test('reads the length and angle it was drawn with', () => {
        expect(edit.length).toBeCloseTo(1);
        expect(edit.degrees).toBeCloseTo(90);
        expect(edit.centre).toApproximatelyEqual(new THREE.Vector3());
    });

    test('changing the angle keeps the centre, start and radius', async () => {
        edit.degrees = 180;
        const result = arcOf(await edit.commit() as visual.SpaceInstance<visual.Curve3D>);
        expect(result.centre).toApproximatelyEqual(new THREE.Vector3());
        expect(result.start).toApproximatelyEqual(new THREE.Vector3(-1, 0, 0));
        expect(result.end).toApproximatelyEqual(new THREE.Vector3(1, 0, 0));
        expect(result.middle).toApproximatelyEqual(new THREE.Vector3(0, 1, 0));
        expect(result.radius).toBeCloseTo(1);
    });

    test('changing the length keeps the centre and angle', async () => {
        edit.length = 2;
        const result = arcOf(await edit.commit() as visual.SpaceInstance<visual.Curve3D>);
        expect(result.centre).toApproximatelyEqual(new THREE.Vector3());
        expect(result.start).toApproximatelyEqual(new THREE.Vector3(-2, 0, 0));
        expect(result.end).toApproximatelyEqual(new THREE.Vector3(0, 2, 0));
        expect(result.angle).toBeCloseTo(Math.PI / 2);
    });

    test('keeps the angle between 0.1° and 359.9°, and the length at least 0.01', () => {
        edit.degrees = 0;
        expect(edit.degrees).toBeCloseTo(0.1);
        edit.degrees = 360;
        expect(edit.degrees).toBeCloseTo(359.9);
        edit.length = -1;
        expect(edit.length).toBeCloseTo(0.01);
    });
});

describe(EditThreePointArcFactory, () => {
    // A quarter arc around the origin, from (1,0) through (√½,√½) to (0,1): its ends are √2 apart and its middle is
    // 1-√½ off the line between them, toward (1,1)
    const start = new THREE.Vector3(1, 0, 0);
    const end = new THREE.Vector3(0, 1, 0);
    const chord = end.clone().sub(start).normalize();
    const side = new THREE.Vector3(1, 1, 0).normalize();
    let edit: EditThreePointArcFactory;

    beforeEach(async () => {
        const makeArc = new ThreePointArcFactory(db, materials, signals);
        makeArc.p1 = start;
        makeArc.p2 = new THREE.Vector3(Math.SQRT1_2, Math.SQRT1_2, 0);
        makeArc.p3 = end;
        const arc = await makeArc.commit() as visual.SpaceInstance<visual.Curve3D>;
        edit = new EditThreePointArcFactory(db, materials, signals);
        edit.arc = arc;
    });

    test('reads the length and height it was drawn with', () => {
        expect(edit.length).toBeCloseTo(Math.SQRT2);
        expect(edit.height).toBeCloseTo(1 - Math.SQRT1_2);
        expect(edit.start).toApproximatelyEqual(start);
    });

    test('changing the length keeps the start, the direction of the end and the height', async () => {
        const height = 1 - Math.SQRT1_2;
        edit.length = 3;
        const result = arcOf(await edit.commit() as visual.SpaceInstance<visual.Curve3D>);
        expect(result.start).toApproximatelyEqual(start);
        expect(result.end).toApproximatelyEqual(start.clone().addScaledVector(chord, 3));
        expect(result.middle).toApproximatelyEqual(start.clone().addScaledVector(chord, 1.5).addScaledVector(side, height));
        expect(result.radius).toBeCloseTo((height * height + 1.5 * 1.5) / (2 * height));
    });

    test('changing the height keeps the ends; past half the length it sweeps more than a half circle', async () => {
        edit.height = 1;
        const result = arcOf(await edit.commit() as visual.SpaceInstance<visual.Curve3D>);
        expect(result.start).toApproximatelyEqual(start);
        expect(result.end).toApproximatelyEqual(end);
        expect(result.middle).toApproximatelyEqual(new THREE.Vector3(0.5, 0.5, 0).addScaledVector(side, 1));
        expect(result.radius).toBeCloseTo(0.75);
        expect(result.angle).toBeGreaterThan(Math.PI);
    });

    test('keeps the length and height at least 0.01', () => {
        edit.length = -1;
        edit.height = -1;
        expect(edit.length).toBeCloseTo(0.01);
        expect(edit.height).toBeCloseTo(0.01);
    });
});

describe(angleDelta, () => {
    test('takes the short way round', () => {
        expect(angleDelta(0, 1)).toBeCloseTo(1);
        expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
        expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI);
    });
});
