import * as THREE from "three";
import SphereFactory, { PossiblyBooleanSphereFactory } from "../../src/commands/sphere/SphereFactory";
import { EditorSignals } from '../../src/editor/EditorSignals';
import { GeometryDatabase } from '../../src/editor/GeometryDatabase';
import MaterialDatabase from '../../src/editor/MaterialDatabase';
import { ParallelMeshCreator } from "../../src/editor/MeshCreator";
import { SolidCopier } from "../../src/editor/SolidCopier";
import * as visual from '../../src/visual_model/VisualModel';
import { FakeMaterials } from "../../__mocks__/FakeMaterials";
import '../matchers';

let db: GeometryDatabase;
let makeSphere: SphereFactory;
let materials: Required<MaterialDatabase>;
let signals: EditorSignals;

beforeEach(() => {
    materials = new FakeMaterials();
    signals = new EditorSignals();
    db = new GeometryDatabase(new ParallelMeshCreator(), new SolidCopier(), materials, signals);
    makeSphere = new SphereFactory(db, materials, signals);
})

describe('commit', () => {
    test('invokes the appropriate c3d commands', async () => {
        makeSphere.center = new THREE.Vector3();
        makeSphere.radius = 1;
        const item = await makeSphere.commit() as visual.Solid;
        const bbox = new THREE.Box3().setFromObject(item);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        expect(center).toApproximatelyEqual(new THREE.Vector3());
        expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-1, -1, -1));
        expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(1, 1, 1));
    })
})

describe(PossiblyBooleanSphereFactory, () => {
    test('a radius changed after drawing resizes the sphere around its centre', async () => {
        const sphere = new PossiblyBooleanSphereFactory(db, materials, signals);
        sphere.center = new THREE.Vector3(1, 0, 0);
        sphere.radius = 1;
        await sphere.update();
        sphere.radius = 2;
        const [item] = await sphere.commit() as visual.Solid[];
        const bbox = new THREE.Box3().setFromObject(item);
        expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-1, -2, -2));
        expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(3, 2, 2));
    });

    test('keeps the radius at least 0.01', () => {
        const sphere = new PossiblyBooleanSphereFactory(db, materials, signals);
        sphere.radius = -1;
        expect(sphere.radius).toBeCloseTo(0.01);
    });
});
