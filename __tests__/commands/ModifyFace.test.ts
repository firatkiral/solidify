import * as THREE from "three";
import c3d from '../../build/Release/c3d.node';
import { ThreePointBoxFactory } from "../../src/commands/box/BoxFactory";
import FilletFactory from "../../src/commands/fillet/FilletFactory";
import { FilletFaceFactory } from "../../src/commands/modifyface/ModifyFaceFactory";
import { EditorSignals } from '../../src/editor/EditorSignals';
import { GeometryDatabase } from '../../src/editor/GeometryDatabase';
import MaterialDatabase from '../../src/editor/MaterialDatabase';
import { ParallelMeshCreator } from "../../src/editor/MeshCreator";
import { SolidCopier } from "../../src/editor/SolidCopier";
import { vec2vec } from "../../src/util/Conversion";
import * as visual from '../../src/visual_model/VisualModel';
import { FakeMaterials } from "../../__mocks__/FakeMaterials";
import '../matchers';

let db: GeometryDatabase;
let materials: Required<MaterialDatabase>;
let signals: EditorSignals;
let box: visual.Solid;

beforeEach(async () => {
    materials = new FakeMaterials();
    signals = new EditorSignals();
    db = new GeometryDatabase(new ParallelMeshCreator(), new SolidCopier(), materials, signals);

    const makeBox = new ThreePointBoxFactory(db, materials, signals);
    makeBox.p1 = new THREE.Vector3();
    makeBox.p2 = new THREE.Vector3(1, 0, 0);
    makeBox.p3 = new THREE.Vector3(1, 1, 0);
    makeBox.p4 = new THREE.Vector3(1, 1, 1);
    box = await makeBox.commit() as visual.Solid;
});

async function blend(distance: number) {
    const makeFillet = new FilletFactory(db, materials, signals);
    makeFillet.solid = box;
    makeFillet.edges = [box.edges.get(0)];
    makeFillet.distance = distance;
    return await makeFillet.commit() as visual.Solid;
}

// The face that is not square to an axis: the blend
function blendFace(solid: visual.Solid) {
    return [...solid.faces].find(face => {
        const n = vec2vec(db.lookupTopologyItem(face).Normal(0.5, 0.5), 1);
        return Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)) < 1 - 1e-6;
    })!;
}

describe(FilletFaceFactory, () => {
    let fillet: FilletFaceFactory;

    beforeEach(() => {
        fillet = new FilletFaceFactory(db, materials, signals);
    });

    test('a flat face of a box is not a fillet', () => {
        expect(fillet.areFilletFaces([box.faces.get(0)])).toBe(false);
        expect(fillet.areFilletOrChamferFaces([box.faces.get(0)])).toBe(false);
    });

    test('the face a fillet makes is a fillet', async () => {
        const face = blendFace(await blend(0.1));
        expect(db.lookupTopologyItem(face).GetSurface().IsA()).toBe(c3d.SpaceType.CylinderSurface);
        expect(fillet.areFilletFaces([face])).toBe(true);
    });

    test('the face a chamfer makes is a blend but not a fillet', async () => {
        const face = blendFace(await blend(-0.1));
        expect(fillet.areFilletOrChamferFaces([face])).toBe(true);
        expect(fillet.areFilletFaces([face])).toBe(false);
    });
});
