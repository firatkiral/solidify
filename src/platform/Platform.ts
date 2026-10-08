// What the app needs from where it runs: the user's files, dialogs, and storage that outlives the page.
// The editor sees only names, bytes and handles, never paths; BrowserPlatform is the real one.

export interface FileType {
    readonly description: string;
    // With the dot, like '.solidify'
    readonly extensions: readonly string[];
    readonly mimeTypes: readonly string[];
}

// A file on the user's disk. The handle, which only some browsers give, lets the app write it again without asking.
export interface FileRef {
    readonly name: string;
    readonly handle?: FileSystemFileHandle;
}

export interface OpenedFile extends FileRef {
    readonly bytes: Uint8Array;
}

export interface Files {
    // Whether the browser writes to files on the user's disk; elsewhere saving downloads a new file each time,
    // and the browser doesn't tell the app the name the user gave it
    readonly savesInPlace: boolean;

    // The files the user picks; none if they cancel
    open(types: readonly FileType[], multiple: boolean): Promise<OpenedFile[]>;

    // Reads a file the app has a handle to, asking the user to let it be edited again if the browser needs to;
    // undefined if they don't
    read(handle: FileSystemFileHandle): Promise<OpenedFile | undefined>;

    // Writes the data to `existing` when the browser can, asking the user to let it be edited again if the browser
    // needs to, otherwise to a file the user picks (or downloads); undefined if they cancel or don't let it be edited. The data can still be in the making: the browser only shows its picker
    // right after the click that asked for it, so the picker opens first.
    save(data: Promise<Blob>, suggestedName: string, type: FileType, existing?: FileSystemFileHandle): Promise<FileRef | undefined>;
}

export interface MessageBoxOptions {
    readonly type: 'info' | 'warning' | 'error';
    readonly message: string;
    readonly detail?: string;
    // Defaults to just OK
    readonly buttons?: readonly string[];
    // The button Enter chooses
    readonly defaultId?: number;
    // The button Escape chooses
    readonly cancelId?: number;
    // A text field, filled in with this; Enter in it chooses the default button
    readonly input?: string;
}

export interface Dialogs {
    // Resolves with the index of the button chosen, and the text field's text if there is one
    showMessageBox(options: MessageBoxOptions): Promise<{ response: number, input?: string }>;
}

// Keys and values kept after the browser closes, until the user clears the site's data or the browser needs the space
export interface Store {
    get<T>(key: string): Promise<T | undefined>;
    // All or none of them
    setMany(entries: [string, unknown][]): Promise<void>;
    delMany(keys: string[]): Promise<void>;
    keys(): Promise<string[]>;
}

// Kept while the tab is open, across reloads
export interface Session {
    get(): unknown;
    set(value: unknown): void;
}

// Locks shared by the browser's tabs: which documents are open, so one isn't open in two tabs at once,
// and its autosave isn't offered or removed while it's open
export interface Locks {
    // Holds the lock until it's released, or the tab goes; false, holding nothing, when another tab holds it
    acquire(name: string): Promise<boolean>;
    release(name: string): void;
    // The locks held by any tab
    held(): Promise<string[]>;
}

export interface Platform {
    readonly files: Files;
    readonly dialogs: Dialogs;
    readonly autosaves: Store;
    readonly recent: Store;
    readonly session: Session;
    readonly locks: Locks;
    // Asks the browser to keep the site's storage rather than clear it when space runs low; whether it will
    persist(): Promise<boolean>;
    // Starts the page over
    reload(): void;
}
