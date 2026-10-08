/**
 * @jest-environment jsdom
 */
import { strFromU8, unzipSync } from 'fflate';
import * as THREE from 'three';
import { FakePlatform } from '../__mocks__/FakePlatform';
import { ThreePointBoxFactory } from '../src/commands/box/BoxFactory';
import { Editor } from '../src/editor/Editor';
import { ExportFactory, ExportFormat, ExportQuality, ExportUnits } from '../src/commands/export/ExportFactory';
import { write3mf, writeObj, writeStl } from '../src/editor/printing/MeshFormats';
import { bounds, PrintMesh, report, weld } from '../src/editor/printing/PrintMesh';
import { readMeshes } from '../src/editor/printing/MeshImport';
import { MeshEmpty } from '../src/editor/Empties';
import '../src/visual_model/VisualModelRaycasting';
import c3d from '../src/kernel/kernel';
import * as visual from '../src/visual_model/VisualModel';
import './matchers';

let editor: Editor;

beforeEach(() => {
    editor = new Editor(new FakePlatform());
});

afterEach(() => editor.dispose());

// A cube of the given size in millimetres, the app's unit, from the origin
async function cube(size: number) {
    const makeBox = new ThreePointBoxFactory(editor._db, editor.materials, editor.signals);
    makeBox.p1 = new THREE.Vector3();
    makeBox.p2 = new THREE.Vector3(size, 0, 0);
    makeBox.p3 = new THREE.Vector3(size, size, 0);
    makeBox.p4 = new THREE.Vector3(size, size, size);
    return await makeBox.commit() as visual.Solid;
}

function meshOf(solid: visual.Solid, tolerance = 0.01): PrintMesh {
    const [mesh] = c3d.Conversion.MeshForPrinting([editor.db.lookup(solid)], tolerance, 0.3);
    return weld('Cube', mesh!.positions, mesh!.triangles);
}

describe("a 20 mm calibration cube", () => {
    test("meshes to 20 mm, watertight, facing out", async () => {
        const mesh = meshOf(await cube(20));
        expect(bounds([mesh])).toEqual({ min: [0, 0, 0], max: [20, 20, 20] });
        const { triangles, openEdges, nonManifoldEdges, volume } = report(mesh);
        expect(triangles).toBe(12);
        expect(openEdges).toBe(0);
        expect(nonManifoldEdges).toBe(0);
        expect(volume).toBeCloseTo(8000, 3);
    });

    test("is 20 mm in a STEP file, and comes back as 20 mm", async () => {
        await cube(20);
        const step = new TextDecoder().decode(await editor.importer.exportStep());
        expect(step).toMatch(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
        expect(step).toMatch(/CARTESIAN_POINT\('',\(20\.,20\.,20\.\)\)|CARTESIAN_POINT\('',\(20\.,20\.,0\.\)\)/);

        await editor.contours.transaction(() => editor.importer.import([{ name: 'cube.step', bytes: new TextEncoder().encode(step) }]));
        const imported = editor._db.items[editor._db.items.length - 1].view;
        const box = new THREE.Box3().setFromObject(imported);
        expect(box.min).toApproximatelyEqual(new THREE.Vector3(0, 0, 0));
        expect(box.max).toApproximatelyEqual(new THREE.Vector3(20, 20, 20));
    });

    test("is 0.787 in a STEP file in inches", async () => {
        await cube(20);
        const step = new TextDecoder().decode(await editor.importer.exportStep(undefined, 'in'));
        expect(step).toMatch(/INCH/);
        expect(step).toMatch(/0\.78740157/);
    });

    test("is 20 mm in STL, OBJ and 3MF, and 0.787 in inches", async () => {
        const mesh = meshOf(await cube(20));

        const stl = new DataView(writeStl([mesh]).buffer);
        expect(stl.getUint32(80, true)).toBe(12);
        const xs = [];
        for (let t = 0; t < 12; t++) for (let v = 0; v < 3; v++) xs.push(stl.getFloat32(84 + 50 * t + 12 + 12 * v, true));
        expect(Math.max(...xs)).toBe(20);
        const inches = new DataView(writeStl([mesh], 'in').buffer);
        expect(inches.getFloat32(84 + 12, true) * 25.4).toBeCloseTo(stl.getFloat32(84 + 12, true), 4);

        const obj = strFromU8(writeObj([mesh]));
        expect(obj).toMatch(/^v 20 20 20$/m);
        expect(obj.match(/^f /gm)).toHaveLength(12);

        const model = strFromU8(unzipSync(write3mf([mesh], { title: 'Cube' }))['3D/3dmodel.model']);
        expect(model).toMatch(/<model unit="millimeter"/);
        expect(model).toMatch(/<vertex x="20" y="20" z="20"\/>/);
        expect(model.match(/<triangle /g)).toHaveLength(12);
        expect(strFromU8(unzipSync(write3mf([mesh], { unit: 'in' }))['3D/3dmodel.model'])).toMatch(/<model unit="inch"/);
    });
});

test("3MF has a thumbnail and its relationship when given one, and objects of their own or one", async () => {
    const a = meshOf(await cube(10));
    const b = { ...a, name: 'Other' };
    const thumbnail = new Uint8Array([137, 80, 78, 71]);
    const separate = unzipSync(write3mf([a, b], { thumbnail }));
    expect(separate['Metadata/thumbnail.png']).toEqual(thumbnail);
    expect(strFromU8(separate['_rels/.rels'])).toMatch(/metadata\/thumbnail/);
    expect(strFromU8(separate['3D/3dmodel.model']).match(/<object /g)).toHaveLength(2);
    expect(strFromU8(separate['3D/3dmodel.model']).match(/<item /g)).toHaveLength(2);

    const one = unzipSync(write3mf([a, b], { separate: false }));
    expect(strFromU8(one['3D/3dmodel.model']).match(/<object /g)).toHaveLength(1);
    expect(one['Metadata/thumbnail.png']).toBeUndefined();
});

test("a finer tolerance makes more triangles of a curved solid", async () => {
    const SphereFactory = (await import('../src/commands/sphere/SphereFactory')).default;
    const makeSphere = new SphereFactory(editor._db, editor.materials, editor.signals);
    makeSphere.center = new THREE.Vector3();
    makeSphere.radius = 10;
    const sphere = await makeSphere.commit() as visual.Solid;
    const coarse = report(meshOf(sphere, 0.5)), fine = report(meshOf(sphere, 0.01));
    expect(fine.triangles).toBeGreaterThan(coarse.triangles);
    expect(fine.openEdges).toBe(0);
    expect(fine.volume).toBeGreaterThan(0);
});

describe(ExportFactory, () => {
    async function factoryFor(solids: visual.Solid[]) {
        const factory = new ExportFactory(editor.db, editor.materials, editor.signals);
        factory.setSolids(solids, solids.map((_, i) => `Solid ${i + 1}`));
        factory.title = 'Cube';
        return factory;
    }

    test("measures what it will export", async () => {
        const factory = await factoryFor([await cube(20)]);
        await factory.update();
        expect(factory.summary).toEqual({ solids: 1, triangles: 12, size: 84 + 50 * 12, bounds: { min: [0, 0, 0], max: [20, 20, 20] }, problems: [] });

        factory.format = ExportFormat.STEP;
        await factory.update();
        expect(factory.summary?.triangles).toBeUndefined();
        expect(factory.summary?.bounds?.max).toEqual([20, 20, 20]);
    });

    test("writes each format", async () => {
        for (const [format, check] of [
            [ExportFormat.STL, (b: Uint8Array) => new DataView(b.buffer).getUint32(80, true) === 12],
            [ExportFormat.ThreeMF, (b: Uint8Array) => /<model unit="inch"/.test(strFromU8(unzipSync(b)['3D/3dmodel.model']))],
            [ExportFormat.OBJ, (b: Uint8Array) => /^v 0\.787402 /m.test(strFromU8(b))],
            [ExportFormat.STEP, (b: Uint8Array) => /INCH/.test(strFromU8(b))],
        ] as [ExportFormat, (b: Uint8Array) => boolean][]) {
            const factory = await factoryFor([await cube(20)]);
            factory.format = format;
            factory.units = ExportUnits.Inches;
            await factory.update();
            await factory.commit();
            expect(check(factory.output!)).toBe(true);
        }
    });

    test("a finer quality makes more triangles", async () => {
        const SphereFactory = (await import('../src/commands/sphere/SphereFactory')).default;
        const makeSphere = new SphereFactory(editor._db, editor.materials, editor.signals);
        makeSphere.center = new THREE.Vector3();
        makeSphere.radius = 10;
        const factory = await factoryFor([await makeSphere.commit() as visual.Solid]);
        factory.quality = ExportQuality.Draft;
        await factory.update();
        const draft = factory.summary!.triangles!;
        factory.quality = ExportQuality.Fine;
        await factory.update();
        expect(factory.summary!.triangles!).toBeGreaterThan(draft);
    });

    test("there's nothing to export without solids", async () => {
        const factory = await factoryFor([]);
        await factory.update();
        expect(factory.summary?.solids).toBe(0);
        await expect(factory.commit()).rejects.toThrow("There is nothing to export.");
    });
});

describe("reference meshes", () => {
    test("an STL comes in as a mesh to model against, in millimetres, and is saved with the document", async () => {
        const stl = writeStl([meshOf(await cube(20))]);
        await editor.importer.import([{ name: 'bracket.stl', bytes: stl }]);
        const [empty] = editor.empties.items;
        expect(empty).toBeInstanceOf(MeshEmpty);
        expect(editor.scene.getName(empty)).toBe('bracket');
        const geometry = (empty as MeshEmpty).geometry;
        expect(geometry.boundingBox!.max.toArray()).toEqual([20, 20, 20]);

        const data = await editor.importer.serialize('b7d1c1a4-0b4e-4d5e-9a62-1f3f2a8c9e10');
        const contents = editor.importer.read(data);
        expect(contents.meshes?.size).toBe(1);

        const other = new Editor(new FakePlatform());
        await other.importer.load(contents);
        expect(other.empties.items).toHaveLength(1);
        expect((other.empties.items[0] as MeshEmpty).geometry.boundingBox!.max.toArray()).toEqual([20, 20, 20]);
        other.dispose();
    });

    test("a 3MF in inches comes in at its size in millimetres, one mesh per object", async () => {
        const mesh = meshOf(await cube(20));
        const threeMF = write3mf([mesh, { ...mesh, name: 'Lid' }], { unit: 'in' });
        const meshes = readMeshes('box.3mf', threeMF);
        expect(meshes).toHaveLength(2);
        expect(bounds(meshes)!.max[0]).toBeCloseTo(20, 4);
    });

    test("an OBJ comes in in millimetres", async () => {
        const obj = writeObj([meshOf(await cube(20))]);
        const [mesh] = readMeshes('box.obj', obj);
        expect(bounds([mesh])!.max).toEqual([20, 20, 20]);
    });

    test("a pick on one snaps to the point hit, facing the way its triangle does", async () => {
        await editor.importer.import([{ name: 'plate.stl', bytes: writeStl([meshOf(await cube(20))]) }]);
        const empty = editor.empties.items[0] as MeshEmpty;
        empty.updateMatrixWorld(true);
        const raycaster = new THREE.Raycaster(new THREE.Vector3(5, 5, 50), new THREE.Vector3(0, 0, -1));
        const hits: THREE.Intersection[] = [];
        empty.raycast(raycaster, hits);
        expect(hits).toHaveLength(1);
        const { position, orientation } = empty.snapAt(hits[0]).project(hits[0].point);
        expect(position).toApproximatelyEqual(new THREE.Vector3(5, 5, 20));
        expect(new THREE.Vector3(0, 0, 1).applyQuaternion(orientation)).toApproximatelyEqual(new THREE.Vector3(0, 0, 1));
    });
});
