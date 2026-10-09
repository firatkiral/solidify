import * as THREE from "three";
import c3d from '../build/Release/c3d.node';
import { ThreePointBoxFactory } from '../src/commands/box/BoxFactory';
import CurveFactory from "../src/commands/curve/CurveFactory";
import FilletFactory from "../src/commands/fillet/FilletFactory";
import { MoveItemFactory } from "../src/commands/translate/TranslateItemFactory";
import { CrossPointDatabase } from "../src/editor/curves/CrossPointDatabase";
import { EditorSignals } from '../src/editor/EditorSignals';
import { Empties } from "../src/editor/Empties";
import { GeometryDatabase } from '../src/editor/GeometryDatabase';
import { Images } from "../src/editor/Images";
import MaterialDatabase from '../src/editor/MaterialDatabase';
import { ParallelMeshCreator } from "../src/editor/MeshCreator";
import { Scene } from "../src/editor/Scene";
import { SnapManager } from "../src/editor/snaps/SnapManager";
import { SolidCopier } from "../src/editor/SolidCopier";
import { TypeManager } from "../src/editor/TypeManager";
import * as visual from '../src/visual_model/VisualModel';
import { FakeMaterials } from "../__mocks__/FakeMaterials";
import './matchers';
import { setLengthUnit } from '../src/util/Units';

let db: GeometryDatabase;
let scene: Scene;
let snaps: SnapManager;
let materials: MaterialDatabase;
let signals: EditorSignals;
let intersect: jest.Mock<any, any>;
let raycaster: THREE.Raycaster;
let camera: THREE.Camera;
let bbox: THREE.Box3;
let types: TypeManager;
let images: Images;
let empties: Empties;

beforeEach(() => {
    materials = new FakeMaterials();
    signals = new EditorSignals();
    db = new GeometryDatabase(new ParallelMeshCreator(), new SolidCopier(), materials, signals);
    images = new Images();
    empties = new Empties(images, signals);
    scene = new Scene(db, empties, materials, signals);
    camera = new THREE.PerspectiveCamera();
    types = scene.types;
    snaps = new SnapManager(db, scene, new CrossPointDatabase(), signals);
    camera.position.set(0, 0, 1);
    bbox = new THREE.Box3();

    intersect = jest.fn();
    raycaster = {
        intersectObjects: intersect
    } as unknown as THREE.Raycaster;
})

afterEach(() => {
    snaps.validate();
})

test("initial state", () => {
    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(0);
});

test("adding & removing solid", async () => {
    const makeBox = new ThreePointBoxFactory(db, materials, signals);
    makeBox.p1 = new THREE.Vector3();
    makeBox.p2 = new THREE.Vector3(1, 0, 0);
    makeBox.p3 = new THREE.Vector3(1, 1, 0);
    makeBox.p4 = new THREE.Vector3(1, 1, 1);
    const box = await makeBox.commit() as visual.Solid;

    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(1);
    expect(snaps.all.geometrySnaps[0].size).toBe(42);

    db.removeItem(box);

    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(0);
});

test("adding and editing a solid", async () => {
    const makeBox = new ThreePointBoxFactory(db, materials, signals);
    makeBox.p1 = new THREE.Vector3();
    makeBox.p2 = new THREE.Vector3(1, 0, 0);
    makeBox.p3 = new THREE.Vector3(1, 1, 0);
    makeBox.p4 = new THREE.Vector3(1, 1, 1);
    const box = await makeBox.commit() as visual.Solid;
    snaps.validate();

    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(1);
    expect(snaps.all.geometrySnaps[0].size).toBe(42);

    const makeFillet = new FilletFactory(db, materials, signals);
    makeFillet.solid = box;
    makeFillet.edges = [box.edges.get(0)];
    makeFillet.distance = 0.1;
    const fillet = await makeFillet.commit() as visual.Solid;

    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(1);
    expect(snaps.all.geometrySnaps[0].size).toBe(58);
    snaps.validate();
})

test("adding & hiding & removing solid", async () => {
    const makeBox = new ThreePointBoxFactory(db, materials, signals);
    makeBox.p1 = new THREE.Vector3();
    makeBox.p2 = new THREE.Vector3(1, 0, 0);
    makeBox.p3 = new THREE.Vector3(1, 1, 0);
    makeBox.p4 = new THREE.Vector3(1, 1, 1);
    const box = await makeBox.commit() as visual.Solid;

    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(1);
    expect(snaps.all.geometrySnaps[0].size).toBe(42);

    scene.makeHidden(box, true);
    snaps.validate();

    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(0);

    db.removeItem(box);
});

test("adding & hiding & unhiding solid", async () => {
    const makeBox = new ThreePointBoxFactory(db, materials, signals);
    makeBox.p1 = new THREE.Vector3();
    makeBox.p2 = new THREE.Vector3(1, 0, 0);
    makeBox.p3 = new THREE.Vector3(1, 1, 0);
    makeBox.p4 = new THREE.Vector3(1, 1, 1);
    const box = await makeBox.commit() as visual.Solid;

    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(1);
    expect(snaps.all.geometrySnaps[0].size).toBe(42);

    scene.makeHidden(box, true);
    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(0);

    scene.makeHidden(box, false);
    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(1);
    expect(snaps.all.geometrySnaps[0].size).toBe(42);

    scene.makeHidden(box, true);
    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(0);

    await scene.unhideAll();
    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(1);
    expect(snaps.all.geometrySnaps[0].size).toBe(42);
});

test("hiding is idempotent", async () => {
    const makeBox = new ThreePointBoxFactory(db, materials, signals);
    makeBox.p1 = new THREE.Vector3();
    makeBox.p2 = new THREE.Vector3(1, 0, 0);
    makeBox.p3 = new THREE.Vector3(1, 1, 0);
    makeBox.p4 = new THREE.Vector3(1, 1, 1);
    const box = await makeBox.commit() as visual.Solid;

    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(1);
    expect(snaps.all.geometrySnaps[0].size).toBe(42);

    scene.makeHidden(box, true);
    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(0);

    scene.makeHidden(box, true);
    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(0);

    scene.makeHidden(box, false);
    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(1);
    expect(snaps.all.geometrySnaps[0].size).toBe(42);
});

test("adding & removing curve", async () => {
    const makeLine = new CurveFactory(db, materials, signals);
    makeLine.type = c3d.SpaceType.Hermit3D;
    makeLine.points.push(new THREE.Vector3(), new THREE.Vector3(1, 0, 0));
    const line = await makeLine.commit() as visual.SpaceInstance<visual.Curve3D>;

    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(1);
    expect(snaps.all.geometrySnaps[0].size).toBe(2);

    db.removeItem(line);

    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(0);
});

test("adding & removing polyline points", async () => {
    const makeLine = new CurveFactory(db, materials, signals);
    makeLine.type = c3d.SpaceType.Polyline3D;
    makeLine.points.push(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(2, 1, 0), new THREE.Vector3(3, 0, 0));
    const line = await makeLine.commit() as visual.SpaceInstance<visual.Curve3D>;

    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(1);
    expect(snaps.all.geometrySnaps[0].size).toBe(7);

    db.removeItem(line);

    expect(snaps.all.basicSnaps.size).toBe(4);
    expect(snaps.all.crossSnaps.length).toBe(0);
    expect(snaps.all.geometrySnaps.length).toBe(0);
});

test("enabling and disabling types adds/removes snaps", async () => {
    const makeLine = new CurveFactory(db, materials, signals);
    makeLine.type = c3d.SpaceType.Polyline3D;
    makeLine.points.push(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(2, 1, 0), new THREE.Vector3(3, 0, 0));
    const line = await makeLine.commit() as visual.SpaceInstance<visual.Curve3D>;

    expect(snaps.all.geometrySnaps[0].size).toBe(7);

    types.disable(visual.Curve3D);
    expect(snaps.all.geometrySnaps.length).toBe(0);

    types.enable(visual.Curve3D);
    expect(snaps.all.geometrySnaps[0].size).toBe(7);
});

const objectLayersOff = () => { for (const layer of SnapManager.objectLayers) snaps.layers.disable(layer) };

test("object snapping is on while any of Face/Curve/Edge is, and Ctrl turns all three on while held", () => {
    expect(snaps.enabled).toBe(true);
    objectLayersOff();
    expect(snaps.enabled).toBe(false);
    expect(snaps.activeLayers.isEnabled(visual.Layers.Face)).toBe(false);

    snaps.holdObjects(true);
    expect(snaps.enabled).toBe(true);
    for (const layer of SnapManager.objectLayers) expect(snaps.activeLayers.isEnabled(layer)).toBe(true);
    expect(snaps.isLayerOn(visual.Layers.Face)).toBe(false);
    snaps.holdObjects(false);
    expect(snaps.enabled).toBe(false);

    snaps.layers.enable(visual.Layers.Curve);
    expect(snaps.enabled).toBe(true);
    snaps.holdObjects(true);
    snaps.holdObjects(false);
    expect(snaps.isLayerOn(visual.Layers.Curve)).toBe(true);
    expect(snaps.isLayerOn(visual.Layers.Face)).toBe(false);
})

test("Shift turns grid snapping and handle stepping on while held, and releasing restores the toggles", () => {
    snaps.snapToGrid = false;
    snaps.gizmoSnapping = false;
    snaps.angleSnapping = false;
    snaps.holdGrid(true);
    expect(snaps.snapToGrid).toBe(true);
    expect(snaps.gizmoSnapping).toBe(true);
    expect(snaps.angleSnapping).toBe(true);
    expect(snaps.angleSnappingSetting).toBe(false);
    expect(snaps.snapToGridSetting).toBe(false);
    expect(snaps.gizmoSnappingSetting).toBe(false);
    snaps.releaseHolds();
    expect(snaps.snapToGrid).toBe(false);
    expect(snaps.gizmoSnapping).toBe(false);
    expect(snaps.angleSnapping).toBe(false);

    snaps.snapToGrid = true;
    snaps.gizmoSnapping = true;
    snaps.holdGrid(true);
    snaps.holdGrid(false);
    expect(snaps.snapToGrid).toBe(true);
    expect(snaps.gizmoSnapping).toBe(true);
})

test("handle drag steps move along their ladders and stop at the ends", () => {
    expect(snaps.lengthStep).toBe(10); // 1 cm
    snaps.stepLengthStep(1);
    expect(snaps.lengthStep).toBe(20);
    snaps.stepLengthStep(1);
    expect(snaps.lengthStep).toBe(50);
    for (let i = 0; i < 30; i++) snaps.stepLengthStep(-1);
    expect(snaps.lengthStep).toBe(0.001);
    for (let i = 0; i < 30; i++) snaps.stepLengthStep(1);
    expect(snaps.lengthStep).toBe(1000);

    expect(snaps.angleStep).toBe(5);
    snaps.stepAngleStep(-1);
    expect(snaps.angleStep).toBe(1);
    snaps.stepAngleStep(-1);
    expect(snaps.angleStep).toBe(1);
    for (let i = 0; i < 20; i++) snaps.stepAngleStep(1);
    expect(snaps.angleStep).toBe(90);
})

test("the grid snap step has its own ladder, in the length unit's system", () => {
    expect(snaps.gridStep).toBe(10); // 1 cm
    snaps.stepGridStep(-1);
    expect(snaps.gridStep).toBe(5);
    expect(snaps.lengthStep).toBe(10);

    setLengthUnit('in');
    try {
        snaps.resetSteps();
        expect(snaps.gridStep).toBeCloseTo(25.4);
        expect(snaps.lengthStep).toBeCloseTo(25.4);
        snaps.stepGridStep(1);
        expect(snaps.gridStep).toBeCloseTo(2 * 25.4);
        for (let i = 0; i < 30; i++) snaps.stepGridStep(1);
        expect(snaps.gridStep).toBeCloseTo(10 * 304.8);
    } finally {
        setLengthUnit('cm');
    }
})

test("settings keep what the panel is set to, and put it back", () => {
    const changed = jest.fn();
    signals.snapSettingsChanged.add(changed);
    snaps.snapToGrid = true;
    snaps.toggleLayer(visual.Layers.Curve);
    snaps.stepGridStep(1);
    snaps.stepAngleStep(1);
    expect(changed).toHaveBeenCalledTimes(4);

    const saved = snaps.settings;
    expect(saved).toMatchObject({ grid: true, handles: false, angles: false, gridStep: 20, lengthStep: 10, angleStep: 10 });
    expect(saved).toMatchObject({ face: true, curve: false, edge: true }); // all on to begin with, here

    const restarted = new SnapManager(db, scene, new CrossPointDatabase(), signals);
    restarted.settings = saved;
    expect(restarted.settings).toEqual(saved);
    expect(restarted.snapToGridSetting).toBe(true);
})

test("settings with steps off the ladder start over at one of the length unit", () => {
    snaps.settings = { ...snaps.settings, gridStep: 3, lengthStep: 25.4, angleStep: 7 };
    expect(snaps.gridStep).toBe(10);
    expect(snaps.lengthStep).toBe(10);
    expect(snaps.angleStep).toBe(5);
})

describe('undo', () => {
    let box: visual.Solid;

    beforeEach(async () => {
        const makeBox = new ThreePointBoxFactory(db, materials, signals);
        makeBox.p1 = new THREE.Vector3();
        makeBox.p2 = new THREE.Vector3(1, 0, 0);
        makeBox.p3 = new THREE.Vector3(1, 1, 0);
        makeBox.p4 = new THREE.Vector3(1, 1, 1);
        box = await makeBox.commit() as visual.Solid;
    })

    test('it works', async () => {
        const snaps_memento = snaps.saveToMemento();
        const db_memento = db.saveToMemento();
        const before = [...snaps.all.geometrySnaps].map(set => [...set].map(p => p.position)).flat();
        expect(before.length).toBe(42);

        const move = new MoveItemFactory(db, materials, signals);
        move.items = [box];
        move.move = new THREE.Vector3(1, 1, 1);
        await move.commit();

        const after = [...snaps.all.geometrySnaps].map(set => [...set].map(p => p.position)).flat();
        expect(after.length).toBe(42);
        expect(after).not.toEqual(before);

        db.restoreFromMemento(db_memento);
        snaps.restoreFromMemento(snaps_memento);
        const afterUndo = [...snaps.all.geometrySnaps].map(set => [...set].map(p => p.position)).flat();
        expect(afterUndo.length).toBe(42);
        expect(afterUndo).toEqual(before);
    })
})
