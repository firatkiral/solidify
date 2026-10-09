import * as THREE from "three";
import c3d from '../../build/Release/c3d.node';
import { MultiBooleanFactory } from "../../src/commands/boolean/BooleanFactory";
import { ThreePointBoxFactory } from "../../src/commands/box/BoxFactory";
import CylinderFactory from "../../src/commands/cylinder/CylinderFactory";
import { FaceExtrudeFactory, PossiblyBooleanExtrudeFactory } from "../../src/commands/extrude/ExtrudeFactory";
import FilletFactory from "../../src/commands/fillet/FilletFactory";
import { GeometryFactory } from "../../src/command/GeometryFactory";
import { EditorSignals } from '../../src/editor/EditorSignals';
import { GeometryDatabase } from '../../src/editor/GeometryDatabase';
import MaterialDatabase from '../../src/editor/MaterialDatabase';
import { ParallelMeshCreator } from "../../src/editor/MeshCreator";
import { SolidCopier } from "../../src/editor/SolidCopier";
import * as visual from '../../src/visual_model/VisualModel';
import { FakeMaterials } from "../../__mocks__/FakeMaterials";
import '../matchers';

jest.setTimeout(600_000);

test('extrude preview cost on a filleted spinner', async () => {
    const materials: Required<MaterialDatabase> = new FakeMaterials();
    const signals = new EditorSignals();
    const db = new GeometryDatabase(new ParallelMeshCreator(), new SolidCopier(), materials, signals);

    const cylinder = async (r: number, z0: number, h: number) => {
        const f = new CylinderFactory(db, materials, signals);
        f.p0 = new THREE.Vector3(0, 0, z0); f.p1 = new THREE.Vector3(r, 0, z0); f.p2 = new THREE.Vector3(0, 0, z0 + h);
        return await f.commit() as visual.Solid;
    };
    const arm = async (degrees: number) => {
        const a = THREE.MathUtils.degToRad(degrees);
        const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0), perp = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
        const f = new ThreePointBoxFactory(db, materials, signals);
        f.p1 = dir.clone().multiplyScalar(60).addScaledVector(perp, -25);
        f.p2 = dir.clone().multiplyScalar(200).addScaledVector(perp, -25);
        f.p3 = f.p2.clone().addScaledVector(perp, 50);
        f.p4 = f.p3.clone().add(new THREE.Vector3(0, 0, 40));
        return await f.commit() as visual.Solid;
    };

    const hub = await cylinder(80, 0, 40);
    const arms = [await arm(0), await arm(120), await arm(240)];
    const union = new MultiBooleanFactory(db, materials, signals);
    union.targets = [hub]; union.tools = arms; union.operationType = c3d.OperationType.Union;
    let [body] = await union.commit() as visual.Solid[];
    const hole = await cylinder(40, -1, 42);
    const cut = new MultiBooleanFactory(db, materials, signals);
    cut.targets = [body]; cut.tools = [hole]; cut.operationType = c3d.OperationType.Difference;
    [body] = await cut.commit() as visual.Solid[];
    const fillet = new FilletFactory(db, materials, signals);
    fillet.solid = body; fillet.edges = [...body.edges]; fillet.distance = 4;
    body = await fillet.commit() as visual.Solid;
    const model = db.lookup(body);

    // The top face: planar, facing up, at the top
    const top = [...body.faces].find(face => {
        const f = db.lookupTopologyItem(face);
        return f.IsPlanar() && f.Normal(0.5, 0.5).z > 0.99 && Math.abs(f.Point(0.5, 0.5).z - 40) < 1e-3;
    })!;

    const face = new FaceExtrudeFactory(db, materials, signals);
    face.face = top;
    const extrude = new PossiblyBooleanExtrudeFactory(new MultiBooleanFactory(db, materials, signals), face);
    extrude.targets = [body];
    extrude.touching = new Set([body]);

    const time = async (fn: () => Promise<unknown>) => { const t = performance.now(); await fn(); return Math.round(performance.now() - t) };

    const drag: number[] = [];
    for (let i = 0; i < 5; i++) {
        extrude.distance1 = 10 + 5 * i;
        drag.push(await time(() => extrude.update()));
    }
    // One preview with the boolean, as after the drag settles (or every step before)
    (extrude as any).changing = false;
    extrude.distance1 = 40;
    const settled = await time(() => GeometryFactory.prototype.update.call(extrude));
    const commit = await time(() => extrude.commit());

    console.info(JSON.stringify({ faces: model.GetFacesCount(), drag, settled, commit }));
});
