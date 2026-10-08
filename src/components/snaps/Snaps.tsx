import { render } from 'preact';
import { PointPickerModel } from "../../command/point-picker/PointPickerModel";
import { Editor } from '../../editor/Editor';
import { Snap } from "../../editor/snaps/Snap";
import * as visual from '../../visual_model/VisualModel';
import { Viewport } from '../viewport/Viewport';

const objectLayers = [
    { layer: visual.Layers.Face, icon: 'face', name: "Face" },
    { layer: visual.Layers.Curve, icon: 'curve', name: "Curve" },
    { layer: visual.Layers.CurveEdge, icon: 'edge', name: "Edge" },
];

const millimeters = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'millimeter', unitDisplay: 'short', maximumFractionDigits: 4 });
const degrees = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'degree', unitDisplay: 'narrow', maximumFractionDigits: 0 });

const title = "py-0.5 px-2 mb-4 text-xs font-bold truncate text-neutral-100";

export default (editor: Editor) => {
    class Anon extends HTMLElement {
        private snaps = new Set<Snap>();
        private pointPicker?: PointPickerModel;
        private viewport?: Viewport;

        connectedCallback() {
            editor.signals.snapsAdded.add(this.add);
            editor.signals.snapsCleared.add(this.delete);
            editor.signals.snapsEnabled.add(this.render);
            editor.signals.snapsDisabled.add(this.render);
            editor.signals.viewportActivated.add(this.render);
            this.render();
        }

        disconnectedCallback() {
            editor.signals.snapsAdded.remove(this.add);
            editor.signals.snapsCleared.remove(this.delete);
            editor.signals.snapsEnabled.remove(this.render);
            editor.signals.snapsDisabled.remove(this.render);
            editor.signals.viewportActivated.remove(this.render);
            this.viewport?.changed.remove(this.render);
        }

        add = (info: { snaps: Snap[], pointPicker: PointPickerModel }) => {
            for (const snap of info.snaps) this.snaps.add(snap);
            this.pointPicker = info.pointPicker;
            this.render();
        }

        delete = (snaps: Snap[]) => {
            this.snaps.clear();
            this.pointPicker = undefined;
            this.render();
        }

        // The grid size shown is the active viewport's, so follow that viewport's changes (e.g. shift-wheel resizing).
        private watchActiveViewport() {
            const viewport = editor.activeViewport;
            if (viewport === this.viewport) return;
            this.viewport?.changed.remove(this.render);
            viewport?.changed.add(this.render);
            this.viewport = viewport;
        }

        // Toggles show what is in effect: their setting, or on while Shift/Ctrl is held. Clicking one changes the setting.
        render = () => {
            this.watchActiveViewport();
            const { snaps } = editor;
            const { viewport, pointPicker } = this;
            render(
                <div class="p-4">
                    <h1 class={title}>Snaps</h1>
                    <div class="flex items-center px-2 space-x-1">
                        {this.toggle('snap-grid', snaps.snapToGrid, "Snap points to the grid (hold Shift)", this.toggleGrid)}
                        {this.stepper(viewport !== undefined ? millimeters.format(viewport.gridSize) : '', "Grid size", true, this.shrinkGrid, this.growGrid)}
                    </div>
                    <div class="flex items-center px-2 mt-2 space-x-1">
                        {this.toggle('snap-gizmo', snaps.gizmoSnapping, "Step lengths and moves when dragging handles (hold Shift)", this.toggleGizmo)}
                        {this.stepper(millimeters.format(snaps.lengthStep), "Handle drag step for lengths", snaps.gizmoSnapping, () => this.stepLength(-1), () => this.stepLength(1))}
                    </div>
                    <div class="flex items-center px-2 mt-2 space-x-1">
                        {this.toggle('snap-angle', snaps.angleSnapping, "Step angles when dragging handles (hold Shift)", this.toggleAngle)}
                        {this.stepper(degrees.format(snaps.angleStep), "Handle drag step for angles", snaps.angleSnapping, () => this.stepAngle(-1), () => this.stepAngle(1))}
                    </div>
                    <ul class="px-2 mt-3 space-y-1">
                        {objectLayers.map(({ layer, icon, name }) => {
                            const on = snaps.activeLayers.isEnabled(layer);
                            return <li class="flex items-center pr-2 space-x-2 rounded cursor-pointer group hover:bg-neutral-700" role="switch" aria-checked={on} onClick={() => this.toggleLayer(layer)}>
                                <div class={`flex-none p-1 rounded ${on ? 'bg-white/10 text-accent-500' : 'text-neutral-500'}`}>
                                    <solidify-icon name={icon}></solidify-icon>
                                </div>
                                <div class={`flex-grow min-w-0 text-xs truncate ${on ? 'text-neutral-300 group-hover:text-neutral-100' : 'text-neutral-500'}`}>{name}</div>
                                <solidify-tooltip placement="left">{`Snap to ${name.toLowerCase()}s (hold Ctrl for all)`}</solidify-tooltip>
                            </li>
                        })}
                    </ul>
                    {pointPicker !== undefined &&
                        <div class="flex flex-wrap gap-1 px-2 mt-2">
                            {[...this.snaps].filter(snap => snap.name !== undefined).map(snap =>
                                <button key={snap.name} class={`px-2 py-1 text-xs rounded-md border border-white/[0.06] hover:bg-white/20 ${pointPicker.isEnabled(snap) ? 'bg-white/10 text-neutral-200' : 'bg-black/10 text-neutral-500'}`} onClick={() => this.toggleSnap(snap)}>
                                    {snap.name}
                                </button>
                            )}
                        </div>
                    }
                </div>, this);
        }

        private toggle(icon: string, on: boolean, tooltip: string, onClick: () => void) {
            return <button class={`flex-none p-1 rounded hover:bg-neutral-700 ${on ? 'bg-white/10 text-accent-500' : 'text-neutral-500'}`} role="switch" aria-checked={on} onClick={onClick}>
                <solidify-icon name={icon}></solidify-icon>
                <solidify-tooltip placement="left">{tooltip}</solidify-tooltip>
            </button>
        }

        // Dimmed while its toggle is off, but still adjustable.
        private stepper(value: string, tooltip: string, active: boolean, minus: () => void, plus: () => void) {
            return <div class={`flex flex-grow min-w-0 h-7 rounded-md border border-white/[0.06] text-neutral-300 ${active ? '' : 'opacity-50'}`}>
                <button class="flex flex-none items-center px-1 rounded-l-md border-r border-white/[0.06] hover:bg-white/20" onClick={minus}>
                    <solidify-icon name="minus"></solidify-icon>
                </button>
                <div class="flex flex-grow justify-center items-center min-w-0 text-xs">
                    <solidify-tooltip placement="left">{tooltip}</solidify-tooltip>
                    <span class="truncate">{value}</span>
                </div>
                <button class="flex flex-none items-center px-1 rounded-r-md border-l border-white/[0.06] hover:bg-white/20" onClick={plus}>
                    <solidify-icon name="plus"></solidify-icon>
                </button>
            </div>
        }

        toggleLayer = (layer: visual.Layers) => {
            editor.snaps.layers.toggle(layer);
            this.render();
        }

        toggleGrid = () => {
            editor.snaps.snapToGrid = !editor.snaps.snapToGridSetting;
            this.render();
        }

        toggleGizmo = () => {
            editor.snaps.gizmoSnapping = !editor.snaps.gizmoSnappingSetting;
            this.render();
        }

        toggleAngle = () => {
            editor.snaps.angleSnapping = !editor.snaps.angleSnappingSetting;
            this.render();
        }

        shrinkGrid = () => editor.activeViewport?.resizeGrid(-1);
        growGrid = () => editor.activeViewport?.resizeGrid(1);

        private stepLength(direction: 1 | -1) {
            editor.snaps.stepLengthStep(direction);
            this.render();
        }

        private stepAngle(direction: 1 | -1) {
            editor.snaps.stepAngleStep(direction);
            this.render();
        }

        toggleSnap = (snap: Snap) => {
            this.pointPicker!.toggle(snap);
            this.render();
        }
    }
    customElements.define('solidify-snaps', Anon);
}
