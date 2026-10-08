import { Store } from '../platform/Platform';

// A document the user opened or saved in this browser
export interface RecentDocument {
    readonly id: string;
    readonly name: string;
    // When it was last opened or saved, in ms since the epoch
    readonly time: number;
    // Where the browser lets the app read it again; only Chromium gives one
    readonly handle?: FileSystemFileHandle;
    // A PNG of how it looked
    readonly thumbnail?: Uint8Array;
}

// The documents opened or saved lately, newest first, by document id
export class RecentDocuments {
    static readonly max = 12;

    constructor(private readonly store: Store) { }

    async add(document: Omit<RecentDocument, 'time'>) {
        const previous = await this.get(document.id);
        // A save that has no picture, like one in the tests, keeps the one there was
        const thumbnail = document.thumbnail ?? previous?.thumbnail;
        await this.store.setMany([[document.id, { ...document, thumbnail, time: Date.now() }]]);
        const old = (await this.list()).slice(RecentDocuments.max);
        if (old.length > 0) await this.store.delMany(old.map(d => d.id));
    }

    async get(id: string): Promise<RecentDocument | undefined> {
        return this.store.get<RecentDocument>(id);
    }

    async list(): Promise<RecentDocument[]> {
        const all = await Promise.all((await this.store.keys()).map(id => this.get(id)));
        return all.filter((d): d is RecentDocument => d !== undefined).sort((a, b) => b.time - a.time);
    }

    async remove(id: string) {
        await this.store.delMany([id]);
    }
}
