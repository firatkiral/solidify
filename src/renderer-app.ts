import * as THREE from 'three';
import c3d from '../build/Release/c3d.node';
import '../lib/c3d/enums';
import * as cmd from './commands/GeometryCommands';
import Clipboard from './components/clipboard/Clipboard';
import Creators from './components/creators/Creators';
import Dialog from './components/dialog/Dialog';
import NumberScrubber from './components/dialog/NumberScrubber';
import Prompt from './components/dialog/Prompt';
import Menu from './components/menu/Menu';
import Outliner from './components/outliner/Outliner';
import './components/pane/Pane';
import Planes from './components/planes/Planes';
import Home from './components/home/Home';
import UpdateNotice from './components/update/UpdateNotice';
import Settings from './components/settings/Settings';
import Snaps from './components/snaps/Snaps';
import Stats from './components/stats/Stats';
import TitleBar from './components/title-bar/TitleBar';
import Icon from './components/toolbar/Icon';
import registerDefaultCommands from './components/toolbar/icons';
import Palette from './components/toolbar/Palette';
import Toolbar from './components/toolbar/Toolbar';
import Tooltip from './components/tooltip/Tooltip';
import UndoHistory from './components/undo-history/UndoHistory';
import Keybindings from './components/viewport/Keybindings';
import SnapOverlay from './components/viewport/SnapOverlay';
import Viewport from './components/viewport/Viewport';
import ViewportHeader from './components/viewport/ViewportHeader';
import './css/index.css';
import { Editor } from './editor/Editor';
import { isDocument, isImportable } from './editor/ImporterExporter';
import { OpenedFile } from './platform/Platform';
import { SnapManager } from './editor/snaps/SnapManager';
import { ConfigFiles } from './startup/ConfigFiles';


ConfigFiles.loadTheme();
ConfigFiles.loadSettings();

export const editor = new Editor();

// Every snap starts off when the app launches (grid and handle steps already do); the snaps panel or holding Shift/Ctrl turns them on.
for (const layer of SnapManager.objectLayers) editor.snaps.layers.disable(layer);

Object.defineProperty(window, 'editor', {
    value: editor,
    writable: false
}); // Make available to debug console

Object.defineProperty(window, 'THREE', {
    value: THREE,
    writable: false,
})

Object.defineProperty(window, 'cmd', {
    value: cmd,
    writable: false,
})

ConfigFiles.loadKeymap(editor.keymaps);

registerDefaultCommands(editor);

Icon(editor);
TitleBar(editor);
Toolbar(editor);
Keybindings(editor);
Palette(editor);
Viewport(editor);
Creators(editor);
NumberScrubber(editor);
Dialog(editor);
ViewportHeader(editor);
SnapOverlay(editor);
Prompt(editor);
Outliner(editor);
UndoHistory(editor);
Tooltip(editor);
Stats(editor);
Snaps(editor);
Planes(editor);
Clipboard(editor);
Menu(editor);
Settings(editor);
Home(editor);
UpdateNotice(editor);

// Files dropped on the app, or opened with it from the desktop, open or are imported; only the ones it can use are read
const usable = (name: string) => isDocument(name) || isImportable(name);
const read = async (file: File, handle?: FileSystemFileHandle): Promise<OpenedFile> =>
    ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle });

// A new tab starts at the start screen; a reload goes back to the document it had
editor.start().then(restored => {
    if (!restored) document.body.dispatchEvent(new CustomEvent('app:home'));
    // Chromium gives the installed app the files it was opened with, with handles to save back to
    window.launchQueue?.setConsumer(async ({ files }) => {
        try {
            const handles = files.filter((h): h is FileSystemFileHandle => h.kind === 'file' && usable(h.name));
            editor.openOrImport(await Promise.all(handles.map(async handle => read(await handle.getFile(), handle))));
        } catch (e) {
            console.error("The files the app was opened with could not be read", e);
        }
    });
});

// Only file drags are drops onto the app; anything else (like text dragged out of a field) is refused.
const hasFiles = (e: DragEvent) => e.dataTransfer !== null && e.dataTransfer.types.includes('Files');

document.addEventListener('drop', async e => {
    e.preventDefault();
    if (!hasFiles(e)) return;
    const { files, items } = e.dataTransfer!;
    // Chromium gives handles to save back to; they have to be asked for before the drop event ends
    const handles = Array.from(items).filter(item => item.kind === 'file').map(item => item.getAsFileSystemHandle?.().catch(() => null));
    const dropped = await Promise.all(Array.from(files).map(async (file, i) => {
        if (!usable(file.name)) return undefined;
        const handle = await handles[i];
        return read(file, handle?.kind === 'file' ? handle as FileSystemFileHandle : undefined);
    }));
    editor.openOrImport(dropped.filter((file): file is OpenedFile => file !== undefined));
});

document.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
});
