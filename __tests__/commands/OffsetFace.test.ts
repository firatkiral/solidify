import * as THREE from "three";
import { ThreePointBoxFactory } from "../../src/commands/box/BoxFactory";
import { MultiOffsetImprintFactory } from "../../src/commands/curve/OffsetContourFactory";
import { MultiOffsetFactory, OffsetFaceFactory } from '../../src/commands/modifyface/OffsetFaceFactory';
import { EditorSignals } from '../../src/editor/EditorSignals';
import { GeometryDatabase } from '../../src/editor/GeometryDatabase';
import MaterialDatabase from '../../src/editor/MaterialDatabase';
import { ParallelMeshCreator } from "../../src/editor/MeshCreator";
import { SolidCopier } from "../../src/editor/SolidCopier";
import { point2point, vec2vec } from "../../src/util/Conversion";
import * as visual from '../../src/visual_model/VisualModel';
import { FakeMaterials } from "../../__mocks__/FakeMaterials";
import '../matchers';

let db: GeometryDatabase;
let offsetFace: OffsetFaceFactory;
let materials: Required<MaterialDatabase>;
let signals: EditorSignals;

beforeEach(() => {
    materials = new FakeMaterials();
    signals = new EditorSignals();
    db = new GeometryDatabase(new ParallelMeshCreator(), new SolidCopier(), materials, signals);
    offsetFace = new OffsetFaceFactory(db, materials, signals);
})

let solid: visual.Solid;

beforeEach(async () => {
    const makeBox = new ThreePointBoxFactory(db, materials, signals);
    makeBox.p1 = new THREE.Vector3();
    makeBox.p2 = new THREE.Vector3(1, 0, 0);
    makeBox.p3 = new THREE.Vector3(1, 1, 0);
    makeBox.p4 = new THREE.Vector3(1, 1, 1);
    solid = await makeBox.commit() as visual.Solid;
});

describe(OffsetFaceFactory, () => {
    beforeEach(() => {
        offsetFace = new OffsetFaceFactory(db, materials, signals);
    })

    test('invokes the appropriate c3d commands', async () => {
        expect(db.temporaryObjects.children.length).toBe(0);
        expect(db.items.length).toBe(1);
        const face = solid.faces.get(0);
        offsetFace.solid = solid;
        offsetFace.faces = [face];
        offsetFace.distance = -0.5
        expect(solid).toHaveCentroidNear(new THREE.Vector3(0.5, 0.5, 0.5));
        const offsetted = await offsetFace.commit();
        expect(offsetted).toHaveCentroidNear(new THREE.Vector3(0.5, 0.5, 0.75));
        expect(db.temporaryObjects.children.length).toBe(0);
        expect(db.items.length).toBe(1);
    })

    test('offsetting a face through the whole solid is an error', async () => {
        offsetFace.solid = solid;
        offsetFace.faces = [solid.faces.get(0)];
        offsetFace.distance = -1;
        await expect(offsetFace.commit()).rejects.toThrow('The offset removes the whole solid');
    })
})

describe(MultiOffsetFactory, () => {
    let solid2: visual.Solid;
    beforeEach(async () => {
        const makeBox = new ThreePointBoxFactory(db, materials, signals);
        makeBox.p1 = new THREE.Vector3(10, 10, 0);
        makeBox.p2 = new THREE.Vector3(11, 0, 0);
        makeBox.p3 = new THREE.Vector3(11, 11, 0);
        makeBox.p4 = new THREE.Vector3(11, 11, 11);
        solid2 = await makeBox.commit() as visual.Solid;
    });

    let offset: MultiOffsetFactory;
    beforeEach(() => {
        offset = new MultiOffsetFactory(db, materials, signals);
    })

    test('it works', async () => {
        const face1 = solid.faces.get(0);
        const face2 = solid2.faces.get(0);
        offset.faces = [face1, face2];
        offset.distance = -0.5;
        const offsetteds = await offset.commit() as visual.Solid[];
        expect(offsetteds.length).toBe(2);

        const first = offsetteds[0];
        expect(first).toHaveCentroidNear(new THREE.Vector3(0.5, 0.5, 0.75));
        expect(db.temporaryObjects.children.length).toBe(0);
        expect(db.items.length).toBe(2);
    })
})
describe('a face divided by an offset loop', () => {
    let inner: visual.Face;
    let divided: visual.Solid;

    // The box's top face inset by 0.25: the square in the middle is a face of its own
    beforeEach(async () => {
        const top = [...solid.faces].find(face => vec2vec(db.lookupTopologyItem(face).Normal(0.5, 0.5), 1).z > 1 - 1e-6)!;
        const inset = MultiOffsetImprintFactory.faceLoops(db, materials, signals, [top]);
        inset.distance = 0.25;
        [divided] = await inset.commit() as visual.Solid[];
        inner = [...divided.faces].find(face => {
            const model = db.lookupTopologyItem(face);
            return vec2vec(model.Normal(0.5, 0.5), 1).z > 1 - 1e-6 && model.GetEdges().every(edge => {
                const p = point2point(edge.Point(0.5));
                return p.x > 0.2 && p.x < 0.8 && p.y > 0.2 && p.y < 0.8;
            });
        })!;
        expect(inner).toBeDefined();
    });

    test('pushed down through the solid, it makes a hole', async () => {
        offsetFace.solid = divided;
        offsetFace.faces = [inner];
        offsetFace.distance = -1;
        const result = await offsetFace.commit() as visual.Solid;
        // The box's six faces, top and bottom now rings, and the hole's four walls
        expect([...result.faces].length).toBe(10);
        expect(result).toHaveCentroidNear(new THREE.Vector3(0.5, 0.5, 0.5));
    });

    test('pulled up, it makes a boss', async () => {
        offsetFace.solid = divided;
        offsetFace.faces = [inner];
        offsetFace.distance = 0.5;
        const result = await offsetFace.commit() as visual.Solid;
        const box = new THREE.Box3().setFromObject(result);
        expect(box.max.z).toBeCloseTo(1.5);
        expect([...result.faces].length).toBe(11);
    });
});
