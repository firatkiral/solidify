import KeymapManager from "atom-keymap-solidify";
import { CompositeDisposable, Disposable } from "event-kit";
import * as THREE from "three";
import Command from '../command/Command';
import { CommandExecutor } from "../command/CommandExecutor";
import { GizmoMaterialDatabase } from "../command/GizmoMaterials";
import { SelectionCommandManager } from "../command/SelectionCommandManager";
import { ExportCommand, ImportCommand } from "../commands/CommandLike";
import CommandRegistry from "../components/atom/CommandRegistry";
import TooltipManager from "../components/atom/tooltip-manager";
import {Outliner} from "../components/outliner/Outliner";
import KeyboardEventManager from "../components/viewport/KeyboardEventManager";
import { Viewport } from "../components/viewport/Viewport";
import { ChangeSelectionExecutor } from "../selection/ChangeSelectionExecutor";
import { SelectionCommandRegistrar } from "../selection/CommandRegistrar";
import { SelectionDatabase } from "../selection/SelectionDatabase";
import { ConfigFiles, OrbitMode } from "../startup/ConfigFiles";
import defaultSettings from '../startup/default-settings';
import defaultTheme from '../startup/default-theme.json';
import { Z } from "../util/Constants";
import { Helpers } from "../util/Helpers";
import { RenderedSceneBuilder } from "../visual_model/RenderedSceneBuilder";
import { Clipboard } from "./Clipboard";
import ContourManager from "./curves/ContourManager";
import { CrossPointDatabase } from "./curves/CrossPointDatabase";
import { PlanarCurveDatabase } from "./curves/PlanarCurveDatabase";
import { RegionManager } from "./curves/RegionManager";
import { CurrentDocument, DocumentState, newDocumentId } from "./CurrentDocument";
import { DatabaseLike } from "./DatabaseLike";
import { EditorSignals } from "./EditorSignals";
import { Empties } from "./Empties";
import { GeometryDatabase } from "./GeometryDatabase";
import { EditorOriginator, History } from "./History";
import { Images } from "./Images";
import { Meshes } from "./Meshes";
import { importFiles, ImporterExporter, isDocument, isImportable, solidifyFile } from "./ImporterExporter";
import LayerManager from "./LayerManager";
import { BasicMaterialDatabase } from "./MaterialDatabase";
import { DoCacheMeshCreator, ParallelMeshCreator } from "./MeshCreator";
import { PlaneDatabase } from "./PlaneDatabase";
import { RecentDocument, RecentDocuments } from "./RecentDocuments";
import { Scene } from "./Scene";
import { BrowserPlatform } from "../platform/BrowserPlatform";
import { FileRef, OpenedFile, Platform } from "../platform/Platform";
import { Backup, Slot } from "./serialization/Backup";
import { SolidifyFileContents } from "./serialization/SolidifyFile";
import { SnapManager } from './snaps/SnapManager';
import { SolidCopier } from "./SolidCopier";
import { TextureLoader } from "./TextureLoader";

THREE.Object3D.DefaultUp = Z;

const withExtension = (name: string) => /\.solidify$/i.test(name) ? name : `${name}.solidify`;

export class Editor {
    private readonly disposable = new CompositeDisposable();
    dispose() { this.disposable.dispose() }

    readonly textures = new TextureLoader();
    readonly viewports: Set<Viewport> = new Set();
    readonly outliners: Set<Outliner> = new Set();

    readonly signals = new EditorSignals();
    readonly registry = new CommandRegistry();
    readonly materials = new BasicMaterialDatabase(this.signals);
    readonly gizmos = new GizmoMaterialDatabase(this.signals, this.styles);
    readonly copier = new SolidCopier();
    readonly meshCreator = new DoCacheMeshCreator(new ParallelMeshCreator(), this.copier);
    readonly _db = new GeometryDatabase(this.meshCreator, this.copier, this.materials, this.signals);

    readonly curves = new PlanarCurveDatabase(this._db);
    readonly regions = new RegionManager(this._db, this.curves);
    readonly contours = new ContourManager(this._db, this.curves, this.regions, this.signals);
    readonly db = this.contours as DatabaseLike;
    readonly images = new Images();
    readonly meshes = new Meshes();
    readonly empties = new Empties(this.images, this.signals, this.meshes);
    readonly scene = new Scene(this._db, this.empties, this.materials, this.signals);

    readonly selection = new SelectionDatabase(this._db, this.scene, this.materials, this.signals);

    readonly registrar = new SelectionCommandRegistrar(this);

    readonly crosses = new CrossPointDatabase();
    readonly snaps = new SnapManager(this.db, this.scene, this.crosses, this.signals);
    readonly keymaps = new KeymapManager();
    readonly tooltips = new TooltipManager({ keymapManager: this.keymaps, viewRegistry: null });
    readonly layers = new LayerManager(this.selection.selected, this.signals);
    readonly helpers: Helpers = new Helpers(this.signals, this.styles);
    readonly changeSelection = new ChangeSelectionExecutor(this.selection, this.db, this.scene, this.signals);
    readonly commandForSelection = new SelectionCommandManager(this);
    readonly originator = new EditorOriginator(this._db, this.empties, this.scene, this.materials, this.selection.selected, this.snaps, this.crosses, this.curves, this.contours, this.viewports, this.images, this.meshes);
    readonly history = new History(this.originator, this.signals);
    readonly executor = new CommandExecutor(this);
    readonly keyboard = new KeyboardEventManager(this.keymaps);
    readonly document = new CurrentDocument(this.history, this.signals, () => this._db.items.length === 0 && this.empties.items.length === 0);
    readonly backup = new Backup(this.platform.autosaves, this.platform.locks, this.originator, this.document, this.signals, () => this.settings.Autosave.keep);
    readonly recent = new RecentDocuments(this.platform.recent);
    readonly highlighter = new RenderedSceneBuilder(this.db, this.scene, this.textures, this.selection, this.styles, this.signals);
    readonly importer = new ImporterExporter(this.originator, this._db, this.empties, this.scene, this.images, this.contours, this.signals, this.meshes);
    readonly planes = new PlaneDatabase(this.signals);
    readonly clipboard = new Clipboard(this);

    windowLoaded = false;

    constructor(readonly platform: Platform = new BrowserPlatform(), readonly settings = defaultSettings, readonly styles = defaultTheme) {
        window.addEventListener('resize', this.onWindowResize, false);
        window.addEventListener('load', this.onWindowLoad, false);

        this.signals.viewportActivated.add(this.onViewportActivated);

        this.disposable.add(new Disposable(() => window.removeEventListener('resize', this.onWindowResize)));
        this.disposable.add(new Disposable(() => window.removeEventListener('load', this.onWindowLoad)));

        this.registry.attach(window);
        this.keymaps.defaultTarget = document.body;

        this.registerCommands();
    }

    async enqueue(command: Command, interrupt?: boolean) {
        await this.executor.enqueue(command, interrupt);
    }

    onWindowResize = () => {
        this.signals.windowResized.dispatch();
    }

    onWindowLoad = () => {
        this.windowLoaded = true;
        this.signals.windowLoaded.dispatch();
    }

    private _activeViewport?: Viewport;
    get activeViewport() { return this._activeViewport ?? [...this.viewports][0] }
    onViewportActivated = (v: Viewport) => {
        this._activeViewport = v;
    }

    // Brings back the document this tab had before a reload; a new tab starts with an empty one.
    // Returns whether a document was brought back.
    async start(): Promise<boolean> {
        const { platform } = this;
        this.signals.documentChanged.add(state => platform.session.set(state));
        window.addEventListener('beforeunload', this.onBeforeUnload);
        this.disposable.add(new Disposable(() => window.removeEventListener('beforeunload', this.onBeforeUnload)));
        const session = platform.session.get() as Partial<DocumentState> | undefined;
        const restored = await this.backup.start(session ?? {});
        await this.reconnect();
        platform.session.set(this.document.state);
        return restored;
    }

    // Set when the page is about to go away on purpose, having asked already
    private leaving = false;

    // The browser asks before closing the tab or leaving with unsaved changes; it can't offer to save them,
    // but they stay in File › Restore
    private onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (this.leaving || !this.document.modified) return;
        e.preventDefault();
        e.returnValue = '';
    }

    // Starts the page over, bringing the document back from its autosave
    async reload() {
        await this.backup.save();
        this.leaving = true;
        this.platform.reload();
    }

    // Asks to save unsaved changes first. Returns whether to go on.
    async confirmDiscard(): Promise<boolean> {
        if (!this.document.modified) return true;
        const [save, dont] = this.platform.files.savesInPlace ? ['Save', 'save'] : ['Download', 'download'];
        const { response } = await this.platform.dialogs.showMessageBox({
            type: 'warning',
            message: `${save} changes to “${this.document.name}”?`,
            detail: `If you don't ${dont}, the changes stay in File › Restore until they're replaced.`,
            buttons: [save, `Don't ${save}`, 'Cancel'],
            defaultId: 0,
            cancelId: 2,
        });
        if (response === 0) return this.save();
        return response === 1;
    }

    async newDocument() {
        if (!await this.confirmDiscard()) return;
        // The reload starts an empty document; this one's autosave stays, in File › Restore
        await this.backup.pause();
        this.platform.session.set({});
        this.leaving = true;
        this.platform.reload();
    }

    async open(file?: OpenedFile) {
        if (!await this.confirmDiscard()) return;
        if (file === undefined) {
            [file] = await this.platform.files.open([solidifyFile], false);
            if (file === undefined) return;
        }
        await this.load(file);
    }

    // Opens a document from before: from its file, where the browser lets the app read it again, otherwise from its autosave
    async openRecent(recent: RecentDocument) {
        if (!await this.confirmDiscard()) return;
        if (recent.handle !== undefined) {
            let file: OpenedFile | undefined;
            try {
                file = await this.platform.files.read(recent.handle);
            } catch (e) {
                this.showError(`“${recent.name}” could not be opened.`, e);
                return;
            }
            if (file !== undefined) await this.load(file);
            return;
        }
        const slot = (await this.backup.slots()).find(s => s.id === recent.id);
        if (slot === undefined) {
            await this.platform.dialogs.showMessageBox({
                type: 'info',
                message: `“${recent.name}” has to be opened from its file.`,
                detail: "This browser doesn't let the app open files again by itself. Use File › Open…",
            });
            return;
        }
        await this.restoreSlot(slot, recent.name);
    }

    async restore(slot: Slot) {
        if (!await this.confirmDiscard()) return;
        await this.restoreSlot(slot);
    }

    // Loads a .solidify file in place of the open document
    private async load(file: OpenedFile) {
        const { name, bytes, handle } = file;
        let contents: SolidifyFileContents;
        try {
            contents = this.importer.read(bytes);
        } catch (e) {
            this.showError(`“${name}” could not be opened.`, e);
            return;
        }
        // Files from this app have an id; another gets one of its own
        const id = contents.id ?? newDocumentId();
        if (!await this.claim(id, name)) return;
        try {
            await this.replaceDocument(id, { name, handle }, () => this.importer.load(contents), false);
        } catch (e) {
            this.showError(`“${name}” could not be opened.`, e);
            return;
        }
        await this.remember(name, handle, contents.thumbnail);
    }

    private async restoreSlot(slot: Slot, title = slot.name ?? 'Untitled') {
        const { id, name } = slot;
        if (!await this.claim(id, title)) return;
        try {
            await this.replaceDocument(id, name === undefined ? undefined : { name }, () => this.backup.load(id), slot.modified);
        } catch (e) {
            await this.backup.quarantine(id);
            this.showError(`The autosave of “${title}” could not be restored.`, e);
            return;
        }
        await this.reconnect();
    }

    // A document is open in one tab or window at a time, so their autosaves don't overwrite each other
    private async claim(id: string, name: string): Promise<boolean> {
        if (await this.backup.claim(id)) return true;
        await this.platform.dialogs.showMessageBox({
            type: 'info',
            message: `“${name}” is open in another tab or window.`,
            detail: "A document can be open in one tab or window at a time, so their changes don't overwrite each other.",
        });
        return false;
    }

    // Loads a document, whose lock is claimed already, in place of the open one; on failure, leaves an empty
    // untitled document and rethrows.
    private async replaceDocument(id: string, file: FileRef | undefined, load: () => Promise<void>, modified: boolean) {
        this.executor.cancelActiveCommand();
        // The open document's last changes go to its autosave first, and nothing autosaves a half-loaded scene
        await this.backup.pause();
        try {
            this.originator.clear();
            await load();
            this.history.clear();
            this.document.reset(id, file, modified);
        } catch (e) {
            this.originator.clear();
            this.history.clear();
            this.document.reset(newDocumentId(), undefined, false);
            throw e;
        } finally {
            await this.backup.claim(this.document.id);
            this.signals.backupLoaded.dispatch();
            this.backup.resume();
            // So the document's autosave exists right away, even before an edit
            await this.backup.save();
        }
    }

    // A document's file handle is kept with it in the recent documents, so Save can write to the file again
    // without asking after a reload or a restore
    private async reconnect() {
        const { file, id } = this.document;
        if (file === undefined || file.handle !== undefined) return;
        try {
            const recent = await this.recent.get(id);
            if (recent?.handle !== undefined) this.document.reconnect(recent.handle);
        } catch (e) {
            console.warn("The file could not be found again", e);
        }
    }

    // Adds the document to the recent ones, and asks the browser to keep what the app stores, now that it's used to keep documents
    private async remember(name: string, handle: FileSystemFileHandle | undefined, thumbnail: Uint8Array | undefined) {
        try {
            await this.recent.add({ id: this.document.id, name, handle, thumbnail });
            await this.platform.persist();
        } catch (e) {
            console.warn("The recent documents could not be updated", e);
        }
    }

    async save(): Promise<boolean> {
        if (!this.platform.files.savesInPlace) return this.download();
        const { file, id } = this.document;
        if (file === undefined) return this.saveAs();
        return this.writeDocument(file.name, id, file.handle);
    }

    // Saving an untitled document gives it a file; saving one that has a file makes a copy, another document
    async saveAs(): Promise<boolean> {
        if (!this.platform.files.savesInPlace) return this.download();
        const { name, file, id } = this.document;
        return this.writeDocument(withExtension(name), file === undefined ? id : newDocumentId());
    }

    // Where the browser can only download, every save is a new file, so Save and Save As are one Download. The app
    // asks for the name itself, since the browser doesn't tell it the one the user gives. It stays the same document.
    async download(): Promise<boolean> {
        const { name, id } = this.document;
        const current = name.replace(/\.solidify$/i, '');
        const { response, input } = await this.platform.dialogs.showMessageBox({
            type: 'info',
            message: "Download as",
            input: current,
            buttons: ['Download', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
        });
        if (response !== 0) return false;
        return this.writeDocument(withExtension(input?.trim() || current), id);
    }

    private async writeDocument(suggestedName: string, id: string, existing?: FileSystemFileHandle): Promise<boolean> {
        // The browser shows its picker only right after the click that asked for it, so it opens while this is written
        const thumbnail = this.thumbnail();
        const data = this.importer.serialize(id, true, thumbnail).then(bytes => new Blob([bytes], { type: solidifyFile.mimeTypes[0] }));
        data.catch(() => { }); // if cancelled, nothing waits for it
        let saved: FileRef | undefined;
        try {
            saved = await this.platform.files.save(data, suggestedName, solidifyFile, existing);
        } catch (e) {
            this.showError(`“${suggestedName}” could not be saved.`, e);
            return false;
        }
        if (saved === undefined) return false;
        // A copy's id is new, so no other tab has it
        await this.backup.claim(id);
        this.document.saved(id, saved);
        // Records in the autosave that it now matches the file
        await this.backup.save();
        await this.remember(saved.name, saved.handle, await thumbnail);
        return true;
    }

    // A picture of the document for its file, the recent documents and 3MF exports; none without a view to draw it, as in the tests
    async thumbnail(): Promise<Uint8Array | undefined> {
        const viewport = this.activeViewport;
        if (viewport === undefined) return undefined;
        try {
            const canvas = viewport.snapshot(256, this.styles.colors.viewport);
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
            return blob === null ? undefined : new Uint8Array(await blob.arrayBuffer());
        } catch (e) {
            console.warn("The thumbnail could not be drawn", e);
            return undefined;
        }
    }

    private showError(message: string, error: unknown) {
        console.error(message, error);
        const detail = error instanceof Error ? error.message : String(error);
        this.platform.dialogs.showMessageBox({ type: 'error', message, detail });
    }

    async import(files?: readonly OpenedFile[]) {
        if (files === undefined) files = await this.platform.files.open(importFiles, true);
        // Importing interrupts the active command, so don't when there's nothing to import
        if (files.length === 0) return;
        const command = new ImportCommand(this);
        command.files = files;
        this.enqueue(command);
    }

    async export() {
        this.enqueue(new ExportCommand(this));
    }

    // Files given to the app from outside, dropped on it or opened with it from the desktop: a .solidify file opens in
    // place of the open document, and anything else it can import is imported into it
    async openOrImport(files: readonly OpenedFile[]) {
        const document = files.find(file => isDocument(file.name));
        if (document !== undefined) await this.open(document);
        else await this.import(files.filter(file => isImportable(file.name)));
    }

    private async undo() {
        // Undo during a drawing that isn't committed yet (like a box with its panel open) only cancels that drawing
        const cancelledDrawing = this.executor.cancelActiveCommand();
        if (!cancelledDrawing) {
            console.info("Undo");
            this.history.undo();
        }
        this.executor.enqueueDefaultCommand();
    }

    private redo() {
        this.executor.cancelActiveCommand();
        console.info("Redo");
        this.history.redo();
        this.executor.enqueueDefaultCommand();
    }

    private registerCommands() {
        const d = this.registry.add(document.body, {
            'file:new': () => this.newDocument(),
            'file:open': () => this.open(),
            'file:save': () => this.save(),
            'file:save-as': () => this.saveAs(),
            'file:import': () => this.import(),
            'file:export': () => this.export(),
            'edit:undo': () => this.undo(),
            'edit:redo': () => this.redo(),
            'edit:copy': () => this.clipboard.copy(),
            'edit:paste': () => this.clipboard.paste(),
            'edit:repeat-last-command': () => this.executor.repeatLastCommand(),
            'settings:orbit-controls:set-default': () => this.setOrbitMode('default'),
            'settings:orbit-controls:set-blender': () => this.setOrbitMode('blender'),
            'settings:orbit-controls:set-maya': () => this.setOrbitMode('maya'),
            'settings:orbit-controls:set-moi3d': () => this.setOrbitMode('moi3d'),
            'settings:orbit-controls:set-3dsmax': () => this.setOrbitMode('3dsmax'),
            'settings:orbit-controls:set-touchpad': () => this.setOrbitMode('touchpad'),
            'noop': () => { },
        });
        this.disposable.add(d);
        this.disposable.add(this.registrar.register(this.registry));
    }

    // Applies in place, without a reload
    setOrbitMode(mode: OrbitMode) {
        ConfigFiles.updateOrbitControls(mode);
        ConfigFiles.reloadUserKeymap(this.keymaps);
        for (const viewport of this.viewports) viewport.navigationControls.reloadBindings();
    }

    debug() {
        this.originator.debug();
        this.executor.debug();
    }
}
