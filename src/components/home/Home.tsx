import { Disposable } from 'event-kit';
import { render } from 'preact';
import { Editor } from '../../editor/Editor';
import { RecentDocument } from '../../editor/RecentDocuments';
import { Slot } from '../../editor/serialization/Backup';
import { canInstall, install, onInstallOfferChanged } from '../../startup/Install';
import { isMac } from '../../util/Os';
import { restoreNote } from '../title-bar/TitleBar';

const tutorial = 'tutorials/screw/screw-tutorial.html';
const logo = 'logo.svg';

const ago = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function when(ms: number) {
    const minutes = Math.round((ms - Date.now()) / 60_000);
    if (Math.abs(minutes) < 60) return ago.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return ago.format(hours, 'hour');
    const days = Math.round(hours / 24);
    if (Math.abs(days) < 30) return ago.format(days, 'day');
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const button = "px-3 py-1.5 rounded-md text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus";

// What a new tab shows first: a way to start, the documents from before, and work that wasn't saved
export default (editor: Editor) => {
    class Home extends HTMLElement {
        private isOpen = false;
        private recent: RecentDocument[] = [];
        private slots: Slot[] = [];
        private autosaved = new Set<string>();
        private thumbnails = new Map<string, string>();
        private command?: Disposable;
        private installOffer?: Disposable;

        connectedCallback() {
            this.command = editor.registry.add(document.body, { 'app:home': () => this.open() });
            this.installOffer = onInstallOfferChanged(() => this.render());
            // A document opened, restored or dropped in, or anything made, means work has started
            editor.signals.backupLoaded.add(this.close);
            editor.signals.historyAdded.add(this.close);
        }

        disconnectedCallback() {
            this.command?.dispose();
            this.installOffer?.dispose();
            editor.signals.backupLoaded.remove(this.close);
            editor.signals.historyAdded.remove(this.close);
            this.close();
        }

        private async open() {
            if (this.isOpen) return;
            this.isOpen = true;
            // Capturing on window comes before the app's shortcuts, which listen there too
            window.addEventListener('keydown', this.onKey, true);
            window.addEventListener('keyup', this.onKey, true);
            this.render();
            try {
                const [recent, slots, all] = await Promise.all([editor.recent.list(), editor.backup.restorable(), editor.backup.slots()]);
                this.recent = recent;
                this.slots = slots;
                this.autosaved = new Set(all.map(s => s.id));
                for (const { id, thumbnail } of recent) {
                    if (thumbnail !== undefined) this.thumbnails.set(id, URL.createObjectURL(new Blob([thumbnail], { type: 'image/png' })));
                }
            } catch (e) {
                console.warn(e);
            }
            this.render();
        }

        private close = () => {
            if (!this.isOpen) return;
            this.isOpen = false;
            window.removeEventListener('keydown', this.onKey, true);
            window.removeEventListener('keyup', this.onKey, true);
            for (const url of this.thumbnails.values()) URL.revokeObjectURL(url);
            this.thumbnails.clear();
            this.render();
        }

        // While open, keystrokes don't reach the app's shortcuts, except Open
        private onKey = (e: KeyboardEvent) => {
            e.stopPropagation();
            if (e.type !== 'keydown') return;
            if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
            } else if (e.key.toLowerCase() === 'o' && (isMac ? e.metaKey : e.ctrlKey)) {
                e.preventDefault();
                editor.open();
            }
        }

        private start = () => {
            const { document } = editor;
            if (document.file === undefined && !document.modified) this.close();
            else editor.newDocument();
        }

        private import = () => {
            this.close();
            editor.import();
        }

        render() {
            if (!this.isOpen) {
                render(null, this);
                return;
            }
            const { recent, slots, autosaved, thumbnails } = this;
            const { savesInPlace } = editor.platform.files;
            // Without a handle to its file, a document opens from its autosave, if it has one
            const openable = (d: RecentDocument) => d.handle !== undefined || autosaved.has(d.id);
            render(
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-ui-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) this.close() }}>
                    <div class="flex flex-col w-[760px] max-w-[92vw] max-h-[88vh] rounded-xl overflow-hidden bg-ui-surface text-ui-text shadow-ui-shadow shadow-2xl ring-1 ring-ui-border">
                        <div class="flex items-start justify-between px-6 pt-5 pb-4 border-b border-ui-divider">
                            <div class="flex items-center gap-3">
                                <img src={logo} alt="" class="w-11 h-11" draggable={false} />
                                <div>
                                    <div class="text-lg font-semibold text-ui-title">Solidify</div>
                                    <div class="text-sm text-ui-muted">Sketch curves, then extrude, revolve, fillet and combine them into solids.</div>
                                </div>
                            </div>
                            <button class="w-6 h-6 rounded text-ui-text hover:bg-ui-hover hover:text-ui-title" title="Close" onClick={this.close}>✕</button>
                        </div>

                        <div class="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">
                            <div class="flex flex-wrap items-center gap-2">
                                <button class={`${button} text-ui-on-primary bg-ui-primary hover:bg-ui-primary-hover`} ref={el => el?.focus()} onClick={this.start}>New</button>
                                <button class={`${button} text-ui-title bg-ui-raised hover:bg-ui-hover`} onClick={() => editor.open()}>Open…</button>
                                <button class={`${button} text-ui-title bg-ui-raised hover:bg-ui-hover`} onClick={this.import}>Import…</button>
                                <span class="pl-2 text-xs text-ui-muted">or drop a .solidify, STEP, STL, 3MF, OBJ or image file anywhere</span>
                            </div>

                            <section>
                                <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-ui-muted">Recent</div>
                                {recent.length === 0
                                    ? <div class="text-sm text-ui-muted">Documents you open or {savesInPlace ? 'save' : 'download'} appear here.</div>
                                    : <ol class="grid grid-cols-4 gap-3">
                                        {recent.map(d => {
                                            const ok = openable(d);
                                            const thumbnail = thumbnails.get(d.id);
                                            return <li class={`group rounded-lg p-1.5 ${ok ? 'cursor-default hover:bg-ui-hover' : 'opacity-50'}`}
                                                title={ok ? d.name : `${d.name}: this browser can only open it from its file`}
                                                onClick={() => { if (ok) editor.openRecent(d) }}>
                                                <div class="aspect-square rounded-md overflow-hidden bg-ui-viewport ring-1 ring-ui-border flex items-center justify-center">
                                                    {thumbnail !== undefined
                                                        ? <img src={thumbnail} alt="" class="w-full h-full object-cover" draggable={false} />
                                                        : <solidify-icon name="file-menu" class="text-ui-faint"></solidify-icon>}
                                                </div>
                                                <div class="mt-1.5 text-sm text-ui-title truncate">{d.name.replace(/\.solidify$/i, '')}</div>
                                                <div class="text-xs text-ui-muted">{when(d.time)}</div>
                                            </li>;
                                        })}
                                    </ol>}
                            </section>

                            {slots.length > 0 &&
                                <section>
                                    <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-ui-muted">Unsaved work</div>
                                    <ol class="space-y-0.5">
                                        {slots.map(slot =>
                                            <li class="flex items-center justify-between px-3 py-1.5 rounded-md text-sm text-ui-text hover:bg-ui-hover cursor-default"
                                                onClick={() => editor.restore(slot)}>
                                                <span class="truncate">{slot.name ?? 'Untitled'}{slot.modified ? ' •' : ''}</span>
                                                <span class="pl-6 text-xs text-ui-muted whitespace-nowrap">{when(slot.time)}</span>
                                            </li>)}
                                    </ol>
                                    <div class="mt-2 text-xs text-ui-muted">{restoreNote(editor)}</div>
                                </section>}
                        </div>

                        <div class="px-6 py-3 border-t border-ui-divider text-xs text-ui-muted space-y-1">
                            <div>New to Solidify? Follow the <a class="text-ui-accent hover:text-ui-focus underline" href={tutorial} target="_blank" rel="noopener">threaded screw tutorial</a>.</div>
                            {!savesInPlace && <div>Solidify is best experienced on a Chrome browser.</div>}
                            {canInstall() && <div>Install Solidify to use it in a window of its own, offline too, and open .solidify files from the desktop. <button class="text-ui-accent hover:text-ui-focus underline" onClick={install}>Install</button></div>}
                        </div>
                    </div>
                </div>, this);
        }
    }
    customElements.define('solidify-home', Home);
}
