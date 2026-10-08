import { Dialogs, FileRef, Files, FileType, Locks, MessageBoxOptions, OpenedFile, Platform, Session, Store } from '../src/platform/Platform';

// A disk of named files. With handles, it saves back to a file without asking, like Chromium; without, every save
// downloads, under the name the app suggests.
export class FakeFiles implements Files {
    readonly disk = new Map<string, Uint8Array>();
    // What the next pickers answer: a name, or undefined to cancel
    toSave?: string;
    toOpen: string[] = [];

    constructor(readonly handles = true) { }

    get savesInPlace() { return this.handles }

    async open(types: readonly FileType[], multiple: boolean): Promise<OpenedFile[]> {
        return this.toOpen.map(name => ({ name, bytes: this.disk.get(name)!, handle: this.handle(name) }));
    }

    // The user lets it be edited, unless the test says otherwise
    allowed = true;

    async read(handle: FileSystemFileHandle): Promise<OpenedFile | undefined> {
        if (!this.allowed) return undefined;
        const bytes = this.disk.get(handle.name);
        if (bytes === undefined) throw new Error(`${handle.name} is gone`);
        return { name: handle.name, bytes, handle };
    }

    async save(data: Promise<Blob>, suggestedName: string, type: FileType, existing?: FileSystemFileHandle): Promise<FileRef | undefined> {
        const name = this.handles ? existing?.name ?? this.toSave : suggestedName;
        if (name === undefined) return undefined;
        await this.write(name, await read(await data));
        return { name, handle: this.handle(name) };
    }

    // Where a test can make writing fail
    async write(name: string, bytes: Uint8Array) {
        this.disk.set(name, bytes);
    }

    private handle(name: string): FileSystemFileHandle | undefined {
        if (!this.handles) return undefined;
        const { disk } = this;
        return {
            kind: 'file', name,
            async getFile() { return new File([disk.get(name)!], name) },
            async isSameEntry(other: FileSystemHandle) { return other.name === name },
        };
    }
}

// jsdom's Blob has no arrayBuffer()
function read(blob: Blob): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
}

// Answers with the cancel button, unless a test says otherwise; a text field keeps its text, unless a test types some
export class FakeDialogs implements Dialogs {
    readonly shown: MessageBoxOptions[] = [];
    answer?: number;
    // Answers for the next boxes, before `answer`
    readonly answers: number[] = [];
    typed?: string;

    async showMessageBox(options: MessageBoxOptions) {
        this.shown.push(options);
        const response = this.answers.shift() ?? this.answer ?? options.cancelId ?? (options.buttons ?? ['OK']).length - 1;
        return options.input === undefined ? { response } : { response, input: this.typed ?? options.input };
    }
}

// Copies values in and out, as IndexedDB does
export class MemoryStore implements Store {
    readonly items = new Map<string, unknown>();

    async get<T>(key: string) { return copy(this.items.get(key)) as T | undefined }
    async setMany(entries: [string, unknown][]) { for (const [key, value] of entries) this.items.set(key, copy(value)) }
    async delMany(keys: string[]) { for (const key of keys) this.items.delete(key) }
    async keys() { return [...this.items.keys()] }
}

// Like a structured clone, except that file handles stay themselves
function copy(value: unknown): unknown {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (Array.isArray(value)) return value.map(copy);
    if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && !('getFile' in value)) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)]));
    }
    return value;
}

export class MemorySession implements Session {
    private value?: string;
    get() { return this.value === undefined ? undefined : JSON.parse(this.value) }
    set(value: unknown) { this.value = JSON.stringify(value) }
}

// The locks of one tab, among the browser's
export class FakeLocks implements Locks {
    private readonly mine = new Set<string>();

    constructor(readonly browser = new Set<string>()) { }

    async acquire(name: string) {
        if (this.mine.has(name)) return true;
        if (this.browser.has(name)) return false;
        this.mine.add(name);
        this.browser.add(name);
        return true;
    }

    release(name: string) {
        if (!this.mine.delete(name)) return;
        this.browser.delete(name);
    }

    async held() { return [...this.browser] }

    // When the tab goes, or reloads
    releaseAll() {
        for (const name of this.mine) this.browser.delete(name);
        this.mine.clear();
    }
}

// The tabs of one browser: they share the files, storage and locks; each has its own session
export class FakePlatform implements Platform {
    readonly dialogs = new FakeDialogs();
    readonly reload = jest.fn();
    readonly persist = jest.fn(async () => true);
    readonly locks: FakeLocks;

    constructor(
        readonly files = new FakeFiles(),
        readonly autosaves = new MemoryStore(),
        readonly recent = new MemoryStore(),
        readonly session = new MemorySession(),
        browserLocks = new Set<string>(),
    ) {
        this.locks = new FakeLocks(browserLocks);
    }

    // Another tab in the same browser
    tab() {
        return new FakePlatform(this.files, this.autosaves, this.recent, new MemorySession(), this.locks.browser);
    }

    // This tab after a reload: the same session, and the locks it held are let go
    reloaded() {
        this.locks.releaseAll();
        return new FakePlatform(this.files, this.autosaves, this.recent, this.session, this.locks.browser);
    }

    // A tab the browser made as a copy of this one, which copies its session
    duplicated() {
        const session = new MemorySession();
        session.set(this.session.get());
        return new FakePlatform(this.files, this.autosaves, this.recent, session, this.locks.browser);
    }
}
