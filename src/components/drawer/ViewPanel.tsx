import { render } from 'preact';
import { Editor } from '../../editor/Editor';
import black_silhouette_png from '../../img/matcap/black_silhouette.png';
import ceramic_dark from '../../img/matcap/ceramic_dark.exr';
import ceramic_dark_png from '../../img/matcap/ceramic_dark.png';
import color_matcap_png from '../../img/matcap/color_matcap.png';
import color_silhouette_png from '../../img/matcap/color_silhouette.png';
import metal_carpaint from '../../img/matcap/metal_carpaint.exr';
import metal_carpaint_png from '../../img/matcap/metal_carpaint.png';
import reflection_check_horizontal from '../../img/matcap/reflection_check_horizontal.exr';
import reflection_check_horizontal_png from '../../img/matcap/reflection_check_horizontal.png';
import reflection_check_vertical from '../../img/matcap/reflection_check_vertical.exr';
import reflection_check_vertical_png from '../../img/matcap/reflection_check_vertical.png';
import { MaterialMode } from '../../visual_model/RenderedSceneBuilder';
import { Viewport } from '../viewport/Viewport';

// The shadings that override the materials: a matcap, or a material mode
const shadings: { name: string, image: string, apply: (viewport: Viewport) => void }[] = [
    { name: "Ceramic", image: ceramic_dark_png, apply: viewport => viewport.matcap = ceramic_dark },
    { name: "Car paint", image: metal_carpaint_png, apply: viewport => viewport.matcap = metal_carpaint },
    { name: "Horizontal stripes", image: reflection_check_horizontal_png, apply: viewport => viewport.matcap = reflection_check_horizontal },
    { name: "Vertical stripes", image: reflection_check_vertical_png, apply: viewport => viewport.matcap = reflection_check_vertical },
    ...([
        ["Colored", color_matcap_png, 'colored-matcap'],
        ["Black silhouette", black_silhouette_png, 'black-silhouette'],
        ["Colored silhouette", color_silhouette_png, 'colored-silhouette'],
    ] as [string, string, MaterialMode][]).map(([name, image, mode]) => ({ name, image, apply: (viewport: Viewport) => viewport.material = mode })),
];

const section = "px-2 mt-4 mb-1 text-[11px] font-semibold tracking-wider uppercase first:mt-0 text-ui-faint";

export default (editor: Editor) => {
    // How the viewport shows the model: its camera, what's drawn over the model, and how the model's shaded
    class ViewPanel extends HTMLElement {
        private readonly viewport = editor.activeViewport;

        connectedCallback() {
            this.viewport.changed.add(this.render);
            this.render();
        }

        disconnectedCallback() {
            this.viewport.changed.remove(this.render);
        }

        render = () => {
            const { viewport } = this;
            const perspective = viewport.camera.isPerspectiveCamera;
            render(
                <>
                    <div class="panel-header">
                        <solidify-icon name="render-mode"></solidify-icon>
                        <h1 class="panel-title">View</h1>
                    </div>
                    <div class="p-4">
                        <h2 class={section}>Camera</h2>
                        <div class="flex gap-0.5 p-0.5 rounded-md bg-ui-raised">
                            {this.segment("Perspective", perspective, () => { if (!perspective) viewport.togglePerspective() })}
                            {this.segment("Orthographic", !perspective, () => { if (perspective) viewport.togglePerspective() })}
                        </div>
                        {/* An orthographic camera has none */}
                        {perspective &&
                            <div class="flex items-center px-2 py-1.5 mt-1 space-x-2">
                                <span class="flex-grow text-xs whitespace-nowrap text-ui-muted">Field of view</span>
                                <solidify-number-scrubber
                                    class="block flex-none w-16"
                                    name="fov"
                                    precision={1}
                                    min={1}
                                    max={90}
                                    value={viewport.fov}
                                    onscrub={e => viewport.fov = e.value}
                                    onchange={e => viewport.fov = e.value}
                                    onfinish={() => { }}
                                ></solidify-number-scrubber>
                            </div>
                        }

                        <h2 class={section}>Display</h2>
                        {this.toggle("Overlays", viewport.showOverlays, () => viewport.toggleOverlays())}
                        {this.toggle("X-ray", viewport.isXRay, () => viewport.toggleXRay())}

                        <h2 class={section}>Shading</h2>
                        {this.toggle("Show edges", viewport.isShowingEdges, () => { viewport.toggleEdges(); this.render() })}
                        {this.toggle("Show faces", viewport.isShowingFaces, () => { viewport.toggleFaces(); this.render() })}
                        {this.toggle("Override materials", !viewport.isRenderMode, () => viewport.isRenderMode = !viewport.isRenderMode)}
                        {!viewport.isRenderMode &&
                            <div class="grid grid-cols-4 gap-2 px-2 my-2">
                                {shadings.map(({ name, image, apply }) =>
                                    <img src={image} alt={name} class="block w-full rounded-full cursor-pointer hover:ring-2 hover:ring-ui-accent" onClick={() => apply(viewport)} />
                                )}
                            </div>
                        }
                    </div>
                </>, this);
        }

        private segment(name: string, on: boolean, onClick: () => void) {
            return <button class={`flex-1 px-2 py-1 min-w-0 text-[11px] truncate rounded ${on ? 'bg-ui-tint text-ui-accent' : 'text-ui-muted hover:text-ui-title'}`} aria-pressed={on} onClick={onClick}>{name}</button>
        }

        private toggle(name: string, on: boolean, onClick: () => void) {
            return <button class="flex items-center px-2 py-1.5 w-full rounded-md hover:bg-ui-hover" role="switch" aria-checked={on} onClick={onClick}>
                <span class={`flex-grow text-xs text-left ${on ? 'text-ui-text' : 'text-ui-muted'}`}>{name}</span>
                <span class={`relative flex-none w-7 h-4 rounded-full ${on ? 'bg-ui-tint' : 'bg-ui-hover'}`}>
                    <span class={`absolute top-0.5 w-3 h-3 rounded-full ${on ? 'left-3.5 bg-ui-accent' : 'left-0.5 bg-ui-muted'}`}></span>
                </span>
            </button>
        }
    }
    customElements.define('solidify-view-panel', ViewPanel);
}
