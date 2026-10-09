import { CompositeDisposable, Disposable } from 'event-kit';
import { render } from 'preact';
import * as like from '../../commands/CommandLike';
import { Editor } from '../../editor/Editor';
import { ConstructionPlane, ConstructionPlaneSnap } from "../../editor/snaps/ConstructionPlaneSnap";
import { humanizeKeystrokes } from '../atom/tooltip-manager';
import { tooltips } from '../toolbar/icons';

type PlaneShortcut = { label: string, command: string };

export default (editor: Editor) => {
    class Anon extends HTMLElement {
        private readonly disposable = new CompositeDisposable();

        constructor() {
            super();
            editor.signals.temporaryConstructionPlaneAdded.add(this.render);
            editor.signals.constructionPlanesChanged.add(this.render);
            this.disposable.add(new Disposable(() => {
                editor.signals.temporaryConstructionPlaneAdded.remove(this.render);
                editor.signals.constructionPlanesChanged.remove(this.render);
            }))
        }

        connectedCallback() { this.render() }
        disconnectedCallback() { this.disposable.dispose() }

        private readonly fromSelection: PlaneShortcut[] = [
            { label: "Construction plane from selection (align camera)", command: 'viewport:navigate:selection' },
            { label: "Construction plane from selection (do not align)", command: 'viewport:grid:selection' },
        ];

        private readonly fromCamera: PlaneShortcut[] = [like.CreateViewspaceConstructionPlaneAtOriginCommand, like.CreateViewspaceConstructionPlaneCommand].map(Command => ({
            label: tooltips.get(Command)!,
            command: `command:${Command.identifier}`,
        }));

        render = (temp?: ConstructionPlane) => {
            render(
                <>
                    <div class="panel-header">
                        <solidify-icon name="construction-planes"></solidify-icon>
                        <h1 class="panel-title">Construction planes</h1>
                    </div>
                    <div class="p-4">
                        <ul class="space-y-1">
                            {[...editor.planes.all].map(plane =>
                                <li
                                    class="flex justify-between items-center py-1 px-2 space-x-2 rounded group hover:bg-ui-hover"
                                    onClick={e => this.onClick(e, plane)}
                                    onDblClick={e => this.onDblClick(e, plane)}
                                >
                                    <solidify-tooltip placement="left">Set plane (double-click to align camera)</solidify-tooltip>
                                    <solidify-icon name="offset-face" class="flex-none text-ui-muted"></solidify-icon>
                                    <div class="flex-grow min-w-0 text-xs truncate text-ui-text group-hover:text-ui-title">{plane.name}</div>
                                </li>
                            )}
                        </ul>
                        <ul class="mt-1 space-y-1">
                            {this.button('plane-from-selection', "Selection", this.fromSelection, this.onClickFromSelection)}
                            {this.button('plane-from-camera', "Camera", this.fromCamera, this.onClickFromCamera)}
                        </ul>
                    </div>
                </>, this);
        }

        // Like Plasticity, the tooltip lists both variants with their shortcuts; clicking runs the first one.
        private button(icon: string, name: string, shortcuts: PlaneShortcut[], onClick: () => void) {
            return <li class="flex justify-between items-center py-1 px-2 space-x-2 rounded group hover:bg-ui-hover" onClick={onClick}>
                <solidify-tooltip placement="left" tooltip-class="nowrap">
                    {shortcuts.map(({ label, command }) => {
                        const bindings = editor.keymaps.findKeyBindings({ command });
                        return <div>{label}{bindings.length > 0 && <> &middot; <span class="keystroke">{humanizeKeystrokes(bindings[0].keystrokes)}</span></>}</div>
                    })}
                </solidify-tooltip>
                <solidify-icon name={icon} class="flex-none text-ui-muted"></solidify-icon>
                <div class="flex-grow min-w-0 text-xs truncate text-ui-text group-hover:text-ui-title">{name}</div>
            </li>
        }

        onClickFromSelection = () => {
            editor.activeViewport?.navigateToSelection();
        }

        onClickFromCamera = () => {
            const command = new like.CreateViewspaceConstructionPlaneAtOriginCommand(editor);
            command.agent = 'user';
            editor.enqueue(command);
        }

        onClick = (event: MouseEvent, plane: ConstructionPlaneSnap) => {
            if (editor.activeViewport !== undefined) editor.activeViewport.constructionPlane = plane;
            this.render();
        }

        onDblClick = (event: MouseEvent, plane: ConstructionPlaneSnap) => {
            editor.activeViewport?.navigate();
            this.render();
        }
    }
    customElements.define('solidify-planes', Anon);
}
