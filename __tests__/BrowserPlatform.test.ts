/**
 * @jest-environment jsdom
 */
import { fileSave } from 'browser-fs-access';
import { BrowserPlatform } from '../src/platform/BrowserPlatform';
import { FileType } from '../src/platform/Platform';

jest.mock('browser-fs-access', () => ({
    supported: true,
    fileOpen: jest.fn(),
    fileSave: jest.fn(async (data: unknown, options: unknown, existing: FileSystemFileHandle | null) => existing),
}));

describe("saving back to a file", () => {
    const type: FileType = { description: "Solidify", extensions: ['.solidify'], mimeTypes: ['application/x-solidify'] };
    const data = Promise.resolve(new Blob());

    // A file kept from before a reload: the browser asks again before the app edits it
    function handle(answer: PermissionState) {
        return {
            kind: 'file', name: 'part.solidify',
            queryPermission: jest.fn(async () => 'prompt' as PermissionState),
            requestPermission: jest.fn(async () => answer),
        } as unknown as FileSystemFileHandle;
    }

    beforeEach(() => jest.mocked(fileSave).mockClear());

    test("asks the user to let it be edited, then writes over it", async () => {
        const existing = handle('granted');
        const saved = await new BrowserPlatform().files.save(data, 'part.solidify', type, existing);
        expect(existing.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
        expect(fileSave).toHaveBeenCalledWith(data, expect.anything(), existing);
        expect(saved).toEqual({ name: 'part.solidify', handle: existing });
    });

    test("saves nothing, and opens no picker, if the user doesn't let it", async () => {
        const saved = await new BrowserPlatform().files.save(data, 'part.solidify', type, handle('denied'));
        expect(fileSave).not.toHaveBeenCalled();
        expect(saved).toBeUndefined();
    });
});
