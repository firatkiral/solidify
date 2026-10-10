import * as THREE from "three";
import { EditPolygonFactory, PolygonFactory } from "../../src/commands/polygon/PolygonFactory";
import { EditorSignals } from '../../src/editor/EditorSignals';
import { GeometryDatabase } from '../../src/editor/GeometryDatabase';
import MaterialDatabase from '../../src/editor/MaterialDatabase';
import { ParallelMeshCreator } from "../../src/editor/MeshCreator";
import { SolidCopier } from "../../src/editor/SolidCopier";
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

describe(EditPolygonFactory, () => {
    // A square around the origin, drawn to the vertex (1,0)
    let edit: EditPolygonFactory;

    beforeEach(async () => {
        const makePolygon = new PolygonFactory(db, materials, signals);
        makePolygon.center = new THREE.Vector3();
        makePolygon.p2 = new THREE.Vector3(1, 0, 0);
        makePolygon.vertexCount = 4;
        const polygon = await makePolygon.commit() as visual.SpaceInstance<visual.Curve3D>;

        edit = new EditPolygonFactory(db, materials, signals);
        edit.center = makePolygon.center;
        edit.p2 = makePolygon.p2;
        edit.orientation = makePolygon.orientation;
        edit.mode = makePolygon.mode;
        edit.vertexCount = makePolygon.vertexCount;
        edit.polygon = polygon;
    });

    test('reads the vertex count, radius and rotation it was drawn with', () => {
        expect(edit.vertexCount).toBe(4);
        expect(edit.radius).toBeCloseTo(1);
        expect(edit.degrees).toBeCloseTo(0);
    });

    test('changing the rotation turns the vertex around the centre, keeping the radius', async () => {
        edit.degrees = 45;
        expect(edit.p2).toApproximatelyEqual(new THREE.Vector3(Math.SQRT1_2, Math.SQRT1_2, 0));
        expect(edit.radius).toBeCloseTo(1);

        const result = await edit.commit() as visual.SpaceInstance<visual.Curve3D>;
        const bbox = new THREE.Box3().setFromObject(result);
        expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-Math.SQRT1_2, -Math.SQRT1_2, 0));
        expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(Math.SQRT1_2, Math.SQRT1_2, 0));
    });

    test('changing the radius keeps the centre and rotation', () => {
        edit.degrees = 90;
        edit.radius = 2;
        expect(edit.p2).toApproximatelyEqual(new THREE.Vector3(0, 2, 0));
        expect(edit.degrees).toBeCloseTo(90);
    });

    test('the rotation wraps at 360°', () => {
        edit.degrees = 450;
        expect(edit.degrees).toBeCloseTo(90);
        edit.degrees = -90;
        expect(edit.degrees).toBeCloseTo(270);
    });

    test('keeps at least 3 vertices and a radius of at least 0.005', () => {
        edit.vertexCount = 2;
        expect(edit.vertexCount).toBe(3);
        edit.radius = 0;
        expect(edit.radius).toBeCloseTo(0.005);
    });
});
