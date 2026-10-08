// STEP import and export (the only exchange format in this OpenCascade build), and meshes for 3D printing.
// The kernel's unit is a hundredth of a millimetre: the app's unit is the millimetre, which it scales by 100 for the kernel
// (unit() in src/util/Conversion.ts). Files are in millimetres, or inches when asked for.

import { ConvResType } from './constants';
import { Region } from './curve2d';
import { Curve3D } from './curve3d';
import { Item } from './base';
import { Assembly, Instance, Model, PlaneInstance, SpaceInstance } from './items';
import { oc } from './occt';
import { compound, curveOfEdge, edgesOf3d, faceOfRegion, Shape, Solid, solidOf } from './solid';

const STEP = /\.(stp|step)$/i;

const kernelUnitsPerMillimetre = 100;

// A copy, scaled about the origin; being a copy, it has no triangulation of its own yet
function scaled(shape: Shape, factor: number): Shape {
    const trsf = new oc.gp_Trsf();
    const origin = new oc.gp_Pnt(0, 0, 0);
    trsf.SetScale(origin, factor);
    const t = new oc.BRepBuilderAPI_Transform(shape, trsf, true, false);
    const result = t.Shape();
    t.delete(); trsf.delete(); origin.delete();
    return result;
}

// OCCT converts between a file's units and these; they exist once a reader or writer has been made
function setUnits(file: 'MM' | 'INCH') {
    oc.Interface_Static.SetCVal('xstep.cascade.unit', 'MM');
    oc.Interface_Static.SetCVal('write.step.unit', file);
}

function explore(shape: Shape, type: any, avoid: any = oc.TopAbs_ShapeEnum.TopAbs_SHAPE): Shape[] {
    const result: Shape[] = [];
    const ex = new oc.TopExp_Explorer(shape, type, avoid);
    for (; ex.More(); ex.Next()) result.push(ex.Current());
    ex.delete();
    return result;
}

export function importFromBuffer(fileName: string, data: Uint8Array): { result: number, model: Model } {
    const model = new Model();
    if (!STEP.test(fileName)) return { result: ConvResType.UnknownExtension, model };
    const path = '/import.step';
    oc.FS.writeFile(path, data);
    try {
        const reader = new oc.STEPControl_Reader();
        setUnits('MM');
        const status = reader.ReadFile(path);
        if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) { reader.delete(); return { result: ConvResType.Error, model } }
        reader.TransferRoots(new oc.Message_ProgressRange());
        const shape = scaled(reader.OneShape(), kernelUnitsPerMillimetre);
        reader.delete();
        const { TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE, TopAbs_EDGE } = oc.TopAbs_ShapeEnum;
        for (const s of explore(shape, TopAbs_SOLID)) model.AddItem(new Solid(oc.TopoDS.Solid(s)));
        // Shells and faces that are not part of a solid: closed shells become solids, the rest stay sheets.
        for (const s of explore(shape, TopAbs_SHELL, TopAbs_SOLID)) {
            const shell = oc.TopoDS.Shell(s);
            model.AddItem(new Solid(oc.BRep_Tool.IsClosed(shell) ? solidOf(shell) : shell));
        }
        for (const f of explore(shape, TopAbs_FACE, TopAbs_SHELL)) model.AddItem(new Solid(oc.TopoDS.Face(f)));
        for (const e of explore(shape, TopAbs_EDGE, TopAbs_FACE)) model.AddItem(new SpaceInstance(curveOfEdge(oc.TopoDS.Edge(e))));
    } finally {
        oc.FS.unlink(path);
    }
    return { result: model.ItemsCount() > 0 ? ConvResType.Success : ConvResType.NoObjects, model };
}

function shapesOf(item: Item): Shape[] {
    if (item instanceof Solid) return [item.shape];
    if (item instanceof SpaceInstance) {
        const curve = item.GetSpaceItem();
        return curve instanceof Curve3D ? [compound(edgesOf3d(curve))] : [];
    }
    if (item instanceof PlaneInstance) {
        const placement = item.GetPlacement();
        const result: Shape[] = [];
        for (let i = 0; i < item.PlaneItemsCount(); i++) {
            const planeItem = item.GetPlaneItem(i);
            if (planeItem instanceof Region) result.push(faceOfRegion(planeItem.Duplicate() as Region, placement));
        }
        return result;
    }
    if (item instanceof Assembly) return item.GetItems().flatMap(shapesOf);
    if (item instanceof Instance) return shapesOf(item.GetItem());
    return [];
}

export function exportIntoBuffer(model: Model, fileName: string, units: 'mm' | 'in' = 'mm'): { result: number, data?: Uint8Array } {
    if (!STEP.test(fileName)) return { result: ConvResType.UnknownExtension };
    const shapes = model.GetItems().flatMap(shapesOf);
    if (shapes.length === 0) return { result: ConvResType.NoObjects };
    const writer = new oc.STEPControl_Writer();
    setUnits(units === 'in' ? 'INCH' : 'MM');
    // A model reads the units as it's made, and the writer made its own before they were set
    writer.Model(true);
    const shape = scaled(compound(shapes), 1 / kernelUnitsPerMillimetre);
    writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, new oc.Message_ProgressRange());
    const path = '/export.step';
    const status = writer.Write(path);
    writer.delete();
    if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) return { result: ConvResType.FileWriteError };
    const data = oc.FS.readFile(path);
    oc.FS.unlink(path);
    return { result: ConvResType.Success, data };
}

// The triangles of each solid (sheets included) for 3D printing, with positions in millimetres; undefined for the items
// that have no faces, like curves. Each face is triangulated on its own, so faces don't share vertices.
export function meshForPrinting(items: Item[], tolerance: number, angle: number): ({ positions: Float32Array, triangles: Uint32Array } | undefined)[] {
    return items.map(item => {
        if (!(item instanceof Solid)) return undefined;
        // A copy in millimetres, so the tolerance is too, and the triangulation shown in the viewport is left alone
        const shape = scaled(item.shape, 1 / kernelUnitsPerMillimetre);
        const data = oc.ReplicadMeshExtractor.extract(shape, tolerance, angle, true);
        const memory = oc.wasmMemory.buffer as ArrayBuffer;
        const positions = new Float32Array(memory, data.getVerticesPtr(), data.getVerticesSize()).slice();
        const triangles = new Uint32Array(memory, data.getTrianglesPtr(), data.getTrianglesSize()).slice();
        data.delete();
        shape.delete();
        return { positions, triangles };
    });
}
