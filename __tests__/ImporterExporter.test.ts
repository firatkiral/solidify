/**
 * @jest-environment jsdom
 */
import * as THREE from "three";
import { FakePlatform } from "../__mocks__/FakePlatform";
import SphereFactory from "../src/commands/sphere/SphereFactory";
import { Editor } from "../src/editor/Editor";
import { EditorSignals } from "../src/editor/EditorSignals";
import { GeometryDatabase } from "../src/editor/GeometryDatabase";
import { ImporterExporter, isDocument, isImportable } from "../src/editor/ImporterExporter";
import MaterialDatabase from "../src/editor/MaterialDatabase";
import * as visual from '../src/visual_model/VisualModel';
import './matchers';

let importer: ImporterExporter;
let editor: Editor;
let db: GeometryDatabase;
let materials: MaterialDatabase;
let signals: EditorSignals;

beforeEach(() => {
    editor = new Editor(new FakePlatform());
    db = editor._db;
    materials = editor.materials;
    signals = editor.signals;
    importer = editor.importer;
});

async function makeSphere() {
    const makeSphere = new SphereFactory(db, materials, signals);
    makeSphere.center = new THREE.Vector3();
    makeSphere.radius = 1;
    return await makeSphere.commit() as visual.Solid;
}

test("export & import STEP", async () => {
    const item = await makeSphere();
    const step = await importer.exportStep();
    expect(new TextDecoder().decode(step.slice(0, 13))).toBe('ISO-10303-21;');

    await db.removeItem(item);
    expect(db.items.length).toBe(0);

    await editor.contours.transaction(() =>
        importer.import([{ name: 'export.step', bytes: step }])
    );
    expect(db.items.length).toBe(1);
});

test("exporting nothing as STEP fails", async () => {
    await expect(importer.exportStep()).rejects.toThrow("There is nothing to export.");
});

test("a .solidify file opens to the same document, with its id", async () => {
    await makeSphere();
    const data = await importer.serialize('b7d1c1a4-0b4e-4d5e-9a62-1f3f2a8c9e10');

    const other = new Editor(new FakePlatform());
    const contents = other.importer.read(data);
    expect(contents.id).toBe('b7d1c1a4-0b4e-4d5e-9a62-1f3f2a8c9e10');
    await other.importer.load(contents);
    expect(other._db.items.length).toBe(1);
});

describe("files from outside, dropped on the app or opened with it", () => {
    const file = (name: string) => ({ name, bytes: new Uint8Array() });

    test("are told apart by name, whatever the case", () => {
        expect(isDocument('Part.SOLIDIFY')).toBe(true);
        expect(isDocument('part.step')).toBe(false);
        for (const name of ['a.step', 'a.STP', 'a.stl', 'a.3mf', 'a.obj', 'a.png', 'a.JPG']) expect(isImportable(name)).toBe(true);
        for (const name of ['a.solidify', 'a.txt', 'step']) expect(isImportable(name)).toBe(false);
    });

    test("a .solidify file among them opens, and nothing is imported", async () => {
        const open = jest.spyOn(editor, 'open').mockResolvedValue();
        const imported = jest.spyOn(editor, 'import').mockResolvedValue();
        const part = file('part.solidify');
        await editor.openOrImport([file('a.step'), part, file('other.solidify')]);
        expect(open).toHaveBeenCalledWith(part);
        expect(imported).not.toHaveBeenCalled();
    });

    test("otherwise, what the app can import is imported, and the rest left out", async () => {
        const open = jest.spyOn(editor, 'open').mockResolvedValue();
        const imported = jest.spyOn(editor, 'import').mockResolvedValue();
        await editor.openOrImport([file('a.step'), file('notes.txt'), file('b.stl')]);
        expect(open).not.toHaveBeenCalled();
        expect(imported).toHaveBeenCalledWith([file('a.step'), file('b.stl')]);
    });
});
