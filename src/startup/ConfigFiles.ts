import json5 from 'json5';
import defaultKeymap from "./default-keymap";
import defaultSettings from './default-settings';
import defaultTheme from './default-theme.json';

export type Theme = typeof defaultTheme;
export type Settings = typeof defaultSettings;
export type OrbitMode = 'default' | 'blender' | 'maya' | 'moi3d' | '3dsmax' | 'touchpad';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// The browser's local storage, or, where the browser blocks it, storage that lasts until the page closes
function defaultStorage(): KeyValueStorage {
    try {
        if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) {
        console.warn("Settings can't be kept: the browser blocks storage", e);
    }
    const items = new Map<string, string>();
    return { getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value) }, removeItem: key => { items.delete(key) } };
}

// The user's keymap, theme and settings: each kept in the browser as JSON5, over the defaults
export class ConfigFiles {
    static storage: KeyValueStorage = defaultStorage();
    static readonly userKeymapKey = 'solidify:keymap';
    static readonly userThemeKey = 'solidify:theme';
    static readonly userSettingsKey = 'solidify:settings';

    // The parsed value, or undefined when there's none
    private static read(key: string): any {
        const text = this.storage.getItem(key);
        return text === null ? undefined : json5.parse(text);
    }

    private static write(key: string, value: unknown) {
        this.storage.setItem(key, json5.stringify(value, null, 4));
    }

    // All of it, as a file to take to another browser
    static export(): string {
        const exported: SettingsFileJSON = { format: settingsFormat, version: 1 };
        for (const [part, key] of this.parts) {
            const value = this.read(key);
            if (value !== undefined) exported[part] = value;
        }
        return JSON.stringify(exported, null, 4);
    }

    // Replaces all of it with what a file from export() has; it applies after a reload. Throws if it isn't one.
    static import(text: string) {
        const imported = json5.parse(text) as SettingsFileJSON;
        if (imported?.format !== settingsFormat) throw new Error("It isn't a Solidify settings file.");
        for (const [part, key] of this.parts) {
            const value = imported[part];
            if (value === undefined) this.storage.removeItem(key);
            else this.write(key, value);
        }
    }

    private static get parts(): [Part, string][] {
        return [['settings', this.userSettingsKey], ['keymap', this.userKeymapKey], ['theme', this.userThemeKey]];
    }

    static loadKeymap(into: AtomKeymap.KeymapManager) {
        into.add('/default', defaultKeymap);
        this.loadUserKeymap(into);
    }

    private static userKeymap?: { dispose(): void };
    private static loadUserKeymap(into: AtomKeymap.KeymapManager) {
        try {
            const parsed = this.read(this.userKeymapKey);
            if (parsed !== undefined) this.userKeymap = into.add('/user', parsed, 100);
        } catch (e) {
            console.error(e);
        }
    }

    static loadTheme() {
        try {
            const parsed = this.read(this.userThemeKey);
            if (parsed !== undefined) {
                const colorInfo = parsed.colors;

                const style = document.documentElement.style;
                const simpleColors = ['viewport', 'dialog', 'matcap', 'grid'];
                for (const colorName of simpleColors) {
                    const color = colorInfo[colorName];
                    if (color === undefined) continue;
                    style.setProperty(`--${colorName}`, color);
                    defaultTheme.colors[colorName as 'viewport'] = color;
                };
                for (const colorName of ['neutral', 'accent', 'supporting', 'red', 'green', 'blue', 'yellow']) {
                    const colorInfo = parsed.colors[colorName];
                    if (colorInfo === undefined) continue;
                    for (const shadeName of ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900']) {
                        const shadeInfo = colorInfo[shadeName];
                        if (shadeInfo === undefined) continue;
                        style.setProperty(`--${colorName}-${shadeName}`, shadeInfo);
                        defaultTheme.colors[colorName as 'neutral'][shadeName as '50'] = shadeInfo;
                    }
                };
            }
        } catch (e) {
            console.error(e);
        }
        return defaultTheme;
    }

    static loadSettings() {
        try {
            const parsed = this.read(this.userSettingsKey);
            if (parsed !== undefined) merge(defaultSettings, parsed);
        } catch (e) {
            console.error(e);
        }

        return defaultSettings;
    }

    static updateOrbitControls(mode: OrbitMode) {
        try {
            const parsed = this.read(this.userKeymapKey) ?? {};
            parsed['orbit-controls'] = { ...orbitPresets[mode] };
            this.write(this.userKeymapKey, parsed);
        } catch (e) {
            console.error(e);
        }
    }

    // Which preset the user keymap's orbit bindings are, or 'custom' when they were edited by hand
    static currentOrbitMode(): OrbitMode | 'custom' {
        let bindings: Record<string, string> = {};
        try {
            bindings = this.read(this.userKeymapKey)?.['orbit-controls'] ?? {};
        } catch (e) {
            console.error(e);
            return 'custom';
        }
        // Without bindings of its own, the user keymap leaves the defaults in place
        if (Object.keys(bindings).length === 0) return 'default';
        const same = (a: Record<string, string>, b: Record<string, string>) =>
            Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);
        for (const [mode, preset] of Object.entries(orbitPresets)) {
            if (same(bindings, preset)) return mode as OrbitMode;
        }
        return 'custom';
    }

    // Rereads the user keymap, e.g. after changing its orbit bindings
    static reloadUserKeymap(into: AtomKeymap.KeymapManager) {
        this.userKeymap?.dispose();
        this.userKeymap = undefined;
        this.loadUserKeymap(into);
    }

    // Changes one setting, in memory and in the user's settings
    static updateSetting<S extends keyof Settings, K extends keyof Settings[S]>(section: S, key: K, value: Settings[S][K]) {
        defaultSettings[section][key] = value;
        try {
            const parsed = this.read(this.userSettingsKey) ?? {};
            parsed[section] = { ...parsed[section], [key]: value };
            this.write(this.userSettingsKey, parsed);
        } catch (e) {
            console.error(e);
        }
    }
}

const settingsFormat = 'solidify-settings';
type Part = 'settings' | 'keymap' | 'theme';
type SettingsFileJSON = { format: typeof settingsFormat, version: number } & Partial<Record<Part, unknown>>;

export const orbitPresets: Record<OrbitMode, Record<string, string>> = {
    'default': {
        "mouse1": "orbit:rotate",
        "mouse2": "orbit:pan",
    },
    'blender': {
        "mouse1": "orbit:rotate",
        "shift-mouse1": "orbit:pan",
        "ctrl-mouse1": "orbit:dolly",
    },
    'maya': {
        "alt-mouse0": "orbit:rotate",
        "alt-mouse1": "orbit:pan",
        "alt-mouse2": "orbit:dolly"
    },
    'moi3d': {
        "mouse2": "orbit:rotate",
        "mouse1": "orbit:pan",
        "shift-mouse2": "orbit:pan",
        "alt-mouse2": "orbit:dolly",
    },
    '3dsmax': {
        "mouse1": "orbit:pan",
        "alt-mouse1": "orbit:rotate",
        "ctrl-alt-mouse1": "orbit:dolly",
    },
    'touchpad': {
        "pinch": "orbit:dolly",
        "gesture": "orbit:pan",
    },
};

function merge(canon: Record<string, any>, custom: Record<string, any>) {
    for (const [k, v] of Object.entries(canon)) {
        if (custom[k] === undefined) continue;
        if (typeof v === 'object') {
            merge(canon[k], custom[k]);
        } else {
            canon[k] = custom[k];
        }
    }
}