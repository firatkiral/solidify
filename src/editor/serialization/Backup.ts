import { Locks, Store } from '../../platform/Platform';
import { CurrentDocument, DocumentState, newDocumentId } from '../CurrentDocument';
import { EditorSignals } from "../EditorSignals";
import { EditorOriginator } from "../History";
import { SolidifyDocument } from './SolidifyDocument';
import { readSolidifyFile, writeSolidifyFile } from './SolidifyFile';

// A document's autosave, overwritten in place
export interface Slot {
    // The document's id
    readonly id: string;
    // The name of its file; none while it was untitled
    readonly name?: string;
    // When it was last written, in ms since the epoch
    readonly time: number;
    // Whether it holds changes that aren't in its file
    readonly modified: boolean;
    // How it looked when it was written, if there was a view to draw it
    readonly thumbnail?: Uint8Array;
}

interface SlotInfo {
    name?: string;
    time: number;
    modified: boolean;
    thumbnail?: Uint8Array;
}

// Autosaves are kept in the browser, which may clear them; they're for getting work back, not for keeping it.
// Each tab holds the lock of the document it has open, and an open document's autosave is neither offered nor pruned.
export class Backup {
    // Off until the startup load settles, so an empty scene can't overwrite an autosave that hasn't been read yet.
    private enabled = false;
    // Set when an unreadable autosave couldn't be moved aside; autosave stays off rather than overwrite it.
    private broken = false;
    private pending = false;
    private saving?: Promise<void>;
    // The history revision last written
    private revision?: number;
    // The document whose lock this tab holds
    private claimed?: string;

    constructor(
        private readonly store: Store,
        private readonly locks: Locks,
        private readonly originator: EditorOriginator,
        private readonly document: CurrentDocument,
        private readonly signals: EditorSignals,
        private readonly keep: () => number,
        private readonly thumbnail: () => Promise<Uint8Array | undefined>,
    ) {
        // The selection isn't kept, so selecting, and undoing or redoing a selection, writes nothing: writing a large
        // document takes seconds, which every click would wait for
        signals.commandFinishedSuccessfully.add(command => { if (command.changesDocument) this.save() });
        signals.historyChanged.add(() => { if (document.revision !== this.revision) this.save() });
    }

    private dataKey(id: string) { return `${id}.solidify` }
    private infoKey(id: string) { return `${id}.json` }

    // Takes the document's lock and lets go of the one held before; false, changing nothing, when it's open in another tab
    async claim(id: string): Promise<boolean> {
        if (id === this.claimed) return true;
        if (!await this.locks.acquire(id)) return false;
        if (this.claimed !== undefined) this.locks.release(this.claimed);
        this.claimed = id;
        return true;
    }

    // Only one write is ever in flight; requests made meanwhile collapse into one more write after it.
    save(): Promise<void> {
        this.pending = true;
        if (!this.enabled) return Promise.resolve();
        if (this.saving === undefined) this.saving = this.drain();
        return this.saving;
    }

    private async drain() {
        try {
            while (this.pending && this.enabled) {
                this.pending = false;
                try {
                    await this.write();
                } catch (e) {
                    console.warn("Autosave failed; the previous one is kept", e);
                }
            }
        } finally {
            this.saving = undefined;
        }
    }

    // Lets the writes requested so far finish, then holds new ones until resume(), e.g. while another document loads.
    async pause() {
        await this.saving;
        this.enabled = false;
        await this.saving;
    }

    // Writes nothing itself; a save() after it writes once for everything asked meanwhile.
    resume() {
        this.enabled = !this.broken;
    }

    private async write() {
        const { document, store } = this;
        const { id, file, modified } = document;
        this.revision = document.revision;
        const isNew = await store.get(this.infoKey(id)) === undefined;
        // An empty untitled document has nothing worth an autosave, and mustn't take the untitled one from another
        if (file === undefined && isNew && document.isEmpty()) return;

        // Drawn now, so it shows what's written
        const thumbnail = this.thumbnail();
        const { json, geometry, images, meshes } = await new SolidifyDocument(this.originator).serialize();
        const data = writeSolidifyFile({ id, json, geometry, images, meshes }, false);
        const info: SlotInfo = { name: file?.name, time: Date.now(), modified, thumbnail: await thumbnail };
        // Together, so an autosave never has another's details
        await store.setMany([[this.dataKey(id), data], [this.infoKey(id), info]]);
        document.autosaved = true;
        if (isNew) await this.prune();
    }

    // One untitled autosave is kept, the newest, even if its document is open: the tab that last changed its
    // untitled document has it. Of documents with a file that aren't open, the newest are kept, up to the setting.
    private async prune() {
        const open = new Set(await this.locks.held());
        const slots = await this.slots();
        const untitled = slots.filter(s => s.name === undefined).slice(1);
        const saved = slots.filter(s => s.name !== undefined && !open.has(s.id)).slice(this.keep());
        for (const slot of [...untitled, ...saved]) await this.remove(slot.id);
    }

    // What File › Restore offers: the untitled autosave, and the newest of documents with a file, up to the setting;
    // none whose document is open in a tab
    async restorable(): Promise<Slot[]> {
        const open = new Set(await this.locks.held());
        const slots = await this.slots();
        const untitled = slots.filter(s => s.name === undefined).slice(0, 1);
        const saved = slots.filter(s => s.name !== undefined && !open.has(s.id)).slice(0, this.keep());
        return [...untitled, ...saved].filter(s => !open.has(s.id)).sort((a, b) => b.time - a.time);
    }

    // Every autosave, newest first
    async slots(): Promise<Slot[]> {
        const keys = new Set(await this.store.keys());
        const result: Slot[] = [];
        for (const key of keys) {
            const match = /^([\w-]+)\.json$/.exec(key);
            if (match === null) continue;
            const id = match[1];
            if (!keys.has(this.dataKey(id))) continue;
            const info = await this.store.get<SlotInfo>(key);
            if (info === undefined || (info.name !== undefined && typeof info.name !== 'string')) {
                console.warn(`Autosave ${id} has unreadable details`);
                continue;
            }
            const thumbnail = info.thumbnail instanceof Uint8Array ? info.thumbnail : undefined;
            result.push({ id, name: info.name, time: Number(info.time) || 0, modified: info.modified === true, thumbnail });
        }
        return result.sort((a, b) => b.time - a.time);
    }

    // Loads an autosave into the (empty) scene; throws if it can't be read.
    async load(id: string) {
        const data = await this.store.get<Uint8Array>(this.dataKey(id));
        if (data === undefined) throw new Error(`Autosave ${id} is gone`);
        const { json, geometry, images, meshes } = readSolidifyFile(data);
        await SolidifyDocument.load(json, geometry, images, this.originator, meshes);
        this.originator.debug();
        this.originator.validate();
    }

    // Startup: a reload brings back the document the tab had; a new tab starts with an empty one, as does a tab
    // copied from another, which still has it open, and a tab whose untitled document another tab's took the
    // autosave from. Returns whether a document was brought back.
    async start(session: Partial<DocumentState>): Promise<boolean> {
        let restored = false;
        const { id, file } = session;
        if (session.autosaved === true && id !== undefined && await this.has(id) && await this.claim(id)) {
            try {
                await this.load(id);
                this.document.reset(id, file, session.modified === true);
                this.document.autosaved = true;
                restored = true;
            } catch (e) {
                console.warn("Autosave could not be loaded", e);
                this.broken = !await this.quarantine(id);
                // Drop whatever part of it was applied, so it isn't autosaved as if it were whole.
                this.originator.clear();
                this.document.reset(newDocumentId(), undefined, false);
            }
            this.signals.backupLoaded.dispatch();
        }
        await this.claim(this.document.id);
        // Earlier versions kept an untitled autosave for every document
        try {
            await this.prune();
        } catch (e) {
            console.warn("Old autosaves could not be cleared", e);
        }
        this.resume();
        if (this.pending) await this.save();
        return restored;
    }

    private async has(id: string) {
        return (await this.store.keys()).includes(this.dataKey(id));
    }

    private async remove(id: string) {
        await this.store.delMany([this.dataKey(id), this.infoKey(id)]);
    }

    // Moves an unreadable autosave aside so it's neither offered nor overwritten. Returns whether that worked.
    async quarantine(id: string) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const corrupt = `${id}.corrupt-${stamp}.solidify`;
        try {
            const data = await this.store.get(this.dataKey(id));
            await this.store.setMany([[corrupt, data]]);
            await this.remove(id);
        } catch (e) {
            console.warn(`Unreadable autosave could not be moved aside`, e);
            return false;
        }
        console.warn(`Unreadable autosave moved to ${corrupt}`);
        return true;
    }
}
