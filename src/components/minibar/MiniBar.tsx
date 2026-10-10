import { CompositeDisposable, Disposable } from 'event-kit';
import { render } from 'preact';
import * as THREE from 'three';
import Command from '../../command/Command';
import * as like from '../../commands/CommandLike';
import { Editor } from '../../editor/Editor';
import { GConstructor } from '../../util/Util';
import { humanizeKeystrokes } from '../atom/tooltip-manager';
import { tooltips } from '../toolbar/icons';
import { ViewportElement } from '../viewport/Viewport';
import { available, barCommands, clampInto, CommandClass, distanceTo, fade, Found, kindOf, Model, placeBeside, Position, Rect, search, Size, Visibility } from './MiniBarModel';

// Clear of the palette on the left and the drawer's tabs on the right
const margin = { left: 58, top: 8, right: 56, bottom: 8 };
// A selection made this recently came from the last click, and the bar goes beside it, this far from the gizmo there
const clickWindow = 1000;
const clickGap = 32;
const boundsGap = 12;
// Moved less than this, the handle was clicked, not dragged
const dragThreshold = 3;

// Plane commands draw the plane-from-camera icon
const icons = new Map<CommandClass, string>([
    [like.CreateViewspaceConstructionPlaneAtOriginCommand as CommandClass, 'plane-from-camera'],
    [like.CreateViewspaceConstructionPlaneCommand as CommandClass, 'plane-from-camera'],
]);

type Menu = { query: string, highlighted: number };
type Drag = { pointerId: number, dx: number, dy: number, startX: number, startY: number, moved: boolean };

export default (editor: Editor) => {
    // Beside the selection: the few things it's most likely to be wanted for, and a menu of everything else. Its handle
    // moves it out of the way, and it stays there until the handle is double-clicked
    class MiniBar extends HTMLElement {
        private readonly disposable = new CompositeDisposable();
        private readonly model = new Model(editor.selection.selected, editor.db);
        private readonly visibility = new Visibility();
        private readonly bar = document.createElement('div');
        private readonly buttons = document.createElement('div');
        private readonly menuElement = document.createElement('div');

        private position: Position = { left: 0, top: 0 };
        private pinnedAt?: Position;
        private lastClick?: { x: number, y: number, time: number };
        private menu?: Menu;
        private drag?: Drag;

        constructor() {
            super();
            this.bar.className = 'flex absolute z-30 gap-0.5 items-center p-1 transition-opacity surface';
            this.bar.style.display = 'none';
            this.buttons.className = 'flex gap-0.5 items-center';
            this.menuElement.className = 'flex overflow-hidden absolute z-40 flex-col w-64 surface';
            this.menuElement.style.display = 'none';
            // Pressing in the bar's menu or its More button doesn't end the command the selection started (see ClickToFinish)
            this.menuElement.addEventListener('pointerdown', e => e.stopPropagation());
        }

        private get viewport() { return this.parentElement as HTMLElement & ViewportElement }

        connectedCallback() {
            const { signals } = editor;
            const { viewport, bar, menuElement } = this;
            const canvas = viewport.model.renderer.domElement;
            const controls = viewport.model.navigationControls;

            this.append(bar, menuElement);
            this.renderBar();

            signals.selectionChanged.add(this.selectionChanged);
            signals.commandStarted.add(this.commandStarted);
            signals.commandEnded.add(this.commandEnded);
            controls.addEventListener('start', this.navigationStarted);
            controls.addEventListener('end', this.navigationEnded);
            canvas.addEventListener('pointerup', this.clicked);
            bar.addEventListener('click', this.launching, true);
            window.addEventListener('pointermove', this.pointerMoved);
            window.addEventListener('pointerdown', this.pointerDownAnywhere, true);
            window.addEventListener('keydown', this.modifierChanged);
            window.addEventListener('keyup', this.modifierChanged);
            window.addEventListener('blur', this.blurred);

            // Kept inside the viewport as it resizes and the drawer slides over it
            const resizes = new ResizeObserver(this.keepInside);
            resizes.observe(viewport);
            const insets = new MutationObserver(this.keepInside);
            insets.observe(viewport, { attributes: true, attributeFilter: ['style'] });

            this.disposable.add(new Disposable(() => {
                signals.selectionChanged.remove(this.selectionChanged);
                signals.commandStarted.remove(this.commandStarted);
                signals.commandEnded.remove(this.commandEnded);
                controls.removeEventListener('start', this.navigationStarted);
                controls.removeEventListener('end', this.navigationEnded);
                canvas.removeEventListener('pointerup', this.clicked);
                bar.removeEventListener('click', this.launching, true);
                window.removeEventListener('pointermove', this.pointerMoved);
                window.removeEventListener('pointerdown', this.pointerDownAnywhere, true);
                window.removeEventListener('keydown', this.modifierChanged);
                window.removeEventListener('keyup', this.modifierChanged);
                window.removeEventListener('blur', this.blurred);
                resizes.disconnect();
                insets.disconnect();
            }));
        }

        disconnectedCallback() {
            this.disposable.dispose();
        }

        private renderBar() {
            const { selection } = editor;
            const commands = barCommands(this.model.commands, selection.selected);
            // preact's diffing algorithm will mutate solidify-tooltips rather than create new ones, which leads to corruption;
            // So, force things to be cleared first.
            render('', this.bar);
            render(<>
                <div class="py-1.5 rounded-md cursor-grab text-ui-faint hover:text-ui-text hover:bg-ui-hover" role="button" aria-label="Move the bar; double-click to put it back"
                    onPointerDown={this.dragStarted} onPointerMove={this.dragged} onPointerUp={this.dragEnded} onPointerCancel={this.dragEnded} onDblClick={this.unpin}>
                    <solidify-icon name="grip"></solidify-icon>
                </div>
                {commands.map(command => <solidify-command name={command.identifier} tooltipPlacement="top"></solidify-command>)}
                <div class="mx-0.5 w-px h-5 bg-ui-divider"></div>
                <div class="bar-button" role="button" aria-label="More" aria-expanded={false} onPointerDown={e => e.stopPropagation()} onClick={this.toggleMenu}>
                    <solidify-icon name="more"></solidify-icon>
                    <solidify-tooltip placement="top">More</solidify-tooltip>
                </div>
            </>, this.bar);
        }

        private update() {
            const { bar, visibility } = this;
            const shown = visibility.shown;
            bar.style.display = shown ? '' : 'none';
            if (!shown) this.closeMenu();
        }

        private selectionChanged = () => {
            const { visibility, lastClick } = this;
            const selected = editor.selection.selected;
            const any = selected.solids.size + selected.curves.size + selected.regions.size + selected.faces.size + selected.edges.size + selected.controlPoints.size > 0;
            visibility.selectionChanged(any);
            this.closeMenu();
            this.renderBar();
            if (any) {
                const recent = lastClick !== undefined && performance.now() - lastClick.time < clickWindow;
                if (recent) this.placeBeside({ left: lastClick!.x, top: lastClick!.y, right: lastClick!.x, bottom: lastClick!.y }, clickGap);
                else this.placeBesideSelection();
            }
            this.update();
            this.bar.style.opacity = '1';
        }

        private commandStarted = (command: Command) => {
            const { visibility } = this;
            const kind = kindOf(command);
            visibility.commandStarted(command, kind);
            if (kind === 'waiting') {
                command.factoryChanged.addOnce(() => {
                    visibility.gizmoUsed(command);
                    this.update();
                });
            }
            this.update();
        }

        private commandEnded = (command: Command) => {
            if (this.visibility.commandEnded(command)) {
                this.renderBar();
                this.placeBesideSelection();
            }
            this.update();
        }

        private navigationStarted = () => {
            this.visibility.navigationStarted();
            this.update();
        }

        private navigationEnded = () => {
            this.visibility.navigationEnded();
            this.update();
        }

        private clicked = (e: PointerEvent) => {
            if (e.button !== 0) return;
            const rect = this.viewport.getBoundingClientRect();
            this.lastClick = { x: e.clientX - rect.left, y: e.clientY - rect.top, time: performance.now() };
        }

        // A bar or menu button is starting a command
        private launching = (e: MouseEvent) => {
            if (!(e.target instanceof Element) || e.target.closest('solidify-command') === null) return;
            this.visibility.launch();
            this.update();
        }

        private modifierChanged = (e: KeyboardEvent) => {
            const held = e.shiftKey || e.ctrlKey;
            this.visibility.modifierChanged(held);
            this.update();
        }

        private blurred = () => {
            this.visibility.modifierChanged(false);
            this.update();
        }

        // Fades as the cursor moves away, unless moved out of the way or showing its menu
        private pointerMoved = (e: PointerEvent) => {
            const { bar, visibility, menu, drag } = this;
            if (bar.style.display === 'none' || drag !== undefined) return;
            if (visibility.pinned || menu !== undefined) {
                bar.style.opacity = '1';
                return;
            }
            const rect = bar.getBoundingClientRect();
            bar.style.opacity = String(fade(distanceTo(e.clientX, e.clientY, rect)));
        }

        private pointerDownAnywhere = (e: PointerEvent) => {
            if (this.menu === undefined) return;
            if (e.target instanceof Node && this.contains(e.target)) return;
            this.closeMenu();
        }

        // Within the viewport, clear of the palette, the drawer and its tabs
        private get area(): Rect {
            const { viewport } = this;
            const inset = parseFloat(getComputedStyle(viewport).getPropertyValue('--drawer-inset')) || 0;
            return {
                left: margin.left,
                top: margin.top,
                right: viewport.clientWidth - inset - margin.right,
                bottom: viewport.clientHeight - margin.bottom,
            };
        }

        private get size(): Size {
            const { bar } = this;
            const display = bar.style.display;
            bar.style.display = '';
            const size = { width: bar.offsetWidth, height: bar.offsetHeight };
            bar.style.display = display;
            return size;
        }

        private moveTo(position: Position) {
            this.position = position;
            this.bar.style.left = `${position.left}px`;
            this.bar.style.top = `${position.top}px`;
            if (this.menu !== undefined) this.placeMenu();
        }

        private placeBeside(anchor: Rect, gap: number) {
            const { pinnedAt, size, area } = this;
            this.moveTo(pinnedAt !== undefined ? clampInto(pinnedAt, size, area) : placeBeside(anchor, size, area, gap));
        }

        private placeBesideSelection() {
            const bounds = this.selectionOnScreen();
            if (bounds !== undefined) return this.placeBeside(bounds, boundsGap);
            const { area } = this;
            const x = (area.left + area.right) / 2, y = area.bottom;
            this.placeBeside({ left: x, top: y, right: x, bottom: y }, 0);
        }

        // Where the selection is drawn, in the viewport
        private selectionOnScreen(): Rect | undefined {
            const { solids, curves, regions, faces, edges, controlPoints } = editor.selection.selected;
            const box = new THREE.Box3();
            for (const item of [...solids, ...curves, ...regions, ...faces, ...edges, ...controlPoints] as unknown[]) {
                if (item instanceof THREE.Object3D) box.expandByObject(item);
                else if (item !== null && typeof item === 'object' && 'getBoundingBox' in item) box.union((item as { getBoundingBox(): THREE.Box3 }).getBoundingBox());
            }
            if (box.isEmpty()) return;

            const { viewport } = this;
            const { camera } = viewport.model;
            const width = viewport.clientWidth, height = viewport.clientHeight;
            const rect: Rect = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
            const corner = new THREE.Vector3();
            for (let i = 0; i < 8; i++) {
                corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
                if (corner.z > 1) continue; // Behind the camera
                const x = (corner.x + 1) / 2 * width, y = (1 - corner.y) / 2 * height;
                rect.left = Math.min(rect.left, x); rect.right = Math.max(rect.right, x);
                rect.top = Math.min(rect.top, y); rect.bottom = Math.max(rect.bottom, y);
            }
            if (rect.left === Infinity) return;
            return rect;
        }

        private keepInside = () => {
            if (this.bar.style.display === 'none') return;
            this.moveTo(clampInto(this.position, this.size, this.area));
        }

        private dragStarted = (e: PointerEvent) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const rect = this.viewport.getBoundingClientRect();
            const { position } = this;
            this.drag = { pointerId: e.pointerId, dx: e.clientX - rect.left - position.left, dy: e.clientY - rect.top - position.top, startX: e.clientX, startY: e.clientY, moved: false };
        }

        private dragged = (e: PointerEvent) => {
            const { drag } = this;
            if (drag === undefined || e.pointerId !== drag.pointerId) return;
            if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < dragThreshold) return;
            if (!drag.moved) this.closeMenu();
            drag.moved = true;
            const rect = this.viewport.getBoundingClientRect();
            this.bar.style.opacity = '1';
            this.moveTo(clampInto({ left: e.clientX - rect.left - drag.dx, top: e.clientY - rect.top - drag.dy }, this.size, this.area));
        }

        private dragEnded = (e: PointerEvent) => {
            const { drag } = this;
            if (drag === undefined || e.pointerId !== drag.pointerId) return;
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            this.drag = undefined;
            if (!drag.moved) return;
            this.pinnedAt = this.position;
            this.visibility.pinned = true;
        }

        private unpin = () => {
            this.pinnedAt = undefined;
            this.visibility.pinned = false;
            this.placeBesideSelection();
        }

        private toggleMenu = (e: MouseEvent) => {
            e.stopPropagation();
            if (this.menu !== undefined) this.closeMenu();
            else this.openMenu();
        }

        private openMenu() {
            this.menu = { query: '', highlighted: 0 };
            this.bar.style.opacity = '1';
            this.menuElement.style.display = '';
            this.moreOpen(true);
            this.renderMenu();
            this.placeMenu();
            this.menuElement.querySelector('input')?.focus();
        }

        private closeMenu() {
            if (this.menu === undefined) return;
            this.menu = undefined;
            this.menuElement.style.display = 'none';
            render('', this.menuElement);
            this.moreOpen(false);
        }

        // The More button shows the menu's open, and its tooltip keeps out of the menu's way meanwhile
        private moreOpen(open: boolean) {
            const more = this.bar.querySelector<HTMLElement>('[aria-label="More"]');
            if (more === null) return;
            more.classList.toggle('on', open);
            more.setAttribute('aria-expanded', String(open));
            for (const tooltip of editor.tooltips.findTooltips(more)) {
                if (open) {
                    tooltip.hide();
                    tooltip.disable();
                } else tooltip.enable();
            }
        }

        // Below the bar, or above it where there isn't room
        private placeMenu() {
            const { menuElement, position, area } = this;
            const barHeight = this.bar.offsetHeight;
            const height = menuElement.offsetHeight, width = menuElement.offsetWidth;
            const below = position.top + barHeight + 4;
            const top = below + height <= area.bottom ? below : Math.max(area.top, position.top - 4 - height);
            const left = Math.max(area.left, Math.min(position.left, area.right - width));
            menuElement.style.left = `${left}px`;
            menuElement.style.top = `${top}px`;
            menuElement.style.maxHeight = `${area.bottom - area.top}px`;
        }

        // With nothing typed, what the selection can do; typed, every command that matches, those that can't run on the
        // selection greyed with what they need
        private get rows(): (Found | 'divider')[] {
            const { menu } = this;
            if (menu === undefined) return [];
            const list = this.model.commands;
            if (menu.query.trim() !== '') return search(menu.query, available(list));
            const rows: (Found | 'divider')[] = [];
            const sections = list.trash === undefined ? list.sections : [...list.sections, [list.trash]];
            for (const section of sections.filter(section => section.length > 0)) {
                if (rows.length > 0) rows.push('divider');
                for (const command of section) rows.push({ command, label: tooltips.get(command) ?? command.title });
            }
            return rows;
        }

        private renderMenu() {
            const { menu } = this;
            if (menu === undefined) return;
            const rows = this.rows;
            const runnable = rows.filter((row): row is Found => row !== 'divider' && row.need === undefined);
            const highlighted = runnable[Math.min(menu.highlighted, runnable.length - 1)];
            render(<>
                <div class="flex flex-none gap-2 items-center px-3 h-10 border-b border-ui-divider text-ui-muted">
                    <solidify-icon name="search"></solidify-icon>
                    <input type="text" class="flex-1 min-w-0 text-xs bg-transparent outline-none text-ui-title placeholder:text-ui-faint" placeholder="Search commands" aria-label="Search commands"
                        value={menu.query} onInput={this.queryChanged} onKeyDown={this.menuKey} onKeyUp={e => e.stopPropagation()} />
                </div>
                <ul class="overflow-y-auto flex-1 p-1" role="listbox" aria-label="Commands">
                    {rows.length === 0 && <li class="px-2 py-1.5 text-xs text-ui-faint">No commands match</li>}
                    {rows.map((row, index) => {
                        if (row === 'divider') return <li key={`divider-${index}`} class="my-1 mx-2 h-px bg-ui-divider" role="separator"></li>;
                        const { command, label, need } = row;
                        const on = row === highlighted;
                        const bindings = editor.keymaps.findKeyBindings({ command: `command:${command.identifier}` });
                        // Keyed, so each row's icon is drawn for its own command
                        return <li key={command.identifier} role="option" aria-selected={on} aria-disabled={need !== undefined} title={need ?? label}
                            class={`flex gap-2 items-center px-2 h-8 text-xs rounded-md ${need !== undefined ? 'text-ui-faint' : `cursor-pointer ${on ? 'bg-ui-tint text-ui-title' : 'text-ui-text hover:bg-ui-hover'}`}`}
                            onPointerEnter={() => this.highlight(row, runnable)} onClick={() => this.run(row)}>
                            <solidify-icon class={`flex-none ${need !== undefined ? 'opacity-50' : on ? 'text-ui-accent' : 'text-ui-muted'}`} name={icons.get(command) ?? command.identifier}></solidify-icon>
                            <span class="flex-1 min-w-0 truncate">{label}</span>
                            {need !== undefined
                                ? <span class="flex-none text-[11px]">{need}</span>
                                : bindings.length > 0 && <span class="flex-none px-1 text-[11px] leading-4 rounded ring-1 ring-ui-border text-ui-faint">{humanizeKeystrokes(bindings[0].keystrokes)}</span>}
                        </li>;
                    })}
                </ul>
            </>, this.menuElement);
        }

        private queryChanged = (e: Event) => {
            if (this.menu === undefined) return;
            this.menu = { query: (e.currentTarget as HTMLInputElement).value, highlighted: 0 };
            this.renderMenu();
            this.placeMenu();
        }

        private highlight(row: Found, runnable: Found[]) {
            const index = runnable.indexOf(row);
            if (index === -1 || this.menu === undefined || this.menu.highlighted === index) return;
            this.menu = { ...this.menu, highlighted: index };
            this.renderMenu();
        }

        // Typing goes to the search, not the viewport's shortcuts
        private menuKey = (e: KeyboardEvent) => {
            e.stopPropagation();
            const { menu } = this;
            if (menu === undefined) return;
            const runnable = this.rows.filter((row): row is Found => row !== 'divider' && row.need === undefined);
            switch (e.key) {
                case 'ArrowDown':
                case 'ArrowUp': {
                    e.preventDefault();
                    if (runnable.length === 0) return;
                    const step = e.key === 'ArrowDown' ? 1 : -1;
                    const highlighted = (Math.min(menu.highlighted, runnable.length - 1) + step + runnable.length) % runnable.length;
                    this.menu = { ...menu, highlighted };
                    this.renderMenu();
                    this.menuElement.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
                    break;
                }
                case 'Enter': {
                    e.preventDefault();
                    const row = runnable[Math.min(menu.highlighted, runnable.length - 1)];
                    if (row !== undefined) this.run(row);
                    break;
                }
                case 'Escape':
                    e.preventDefault();
                    this.closeMenu();
                    break;
            }
        }

        private run(row: Found) {
            if (row.need !== undefined) return;
            this.closeMenu();
            this.visibility.launch();
            this.update();
            const Klass: GConstructor<Command> = row.command;
            editor.enqueue(new Klass(editor));
        }
    }
    customElements.define('solidify-mini-bar', MiniBar);
}
