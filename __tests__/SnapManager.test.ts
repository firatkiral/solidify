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
import { PointSnap } from "../src/editor/snaps/PointSnap";
import { originSnap, SnapManager, xAxisSnap, yAxisSnap, zAxisSnap } from "../src/editor/snaps/SnapManager";
import { SolidCopier } from "../src/editor/SolidCopier";
import { TypeManager } from "../src/editor/TypeManager";
import * as visual from '../src/visual_model/VisualModel';
import { FakeMaterials } from "../__mocks__/FakeMaterials";
import './matchers';
import { setLengthUnit } from '../src/util/Units';
import { curve3d2curve2d, inst2curve } from '../src/util/Conversion';

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

test("the points on objects are on the Point toggle's layer, and the origin on the Grid toggle's", async () => {
    const makeBox = new ThreePointBoxFactory(db, materials, signals);
    makeBox.p1 = new THREE.Vector3();
    makeBox.p2 = new THREE.Vector3(1, 0, 0);
    makeBox.p3 = new THREE.Vector3(1, 1, 0);
    makeBox.p4 = new THREE.Vector3(1, 1, 1);
    await makeBox.commit();
    snaps.cache.update();

    const pickers = [...snaps.cache.geometrySnaps.points];
    const onPointLayer = pickers.filter(p => p.layers.isEnabled(visual.Layers.SnapPoint));
    const origin = pickers.filter(p => p.userData.points.includes(originSnap));
    expect(onPointLayer.length).toBe(pickers.length - 1);
    expect(onPointLayer.flatMap(p => p.userData.points).length).toBe(42);
    expect(origin.length).toBe(1);
    expect(origin[0].layers.isEnabled(visual.Layers.SnapPoint)).toBe(false);
    expect(origin[0].layers.isEnabled(visual.Layers.SnapAxis)).toBe(true);

    const active = new THREE.Layers();
    active.mask = snaps.activeLayers.mask;
    expect(onPointLayer.every(p => p.layers.test(active))).toBe(true);
    snaps.toggleLayer(visual.Layers.SnapPoint);
    active.mask = snaps.activeLayers.mask;
    expect(onPointLayer.some(p => p.layers.test(active))).toBe(false);
});

test("the origin and axes snap only while the grid toggle is on", () => {
    const axes = [xAxisSnap, yAxisSnap, zAxisSnap].map(axis => axis.snapper);
    const active = new THREE.Layers();

    active.mask = snaps.activeLayers.mask;
    expect(axes.some(axis => axis.layers.test(active))).toBe(false);

    snaps.snapToGrid = true;
    active.mask = snaps.activeLayers.mask;
    expect(axes.every(axis => axis.layers.test(active))).toBe(true);

    snaps.settings = { ...snaps.settings, grid: false };
    active.mask = snaps.activeLayers.mask;
    expect(axes.some(axis => axis.layers.test(active))).toBe(false);
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

describe("spline points", () => {
    const points = [new THREE.Vector3(), new THREE.Vector3(1, 1, 0), new THREE.Vector3(2, -1, 0), new THREE.Vector3(3, 0, 0)];
    const names = () => [...snaps.all.geometrySnaps[0]].map(snap => snap.name);
    const positions = () => [...snaps.all.geometrySnaps[0]].map(snap => (snap as PointSnap).position);

    const spline = async (type: c3d.SpaceType, closed = false) => {
        const makeCurve = new CurveFactory(db, materials, signals);
        makeCurve.type = type;
        makeCurve.closed = closed;
        makeCurve.points.push(...points);
        return await makeCurve.commit() as visual.SpaceInstance<visual.Curve3D>;
    }

    test("a hermite or cubic spline snaps at every point it passes through", async () => {
        for (const type of [c3d.SpaceType.Hermit3D, c3d.SpaceType.CubicSpline3D]) {
            const curve = await spline(type);
            expect(names()).toEqual(["Beginning", "Point", "Point", "End"]);
            positions().forEach((position, i) => expect(position).toApproximatelyEqual(points[i]));
            db.removeItem(curve);
        }
    });

    test("a closed hermite spline snaps at all its points", async () => {
        await spline(c3d.SpaceType.Hermit3D, true);
        expect(names()).toEqual(["Point", "Point", "Point", "Point"]);
    });

    test("a bezier or nurbs spline snaps only at its ends, since its inner points are off the curve", async () => {
        for (const type of [c3d.SpaceType.Bezier3D, c3d.SpaceType.Nurbs3D]) {
            const curve = await spline(type);
            expect(names()).toEqual(["Beginning", "End"]);
            db.removeItem(curve);
        }
    });

    test("a curve lying in a plane snaps like the same curve in space", async () => {
        for (const [type, expected] of [[c3d.SpaceType.Hermit3D, ["Beginning", "Point", "Point", "End"]], [c3d.SpaceType.Polyline3D, ["End", "End", "End", "End", "Mid", "Mid", "Mid"]]] as const) {
            const inSpace = c3d.ActionCurve3D.SplineCurve(points.map(p => new c3d.CartPoint3D(p.x, p.y, p.z)), false, type);
            const { curve: curve2d, placement } = curve3d2curve2d(inSpace, new c3d.Placement3D())!;
            const curve = await db.addItem(new c3d.SpaceInstance(new c3d.PlaneCurve(placement, curve2d, false)));
            expect(inst2curve(db.lookup(curve))).toBeInstanceOf(c3d.PlaneCurve);
            expect(names()).toEqual(expected);
            db.removeItem(curve);
        }
    });
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

test("object snapping is on while any of Point/Edge/Face/Curve is", () => {
    expect(snaps.enabled).toBe(true);
    objectLayersOff();
    expect(snaps.enabled).toBe(false);
    expect(snaps.activeLayers.isEnabled(visual.Layers.Face)).toBe(false);

    snaps.layers.enable(visual.Layers.Curve);
    expect(snaps.enabled).toBe(true);
    expect(snaps.isLayerOn(visual.Layers.Curve)).toBe(true);
    expect(snaps.isLayerOn(visual.Layers.Face)).toBe(false);
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
    expect(saved).toMatchObject({ point: true, face: true, curve: false, edge: true }); // all on to begin with, here

    const restarted = new SnapManager(db, scene, new CrossPointDatabase(), signals);
    restarted.settings = saved;
    expect(restarted.settings).toEqual(saved);
    expect(restarted.snapToGridSetting).toBe(true);
})

describe("holding Ctrl", () => {
    test("turns every toggle off until released, as if they were all switched off", () => {
        snaps.snapToGrid = true;
        snaps.gizmoSnapping = true;
        snaps.angleSnapping = true;
        const saved = snaps.settings;

        snaps.bypass(true);
        expect(snaps.enabled).toBe(false);
        expect(snaps.snapToGrid).toBe(false);
        expect(snaps.gizmoSnapping).toBe(false);
        expect(snaps.angleSnapping).toBe(false);
        for (const layer of [...SnapManager.objectLayers, visual.Layers.SnapAxis]) {
            expect(snaps.activeLayers.isEnabled(layer)).toBe(false);
        }

        snaps.bypass(false);
        expect(snaps.enabled).toBe(true);
        expect(snaps.snapToGrid).toBe(true);
        expect(snaps.gizmoSnapping).toBe(true);
        expect(snaps.angleSnapping).toBe(true);
        expect(snaps.settings).toEqual(saved);
    })

    test("leaves the toggles, and the settings kept between sessions, as they are", () => {
        snaps.snapToGrid = true;
        const saved = snaps.settings;
        const changed = jest.fn();
        signals.snapSettingsChanged.add(changed);

        snaps.bypass(true);
        expect(snaps.snapToGridSetting).toBe(true);
        expect(snaps.isLayerOn(visual.Layers.Face)).toBe(true);
        expect(snaps.settings).toEqual(saved);
        expect(changed).not.toHaveBeenCalled();
    })

    test("tells the point picker to look again, once per press and release", () => {
        const enabled = jest.fn(), disabled = jest.fn();
        signals.snapsEnabled.add(enabled);
        signals.snapsDisabled.add(disabled);

        snaps.bypass(true);
        snaps.bypass(true);
        expect(disabled).toHaveBeenCalledTimes(1);
        expect(enabled).not.toHaveBeenCalled();
        snaps.bypass(false);
        snaps.bypass(false);
        expect(enabled).toHaveBeenCalledTimes(1);
    })

    test("still snaps to the layers a command forces on", () => {
        const forced = snaps.forceLayers(visual.Layers.Curve);
        snaps.bypass(true);
        expect(snaps.enabled).toBe(true);
        expect(snaps.activeLayers.isEnabled(visual.Layers.Curve)).toBe(true);
        expect(snaps.activeLayers.isEnabled(visual.Layers.Face)).toBe(false);
        expect(snaps.activeLayers.isEnabled(visual.Layers.SnapPoint)).toBe(false);

        forced.dispose();
        expect(snaps.enabled).toBe(false);
    })
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
