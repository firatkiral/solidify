import * as THREE from 'three';
import c3d from '../kernel/kernel';
import { FileType, OpenedFile } from '../platform/Platform';
import ContourManager from './curves/ContourManager';
import { EditorSignals } from './EditorSignals';
import { Empties } from './Empties';
import { GeometryDatabase } from "./GeometryDatabase";
import { EditorOriginator } from './History';
import { Images } from "./Images";
import { Meshes } from "./Meshes";
import { meshExtensions, readMeshes } from './printing/MeshImport';
import { writeStl } from './printing/MeshFormats';
import { PlaneDatabase } from './PlaneDatabase';
import { Scene } from './Scene';
import { SolidifyDocument } from './serialization/SolidifyDocument';
import { readSolidifyFile, SolidifyFileContents, writeSolidifyFile } from './serialization/SolidifyFile';
import { ConstructionPlane } from './snaps/ConstructionPlaneSnap';
import * as visual from '../visual_model/VisualModel';

export const supportedExtensions = ['stp', 'step', 'png', 'jpg', 'jpeg', ...meshExtensions];

// Whether a file, by its name, is a document to open, or something to import into one
export const isDocument = (name: string) => /\.solidify$/i.test(name);
const importable = new RegExp(`\\.(${supportedExtensions.join('|')})$`, 'i');
export const isImportable = (name: string) => importable.test(name);

export const solidifyFile: FileType = { description: 'Solidify document', extensions: ['.solidify'], mimeTypes: ['application/x-solidify'] };
export const stepFile: FileType = { description: 'STEP file', extensions: ['.step', '.stp'], mimeTypes: ['model/step'] };
export const objFile: FileType = { description: 'Wavefront OBJ', extensions: ['.obj'], mimeTypes: ['model/obj'] };
export const stlFile: FileType = { description: 'STL', extensions: ['.stl'], mimeTypes: ['model/stl'] };
export const threeMFFile: FileType = { description: '3MF', extensions: ['.3mf'], mimeTypes: ['model/3mf'] };
const imageFile: FileType = { description: 'Image', extensions: ['.png', '.jpg', '.jpeg'], mimeTypes: ['image/png', 'image/jpeg'] };
const meshFile: FileType = { description: 'Mesh (STL, OBJ, 3MF)', extensions: ['.stl', '.obj', '.3mf'], mimeTypes: ['model/stl', 'model/obj', 'model/3mf'] };
export const importFiles: FileType[] = [
    { description: 'All supported', extensions: [...stepFile.extensions, ...meshFile.extensions, ...imageFile.extensions], mimeTypes: [...stepFile.mimeTypes, ...meshFile.mimeTypes, ...imageFile.mimeTypes] },
    stepFile,
    meshFile,
    imageFile,
];

export class ImporterExporter {
    constructor(
        private readonly originator: EditorOriginator,
        private readonly db: GeometryDatabase,
        private readonly empties: Empties,
        private readonly scene: Scene,
        private readonly images: Images,
        private readonly contours: ContourManager,
        private readonly signals: EditorSignals,
        private readonly meshes = new Meshes(),
    ) { }

    // Throws if it isn't a .solidify file
    read(data: Uint8Array): SolidifyFileContents {
        return readSolidifyFile(data);
    }

    // Loads what read() gave in place of the scene
    async load({ json, geometry, images, meshes }: SolidifyFileContents) {
        this.originator.clear();
        await SolidifyDocument.load(json, geometry, images, this.originator, meshes);
        this.originator.debug();
        this.originator.validate();
        this.signals.backupLoaded.dispatch();
    }

    async import(files: readonly OpenedFile[], cplane?: ConstructionPlane) {
        const { db, empties, images, meshes, scene } = this;
        for (const { name, bytes } of files) {
            if (/\.(stl|obj|3mf)$/i.test(name)) {
                // Reference meshes stay where the file has them, which is often where a printer's bed is
                for (const mesh of readMeshes(name, bytes)) {
                    const data = writeStl([mesh]);
                    const meshName = Meshes.nameFor(data);
                    meshes.add(meshName, data);
                    const empty = empties.addMesh(meshName);
                    scene.setName(empty, mesh.name);
                }
            } else if (/\.(png|jpg|jpeg)$/i.test(name)) {
                if (cplane === undefined) cplane = PlaneDatabase.XY;
                const imageName = Images.nameFor(name, bytes);
                await images.add(imageName, bytes);
                const empty = empties.addImage(imageName);
                const transform = { position: cplane.p.clone(), quaternion: cplane.orientation.clone(), scale: new THREE.Vector3(1, 1, 1) };
                scene.setTransform(empty, transform);
            } else {
                const { result, model } = await c3d.Conversion.ImportFromBuffer_async(name, bytes);
                if (result !== c3d.ConvResType.Success) {
                    console.error(name, c3d.ConvResType[result]);
                    continue;
                }
                await db.load(model, false);
            }
        }
    }

    // The document as a .solidify file; `id` is the document's, kept in the file. What's saved is what there is
    // when this is called, though the thumbnail may come later.
    async serialize(id: string, compress = true, thumbnail?: Promise<Uint8Array | undefined>): Promise<Uint8Array> {
        const { json, geometry, images, meshes } = await new SolidifyDocument(this.originator).serialize();
        return writeSolidifyFile({ id, json, geometry, images, meshes, thumbnail: await thumbnail }, compress);
    }

    // The items given, or everything
    async exportStep(items?: readonly visual.Item[], units: 'mm' | 'in' = 'mm'): Promise<Uint8Array> {
        let model: c3d.Model;
        if (items === undefined) model = this.db.saveToMemento().model;
        else {
            model = new c3d.Model();
            for (const item of items) model.AddItem(this.db.lookup(item));
        }
        const { result, data } = await c3d.Conversion.ExportIntoBuffer_async(model, 'export.step', units);
        if (result === c3d.ConvResType.NoObjects) throw new Error("There is nothing to export.");
        if (result !== c3d.ConvResType.Success || data === undefined) throw new Error(c3d.ConvResType[result]);
        return data;
    }
}
