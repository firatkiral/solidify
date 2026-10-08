import * as THREE from 'three';
import { GeometryFactory } from '../../command/GeometryFactory';
import { TemporaryObject } from '../../editor/DatabaseLike';
import { write3mf, writeObj, writeStl } from '../../editor/printing/MeshFormats';
import { bounds, Bounds, PrintMesh, report, weld } from '../../editor/printing/PrintMesh';
import c3d from '../../kernel/kernel';
import * as visual from '../../visual_model/VisualModel';

export enum ExportFormat { STL, ThreeMF, OBJ, STEP }
export enum ExportScope { Selection, Visible, All }
export enum ExportQuality { Draft, Normal, Fine, Custom }
export enum ExportUnits { Millimeters, Inches }
export enum ExportObjects { Separate, One }

export interface ExportParams {
    format: ExportFormat;
    scope: ExportScope;
    quality: ExportQuality;
    // How far the triangles may stray from the surface, in millimetres, and how much their normals may turn, in degrees; for Custom
    tolerance: number;
    angle: number;
    units: ExportUnits;
    objects: ExportObjects;
}

// From coarse and quick to smooth curves; finer than a printer's layers is wasted
export const qualities: Record<Exclude<ExportQuality, ExportQuality.Custom>, { tolerance: number, angle: number }> = {
    [ExportQuality.Draft]: { tolerance: 0.1, angle: 30 },
    [ExportQuality.Normal]: { tolerance: 0.025, angle: 15 },
    [ExportQuality.Fine]: { tolerance: 0.005, angle: 5 },
};

export interface ExportSummary {
    readonly solids: number;
    // None for STEP, which keeps the exact surfaces
    readonly triangles?: number;
    // An estimate, in bytes
    readonly size?: number;
    // In millimetres
    readonly bounds?: Bounds;
    readonly problems: readonly string[];
}

export class ExportFactory extends GeometryFactory implements ExportParams {
    format = ExportFormat.STL;
    scope = ExportScope.Visible;
    quality = ExportQuality.Normal;
    tolerance = qualities[ExportQuality.Normal].tolerance;
    angle = qualities[ExportQuality.Normal].angle;
    units = ExportUnits.Millimeters;
    objects = ExportObjects.Separate;

    hasSelection = false;
    // For the file's metadata
    title = 'Untitled';
    application = 'Solidify';
    // A picture for 3MF; taken before the preview replaces the solids
    thumbnail?: Promise<Uint8Array | undefined>;

    private _solids: visual.Solid[] = [];
    private names: string[] = [];
    get solids() { return this._solids }
    setSolids(solids: visual.Solid[], names: string[]) {
        this._solids = solids;
        this.names = names;
    }

    private meshes: PrintMesh[] = [];
    private _summary?: ExportSummary;
    get summary() { return this._summary }

    // The file, once committed
    output?: Uint8Array;

    private get deflection() {
        return this.quality === ExportQuality.Custom ? { tolerance: this.tolerance, angle: this.angle } : qualities[this.quality];
    }

    private get unit() { return this.units === ExportUnits.Inches ? 'in' as const : 'mm' as const }

    async doUpdate(): Promise<TemporaryObject[]> {
        const { db, solids, names, format } = this;
        if (format === ExportFormat.STEP) {
            // STEP keeps the exact surfaces, so there are no triangles to show or check
            this.meshes = [];
            const box = new THREE.Box3();
            for (const solid of solids) box.expandByObject(solid);
            this._summary = {
                solids: solids.length,
                bounds: box.isEmpty() ? undefined : { min: box.min.toArray(), max: box.max.toArray() },
                problems: [],
            };
            this.cleanupTemps();
            return this.temps = [];
        }

        const { tolerance, angle } = this.deflection;
        const raw = await c3d.Conversion.MeshForPrinting_async(solids.map(s => db.lookup(s)), Math.max(tolerance, 0.0001), Math.max(angle, 0.1) * Math.PI / 180);
        const meshes: PrintMesh[] = [];
        const problems: string[] = [];
        raw.forEach((mesh, i) => {
            if (mesh === undefined) return;
            const welded = weld(names[i], mesh.positions, mesh.triangles);
            meshes.push(welded);
            const { openEdges, nonManifoldEdges, volume, triangles } = report(welded);
            if (triangles === 0) problems.push(`${names[i]} has no triangles.`);
            else if (openEdges > 0) problems.push(`${names[i]} isn't closed (${openEdges} open edges): a slicer may not print it as a solid.`);
            else if (volume < 0) problems.push(`${names[i]} is inside out.`);
            if (nonManifoldEdges > 0) problems.push(`${names[i]} has ${nonManifoldEdges} edges shared by more than two faces.`);
        });
        this.meshes = meshes;
        const triangles = meshes.reduce((n, m) => n + m.triangles.length / 3, 0);
        const vertices = meshes.reduce((n, m) => n + m.positions.length / 3, 0);
        this._summary = { solids: solids.length, triangles, size: estimate(format, triangles, vertices), bounds: bounds(meshes), problems };

        // The triangles, as a wireframe in place of each solid
        const temps: TemporaryObject[] = meshes.map((mesh, i) => {
            const solid = solids[i];
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
            geometry.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
            const wireframe = new THREE.WireframeGeometry(geometry);
            geometry.dispose();
            const object = new THREE.LineSegments(wireframe);
            object.visible = false;
            db.temporaryObjects.add(object);
            return {
                underlying: object,
                show() { object.visible = true; solid.visible = false },
                hide() { object.visible = false; solid.visible = true },
                cancel() {
                    wireframe.dispose();
                    db.temporaryObjects.remove(object);
                    solid.visible = true;
                },
            };
        });
        this.cleanupTemps();
        return this.temps = this.showTemps(temps);
    }

    async doCommit() {
        const { meshes, unit, format, solids } = this;
        try {
            if (solids.length === 0) throw new Error("There is nothing to export.");
            const separate = this.objects === ExportObjects.Separate;
            switch (format) {
                case ExportFormat.STL: this.output = writeStl(meshes, unit); break;
                case ExportFormat.ThreeMF: this.output = write3mf(meshes, { unit, separate, title: this.title, application: this.application, thumbnail: await this.thumbnail }); break;
                case ExportFormat.OBJ: this.output = writeObj(meshes, { unit, separate }); break;
                case ExportFormat.STEP: {
                    const model = new c3d.Model();
                    for (const solid of solids) model.AddItem(this.db.lookup(solid));
                    const { result, data } = await c3d.Conversion.ExportIntoBuffer_async(model, 'export.step', unit);
                    if (result !== c3d.ConvResType.Success || data === undefined) throw new Error(c3d.ConvResType[result]);
                    this.output = data;
                    break;
                }
            }
        } finally {
            for (const temp of this.temps) temp.cancel();
        }
        return [];
    }
}

// Exact for binary STL; for the text formats, about what the numbers take, and 3MF's zip shrinks that to about a quarter
function estimate(format: ExportFormat, triangles: number, vertices: number): number | undefined {
    switch (format) {
        case ExportFormat.STL: return 84 + 50 * triangles;
        case ExportFormat.OBJ: return 30 * vertices + 20 * triangles;
        case ExportFormat.ThreeMF: return Math.round((45 * vertices + 40 * triangles) / 4);
        default: return undefined;
    }
}
