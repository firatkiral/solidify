/**
 * @jest-environment jsdom
 */
import * as THREE from 'three';
import { FakePlatform } from '../__mocks__/FakePlatform';
import { ThreePointBoxFactory } from '../src/commands/box/BoxFactory';
import { CurrentDocument } from '../src/editor/CurrentDocument';
import { Editor } from '../src/editor/Editor';
import './matchers';

describe(CurrentDocument, () => {
    let editor: Editor;

    const id = 'b7d1c1a4-0b4e-4d5e-9a62-1f3f2a8c9e10';
    const part = { name: 'part.solidify' };

    beforeEach(() => {
        editor = new Editor(new FakePlatform());
    });

    async function makeBox(size: number) {
        const makeBox = new ThreePointBoxFactory(editor._db, editor.materials, editor.signals);
        makeBox.p1 = new THREE.Vector3();
        makeBox.p2 = new THREE.Vector3(size, 0, 0);
        makeBox.p3 = new THREE.Vector3(size, size, 0);
        makeBox.p4 = new THREE.Vector3(size, size, size);
        return makeBox.commit();
    }

    async function edit(size: number) {
        const before = editor.history.current;
        await makeBox(size);
        editor.history.add("Box", before);
    }

    test("an empty untitled document has nothing unsaved", async () => {
        expect(editor.document.name).toBe('Untitled');
        expect(editor.document.modified).toBe(false);
        await edit(1);
        expect(editor.document.modified).toBe(true);
    });

    test("an edit is unsaved; a selection isn't", async () => {
        editor.document.reset(id, part, false);
        expect(editor.document.name).toBe('part.solidify');

        editor.history.add("Select", editor.history.current, false);
        expect(editor.document.modified).toBe(false);

        await edit(1);
        expect(editor.document.modified).toBe(true);
    });

    test("undoing back to the save, or saving, leaves nothing unsaved", async () => {
        editor.document.reset(id, part, false);
        await edit(1);
        editor.history.undo();
        expect(editor.document.modified).toBe(false);
        editor.history.redo();
        expect(editor.document.modified).toBe(true);
        editor.document.saved(id, part);
        expect(editor.document.modified).toBe(false);

        editor.history.undo();
        expect(editor.document.modified).toBe(true);
    });

    test("restored unsaved changes stay unsaved until saved", async () => {
        await makeBox(1);
        editor.document.reset(id, part, true);
        expect(editor.document.modified).toBe(true);
        editor.document.saved(id, part);
        expect(editor.document.modified).toBe(false);
    });

    test("changes are announced once", async () => {
        const changed = jest.fn();
        editor.signals.documentChanged.add(changed);
        editor.document.reset(id, part, false);
        expect(changed).toHaveBeenCalledTimes(1);
        await edit(1);
        await edit(2);
        expect(changed).toHaveBeenCalledTimes(2);
        expect(changed).toHaveBeenLastCalledWith({ id, file: part, modified: true, autosaved: false });
    });
});
