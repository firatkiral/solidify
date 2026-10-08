import { render } from 'preact';
import { Editor } from '../../editor/Editor';
import { registerServiceWorker, switchToUpdate } from '../../startup/ServiceWorker';

// Tells the app that a new version has been deployed and downloaded, or that one has replaced the code it still needs
// to load. Reloading switches to it, and brings the document back from its autosave.
export default (editor: Editor) => {
    class UpdateNotice extends HTMLElement {
        private state: 'none' | 'available' | 'required' = 'none';
        private dismissed = false;

        connectedCallback() {
            registerServiceWorker(() => {
                if (this.state !== 'none' || this.dismissed) return;
                this.state = 'available';
                this.render();
            });
            // A deploy removes the code the last one had; when this window can't load a part of it, only a reload helps
            window.addEventListener('vite:preloadError', e => {
                e.preventDefault();
                this.state = 'required';
                this.render();
            });
        }

        private reload = async () => {
            await switchToUpdate();
            editor.reload();
        }

        private later = () => {
            this.dismissed = true;
            this.state = 'none';
            this.render();
        }

        render() {
            if (this.state === 'none') {
                render(null, this);
                return;
            }
            const required = this.state === 'required';
            render(
                <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 pl-4 pr-2 py-2 rounded-lg bg-neutral-800 text-sm text-neutral-100 shadow-black/40 shadow-xl ring-1 ring-neutral-600 ring-opacity-5" role="status">
                    <span>{required ? "Solidify was updated, and needs a reload to go on." : "A new version of Solidify is ready."}</span>
                    <button class="px-3 py-1 rounded-md bg-accent-600 hover:bg-accent-500" onClick={this.reload}>Reload</button>
                    {!required && <button class="px-3 py-1 rounded-md bg-white/10 hover:bg-white/20" onClick={this.later}>Later</button>}
                </div>, this);
        }
    }
    customElements.define('solidify-update-notice', UpdateNotice);
}
