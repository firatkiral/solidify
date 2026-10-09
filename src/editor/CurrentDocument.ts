import { FileRef } from '../platform/Platform';
import { EditorSignals } from './EditorSignals';
import { History } from './History';

// What the tab keeps for its document, so a reload can bring it back. The file's handle isn't kept here.
export interface DocumentState {
    readonly id: string;
    readonly file?: { readonly name: string };
    readonly modified: boolean;
    readonly autosaved: boolean;
}

export function newDocumentId(): string {
    // Only in secure contexts (https and localhost), and not in the tests' jsdom
    const random = typeof crypto !== 'undefined' ? (crypto as Crypto & { randomUUID?(): string }) : undefined;
    if (random?.randomUUID !== undefined) return random.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

export class CurrentDocument {
    private _id = newDocumentId();
    // Which document it is, untitled or not: kept in its file, and naming its autosave
    get id() { return this._id }

    private _file?: FileRef;
    // The file this document is saved to; none while it is untitled
    get file() { return this._file }

    // The history revision the file has; -1 when the content matches no revision, like restored unsaved changes
    private savedRevision = 0;

    private _autosaved = false;
    // Whether this document's content is in its autosave slot (written there, or loaded from it)
    get autosaved() { return this._autosaved }
    set autosaved(autosaved: boolean) {
        this._autosaved = autosaved;
        this.update();
    }

    private last: DocumentState;

    constructor(
        private readonly history: History,
        private readonly signals: EditorSignals,
        readonly isEmpty: () => boolean,
    ) {
        this.last = this.state;
        signals.historyAdded.add(this.update);
        signals.historyChanged.add(this.update);
    }

    get name() { return this._file?.name ?? 'Untitled' }

    // Changes with every change to the content, and back again with undo and redo; not with the selection
    get revision() { return this.history.revision }

    get modified() {
        // There's nothing to lose in an empty untitled document
        if (this._file === undefined && this.isEmpty()) return false;
        return this.history.revision !== this.savedRevision;
    }

    get state(): DocumentState {
        const { _file: file } = this;
        return {
            id: this._id,
            file: file === undefined ? undefined : { name: file.name },
            modified: this.modified,
            autosaved: this._autosaved,
        };
    }

    // For a document just loaded (or a new one): history starts over from here
    reset(id: string, file: FileRef | undefined, modified: boolean) {
        this._id = id;
        this._file = file;
        this.savedRevision = modified ? -1 : this.history.revision;
        this._autosaved = false;
        this.update();
    }

    // For the content just written to a file; a copy saved elsewhere is another document, with another id
    saved(id: string, file: FileRef) {
        this._id = id;
        this._file = file;
        this.savedRevision = this.history.revision;
        this.update();
    }

    // Lets the document be saved back to its file without asking, like before a reload
    reconnect(handle: FileSystemFileHandle) {
        if (this._file === undefined) return;
        this._file = { ...this._file, handle };
    }

    private update = () => {
        const { last } = this;
        const state = this.state;
        if (state.id === last.id && state.file?.name === last.file?.name && state.modified === last.modified && state.autosaved === last.autosaved) return;
        this.last = state;
        this.signals.documentChanged.dispatch(state);
    }
}
