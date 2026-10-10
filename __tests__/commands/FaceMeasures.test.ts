import * as THREE from "three";
import { ThreePointBoxFactory } from "../../src/commands/box/BoxFactory";
import CylinderFactory from "../../src/commands/cylinder/CylinderFactory";
import { OffsetFaceFactory } from '../../src/commands/modifyface/OffsetFaceFactory';
import { EditorSignals } from '../../src/editor/EditorSignals';
import { GeometryDatabase } from '../../src/editor/GeometryDatabase';
import MaterialDatabase from '../../src/editor/MaterialDatabase';
import { ParallelMeshCreator } from "../../src/editor/MeshCreator";
import { SolidCopier } from "../../src/editor/SolidCopier";
import { deunit, point2point, vec2vec } from "../../src/util/Conversion";
import * as visual from '../../src/visual_model/VisualModel';
import { FakeMaterials } from "../../__mocks__/FakeMaterials";
import '../matchers';

// The sizes the offset face handle shows (see OffsetFaceGizmo): a flat face's thickness back to the face opposite it,
// and a round wall's radius

let db: GeometryDatabase;
let materials: Required<MaterialDatabase>;
let signals: EditorSignals;

beforeEach(() => {
    materials = new FakeMaterials();
    signals = new EditorSignals();
    db = new GeometryDatabase(new ParallelMeshCreator(), new SolidCopier(), materials, signals);
})

const faceFacing = (solid: visual.Solid, direction: THREE.Vector3) =>
    [...solid.faces].find(face => vec2vec(db.lookupTopologyItem(face).GetAnyPointOn().normal, 1).dot(direction) > 1 - 1e-6)!;
const centerOf = (face: visual.Face) => db.lookupTopologyItem(face).GetAnyPointOn().point;

describe('a box', () => {
    let box: visual.Solid;

    beforeEach(async () => {
        const makeBox = new ThreePointBoxFactory(db, materials, signals);
        makeBox.p1 = new THREE.Vector3();
        makeBox.p2 = new THREE.Vector3(1, 0, 0);
        makeBox.p3 = new THREE.Vector3(1, 2, 0);
        makeBox.p4 = new THREE.Vector3(1, 2, 3);
        box = await makeBox.commit() as visual.Solid;
    });

    test('a face is as thick as the box across it', () => {
        const top = faceFacing(box, new THREE.Vector3(0, 0, 1));
        const side = faceFacing(box, new THREE.Vector3(0, 1, 0));
        expect(deunit(db.lookupTopologyItem(top).GetThickness(centerOf(top))!)).toBeCloseTo(3);
        expect(deunit(db.lookupTopologyItem(side).GetThickness(centerOf(side))!)).toBeCloseTo(2);
        expect(db.lookupTopologyItem(top).GetCylinder()).toBeUndefined();
    });

    test('offsetting the face adds to its thickness', async () => {
        const top = faceFacing(box, new THREE.Vector3(0, 0, 1));
        const offset = new OffsetFaceFactory(db, materials, signals);
        offset.solid = box;
        offset.faces = [top];
        offset.distance = 0.5;
        const result = await offset.commit() as visual.Solid;
        const after = faceFacing(result, new THREE.Vector3(0, 0, 1));
        expect(deunit(db.lookupTopologyItem(after).GetThickness(centerOf(after))!)).toBeCloseTo(3.5);
    });

    test('a point off the face behind which nothing lies has no thickness', () => {
        const top = faceFacing(box, new THREE.Vector3(0, 0, 1));
        expect(db.lookupTopologyItem(top).GetThickness(point2point(new THREE.Vector3(5, 5, 3)))).toBeUndefined();
    });
});

describe('a cylinder', () => {
    let cylinder: visual.Solid;

    beforeEach(async () => {
        const makeCylinder = new CylinderFactory(db, materials, signals);
        makeCylinder.p0 = new THREE.Vector3();
        makeCylinder.p1 = new THREE.Vector3(2, 0, 0);
        makeCylinder.p2 = new THREE.Vector3(0, 0, 3);
        cylinder = await makeCylinder.commit() as visual.Solid;
    });

    test('its wall is a boss of its radius, and its top as thick as it is tall', () => {
        const wall = [...cylinder.faces].find(face => db.lookupTopologyItem(face).GetCylinder() !== undefined)!;
        const { radius, boss } = db.lookupTopologyItem(wall).GetCylinder()!;
        expect(deunit(radius)).toBeCloseTo(2);
        expect(boss).toBe(true);

        const top = faceFacing(cylinder, new THREE.Vector3(0, 0, 1));
        expect(deunit(db.lookupTopologyItem(top).GetThickness(centerOf(top))!)).toBeCloseTo(3);
    });
});
