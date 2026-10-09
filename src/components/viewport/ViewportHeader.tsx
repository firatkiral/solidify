import { render } from 'preact';
import { Editor } from '../../editor/Editor';
import { PlaneDatabase } from '../../editor/PlaneDatabase';
import { ConstructionPlaneSnap } from '../../editor/snaps/ConstructionPlaneSnap';
import { ViewportElement } from './Viewport';

export default (editor: Editor) => {
    class Header extends HTMLElement {
        constructor() {
            super();
            this.render = this.render.bind(this);
        }

        connectedCallback() {
            this.render();
            this.viewport.changed.add(this.render);
        }

        disconnectedCallback() {
            this.viewport.changed.remove(this.render);
        }

        get viewport() {
            const element = this.parentNode as unknown as ViewportElement;
            return element.model;
        }

        render() {
            const { viewport: { constructionPlane } } = this;
            const result = (
                // Along the top, the construction plane when it isn't the ground. The side columns keep clear of the File
                // menu and the navigator, and share what's left equally, so it's centred unless that would crowd the
                // navigator. Only it takes the pointer: the space around it is the viewport's
                <div class="grid absolute top-2 left-2 z-40 grid-cols-[minmax(50px,1fr)_auto_minmax(178px,1fr)] items-center h-[42px] clear-of-drawer pointer-events-none">
                    {constructionPlane !== PlaneDatabase.XY &&
                        <div class="col-start-2 pointer-events-auto">
                            <div class={`flex justify-between items-center py-0.5 px-2 space-x-1 chip hover:bg-ui-hover ${constructionPlane.isTemp ? 'cursor-pointer' : ''}`} onClick={() => editor.planes.add(constructionPlane as ConstructionPlaneSnap)}>
                                <div class="p-1 text-xs text-ui-text group-hover:text-ui-title">{constructionPlane.isTemp ? "Temporary" : constructionPlane.name}</div>
                                {constructionPlane.isTemp &&
                                    <button class="p-1 rounded group text-ui-text">
                                        <solidify-icon name="save"></solidify-icon>
                                    </button>
                                }
                            </div>
                        </div>
                    }
                </div>
            );
            render(result, this);
        }
    }

    customElements.define('solidify-viewport-header', Header);
}
