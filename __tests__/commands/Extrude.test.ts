import * as THREE from "three";
import c3d from '../../build/Release/c3d.node';
import { MultiBooleanFactory, phantom_blue } from "../../src/commands/boolean/BooleanFactory";
import { PossiblyBooleanFactory } from "../../src/commands/boolean/PossiblyBooleanFactory";
import { ThreePointBoxFactory } from "../../src/commands/box/BoxFactory";
import { CenterCircleFactory } from "../../src/commands/circle/CircleFactory";
import CurveFactory from "../../src/commands/curve/CurveFactory";
import { CurveExtrudeFactory, FaceExtrudeFactory, NewBody, PossiblyBooleanExtrudeFactory, RegionExtrudeFactory, solidsUnderRegion } from "../../src/commands/extrude/ExtrudeFactory";
import { ExtrudeSurfaceFactory } from "../../src/commands/extrude/ExtrudeSurfaceFactory";
import { RegionFactory } from "../../src/commands/region/RegionFactory";
import SphereFactory from "../../src/commands/sphere/SphereFactory";
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

describe(CurveExtrudeFactory, () => {
    let extrude: CurveExtrudeFactory;
    beforeEach(() => {
        extrude = new CurveExtrudeFactory(db, materials, signals);
    });

    test('invokes the appropriate c3d commands', async () => {
        const makeCircle = new CenterCircleFactory(db, materials, signals);
        makeCircle.center = new THREE.Vector3();
        makeCircle.radius = 1;
        const circle = await makeCircle.commit() as visual.SpaceInstance<visual.Curve3D>;

        extrude.curves = [circle];
        extrude.distance1 = 1;
        extrude.distance2 = 1;
        expect(extrude.direction).toApproximatelyEqual(new THREE.Vector3(0, 0, 1));
        const result = await extrude.commit() as visual.SpaceItem;

        const bbox = new THREE.Box3().setFromObject(result);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        expect(center).toApproximatelyEqual(new THREE.Vector3(0, 0, 0));
        expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-1, -1, -1));
        expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(1, 1, 1));
    })

    test('with direction', async () => {
        const makeCircle = new CenterCircleFactory(db, materials, signals);
        makeCircle.center = new THREE.Vector3();
        makeCircle.radius = 1;
        const circle = await makeCircle.commit() as visual.SpaceInstance<visual.Curve3D>;

        extrude.curves = [circle];
        extrude.distance1 = 1;
        extrude.distance2 = 1;
        extrude.direction = new THREE.Vector3(1, 1, 1).normalize();
        const result = await extrude.commit() as visual.SpaceItem;

        const bbox = new THREE.Box3().setFromObject(result);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        expect(center).toApproximatelyEqual(new THREE.Vector3(0, 0, 0));
        expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-1.577, -1.577, -0.577));
        expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(1.577, 1.577, 0.577));
    })
})

describe(RegionExtrudeFactory, () => {
    let extrude: RegionExtrudeFactory;
    beforeEach(() => {
        extrude = new RegionExtrudeFactory(db, materials, signals);
    });

    test('invokes the appropriate c3d commands', async () => {
        const makeCircle = new CenterCircleFactory(db, materials, signals);
        const makeRegion = new RegionFactory(db, materials, signals);

        makeCircle.center = new THREE.Vector3();
        makeCircle.radius = 1;
        const circle = await makeCircle.commit() as visual.SpaceInstance<visual.Curve3D>;
        makeRegion.contours = [circle];
        const items = await makeRegion.commit() as visual.PlaneInstance<visual.Region>[];
        const region = items[0];

        extrude.region = region;
        extrude.distance1 = 1;
        extrude.distance2 = 1;
        expect(extrude.direction).toApproximatelyEqual(new THREE.Vector3(0, 0, 1));
        const result = await extrude.commit() as visual.SpaceItem;

        const bbox = new THREE.Box3().setFromObject(result);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        expect(center).toApproximatelyEqual(new THREE.Vector3(0, 0, 0));
        expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-1, -1, -1));
        expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(1, 1, 1));
        // To both sides it is one prism: the side is one face, with no seam along the circle's plane
        expect([...(result as visual.Solid).faces].length).toBe(3);
    })

    test('with direction', async () => {
        const makeCircle = new CenterCircleFactory(db, materials, signals);
        const makeRegion = new RegionFactory(db, materials, signals);

        makeCircle.center = new THREE.Vector3();
        makeCircle.radius = 1;
        const circle = await makeCircle.commit() as visual.SpaceInstance<visual.Curve3D>;
        makeRegion.contours = [circle];
        const items = await makeRegion.commit() as visual.PlaneInstance<visual.Region>[];
        const region = items[0];

        extrude.region = region;
        extrude.distance1 = 1;
        extrude.distance2 = 1;
        extrude.direction = new THREE.Vector3(1, 1, 1).normalize();
        const result = await extrude.commit() as visual.SpaceItem;

        const bbox = new THREE.Box3().setFromObject(result);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        expect(center).toApproximatelyEqual(new THREE.Vector3(0, 0, 0));
        expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-1.577, -1.577, -0.577));
        expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(1.577, 1.577, 0.577));
    })
})

describe(FaceExtrudeFactory, () => {
    let extrude: FaceExtrudeFactory;
    beforeEach(() => {
        extrude = new FaceExtrudeFactory(db, materials, signals);
    });

    let box: visual.Solid;

    beforeEach(async () => {
        const makeBox = new ThreePointBoxFactory(db, materials, signals);
        makeBox.p1 = new THREE.Vector3();
        makeBox.p2 = new THREE.Vector3(1, 0, 0);
        makeBox.p3 = new THREE.Vector3(1, 1, 0);
        makeBox.p4 = new THREE.Vector3(1, 1, 1);
        box = await makeBox.commit() as visual.Solid;
    });

    test('invokes the appropriate c3d commands to create a new body', async () => {
        extrude.face = box.faces.get(0);
        extrude.distance1 = 0.2;
        const result = await extrude.commit() as visual.SpaceItem;

        const bbox = new THREE.Box3().setFromObject(result);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        expect(center).toApproximatelyEqual(new THREE.Vector3(0.5, 0.5, -0.1));
        expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(0, 0, -0.2));
        expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(1, 1, 0));

        expect(extrude.originalItem).toBeUndefined();

        expect(db.items.length).toBe(2);
    })

    test('faces automatically set the boolean operation type based on direction', async () => {
        extrude.face = box.faces.get(1);
        extrude.target = box;
        extrude.distance1 = 0.2;
        expect(extrude.operationType).toBe(c3d.OperationType.Union);
        extrude.distance1 = -0.2;
        expect(extrude.operationType).toBe(c3d.OperationType.Difference);
        const result = await extrude.commit() as visual.SpaceItem;

        const bbox = new THREE.Box3().setFromObject(result);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        expect(center).toApproximatelyEqual(new THREE.Vector3(0.5, 0.5, 0.4));
        expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(0, 0, 0));
        expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(1, 1, 0.8));

        expect(extrude.originalItem).toBe(box);

        expect(db.items.length).toBe(1);
    });
})

describe(PossiblyBooleanExtrudeFactory, () => {
    let extrude: PossiblyBooleanExtrudeFactory;
    let region: visual.PlaneInstance<visual.Region>;
    let sphere: visual.Solid;

    beforeEach(async () => {
        const makeCircle = new CenterCircleFactory(db, materials, signals);
        const makeRegion = new RegionFactory(db, materials, signals);
        const makeSphere = new SphereFactory(db, materials, signals);

        makeCircle.center = new THREE.Vector3(0, 0, 2);
        makeCircle.radius = 0.1;
        const circle = await makeCircle.commit() as visual.SpaceInstance<visual.Curve3D>;

        makeRegion.contours = [circle];
        const items = await makeRegion.commit() as visual.PlaneInstance<visual.Region>[];
        region = items[0];

        makeSphere.center = new THREE.Vector3();
        makeSphere.radius = 1;
        sphere = await makeSphere.commit() as visual.Solid;

        expect(db.items.length).toBe(3);
    });

    describe('region', () => {
        beforeEach(() => {
            const bool = new MultiBooleanFactory(db, materials, signals);
            const phantom = new RegionExtrudeFactory(db, materials, signals);
            phantom.region = region;
            extrude = new PossiblyBooleanExtrudeFactory(bool, phantom);
        });

        test('basic union', async () => {
            extrude.targets = [sphere];
            extrude.distance1 = 0;
            extrude.distance2 = 1.5;
            extrude.operationType = c3d.OperationType.Union;
            const results = await extrude.commit() as visual.SpaceItem[];
            expect(results.length).toBe(1);

            const bbox = new THREE.Box3().setFromObject(results[0]);
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            expect(center).toApproximatelyEqual(new THREE.Vector3(0, 0, 0.5));
            expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-1, -1, -1));
            expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(1, 1, 2));

            expect(db.items.length).toBe(3);
        })

        test('newBody=true', async () => {
            extrude.targets = [sphere];
            extrude.distance1 = 0;
            extrude.distance2 = 1.5;
            extrude.newBody = true;
            extrude.operationType = c3d.OperationType.Union;
            const results = await extrude.commit() as visual.SpaceItem[];
            expect(results.length).toBe(1);

            const bbox = new THREE.Box3().setFromObject(results[0]);
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            expect(center).toApproximatelyEqual(new THREE.Vector3(0, 0, 1.25));
            expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-0.1, -0.1, 0.5));
            expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(0.1, 0.1, 2));

            expect(db.items.length).toBe(4);
        })

        test('solid=undefined', async () => {
            extrude.distance1 = 0;
            extrude.distance2 = 1.5;
            extrude.operationType = c3d.OperationType.Union;
            const results = await extrude.commit() as visual.SpaceItem[];
            expect(results.length).toBe(1)

            const bbox = new THREE.Box3().setFromObject(results[0]);
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            expect(center).toApproximatelyEqual(new THREE.Vector3(0, 0, 1.25));
            expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-0.1, -0.1, 0.5));
            expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(0.1, 0.1, 2));

            expect(db.items.length).toBe(4);
        })

        test('basic difference', async () => {
            extrude.targets = [sphere];
            extrude.distance1 = 0;
            extrude.distance2 = 1.5;
            extrude.operationType = c3d.OperationType.Difference;
            const results = await extrude.commit() as visual.SpaceItem[];
            expect(results.length).toBe(1)

            const bbox = new THREE.Box3().setFromObject(results[0]);
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            expect(center).toApproximatelyEqual(new THREE.Vector3(0, 0, 0));
            expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-1, -1, -1));
            expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(1, 1, 1));

            expect(db.items.length).toBe(3);
        })

        describe('phantom', () => {
            test('basic difference', async () => {
                extrude.targets = [sphere];
                extrude.distance1 = 0;
                extrude.distance2 = 1.5;
                extrude.operationType = c3d.OperationType.Difference;
                await extrude.calculate();
                const phantoms = await extrude.calculatePhantoms();
                const { phantom } = phantoms[0];
                const result = await db.addItem(phantom);

                const bbox = new THREE.Box3().setFromObject(result);
                const center = new THREE.Vector3();
                bbox.getCenter(center);
                expect(center).toApproximatelyEqual(new THREE.Vector3(0, 0, 1.25));
                expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-0.1, -0.1, 0.5));
                expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(0.1, 0.1, 2));
            })
        });
    })

    describe("face", () => {
        let box: visual.Solid;

        beforeEach(async () => {
            const makeBox = new ThreePointBoxFactory(db, materials, signals);
            makeBox.p1 = new THREE.Vector3();
            makeBox.p2 = new THREE.Vector3(1, 0, 0);
            makeBox.p3 = new THREE.Vector3(1, 1, 0);
            makeBox.p4 = new THREE.Vector3(1, 1, 1);
            box = await makeBox.commit() as visual.Solid;
        });

        beforeEach(() => {
            const bool = new MultiBooleanFactory(db, materials, signals);
            const phantom = new FaceExtrudeFactory(db, materials, signals);
            phantom.face = box.faces.get(1);
            extrude = new PossiblyBooleanExtrudeFactory(bool, phantom);
        });

        test('face direction positive is union', async () => {
            extrude.targets = [box];
            extrude.distance1 = 0.2;
            const results = await extrude.commit() as visual.SpaceItem[];
            expect(results.length).toBe(1)

            const bbox = new THREE.Box3().setFromObject(results[0]);
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            expect(center).toApproximatelyEqual(new THREE.Vector3(0.5, 0.5, 0.6));
            expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(0, 0, 0));
            expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(1, 1, 1.2));
        });

        test('face direction negative is difference', async () => {
            extrude.targets = [box];
            extrude.distance1 = -0.2;
            const results = await extrude.commit() as visual.SpaceItem[];
            expect(results.length).toBe(1);

            const bbox = new THREE.Box3().setFromObject(results[0]);
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            expect(center).toApproximatelyEqual(new THREE.Vector3(0.5, 0.5, 0.4));
            expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(0, 0, 0));
            expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(1, 1, 0.8));
        });
    })
})

describe(ExtrudeSurfaceFactory, () => {
    let extrude: ExtrudeSurfaceFactory;
    beforeEach(() => {
        extrude = new ExtrudeSurfaceFactory(db, materials, signals);
    });

    test("it works", async () => {
        const makeCurve = new CurveFactory(db, materials, signals);
        makeCurve.points.push(new THREE.Vector3(-2, 2, 0));
        makeCurve.points.push(new THREE.Vector3(0, 2, 0.5));
        makeCurve.points.push(new THREE.Vector3(2, 2, 0));
        const curve = await makeCurve.commit() as visual.SpaceInstance<visual.Curve3D>;

        extrude.curve = curve;
        extrude.direction = new THREE.Vector3(0, 1, 0);

        const result = await extrude.commit() as visual.SpaceItem;

        const bbox = new THREE.Box3().setFromObject(result);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        expect(center).toApproximatelyEqual(new THREE.Vector3(0, 2.5, 0.25));
        expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(-2, 2, 0));
        expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(2, 3, 0.5));
    })
})
describe(solidsUnderRegion, () => {
    let box: visual.Solid;

    beforeEach(async () => {
        const makeBox = new ThreePointBoxFactory(db, materials, signals);
        makeBox.p1 = new THREE.Vector3();
        makeBox.p2 = new THREE.Vector3(1, 0, 0);
        makeBox.p3 = new THREE.Vector3(1, 1, 0);
        makeBox.p4 = new THREE.Vector3(1, 1, 1);
        box = await makeBox.commit() as visual.Solid;
    });

    async function regionAt(center: THREE.Vector3) {
        const makeCircle = new CenterCircleFactory(db, materials, signals);
        makeCircle.center = center;
        makeCircle.radius = 0.2;
        const circle = await makeCircle.commit() as visual.SpaceInstance<visual.Curve3D>;
        const makeRegion = new RegionFactory(db, materials, signals);
        makeRegion.contours = [circle];
        const items = await makeRegion.commit() as visual.PlaneInstance<visual.Region>[];
        return items[0];
    }

    function extrudeOnFace(region: visual.PlaneInstance<visual.Region>) {
        const [{ solid, normal }] = solidsUnderRegion(db, region, [box]);
        const phantom = new RegionExtrudeFactory(db, materials, signals);
        phantom.region = region;
        phantom.faceNormal = normal;
        const extrude = new PossiblyBooleanExtrudeFactory(new MultiBooleanFactory(db, materials, signals), phantom);
        extrude.targets = [solid];
        return extrude;
    }

    test('finds the solid whose face the region lies on, with the face normal', async () => {
        const region = await regionAt(new THREE.Vector3(0.5, 0.5, 1));
        const found = solidsUnderRegion(db, region, [box]);
        expect(found.length).toBe(1);
        expect(found[0].solid).toBe(box);
        expect(found[0].normal).toApproximatelyEqual(new THREE.Vector3(0, 0, 1));
    });

    test('a region off the faces finds nothing', async () => {
        expect(solidsUnderRegion(db, await regionAt(new THREE.Vector3(0.5, 0.5, 2)), [box]).length).toBe(0);
        expect(solidsUnderRegion(db, await regionAt(new THREE.Vector3(3, 3, 1)), [box]).length).toBe(0);
    });

    test('extruding into the solid cuts it', async () => {
        const extrude = extrudeOnFace(await regionAt(new THREE.Vector3(0.5, 0.5, 1)));
        expect(extrude.direction).toApproximatelyEqual(new THREE.Vector3(0, 0, 1));
        extrude.distance1 = -1;
        expect(extrude.operationType).toBe(c3d.OperationType.Difference);
        const results = await extrude.commit() as visual.Solid[];
        expect(results.length).toBe(1);

        const bbox = new THREE.Box3().setFromObject(results[0]);
        expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(0, 0, 0));
        expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(1, 1, 1));
        expect(db.lookup(results[0]).GetFacesCount()).toBeGreaterThan(6);
    });

    test('extruding out of the solid joins it', async () => {
        const extrude = extrudeOnFace(await regionAt(new THREE.Vector3(0.5, 0.5, 1)));
        extrude.distance1 = 0.5;
        expect(extrude.operationType).toBe(c3d.OperationType.Union);
        const results = await extrude.commit() as visual.Solid[];
        expect(results.length).toBe(1);

        const bbox = new THREE.Box3().setFromObject(results[0]);
        expect(bbox.min).toApproximatelyEqual(new THREE.Vector3(0, 0, 0));
        expect(bbox.max).toApproximatelyEqual(new THREE.Vector3(1, 1, 1.5));
    });
})

describe('symmetric', () => {
    let extrude: PossiblyBooleanExtrudeFactory;

    beforeEach(async () => {
        const makeCircle = new CenterCircleFactory(db, materials, signals);
        makeCircle.center = new THREE.Vector3();
        makeCircle.radius = 1;
        const circle = await makeCircle.commit() as visual.SpaceInstance<visual.Curve3D>;
        const makeRegion = new RegionFactory(db, materials, signals);
        makeRegion.contours = [circle];
        const [region] = await makeRegion.commit() as visual.PlaneInstance<visual.Region>[];
        const phantom = new RegionExtrudeFactory(db, materials, signals);
        phantom.region = region;
        extrude = new PossiblyBooleanExtrudeFactory(new MultiBooleanFactory(db, materials, signals), phantom);
    });

    test('turning it on copies distance 1, turning it off gives distance 2 back', () => {
        extrude.distance1 = 1;
        extrude.distance2 = 0.3;
        extrude.symmetric = true;
        expect(extrude.distance2).toBe(1);
        extrude.symmetric = false;
        expect(extrude.distance2).toBe(0.3);
        expect(extrude.distance1).toBe(1);
    });

    test('while on, whichever distance changes sets the other', () => {
        extrude.distance1 = 1;
        extrude.symmetric = true;
        extrude.distance1 = 2;
        extrude.syncDistances();
        expect(extrude.distance2).toBe(2);
        extrude.distance2 = 3;
        extrude.syncDistances();
        expect(extrude.distance1).toBe(3);
        extrude.distance1 = -0.5;
        extrude.syncDistances();
        expect(extrude.distance2).toBe(-0.5);
    });

    test('off, distances are independent', () => {
        extrude.distance1 = 1;
        extrude.distance2 = 0;
        extrude.syncDistances();
        expect(extrude.distance2).toBe(0);
    });

    test('on commits on both sides, off on one', async () => {
        extrude.distance1 = 1;
        extrude.symmetric = true;
        const both = new THREE.Box3().setFromObject((await extrude.commit() as visual.Solid[])[0]);
        expect(both.min.z).toBeCloseTo(-1);
        expect(both.max.z).toBeCloseTo(1);
    });

    test('turning it off before commit is one-sided again', async () => {
        extrude.distance1 = 1;
        extrude.symmetric = true;
        extrude.symmetric = false;
        const one = new THREE.Box3().setFromObject((await extrude.commit() as visual.Solid[])[0]);
        expect(one.min.z).toBeCloseTo(0);
        expect(one.max.z).toBeCloseTo(1);
    });

    test('a negative distance makes an even extrusion too', async () => {
        extrude.distance1 = -1;
        extrude.symmetric = true;
        const both = new THREE.Box3().setFromObject((await extrude.commit() as visual.Solid[])[0]);
        expect(both.min.z).toBeCloseTo(-1);
        expect(both.max.z).toBeCloseTo(1);
    });

    test('operation is the boolean or a new body', () => {
        extrude.operation = NewBody;
        expect(extrude.newBody).toBe(true);
        expect(extrude.operation).toBe(NewBody);
        extrude.operation = c3d.OperationType.Union;
        expect(extrude.newBody).toBe(false);
        expect(extrude.operationType).toBe(c3d.OperationType.Union);
        expect(extrude.operation).toBe(c3d.OperationType.Union);
    });
})

describe('previewing the boolean once values settle', () => {
    let box: visual.Solid;
    let face: FaceExtrudeFactory;
    let extrude: PossiblyBooleanExtrudeFactory;
    const settleDelay = PossiblyBooleanFactory.settleDelay;

    beforeEach(async () => {
        PossiblyBooleanFactory.settleDelay = 20;
        const makeBox = new ThreePointBoxFactory(db, materials, signals);
        makeBox.p1 = new THREE.Vector3();
        makeBox.p2 = new THREE.Vector3(1, 0, 0);
        makeBox.p3 = new THREE.Vector3(1, 1, 0);
        makeBox.p4 = new THREE.Vector3(1, 1, 1);
        box = await makeBox.commit() as visual.Solid;

        face = new FaceExtrudeFactory(db, materials, signals);
        face.face = box.faces.get(1); // the top
        extrude = new PossiblyBooleanExtrudeFactory(new MultiBooleanFactory(db, materials, signals), face);
        extrude.targets = [box];
        extrude.touching = new Set([box]);
        extrude.distance1 = 0.5;
    });

    afterEach(() => { PossiblyBooleanFactory.settleDelay = settleDelay });

    const settled = () => new Promise(resolve => setTimeout(resolve, PossiblyBooleanFactory.settleDelay + 50));

    test('while values change, it previews just the tool and leaves the target alone', async () => {
        await extrude.update();
        expect(await extrude.calculate()).toEqual([]);
        const phantoms = await extrude.calculatePhantoms();
        expect(phantoms.length).toBe(1);
        expect(phantoms[0].material).toBe(phantom_blue);
        extrude.cancel();
    });

    test('once values settle, it previews the boolean', async () => {
        await extrude.update();
        await settled();
        const results = await extrude.calculate() as c3d.Solid[];
        expect(results.length).toBe(1);
        expect(await extrude.calculatePhantoms()).toEqual([]);
        extrude.cancel();
    });

    test('committing while values change still does the boolean', async () => {
        await extrude.update();
        const results = await extrude.commit() as visual.Solid[];
        expect(results.length).toBe(1);
        const bbox = new THREE.Box3().setFromObject(results[0]);
        expect(bbox.max.z).toBeCloseTo(1.5);
        expect(db.find(visual.Solid).length).toBe(1);
        await settled(); // no stray update after commit
    });

    test('a target it is known to touch needs no overlap test', async () => {
        const test = jest.spyOn(c3d.Action, 'IsSolidsIntersectionFast_async');
        await extrude.update();
        expect(test).not.toHaveBeenCalled();
        expect(extrude.isOverlapping).toBe(true);

        extrude.touching = new Set();
        await extrude.update();
        expect(test).toHaveBeenCalled();
        test.mockRestore();
        extrude.cancel();
    });

    test('an update builds the tool once', async () => {
        const build = jest.spyOn(face, 'calculate');
        await extrude.update();
        expect(build).toHaveBeenCalledTimes(1);
        build.mockRestore();
        extrude.cancel();
    });
})
