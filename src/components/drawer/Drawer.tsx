import { render } from 'preact';
import signals from 'signals';
import { Editor } from '../../editor/Editor';
import { ConfigFiles } from '../../startup/ConfigFiles';
import { ViewportElement } from '../viewport/Viewport';

// The panels the drawer over the viewport shows, one at a time, each opened by its button in the viewport; the stats
// are for development
const tabs = [
    { id: 'scene', icon: 'outliner', name: "Outliner" },
    { id: 'properties', icon: 'properties', name: "Properties" },
    { id: 'selection', icon: 'selection', name: "Selection" },
    { id: 'view', icon: 'render-mode', name: "View" },
    { id: 'snaps', icon: 'snaps', name: "Snaps" },
    { id: 'planes', icon: 'construction-planes', name: "Construction planes" },
    ...process.env.NODE_ENV === 'development' ? [{ id: 'stats', icon: 'stats', name: "Stats" }] : [],
];

const minWidth = 200;
// The drawer leaves the viewport this much (as in index.css): room for the palette, the construction plane, the navigator
// and the tab buttons in a row
const minViewportWidth = 320;
// Between the drawer and what it pushes along the viewport's right edge
const gap = 8;
// The tab buttons' column, and the gap left of it, which the navigator sits beyond
const tabsWidth = 42 + gap;
const slideDuration = 200;

export default (editor: Editor) => {
    // The open tab, '' while the drawer is closed, and its width, as they were last left
    let open = tabs.some(tab => tab.id === editor.settings.Layout.drawerTab) ? editor.settings.Layout.drawerTab : '';
    let width = editor.settings.Layout.drawerWidth;
    const changed = new signals.Signal();

    // Clicking the open tab's button closes the drawer, clicking another's shows that tab instead
    const toggle = (id: string) => {
        open = open === id ? '' : id;
        ConfigFiles.updateSetting('Layout', 'drawerTab', open);
        changed.dispatch();
    }

    class DrawerTabs extends HTMLElement {
        connectedCallback() {
            changed.add(this.render);
            this.render();
        }

        disconnectedCallback() {
            changed.remove(this.render);
        }

        // Down the viewport's right edge from its top, right of the navigator
        render = () => {
            render(
                <div class="flex absolute top-2 z-40 flex-col gap-1 clear-of-drawer">
                    {tabs.map(({ id, icon, name }) =>
                        <div class="p-1 surface">
                            <button class={`bar-button ${open === id ? 'on' : ''}`} aria-label={name} aria-pressed={open === id} onClick={() => toggle(id)}>
                                <solidify-icon name={icon}></solidify-icon>
                                <solidify-tooltip placement="left">{name}</solidify-tooltip>
                            </button>
                        </div>
                    )}
                </div>, this);
        }
    }
    customElements.define('solidify-drawer-tabs', DrawerTabs);

    // Its tabs are the panels marked with data-tab, on its card; its left edge is dragged to resize it. It slides in from
    // the viewport's right edge as it opens, pushing what's along that edge (the tab buttons, the navigator, and the
    // buttons and panels that span the viewport) out of its way, and slides back out as it closes, still showing the tab
    // it had
    class Drawer extends HTMLElement {
        private readonly handle = document.createElement('div');
        private readonly resizes = new ResizeObserver(() => this.place());
        // How far it's in: 0 closed, 1 open
        private shown = open === '' ? 0 : 1;
        private frame = 0;

        connectedCallback() {
            this.handle.className = 'drawer-handle';
            this.handle.addEventListener('pointerdown', this.onPointerDown);
            this.prepend(this.handle);
            this.resizes.observe(this);
            changed.add(this.update);
            this.update();
        }

        disconnectedCallback() {
            this.handle.removeEventListener('pointerdown', this.onPointerDown);
            this.resizes.disconnect();
            cancelAnimationFrame(this.frame);
            changed.remove(this.update);
        }

        private update = () => {
            this.style.width = `${width}px`;
            if (open !== '') {
                for (const panel of Array.from(this.querySelectorAll<HTMLElement>('[data-tab]'))) {
                    panel.hidden = panel.getAttribute('data-tab') !== open;
                }
            }
            this.slide(open === '' ? 0 : 1);
        }

        private slide(to: number) {
            cancelAnimationFrame(this.frame);
            const from = this.shown;
            if (from === to) return this.place();
            const start = performance.now();
            const step = (now: number) => {
                const t = Math.min((now - start) / slideDuration, 1);
                this.shown = from + (to - from) * (1 - Math.pow(1 - t, 3));
                this.place();
                if (t < 1) this.frame = requestAnimationFrame(step);
            };
            this.frame = requestAnimationFrame(step);
        }

        private get viewport() {
            return this.parentElement!.querySelector('solidify-viewport') as HTMLElement & ViewportElement;
        }

        // In by as much as it's shown, and what's along the viewport's right edge pushed as far
        private place() {
            const { viewport } = this;
            const span = this.offsetWidth + gap;
            const inset = span * this.shown;
            this.style.transform = `translateX(${span - inset}px)`;
            this.style.visibility = this.shown === 0 ? 'hidden' : '';
            viewport.style.setProperty('--drawer-inset', `${inset}px`);
            viewport.model.navigatorInset = tabsWidth + inset;
        }

        private onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            const { handle } = this;
            handle.setPointerCapture(e.pointerId);
            handle.addEventListener('pointermove', this.onPointerMove);
            handle.addEventListener('pointerup', this.onPointerUp);
            handle.addEventListener('pointercancel', this.onPointerUp);
        }

        private onPointerMove = (e: PointerEvent) => {
            const right = this.getBoundingClientRect().right;
            width = Math.round(Math.min(Math.max(right - e.clientX, minWidth), this.maxWidth));
            this.update();
        }

        // As the stylesheet has it, which keeps to it as the window narrows, but never less than minWidth
        private get maxWidth() {
            return Math.max(minWidth, this.viewport.clientWidth - 2 * gap - minViewportWidth);
        }

        private onPointerUp = (e: PointerEvent) => {
            const { handle } = this;
            handle.releasePointerCapture(e.pointerId);
            handle.removeEventListener('pointermove', this.onPointerMove);
            handle.removeEventListener('pointerup', this.onPointerUp);
            handle.removeEventListener('pointercancel', this.onPointerUp);
            ConfigFiles.updateSetting('Layout', 'drawerWidth', width);
        }
    }
    customElements.define('solidify-drawer', Drawer);
}
