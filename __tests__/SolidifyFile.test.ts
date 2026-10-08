import { strToU8, unzipSync, zipSync } from 'fflate';
import { readSolidifyFile, writeSolidifyFile } from '../src/editor/serialization/SolidifyFile';
import { SolidifyJSON } from '../src/editor/serialization/SolidifyDocument';

describe("SolidifyFile", () => {
    const json = { viewports: [], materials: [], nodes: [], groups: [], empties: [], images: [{ uri: 'abc.png' }] } as SolidifyJSON;
    const geometry = strToU8('{"format":"solidify-occt","version":1,"items":[]}');
    const images = new Map([['abc.png', new Uint8Array([137, 80, 78, 71])]]);

    test("what's written is read back", () => {
        for (const compress of [true, false]) {
            const read = readSolidifyFile(writeSolidifyFile({ id: 'doc', json, geometry, images }, compress));
            expect(read.id).toBe('doc');
            expect(read.json).toEqual(json);
            expect(read.geometry).toEqual(geometry);
            expect(read.images).toEqual(images);
        }
    });

    test("it's a zip, with the images under images/", () => {
        const entries = unzipSync(writeSolidifyFile({ json, geometry, images }));
        expect(Object.keys(entries).sort()).toEqual(['document.json', 'geometry.json', 'images/abc.png', 'meta.json']);
    });

    test("the thumbnail is kept, when there is one", () => {
        const thumbnail = new Uint8Array([137, 80, 78, 71, 1]);
        expect(readSolidifyFile(writeSolidifyFile({ json, geometry, images, thumbnail })).thumbnail).toEqual(thumbnail);
        expect(readSolidifyFile(writeSolidifyFile({ json, geometry, images })).thumbnail).toBeUndefined();
    });

    test("something else isn't read", () => {
        expect(() => readSolidifyFile(strToU8("hello"))).toThrow("It isn't a Solidify file.");
        expect(() => readSolidifyFile(zipSync({ 'meta.json': strToU8('{"format":"other"}') }))).toThrow("It isn't a Solidify file.");
    });

    test("a newer format isn't read", () => {
        const meta = strToU8(JSON.stringify({ format: 'solidify', formatVersion: 2 }));
        expect(() => readSolidifyFile(zipSync({ 'meta.json': meta }))).toThrow("It was saved by a newer version of Solidify. Reload the page to get it.");
    });
});
