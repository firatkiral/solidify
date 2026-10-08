import * as THREE from "three";
import { ThreePointBoxFactory } from "../../src/commands/box/BoxFactory";
import { CenterCircleFactory } from "../../src/commands/circle/CircleFactory";
import CurveFactory from "../../src/commands/curve/CurveFactory";
import { ConstructionPlaneGenerator, PlaneContext } from "../../src/components/viewport/ConstructionPlaneGenerator";
import { Orientation } from "../../src/components/viewport/ViewportNavigator";
import { CrossPointDatabase } from "../../src/editor/curves/CrossPointDatabase";
import { EditorSignals } from "../../src/editor/EditorSignals";
import { Empties } from "../../src/editor/Empties";
import { GeometryDatabase } from "../../src/editor/GeometryDatabase";
import { Images } from "../../src/editor/Images";
import MaterialDatabase from "../../src/editor/MaterialDatabase";
import { ParallelMeshCreator } from "../../src/editor/MeshCreator";
import { PlaneDatabase } from "../../src/editor/PlaneDatabase";
import { Scene } from "../../src/editor/Scene";
import { FaceConstructionPlaneSnap } from "../../src/editor/snaps/ConstructionPlaneSnap";
import { SnapManager } from "../../src/editor/snaps/SnapManager";
import { SolidCopier } from "../../src/editor/SolidCopier";
import { point2point, vec2vec } from "../../src/util/Conversion";
import * as visual from '../../src/visual_model/VisualModel';
import { FakeMaterials } from "../../__mocks__/FakeMaterials";
import '../matchers';

let db: GeometryDatabase;
let signals: EditorSignals;
let scene: Scene;
let materials: MaterialDatabase;
let planes: PlaneDatabase;
let snaps: SnapManager;
let images: Images;
let empties: Empties;

beforeEach(() => {
    materials = new FakeMaterials();
    signals = new EditorSignals();
    db = new GeometryDatabase(new ParallelMeshCreator(), new SolidCopier(), materials, signals);
    images = new Images();
    empties = new Empties(images, signals);
    scene = new Scene(db, empties, materials, signals);
    planes = new PlaneDatabase(signals);
    snaps = new SnapManager(db, scene, new CrossPointDatabase(), signals);
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

let cplanes: ConstructionPlaneGenerator;

beforeEach(() => {
    cplanes = new ConstructionPlaneGenerator(db, planes, snaps);
})

test("constructionPlane(Face)", () => {
    const face = solid.faces.get(0);
    const result = cplanes.constructionPlaneForFace(face);
    expect(result.tag).toEqual('face');
    const f = result.cplane as FaceConstructionPlaneSnap;
    const faceSnap = snaps.identityMap.lookup(face);
    expect(f.faceSnap).toBe(faceSnap);
    expect(f.isCompatibleWithSnap(faceSnap)).toBe(false);
    expect(f.n).toApproximatelyEqual(new THREE.Vector3(0, 0, -1));
    expect(f.p).toApproximatelyEqual(new THREE.Vector3(0.5, 0.5, 0));
})

test("constructionPlaneForCamera", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(5, -5, 5);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    const towardCamera = camera.position.clone().normalize();
    const screenRight = new THREE.Vector3(1, 1, 0).normalize();

    const atOrigin = cplanes.constructionPlaneForCamera(camera.quaternion);
    expect(atOrigin.isTemp).toBe(true);
    expect(atOrigin.n).toApproximatelyEqual(towardCamera);
    expect(atOrigin.x).toApproximatelyEqual(screenRight);
    expect(atOrigin.p).toApproximatelyEqual(new THREE.Vector3(0, 0, 0));

    const through = cplanes.constructionPlaneForCamera(camera.quaternion, new THREE.Vector3(1, 2, 3));
    expect(through.n).toApproximatelyEqual(towardCamera);
    expect(through.p).toApproximatelyEqual(new THREE.Vector3(1, 2, 3));
})

describe("constructionPlaneForSelection's other kinds of selection", () => {
    let context: PlaneContext;
    beforeEach(() => {
        const camera = new THREE.PerspectiveCamera();
        camera.position.set(5, -5, 5);
        camera.up.set(0, 0, 1);
        camera.lookAt(0, 0, 0);
        context = { cplane: PlaneDatabase.XY, cameraOrientation: camera.quaternion.clone() };
    });

    const faceFacing = (n: THREE.Vector3) => [...solid.faces].find(f => vec2vec(db.lookupTopologyItem(f).GetAnyPointOn().normal, 1).normalize().distanceTo(n) < 1e-6)!;

    test("several faces: average normal, through the middle of their centers", () => {
        const result = cplanes.constructionPlaneForFaces([faceFacing(new THREE.Vector3(0, 0, 1)), faceFacing(new THREE.Vector3(1, 0, 0))]);
        expect(result.tag).toBe('selection');
        expect(result.cplane.n).toApproximatelyEqual(new THREE.Vector3(1, 0, 1).normalize());
        expect(result.cplane.p).toApproximatelyEqual(new THREE.Vector3(0.75, 0.5, 0.75));
    });

    test("straight edge: contains the edge, facing out between its faces", () => {
        const edge = [...solid.edges].find(e => {
            const m = db.lookupTopologyItem(e);
            const [a, b] = [point2point(m.GetBegPoint()), point2point(m.GetEndPoint())];
            return Math.abs(a.x - 1) < 1e-6 && Math.abs(b.x - 1) < 1e-6 && Math.abs(a.z - 1) < 1e-6 && Math.abs(b.z - 1) < 1e-6;
        })!;
        const result = cplanes.constructionPlaneForEdge(edge, context);
        expect(result.cplane.n).toApproximatelyEqual(new THREE.Vector3(1, 0, 1).normalize());
        expect(result.cplane.p).toApproximatelyEqual(new THREE.Vector3(1, 0.5, 1));
        expect(Math.abs(result.cplane.x!.y)).toBeCloseTo(1);
    });

    test("planar curve: its own plane, at its center, facing the camera", async () => {
        const makeCircle = new CenterCircleFactory(db, materials, signals);
        makeCircle.orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
        makeCircle.center = new THREE.Vector3(0, 2, 0);
        makeCircle.radius = 1;
        const circle = await makeCircle.commit() as visual.SpaceInstance<visual.Curve3D>;
        const result = cplanes.constructionPlaneForCurve(circle, context);
        expect(result.cplane.n).toApproximatelyEqual(new THREE.Vector3(0, -1, 0));
        expect(result.cplane.p).toApproximatelyEqual(new THREE.Vector3(0, 2, 0));
    });

    test("straight curve: contains the line, facing the camera", async () => {
        const makeCurve = new CurveFactory(db, materials, signals);
        makeCurve.push(new THREE.Vector3());
        makeCurve.push(new THREE.Vector3(1, 1, 0));
        const line = await makeCurve.commit() as visual.SpaceInstance<visual.Curve3D>;
        const result = cplanes.constructionPlaneForCurve(line, context);
        expect(result.cplane.n).toApproximatelyEqual(new THREE.Vector3(1, -1, 1).normalize());
        expect(result.cplane.p).toApproximatelyEqual(new THREE.Vector3(0.5, 0.5, 0));
        expect(result.cplane.x).toApproximatelyEqual(new THREE.Vector3(1, 1, 0).normalize());
    });

    test("control points: one moves the current plane, two contain both, more fit a plane", async () => {
        const makeCurve = new CurveFactory(db, materials, signals);
        makeCurve.push(new THREE.Vector3(0, 0, 1));
        makeCurve.push(new THREE.Vector3(1, 1, 1));
        makeCurve.push(new THREE.Vector3(2, -1, 1));
        const curve = await makeCurve.commit() as visual.SpaceInstance<visual.Curve3D>;
        const points = [...curve.underlying.points];
        expect(points.length).toBeGreaterThanOrEqual(3);

        const one = cplanes.constructionPlaneForControlPoints([points[0]], context).cplane;
        expect(one.n).toApproximatelyEqual(new THREE.Vector3(0, 0, 1));
        expect(one.p).toApproximatelyEqual(points[0].position);

        const two = cplanes.constructionPlaneForControlPoints(points.slice(0, 2), context).cplane;
        expect(two.p).toApproximatelyEqual(points[0].position.clone().add(points[1].position).multiplyScalar(0.5));
        expect(Math.abs(two.n.dot(points[1].position.clone().sub(points[0].position)))).toBeCloseTo(0);

        const all = cplanes.constructionPlaneForControlPoints(points, context).cplane;
        expect(all.n).toApproximatelyEqual(new THREE.Vector3(0, 0, 1));
        expect(all.p.z).toBeCloseTo(1);
    });
});

test("constructionPlane(Orientation)", () => {
    const result = cplanes.constructionPlaneForOrientation(Orientation.negX);
    const constructionPlane = result.cplane;
    expect(constructionPlane.n).toApproximatelyEqual(new THREE.Vector3(-1, 0, 0));
    expect(constructionPlane.p).toApproximatelyEqual(new THREE.Vector3(0, 0, 0));
})