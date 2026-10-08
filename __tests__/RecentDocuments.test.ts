import { MemoryStore } from '../__mocks__/FakePlatform';
import { RecentDocuments } from '../src/editor/RecentDocuments';

describe(RecentDocuments, () => {
    let recent: RecentDocuments;
    let now: number;

    beforeEach(() => {
        recent = new RecentDocuments(new MemoryStore());
        now = Date.UTC(2026, 0, 1);
        jest.spyOn(Date, 'now').mockImplementation(() => now += 1000);
    });

    afterEach(() => jest.restoreAllMocks());

    test("newest first, once each, up to the most kept", async () => {
        for (let i = 0; i < RecentDocuments.max + 2; i++) await recent.add({ id: `${i}`, name: `${i}.solidify` });
        await recent.add({ id: '5', name: 'renamed.solidify' });
        const list = await recent.list();
        expect(list.length).toBe(RecentDocuments.max);
        expect(list.slice(0, 3).map(d => d.name)).toEqual(['renamed.solidify', `${RecentDocuments.max + 1}.solidify`, `${RecentDocuments.max}.solidify`]);
        expect(list.map(d => d.id)).not.toContain('0');
    });

    test("a save without a picture keeps the one there was", async () => {
        const thumbnail = new Uint8Array([1, 2, 3]);
        await recent.add({ id: 'a', name: 'a.solidify', thumbnail });
        await recent.add({ id: 'a', name: 'a.solidify' });
        expect((await recent.get('a'))?.thumbnail).toEqual(thumbnail);
    });
});
