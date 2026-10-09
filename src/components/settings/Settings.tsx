import { Disposable } from 'event-kit';
import { render } from 'preact';
import { Editor } from '../../editor/Editor';
import { FileType } from '../../platform/Platform';
import { ConfigFiles, OrbitMode } from '../../startup/ConfigFiles';
import { restoreNote } from '../title-bar/TitleBar';
import { ChangeEvent } from '../dialog/NumberScrubber';
import { LengthUnit, lengthUnits, unitSystem, unitSystems } from '../../util/Units';

const APP_VERSION = process.env.APP_VERSION;

type Tab = 'navigation' | 'units' | 'file' | 'privacy';

const tabs: { id: Tab, label: string }[] = [
    { id: 'navigation', label: 'Navigation' },
    { id: 'units', label: 'Units & grid' },
    { id: 'file', label: 'File' },
    { id: 'privacy', label: 'Privacy' },
];

const mouseControls: { mode: OrbitMode, label: string, hint: string }[] = [
    { mode: 'default', label: 'Default', hint: 'Middle drag orbits · Right drag pans' },
    { mode: 'blender', label: 'Blender', hint: 'Middle drag orbits · Shift+Middle pans · Ctrl+Middle zooms' },
    { mode: 'maya', label: 'Maya', hint: 'Alt+Left orbits · Alt+Middle pans · Alt+Right zooms' },
    { mode: 'moi3d', label: 'Moi3D', hint: 'Right drag orbits · Middle or Shift+Right pans · Alt+Right zooms' },
    { mode: '3dsmax', label: '3ds Max', hint: 'Alt+Middle orbits · Middle pans · Ctrl+Alt+Middle zooms' },
    { mode: 'touchpad', label: 'Touchpad', hint: 'Two-finger swipe orbits · Shift+swipe pans · Pinch zooms' },
];

const minKeep = 1, maxKeep = 10;

const settingsFile: FileType = { description: 'Solidify settings', extensions: ['.json'], mimeTypes: ['application/json'] };

export default (editor: Editor) => {
    class Settings extends HTMLElement {
        private isOpen = false;
        private tab: Tab = 'navigation';
        private orbitMode: OrbitMode | 'custom' = 'default';
        private command?: Disposable;

        connectedCallback() {
            this.command = editor.registry.add(document.body, { 'app:settings': () => this.open() });
            this.render();
        }

        disconnectedCallback() {
            this.command?.dispose();
            this.close();
        }

        private open() {
            if (this.isOpen) return;
            this.isOpen = true;
            this.orbitMode = ConfigFiles.currentOrbitMode();
            // Capturing on window comes before the app's shortcuts, which listen there too
            window.addEventListener('keydown', this.onKey, true);
            window.addEventListener('keyup', this.onKey, true);
            editor.signals.settingsChanged.add(this.render);
            this.render();
        }

        private close = () => {
            if (!this.isOpen) return;
            this.isOpen = false;
            window.removeEventListener('keydown', this.onKey, true);
            window.removeEventListener('keyup', this.onKey, true);
            editor.signals.settingsChanged.remove(this.render);
            this.render();
        }

        // While open, keystrokes don't reach the app's shortcuts
        private onKey = (e: KeyboardEvent) => {
            e.stopPropagation();
            if (e.type === 'keydown' && e.key === 'Escape') {
                e.preventDefault();
                this.close();
            }
        }

        private setOrbitMode(mode: OrbitMode) {
            editor.setOrbitMode(mode);
            this.orbitMode = mode;
            this.render();
        }

        private async exportSettings() {
            const data = Promise.resolve(new Blob([ConfigFiles.export()], { type: settingsFile.mimeTypes[0] }));
            try {
                await editor.platform.files.save(data, 'solidify-settings.json', settingsFile);
            } catch (e) {
                editor.platform.dialogs.showMessageBox({ type: 'error', message: "The settings could not be exported.", detail: String(e) });
            }
        }

        private async importSettings() {
            const [file] = await editor.platform.files.open([settingsFile], false);
            if (file === undefined) return;
            try {
                ConfigFiles.import(new TextDecoder().decode(file.bytes));
            } catch (e) {
                editor.platform.dialogs.showMessageBox({ type: 'error', message: `“${file.name}” could not be imported.`, detail: e instanceof Error ? e.message : String(e) });
                return;
            }
            // Settings, keymap and theme are read as the app starts; the document comes back from its autosave
            editor.reload();
        }

        private privacy() {
            return <div>
                <div class="text-sm font-semibold text-neutral-100">Your documents</div>
                <div class="text-xs text-neutral-400">Solidify runs in this browser. Documents, autosaves and settings stay on this computer; nothing you make is uploaded.</div>
            </div>;
        }

        private setKeep(keep: number) {
            ConfigFiles.updateSetting('Autosave', 'keep', Math.min(maxKeep, Math.max(minKeep, keep)));
            this.render();
        }

        render = () => {
            if (!this.isOpen) {
                render(null, this);
                return;
            }
            const content = this.tab === 'navigation' ? this.navigation() : this.tab === 'units' ? this.units() : this.tab === 'file' ? this.file() : this.privacy();
            render(
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onPointerDown={e => { if (e.target === e.currentTarget) this.close() }}>
                    <div class="flex flex-col w-[640px] h-[540px] max-w-[90vw] max-h-[90vh] rounded-lg overflow-hidden bg-neutral-800 text-neutral-200 shadow-black/30 shadow-xl ring-1 ring-neutral-600 ring-opacity-5">
                        <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
                            <div class="text-sm font-semibold text-neutral-100">Settings</div>
                            <button class="w-6 h-6 rounded text-neutral-300 hover:bg-white/20 hover:text-neutral-50" title="Close" onClick={this.close}>✕</button>
                        </div>
                        <div class="flex flex-1 min-h-0">
                            <nav class="flex flex-col justify-between w-40 p-2 border-r border-white/10">
                                <ol class="space-y-1">
                                    {tabs.map(({ id, label }) =>
                                        <li class={`px-3 py-1.5 rounded-md text-sm cursor-default ${id === this.tab ? 'bg-white/20 text-neutral-50' : 'text-neutral-300 hover:bg-white/10'}`}
                                            onClick={() => { this.tab = id; this.render() }}>
                                            {label}
                                        </li>)}
                                </ol>
                                <div class="px-3 py-1 text-xs text-neutral-400">Solidify {APP_VERSION}</div>
                            </nav>
                            <section class="flex-1 p-5 overflow-y-auto">{content}</section>
                        </div>
                    </div>
                </div>, this);
        }

        private navigation() {
            return <div>
                <div class="text-sm font-semibold text-neutral-100">Mouse controls</div>
                <div class="mb-3 text-xs text-neutral-400">Which buttons orbit, pan and zoom the view. The wheel zooms, except with Touchpad.</div>
                <ol class="space-y-1">
                    {mouseControls.map(({ mode, label, hint }) =>
                        <li class={`flex items-start px-3 py-2 rounded-md cursor-default ${mode === this.orbitMode ? 'bg-white/20' : 'hover:bg-white/10'}`}
                            onClick={() => this.setOrbitMode(mode)}>
                            <span class={`mt-1 mr-3 w-3 h-3 shrink-0 rounded-full border ${mode === this.orbitMode ? 'border-accent-400 bg-accent-400' : 'border-neutral-400'}`}></span>
                            <span>
                                <div class="text-sm text-neutral-100">{label}</div>
                                <div class="text-xs text-neutral-400">{hint}</div>
                            </span>
                        </li>)}
                </ol>
                {this.orbitMode === 'custom' &&
                    <div class="mt-3 text-xs text-neutral-400">Currently custom. Choosing one above replaces it.</div>}
            </div>;
        }

        private units() {
            const current = editor.settings.Units.length;
            const { size, step } = editor.settings.Grid;
            const { majorEvery } = unitSystems[unitSystem()];
            const setSize = (e: ChangeEvent) => editor.setGrid(e.value, step);
            const setStep = (e: ChangeEvent) => editor.setGrid(size, e.value);
            return <div>
                <div class="text-sm font-semibold text-neutral-100">Units</div>
                <div class="mb-3 text-xs text-neutral-400">How lengths are shown and typed; a typed length can name its own unit, like 2 in. Documents and exported files aren't affected. Moving between metric and imperial sets the grid and the snap steps to round values in the new units.</div>
                <div class="flex space-x-1">
                    {(Object.keys(lengthUnits) as LengthUnit[]).map(unit =>
                        <button class={`w-12 py-1 rounded-md text-sm ${unit === current ? 'bg-white/20 text-neutral-50 ring-1 ring-accent-400' : 'bg-white/5 text-neutral-300 hover:bg-white/10'}`} onClick={() => editor.setLengthUnit(unit)}>
                            {unit}
                            <solidify-tooltip placement="bottom">{lengthUnits[unit].name}</solidify-tooltip>
                        </button>)}
                </div>

                <div class="mt-6 text-sm font-semibold text-neutral-100">Grid</div>
                <div class="mb-3 text-xs text-neutral-400">On the floor and on construction planes: a line every step, and a heavier one every {majorEvery} steps. Snapping to the grid has its own step, in the Snaps panel.</div>
                <div class="grid grid-cols-[4rem_9rem] items-center gap-x-3 gap-y-2 text-sm">
                    <label for="size">Size</label>
                    <solidify-number-scrubber name="size" unit="length" min={1} max={1_000_000} value={size} onchange={setSize} onscrub={setSize} onfinish={() => { }}></solidify-number-scrubber>
                    <label for="step">Step</label>
                    <solidify-number-scrubber name="step" unit="length" min={0.01} max={1_000_000} value={step} onchange={setStep} onscrub={setStep} onfinish={() => { }}></solidify-number-scrubber>
                </div>
            </div>;
        }

        private file() {
            const keep = editor.settings.Autosave.keep;
            const step = "w-6 h-6 rounded text-neutral-200 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none";
            return <div>
                <div class="text-sm font-semibold text-neutral-100">Autosave</div>
                <div class="mb-3 text-xs text-neutral-400">File › Restore offers the autosaves of recent documents that aren't open. {restoreNote(editor)}</div>
                <div class="flex items-center space-x-2 text-sm">
                    <span>Restore keeps</span>
                    <button class={step} disabled={keep <= minKeep} onClick={() => this.setKeep(keep - 1)}>−</button>
                    <span class="w-6 text-center tabular-nums">{keep}</span>
                    <button class={step} disabled={keep >= maxKeep} onClick={() => this.setKeep(keep + 1)}>+</button>
                    <span>documents</span>
                </div>

                <div class="mt-6 text-sm font-semibold text-neutral-100">Settings, keymap and theme</div>
                <div class="mb-3 text-xs text-neutral-400">They're kept in this browser. Export them to keep a copy or to use them in another browser; importing replaces them and reloads.</div>
                <div class="flex items-center space-x-2">
                    <button class="px-3 py-1 rounded-md text-sm text-neutral-100 bg-white/10 hover:bg-white/20" onClick={() => this.exportSettings()}>Export…</button>
                    <button class="px-3 py-1 rounded-md text-sm text-neutral-100 bg-white/10 hover:bg-white/20" onClick={() => this.importSettings()}>Import…</button>
                </div>
            </div>;
        }
    }
    customElements.define('solidify-settings', Settings);
}
