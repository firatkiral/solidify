import { fileOpen, fileSave, FileWithHandle, supported } from 'browser-fs-access';
import { createStore, delMany, get, keys, setMany, UseStore } from 'idb-keyval';
import { showMessageBox } from './MessageBox';
import { FileRef, Files, FileType, Locks, OpenedFile, Platform, Session, Store } from './Platform';

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

const options = ({ description, extensions, mimeTypes }: FileType) =>
    ({ description, extensions: [...extensions], mimeTypes: [...mimeTypes] });

// After a reload the browser can need the user's leave again before the app edits a file; whether it has it
async function allowEditing(handle: FileSystemFileHandle): Promise<boolean> {
    const mode = { mode: 'readwrite' as const };
    if (handle.queryPermission === undefined || await handle.queryPermission(mode) === 'granted') return true;
    return await handle.requestPermission!(mode) === 'granted';
}

// Chromium's file pickers, which give handles to save back to; elsewhere a file input to open, and downloads to save
class BrowserFiles implements Files {
    readonly savesInPlace = supported;

    async open(types: readonly FileType[], multiple: boolean): Promise<OpenedFile[]> {
        let files: FileWithHandle[];
        try {
            const [first, ...rest] = types.map(options);
            const result: FileWithHandle | FileWithHandle[] = await fileOpen<boolean>([{ ...first, multiple }, ...rest]);
            files = Array.isArray(result) ? result : [result];
        } catch (e) {
            if (isAbort(e)) return [];
            throw e;
        }
        return Promise.all(files.map(async file =>
            ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle: file.handle })));
    }

    async read(handle: FileSystemFileHandle): Promise<OpenedFile | undefined> {
        // Asked for editing now, so saving back later doesn't ask again
        if (!await allowEditing(handle)) return undefined;
        const file = await handle.getFile();
        return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle };
    }

    async save(data: Promise<Blob>, suggestedName: string, type: FileType, existing?: FileSystemFileHandle): Promise<FileRef | undefined> {
        try {
            // Without leave to edit it, the library would quietly open the picker, as if for Save As
            if (existing !== undefined && !await allowEditing(existing)) return undefined;
            const handle = await fileSave(data, { fileName: suggestedName, ...options(type) }, existing ?? null);
            // Without a handle, the browser downloaded it, under the suggested name unless the user changed it
            return handle === null ? { name: suggestedName } : { name: handle.name, handle };
        } catch (e) {
            if (isAbort(e)) return undefined;
            throw e;
        }
    }
}

// Each store is its own database, as idb-keyval needs
class IndexedDbStore implements Store {
    private _store?: UseStore;
    // Opened on first use, so making one touches nothing
    private get store() { return this._store ??= createStore(this.name, this.name) }

    constructor(private readonly name: string) { }

    get<T>(key: string) { return get<T>(key, this.store) }
    setMany(entries: [string, unknown][]) { return setMany(entries, this.store) }
    delMany(keys: string[]) { return delMany(keys, this.store) }
    async keys() { return (await keys(this.store)).map(String) }
}

class TabSession implements Session {
    private readonly key = 'solidify:session';

    get(): unknown {
        try {
            const value = sessionStorage.getItem(this.key);
            return value === null ? undefined : JSON.parse(value);
        } catch (e) {
            return undefined;
        }
    }

    set(value: unknown) {
        try {
            sessionStorage.setItem(this.key, JSON.stringify(value));
        } catch (e) {
            console.warn("The session could not be kept", e);
        }
    }
}

// The Web Locks API; where a browser lacks it, this tab is the only one it knows of
class TabLocks implements Locks {
    private readonly prefix = 'solidify:';
    private readonly releases = new Map<string, () => void>();

    async acquire(name: string): Promise<boolean> {
        if (this.releases.has(name)) return true;
        const { locks } = navigator;
        if (locks === undefined) {
            this.releases.set(name, () => { });
            return true;
        }
        return new Promise<boolean>(resolve => {
            locks.request(this.prefix + name, { ifAvailable: true }, lock => {
                if (lock === null) return resolve(false);
                // Held until this promise resolves
                return new Promise<void>(release => {
                    this.releases.set(name, release);
                    resolve(true);
                });
            });
        });
    }

    release(name: string) {
        this.releases.get(name)?.();
        this.releases.delete(name);
    }

    async held(): Promise<string[]> {
        const { locks } = navigator;
        if (locks === undefined) return [...this.releases.keys()];
        const { held = [] } = await locks.query();
        return held.map(lock => lock.name ?? '').filter(name => name.startsWith(this.prefix)).map(name => name.slice(this.prefix.length));
    }
}

export class BrowserPlatform implements Platform {
    readonly files = new BrowserFiles();
    readonly dialogs = { showMessageBox };
    readonly autosaves = new IndexedDbStore('solidify-autosaves');
    readonly recent = new IndexedDbStore('solidify-recent');
    readonly session = new TabSession();
    readonly locks = new TabLocks();

    async persist() {
        const { storage } = navigator;
        if (storage === undefined) return false;
        if (await storage.persisted()) return true;
        return storage.persist();
    }

    reload() { location.reload() }
}
