import { JSX, render } from 'preact';
import { Editor } from '../../editor/Editor';
import { RecentDocument } from '../../editor/RecentDocuments';
import { Slot } from '../../editor/serialization/Backup';
import { isMac } from '../../util/Os';

const shortcut = (key: string, shift = false) =>
    isMac ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`;
// Browsers keep ⌘N and Ctrl+N for a new window
const newShortcut = isMac ? '⌥⇧N' : 'Alt+Shift+N';

const time = (ms: number) =>
    new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// Autosaves are for getting work back, not for keeping it
export const restoreNote = (editor: Editor) =>
    `Autosaves are kept in this browser, which can clear them to make space. ${editor.platform.files.savesInPlace ? 'Save' : 'Download'} to keep your work.`;

const row = "flex items-center justify-between px-3 py-1.5 rounded-md text-xs";
const enabledRow = `${row} text-ui-text hover:bg-ui-hover cursor-default`;
const disabledRow = `${row} text-ui-faint pointer-events-none`;
const panel = "p-1.5 surface text-ui-title";

export default (editor: Editor) => {
    // The window's title bar, with the document's name, where the installed app has it (see index.css); elsewhere it's
    // hidden, and keeps the browser tab's title
    class TitleBar extends HTMLElement {
        connectedCallback() { this.render() }

        render() {
            render(
                <div class="hidden titlebar">
                    <solidify-document-title class="text-xs text-center pointer-events-none titlebar-title text-ui-text"></solidify-document-title>
                </div>, this);
        }
    }
    customElements.define('solidify-titlebar', TitleBar);

    // The File menu, at the viewport's top left
    class FileMenu extends HTMLElement {
        connectedCallback() { this.render() }

        render() {
            const item = (label: string, command: string, keys?: string) =>
                <li class={enabledRow} onClick={this.execute} data-command={command}>
                    <span>{label}</span>
                    {keys !== undefined && <span class="pl-6 text-xs text-ui-muted">{keys}</span>}
                </li>;
            const submenu = (label: string, list: JSX.Element) =>
                <li class={`${enabledRow} group relative`}>
                    <span>{label}</span>
                    <solidify-icon name="nav-arrow-right" class="text-ui-muted"></solidify-icon>
                    {/* Inside the menu, so moving onto it doesn't count as leaving the menu */}
                    <div class="hidden group-hover:block absolute left-full -top-1.5 pl-1">
                        <div class={`${panel} min-w-[16rem]`}>{list}</div>
                    </div>
                </li>;
            const separator = <li class="my-1 border-t border-ui-divider"></li>;

            render(
                // Opened by clicking anywhere on its surface, and lined up with it
                <div class="absolute top-2 left-2 z-40 p-1 surface">
                    <button class="bar-button" aria-label="File menu">
                        <solidify-icon name="menu"></solidify-icon>
                    </button>
                    <solidify-menu placement="bottom-start" trigger="onclick">
                        <div class={`w-64 ${panel}`}>
                            <ol>
                                <li class="px-3 pt-1.5 pb-1 text-xs truncate text-ui-muted cursor-default">
                                    <solidify-document-title></solidify-document-title>
                                </li>
                                {separator}
                                {item("New", "file:new", newShortcut)}
                                {item("Open…", "file:open", shortcut('O'))}
                                {submenu("Open Recent", <solidify-file-list kind="recent"></solidify-file-list>)}
                                {separator}
                                {submenu("Restore", <solidify-file-list kind="restore"></solidify-file-list>)}
                                {separator}
                                {editor.platform.files.savesInPlace
                                    ? <>
                                        {item("Save", "file:save", shortcut('S'))}
                                        {item("Save As…", "file:save-as", shortcut('S', true))}
                                    </>
                                    // Where the browser only downloads, Save and Save As do the same; both shortcuts download
                                    : item("Download…", "file:save", shortcut('S'))}
                                {separator}
                                {item("Import…", "file:import")}
                                {item("Export…", "file:export")}
                                {separator}
                                {item("Settings…", "app:settings")}
                            </ol>
                        </div>
                    </solidify-menu>
                </div>, this);
        }

        private execute = (e: MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
            const element = e.currentTarget! as HTMLElement;
            const command = element.getAttribute('data-command');
            if (command === null) {
                console.error("Missing command name: ", element);
                return;
            }

            element.dispatchEvent(new CustomEvent(command, { bubbles: true }));
            element.dispatchEvent(new CustomEvent('closeMenu', { bubbles: true }));
        }
    }
    customElements.define('solidify-file-menu', FileMenu);

    // The name of the open document, marked while it has unsaved changes, here and in the browser tab
    class DocumentTitle extends HTMLElement {
        connectedCallback() {
            editor.signals.documentChanged.add(this.render);
            this.render();
        }

        disconnectedCallback() {
            editor.signals.documentChanged.remove(this.render);
        }

        render = () => {
            const { name, modified } = editor.document;
            const title = `${name}${modified ? ' •' : ''}`;
            window.document.title = `${title} — Solidify`;
            render(<span>{title}</span>, this);
        }
    }
    customElements.define('solidify-document-title', DocumentTitle);

    // The entries of File › Open Recent or File › Restore, read afresh each time the menu opens
    class FileList extends HTMLElement {
        connectedCallback() { this.render() }

        render = async () => {
            if (this.getAttribute('kind') === 'recent') {
                let recent: RecentDocument[] = [];
                let autosaved = new Set<string>();
                try {
                    recent = await editor.recent.list();
                    autosaved = new Set((await editor.backup.slots()).map(s => s.id));
                } catch (e) {
                    console.warn(e);
                }
                // Without a handle to its file, a document opens from its autosave, if it has one
                const openable = (d: RecentDocument) => d.handle !== undefined || autosaved.has(d.id);
                render(<ol>
                    {recent.length === 0 && <li class={disabledRow}>None</li>}
                    {recent.map(d =>
                        <li class={openable(d) ? enabledRow : disabledRow} onClick={e => this.choose(e, () => editor.openRecent(d))}>
                            <span class="truncate">{d.name}</span>
                            <span class="pl-6 text-xs text-ui-muted whitespace-nowrap">{openable(d) ? time(d.time) : 'Open from its file'}</span>
                        </li>)}
                </ol>, this);
            } else {
                let slots: Slot[] = [];
                try {
                    slots = await editor.backup.restorable();
                } catch (e) {
                    console.warn(e);
                }
                render(<ol>
                    {slots.length === 0 && <li class={disabledRow}>None</li>}
                    {slots.map(slot =>
                        <li class={enabledRow} onClick={e => this.choose(e, () => editor.restore(slot))}>
                            <span class="truncate">{slot.name ?? 'Untitled'}</span>
                            <span class="pl-6 text-xs text-ui-muted whitespace-nowrap">{time(slot.time)}</span>
                        </li>)}
                    <li class="px-3 pt-2 pb-1 mt-1 border-t border-ui-divider text-xs text-ui-muted whitespace-normal">{restoreNote(editor)}</li>
                </ol>, this);
            }
        }

        private choose(e: MouseEvent, action: () => void) {
            e.stopPropagation();
            this.dispatchEvent(new CustomEvent('closeMenu', { bubbles: true }));
            action();
        }
    }
    customElements.define('solidify-file-list', FileList);
}
