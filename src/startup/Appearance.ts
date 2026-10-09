import signals from 'signals';

// Light or dark, as Settings › Appearance has it, or as the system does. index.html sets it before anything shows; this
// keeps it as the setting and the system change
export type ThemeSetting = 'system' | 'light' | 'dark';

let setting: ThemeSetting = 'system';
let applied: 'light' | 'dark' | undefined;
let systemPrefersLight: MediaQueryList | undefined;

// After the theme changes, for what the stylesheet doesn't colour: the 3D view
export const themeChanged = new signals.Signal();

export function setTheme(theme: ThemeSetting) {
    setting = theme;
    if (systemPrefersLight === undefined) {
        systemPrefersLight = window.matchMedia('(prefers-color-scheme: light)');
        systemPrefersLight.addEventListener('change', () => { if (setting === 'system') apply() });
    }
    apply();
}

function apply() {
    const theme = setting === 'system' ? (systemPrefersLight!.matches ? 'light' : 'dark') : setting;
    if (theme === applied) return;
    applied = theme;
    document.documentElement.dataset.theme = theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content = paletteColor('bg');
    themeChanged.dispatch();
}

// A colour of the palette in index.css as the theme has it, or '' where there's no page (as in tests)
export function paletteColor(name: string) {
    if (typeof document === 'undefined') return '';
    return getComputedStyle(document.documentElement).getPropertyValue(`--ui-${name}`).trim();
}
