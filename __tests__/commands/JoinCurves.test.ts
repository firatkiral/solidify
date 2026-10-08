import c3d from '../../build/Release/c3d.node';
import JoinCurvesFactory from '../../src/commands/curve/JoinCurvesFactory';
import { EditorSignals } from '../../src/editor/EditorSignals';
import { GeometryDatabase } from '../../src/editor/GeometryDatabase';
import { ParallelMeshCreator } from '../../src/editor/MeshCreator';
import { SolidCopier } from '../../src/editor/SolidCopier';
import { FakeMaterials } from '../../__mocks__/FakeMaterials';

function factory() {
    const signals = new EditorSignals();
    const materials = new FakeMaterials();
    const db = new GeometryDatabase(new ParallelMeshCreator(), new SolidCopier(), materials, signals);
    return new JoinCurvesFactory(db, materials, signals);
}

function line(x1: number, y1: number, x2: number, y2: number) {
    return new c3d.SpaceInstance(new c3d.Polyline3D([
        new c3d.CartPoint3D(x1, y1, 0), new c3d.CartPoint3D(x2, y2, 0)
    ], false));
}

test('joins a small shuffled profile by coincident endpoints', async () => {
    const join = factory();
    join.push(line(0, 0, 1, 0));
    join.push(line(0, 1, 1, 1));
    join.push(line(0, 0, 0, 1));
    join.push(line(1, 0, 1, 1));
    const result = await join.calculate();
    expect(result).toHaveLength(1);
    const contour = result[0].GetSpaceItem() as c3d.Contour3D;
    expect(contour.IsClosed()).toBe(true);
    expect(contour.GetSegmentsCount()).toBe(4);
});

test('keeps nearby disconnected curves separate', async () => {
    const join = factory();
    join.push(line(0, 0, 1, 0));
    join.push(line(0, 0.1, 1, 0.1));
    expect(await join.calculate()).toHaveLength(2);
});
