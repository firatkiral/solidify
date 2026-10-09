import { render } from 'preact';
import { Editor } from '../../editor/Editor';

export default (editor: Editor) => {
    class Undo extends HTMLElement {
        connectedCallback() {
            this.render();
            editor.signals.historyChanged.add(this.render);
            editor.signals.historyAdded.add(this.render);
        }

        disconnectedCallback() {
            editor.signals.historyChanged.remove(this.render);
            editor.signals.historyAdded.remove(this.render);
        }

        render = () => {
            render(
                <div class="p-4">
                    <h1 class="mb-4 text-xs font-bold text-ui-title">Undo history</h1>
                    <ol class="space-y-1">
                        {editor.history.undoStack.map(({ name }) =>
                            <li class="flex justify-between items-center py-0.5 px-3 rounded hover:bg-ui-hover">
                                <div class="text-xs text-ui-muted">{name}</div>
                            </li>
                        )}
                    </ol>

                </div>, this)
        }
    }

    customElements.define('solidify-undo-history', Undo);
}