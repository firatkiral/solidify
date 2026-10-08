import * as THREE from "three";
import c3d from '../build/Release/c3d.node';
import { BooleanFactory } from "../src/commands/boolean/BooleanFactory";
import { ThreePointBoxFactory } from "../src/commands/box/BoxFactory";
import CylinderFactory from "../src/commands/cylinder/CylinderFactory";
import { FaceCollector } from "../src/commands/modifyface/OffsetFaceFactory";
import { EditorSignals } from '../src/editor/EditorSignals';
import { GeometryDatabase } from '../src/editor/GeometryDatabase';
import MaterialDatabase from '../src/editor/MaterialDatabase';
import { ParallelMeshCreator } from "../src/editor/MeshCreator";
import { SolidCopier } from "../src/editor/SolidCopier";
import { FakeMaterials } from "../__mocks__/FakeMaterials";
import './matchers';

let db: GeometryDatabase;
let intersect: BooleanFactory;
let materials: Required<MaterialDatabase>;
let signals: EditorSignals;

beforeEach(() => {
    materials = new FakeMaterials();
    signals = new EditorSignals();
    db = new GeometryDatabase(new ParallelMeshCreator(), new SolidCopier(), materials, signals);
    intersect = new BooleanFactory(db, materials, signals);
    intersect.operationType = c3d.OperationType.Difference;
})

describe(FaceCollector, () => {
    let solid: c3d.Solid;
    describe("unfilletted cylinder", () => {
        beforeEach(async () => {
            const makeCylinder = new CylinderFactory(db, materials, signals);
            makeCylinder.p0 = new THREE.Vector3();
            makeCylinder.p1 = new THREE.Vector3(1, 0, 0);
            makeCylinder.p2 = new THREE.Vector3(0, 0, 1);
            solid = await makeCylinder.calculate();
        });

        test("top", async () => {
            const faces = solid.GetFaces();
            expect(faces.length).toBe(3);

            const reference = faces[2]; // top plane
            const surface = reference.GetSurface().GetSurface();
            expect(surface.IsA()).toBe(c3d.SpaceType.Plane);

            const collector = new FaceCollector(solid, reference);
            const { smoothlyJoinedFaces, slopes } = collector;

            expect(smoothlyJoinedFaces.length).toBe(0);

            expect(slopes.length).toBe(1);
            const slope = slopes[0];
            expect(slope.GetSurface().GetSurface().IsA()).toBe(c3d.SpaceType.CylinderSurface);
        });

        test("bottom", async () => {
            const faces = solid.GetFaces();
            expect(faces.length).toBe(3);

            const reference = faces[1]; // bottom plane
            const surface = reference.GetSurface().GetSurface();
            expect(surface.IsA()).toBe(c3d.SpaceType.Plane);

            const collector = new FaceCollector(solid, reference);
            const { smoothlyJoinedFaces, slopes } = collector;

            expect(smoothlyJoinedFaces.length).toBe(0);

            expect(slopes.length).toBe(1);
            const slope = slopes[0];
            expect(slope.GetSurface().GetSurface().IsA()).toBe(c3d.SpaceType.CylinderSurface);
        });
    });

    describe("unfilletted box", () => {
        beforeEach(async () => {
            const makeBox = new ThreePointBoxFactory(db, materials, signals);
            makeBox.p1 = new THREE.Vector3();
            makeBox.p2 = new THREE.Vector3(1, 0, 0);
            makeBox.p3 = new THREE.Vector3(1, 1, 0);
            makeBox.p4 = new THREE.Vector3(1, 1, 1);
            solid = await makeBox.calculate();
        });

        test("draft", async () => {
            const faces = solid.GetFaces();
            expect(faces.length).toBe(6);

            let reference = faces[1]; // top plane
            const surface = reference.GetSurface().GetSurface();
            expect(surface.IsA()).toBe(c3d.SpaceType.Plane);

            const collector = new FaceCollector(solid, reference);
            const { smoothlyJoinedFaces, slopes } = collector;

            expect(smoothlyJoinedFaces.length).toBe(0);

            expect(slopes.length).toBe(4);
            const slope = slopes[0];
            expect(slope.GetSurface().GetSurface().IsA()).toBe(c3d.SpaceType.Plane);
        });
    });
});


        // test.skip('inserts faces', async () => {
        //     const log: string[] = [];
        //     const makeBox = new ThreePointBoxFactory(db, materials, signals);
        //     makeBox.p1 = new THREE.Vector3();
        //     makeBox.p2 = new THREE.Vector3(1, 0, 0);
        //     makeBox.p3 = new THREE.Vector3(1, 1, 0);
        //     makeBox.p4 = new THREE.Vector3(1, 1, 1);
        //     const box = await makeBox.commit() as visual.Solid;
        //     expect([...box.faces].length).toBe(6);

        //     const makeLine = new CurveFactory(db, materials, signals);
        //     makeLine.points.push(new THREE.Vector3(-2, -2, 0));
        //     makeLine.points.push(new THREE.Vector3(2, 2, 0));
        //     const line = await makeLine.commit() as visual.SpaceInstance<visual.Curve3D>;

        //     const split = new SplitFactory(db, materials, signals);
        //     split.constructionPlane = new PlaneSnap(new THREE.Vector3(0, 0, 1));
        //     split.faces = [box.faces.get(0)];
        //     split.curve = line;
        //     const result = await split.commit() as visual.Solid;

        //     const split0 = result.faces.get(0);
        //     const split1 = result.faces.get(1);

        //     const face = db.lookupTopologyItem(result.faces.get(0));
        //     const edges = face.GetOuterEdges(50);

        //     for (const edge of edges) {
        //         if (edge.IsSplit()) {
        //             console.log(edge.GetNameHash());
        //             const curve = edge.MakeCurve()!;

        //             // curve.Duplicate().Cast<c3d.Curve>(curve.IsA())
        //             const contour = new c3d.Contour();
        //             const surface = c3d.ActionSurface.ExtrusionSurface(curve, new c3d.Vector3D(0, 0, 1), false);
        //         }
        //     }
        //     console.log(log.join("\n"));
        // });