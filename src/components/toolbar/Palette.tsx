import { CompositeDisposable, Disposable } from 'event-kit';
import { render } from 'preact';
import * as THREE from "three";
import _ from "underscore-plus";
import Command from '../../command/Command';
import * as cmd from '../../commands/GeometryCommands';
import { Editor } from '../../editor/Editor';
import { GConstructor } from '../../util/Util';
import icons, { tooltips } from './icons';

// Time thresholds are in milliseconds, distance thresholds are in pixels.
const consummationTimeThreshold = 200; // once the mouse is down at least this long the drag is consummated
const consummationDistanceThreshold = 4; // once the mouse moves at least this distance the drag is consummated

type TooltipPlacement = "left" | "top" | "bottom" | "right" | undefined;

export default (editor: Editor) => {
    class CommandButton extends HTMLElement {
        command!: GConstructor<Command> & { identifier: string };
        private tooltip?: string;

        private _tooltipPlacement: TooltipPlacement = "left";
        get tooltipPlacement() { return this._tooltipPlacement }
        set tooltipPlacement(placement: TooltipPlacement) { this._tooltipPlacement = placement }

        connectedCallback() {
            const name = this.getAttribute('name')!;
            const CommandName = _.undasherize(name).replace(/\s+/g, '') + 'Command' as keyof typeof cmd;
            const klass = cmd[CommandName];
            if (klass == null) throw `${name} is invalid (${CommandName})`;

            const tooltip = tooltips.get(klass);
            if (!tooltip) console.error("no matching tooltip for command " + CommandName);

            this.command = klass;
            this.tooltip = tooltip;

            this.render()
        }

        render() {
            const { command, tooltip } = this;
            const name = this.getAttribute('name')!;
            render(
                <div class="p-2 cursor-pointer bg-neutral-800 text-neutral-200 hover:bg-accent-500 hover:text-accent-100"
                    onClick={this.execute} >
                    <solidify-icon name={name}></solidify-icon>
                    {tooltip !== undefined && <solidify-tooltip command={`command:${command.identifier}`} placement={this.tooltipPlacement}>{tooltip}</solidify-tooltip>}
                </div >, this);
        }

        execute = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const klass = this.command;
            editor.enqueue(new klass(editor));
        }
    }
    customElements.define('solidify-command', CommandButton);

    type ButtonGroupState = { tag: 'none' } | { tag: 'down', downEvent: PointerEvent, disposable: CompositeDisposable } | { tag: 'open', downEvent: PointerEvent, disposable: CompositeDisposable };
    class ButtonGroup extends HTMLElement {
        private selected = 0;
        private state: ButtonGroupState = { tag: 'none' };
        private original!: string;

        constructor() {
            super();
        }

        connectedCallback() {
            this.original = this.innerHTML;
            this.render();
            this.addEventListener('pointerdown', this.onPointerDown)
            editor.signals.commandStarted.add(this.onCommandStarted);
        }

        disconnectedCallback() {
            this.removeEventListener('pointerdown', this.onPointerDown);
            editor.signals.commandStarted.remove(this.onCommandStarted);
        }

        // Show the group's most recently used command, however it was invoked (palette, submenu, or shortcut)
        private onCommandStarted = (command: Command) => {
            const index = Array.from(this.children).findIndex(child => child instanceof CommandButton && command.constructor === child.command);
            if (index === -1 || index === this.selected) return;
            this.selected = index;
            if (this.state.tag === 'none') this.render();
        }

        render = () => {
            switch (this.state.tag) {
                case 'none': {
                    for (const [i, child] of Array.from(this.children).entries()) {
                        if (!(child instanceof CommandButton)) continue;
                        child.style.display = i === this.selected ? '' : 'none';
                    }
                    break;
                }
                case 'open': {
                    const { disposable } = this.state;
                    const pos = this.getBoundingClientRect();
                    const submenu = document.createElement('section');
                    submenu.className = 'flex absolute flex-col p-1 space-y-0.5';
                    submenu.innerHTML = this.original;
                    document.body.appendChild(submenu);
                    disposable.add(new Disposable(() => submenu.remove()));

                    const actualWidth = submenu.offsetWidth;
                    const actualHeight = submenu.offsetHeight;
                    const offset = {
                        top: pos.top + pos.height / 2 - actualHeight / 2,
                        left: pos.left - actualWidth
                    };

                    submenu.style.top = offset.top + 'px';
                    submenu.style.left = offset.left + 'px';
                    document.body.appendChild(submenu);
                    break;
                }
            }
        }

        private onPointerDown = (e: PointerEvent) => {
            switch (this.state.tag) {
                case 'none': {
                    e.stopPropagation();
                    e.preventDefault();
                    window.addEventListener('pointermove', this.onPointerMove);
                    window.addEventListener('pointerup', this.onPointerUp);
                    const disposables = new CompositeDisposable();
                    disposables.add(new Disposable(() => window.removeEventListener('pointermove', this.onPointerMove)));
                    disposables.add(new Disposable(() => window.removeEventListener('pointerup', this.onPointerUp)));
                    // Holding still emits no pointermove, so the time threshold needs its own timer
                    const timeout = window.setTimeout(this.open, consummationTimeThreshold);
                    disposables.add(new Disposable(() => window.clearTimeout(timeout)));
                    this.state = { tag: 'down', downEvent: e, disposable: disposables };
                    break;
                }
                default: throw new Error('invalid state: ' + this.state.tag);
            }
        }

        private open = () => {
            if (this.state.tag !== 'down') return;
            const { downEvent, disposable } = this.state;
            // The hovered button's tooltip would cover the submenu, so suppress it while open
            for (const label of Array.from(this.querySelectorAll('solidify-tooltip'))) {
                for (const tooltip of editor.tooltips.findTooltips(label.parentElement)) {
                    tooltip.disable();
                    tooltip.hide();
                    disposable.add(new Disposable(() => tooltip.enable()));
                }
            }
            this.state = { tag: 'open', downEvent, disposable };
            this.render();
        }

        private onPointerMove = (e: PointerEvent) => {
            switch (this.state.tag) {
                case 'down': {
                    const { downEvent } = this.state;
                    if (e.pointerId !== downEvent.pointerId) return;
                    const currentPosition = new THREE.Vector2(e.clientX, e.clientY);
                    const startPosition = new THREE.Vector2(downEvent.clientX, downEvent.clientY);
                    if (currentPosition.distanceTo(startPosition) >= consummationDistanceThreshold) {
                        this.open();
                    }
                    break;
                }
                case 'open':
                    const { downEvent } = this.state;
                    if (e.pointerId !== downEvent.pointerId) return;
                    break;
                default: throw new Error('invalid state: ' + this.state.tag);
            }
        }

        private onPointerUp = (e: PointerEvent) => {
            switch (this.state.tag) {
                case 'down': {
                    const { downEvent, disposable } = this.state;
                    if (e.pointerId !== downEvent.pointerId) return;
                    disposable.dispose();
                    this.state = { tag: 'none' };
                    this.render();
                    break;
                }
                case 'open':
                    const { downEvent, disposable } = this.state;
                    if (e.pointerId !== downEvent.pointerId) return;

                    for (const item of Array.from(e.composedPath())) {
                        if (item instanceof CommandButton) {
                            item.execute(e);
                            break;
                        }
                    }

                    disposable.dispose();
                    this.state = { tag: 'none' };
                    this.render();
                    break;
            }
        }
    }
    customElements.define('solidify-button-group', ButtonGroup);

    class Palette extends HTMLElement {
        connectedCallback() { this.render() }

        render() {
            return render(
                <div class="flex absolute right-2 top-1/2 z-40 flex-col space-y-2 -translate-y-1/2">
                    <section class="flex flex-col space-y-0.5">
                        <solidify-command name="line" class="shadow-lg first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                        <solidify-command name="curve" class="shadow-lg first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                        <solidify-button-group class="shadow-lg first:rounded-t last:rounded-b overflow-clip">
                            <solidify-command name="center-circle" class="first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                            <solidify-command name="two-point-circle" class="first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                            <solidify-command name="three-point-circle" class="first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                        </solidify-button-group>
                        <solidify-command name="polygon"></solidify-command>
                        <solidify-button-group class="shadow-lg first:rounded-t last:rounded-b overflow-clip">
                            <solidify-command name="corner-rectangle" class="first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                            <solidify-command name="center-rectangle" class="first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                            <solidify-command name="three-point-rectangle" class="first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                        </solidify-button-group>
                        <solidify-button-group class="shadow-lg first:rounded-t last:rounded-b overflow-clip">
                            <solidify-command name="three-point-arc" class="first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                            <solidify-command name="center-point-arc" class="first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                        </solidify-button-group>
                        <solidify-button-group class="shadow-lg first:rounded-t last:rounded-b overflow-clip">
                            <solidify-command name="center-ellipse" class="first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                            <solidify-command name="three-point-ellipse" class="first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                        </solidify-button-group>
                        <solidify-button-group class="shadow-lg first:rounded-t last:rounded-b overflow-clip">
                            <solidify-command name="spiral" class="first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                            <solidify-command name="character-curve" class="first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                        </solidify-button-group>
                        <solidify-command name="trim" class="shadow-lg first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                        <solidify-command name="bridge-curves" class="shadow-lg first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                    </section>
                    <section class="flex flex-col space-y-0.5">
                        <solidify-command name="sphere" class="shadow-lg first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                        <solidify-command name="cylinder" class="shadow-lg first:rounded-t last:rounded-b overflow-clip"></solidify-command>
                        <solidify-button-group class="shadow-lg first:rounded-t last:rounded-b overflow-clip">
                            <solidify-command name="corner-box"></solidify-command>
                            <solidify-command name="center-box"></solidify-command>
                            <solidify-command name="three-point-box"></solidify-command>
                        </solidify-button-group>
                    </section>
                </div>, this);
        }
    }
    customElements.define('solidify-palette', Palette);
}
