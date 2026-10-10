import json5 from 'json5';
import { ConfigFiles, orbitPresets } from '../src/startup/ConfigFiles';
import defaultSettings from '../src/startup/default-settings';

describe(ConfigFiles, () => {
    const original = ConfigFiles.storage;
    let items: Map<string, string>;

    beforeEach(() => {
        items = new Map();
        ConfigFiles.storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value) }, removeItem: key => { items.delete(key) } };
    });

    afterEach(() => {
        ConfigFiles.storage = original;
        defaultSettings.Autosave.keep = 3;
    });

    const stored = (key: string) => json5.parse(items.get(key)!);

    test("a setting is changed in memory and kept", () => {
        ConfigFiles.updateSetting('Autosave', 'keep', 5);
        expect(defaultSettings.Autosave.keep).toBe(5);
        expect(stored(ConfigFiles.userSettingsKey)).toEqual({ Autosave: { keep: 5 } });
    });

    test("a setting keeps the other ones", () => {
        items.set(ConfigFiles.userSettingsKey, `{ OrbitControls: { zoomSpeed: 2 }, Autosave: { keep: 1 } }`);
        ConfigFiles.updateSetting('Autosave', 'keep', 4);
        expect(stored(ConfigFiles.userSettingsKey)).toEqual({ OrbitControls: { zoomSpeed: 2 }, Autosave: { keep: 4 } });
    });

    test("kept settings are loaded over the defaults", () => {
        items.set(ConfigFiles.userSettingsKey, `{ Autosave: { keep: 7 } }`);
        expect(ConfigFiles.loadSettings().Autosave.keep).toBe(7);
    });

    test("unreadable settings leave the defaults", () => {
        items.set(ConfigFiles.userSettingsKey, `{ Autosave: `);
        expect(ConfigFiles.loadSettings().Autosave.keep).toBe(3);
    });

    test("the mouse controls are found from the keymap", () => {
        expect(ConfigFiles.currentOrbitMode()).toBe('default');
        for (const mode of Object.keys(orbitPresets) as (keyof typeof orbitPresets)[]) {
            ConfigFiles.updateOrbitControls(mode);
            expect(ConfigFiles.currentOrbitMode()).toBe(mode);
        }
        items.set(ConfigFiles.userKeymapKey, `{ "orbit-controls": { "mouse0": "orbit:rotate" } }`);
        expect(ConfigFiles.currentOrbitMode()).toBe('custom');
    });

    test("exported settings are imported in another browser, in place of what's there", () => {
        ConfigFiles.updateSetting('Autosave', 'keep', 5);
        ConfigFiles.updateOrbitControls('maya');
        const exported = ConfigFiles.export();

        items.clear();
        items.set(ConfigFiles.userThemeKey, `{ colors: { viewport: '#000000' } }`);
        ConfigFiles.import(exported);
        expect(stored(ConfigFiles.userSettingsKey)).toEqual({ Autosave: { keep: 5 } });
        expect(stored(ConfigFiles.userKeymapKey)).toEqual({ 'orbit-controls': orbitPresets.maya });
        expect(items.has(ConfigFiles.userThemeKey)).toBe(false);
    });

    test("something else isn't imported", () => {
        items.set(ConfigFiles.userSettingsKey, `{ Autosave: { keep: 2 } }`);
        expect(() => ConfigFiles.import(`{ "Autosave": { "keep": 9 } }`)).toThrow("It isn't a Solidify settings file.");
        expect(() => ConfigFiles.import(`not json`)).toThrow();
        expect(stored(ConfigFiles.userSettingsKey)).toEqual({ Autosave: { keep: 2 } });
    });

    test("touchpad devices start with Touchpad on first launch", () => {
        ConfigFiles.pickFirstOrbitMode(false);
        expect(ConfigFiles.currentOrbitMode()).toBe('default');
        ConfigFiles.pickFirstOrbitMode(true);
        expect(ConfigFiles.currentOrbitMode()).toBe('touchpad');
    });

    test("a picked navigation is kept over the first launch one", () => {
        ConfigFiles.updateOrbitControls('default');
        ConfigFiles.pickFirstOrbitMode(true);
        expect(ConfigFiles.currentOrbitMode()).toBe('default');
    });

    test("changing the mouse controls keeps the other bindings", () => {
        items.set(ConfigFiles.userKeymapKey, `{ "body": { "x": "command:x" }, "orbit-controls": {} }`);
        ConfigFiles.updateOrbitControls('maya');
        expect(stored(ConfigFiles.userKeymapKey)).toEqual({
            "body": { "x": "command:x" },
            "orbit-controls": orbitPresets.maya,
        });
    });
});
