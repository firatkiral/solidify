import { strFromU8, strToU8, Unzipped, unzipSync, Zippable, zipSync } from 'fflate';
import { SolidifyJSON } from './SolidifyDocument';

// A .solidify file is a zip of the document's parts:
//   meta.json      what wrote it, and which document it is
//   document.json  the viewports, materials, and the scene's nodes, groups and empties
//   geometry.json  the kernel's items
//   images/<name>  the images the document shows, named for their content
//   meshes/<name>  its reference meshes, as binary STL in millimetres, named for their content
//   thumbnail.png  how it looked when it was saved, if there was a view to draw it

const format = 'solidify';
const formatVersion = 1;

interface MetaJSON {
    format: typeof format;
    formatVersion: number;
    appVersion: string;
    // Which document it is, so its autosave is found again when it's opened; none for an untitled document's autosave
    id?: string;
}

export interface SolidifyFileContents {
    readonly id?: string;
    readonly json: SolidifyJSON;
    readonly geometry: Uint8Array;
    readonly images: ReadonlyMap<string, Uint8Array>;
    readonly meshes?: ReadonlyMap<string, Uint8Array>;
    readonly thumbnail?: Uint8Array;
}

// Uncompressed is faster, for autosaves, which are written after every change
export function writeSolidifyFile({ id, json, geometry, images, meshes = new Map(), thumbnail }: SolidifyFileContents, compress = true): Uint8Array {
    const meta: MetaJSON = { format, formatVersion, appVersion: process.env.APP_VERSION ?? 'dev', id };
    const level = compress ? 6 : 0;
    const entries: Zippable = {
        'meta.json': strToU8(JSON.stringify(meta, null, 4)),
        'document.json': strToU8(JSON.stringify(json)),
        'geometry.json': geometry,
    };
    // PNG and JPEG are compressed already
    for (const [name, data] of images) entries[`images/${name}`] = [data, { level: 0 }];
    for (const [name, data] of meshes) entries[`meshes/${name}`] = data;
    if (thumbnail !== undefined) entries['thumbnail.png'] = [thumbnail, { level: 0 }];
    return zipSync(entries, { level });
}

export function readSolidifyFile(data: Uint8Array): SolidifyFileContents {
    let entries: Unzipped;
    try {
        entries = unzipSync(data);
    } catch (e) {
        throw new Error("It isn't a Solidify file.");
    }
    const json = (name: string) => {
        const entry = entries[name];
        if (entry === undefined) throw new Error(`It has no ${name}.`);
        return JSON.parse(strFromU8(entry));
    }
    const meta = json('meta.json') as MetaJSON;
    if (meta.format !== format) throw new Error("It isn't a Solidify file.");
    if (!(meta.formatVersion <= formatVersion)) throw new Error("It was saved by a newer version of Solidify. Reload the page to get it.");

    const geometry = entries['geometry.json'];
    if (geometry === undefined) throw new Error("It has no geometry.json.");
    const images = new Map<string, Uint8Array>(), meshes = new Map<string, Uint8Array>();
    for (const [name, entry] of Object.entries(entries)) {
        if (name.startsWith('images/')) images.set(name.slice('images/'.length), entry);
        else if (name.startsWith('meshes/')) meshes.set(name.slice('meshes/'.length), entry);
    }
    return { id: meta.id, json: json('document.json'), geometry, images, meshes, thumbnail: entries['thumbnail.png'] };
}
