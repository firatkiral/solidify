import { render } from 'preact';
import { Editor } from '../../editor/Editor';
import { SelectionMode } from '../../selection/SelectionModeSet';
import { humanizeKeystrokes } from '../atom/tooltip-manager';

// Each mode with the selection modes it sets and the command its shortcut runs
const modes = [
    { name: "Point", icon: 'control-point', modes: [SelectionMode.ControlPoint], command: 'selection:mode:set:control-point' },
    { name: "Edge", icon: 'edge', modes: [SelectionMode.CurveEdge, SelectionMode.Curve], command: 'selection:mode:set:edge' },
    { name: "Face", icon: 'face', modes: [SelectionMode.Face, SelectionMode.Region], command: 'selection:mode:set:face' },
    { name: "Solid", icon: 'solid', modes: [SelectionMode.Solid, SelectionMode.Empty], command: 'selection:mode:set:solid' },
];

export default (editor: Editor) => {
    // What clicking in the viewport selects: clicking a mode selects only that, shift-clicking adds or removes it
    class SelectionPanel extends HTMLElement {
        connectedCallback() {
            editor.signals.selectionModeChanged.add(this.render);
            this.render();
        }

        disconnectedCallback() {
            editor.signals.selectionModeChanged.remove(this.render);
        }

        render = () => {
            render(
                <>
                    <div class="panel-header">
                        <solidify-icon name="selection"></solidify-icon>
                        <h1 class="panel-title">Selection</h1>
                    </div>
                    <div class="p-4">
                        <ul class="px-2 space-y-1">
                            {modes.map(({ name, icon, modes, command }) => {
                                const on = editor.selection.mode.has(modes[0]);
                                const bindings = editor.keymaps.findKeyBindings({ command });
                                return <li class="flex items-center pr-2 space-x-2 rounded cursor-pointer group hover:bg-ui-hover" role="switch" aria-checked={on} onClick={e => this.onClick(e, modes)}>
                                    <div class={`flex-none p-1 rounded ${on ? 'bg-ui-tint text-ui-accent' : 'text-ui-faint'}`}>
                                        <solidify-icon name={icon}></solidify-icon>
                                    </div>
                                    <div class={`flex-grow min-w-0 text-xs truncate ${on ? 'text-ui-text group-hover:text-ui-title' : 'text-ui-faint'}`}>{name}</div>
                                    {bindings.length > 0 && <span class="px-1 text-[11px] leading-4 rounded ring-1 ring-ui-border text-ui-faint">{humanizeKeystrokes(bindings[0].keystrokes)}</span>}
                                </li>
                            })}
                        </ul>
                        <p class="px-2 mt-3 text-[11px] text-ui-faint">Shift-click to combine modes</p>
                    </div>
                </>, this);
        }

        private onClick = (e: MouseEvent, modes: SelectionMode[]) => {
            if (e.shiftKey) editor.selection.mode.toggle(...modes);
            else editor.selection.mode.set(...modes);
        }
    }
    customElements.define('solidify-selection-panel', SelectionPanel);
}
