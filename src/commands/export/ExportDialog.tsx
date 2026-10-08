import { render } from 'preact';
import { AbstractDialog } from "../../command/AbstractDialog";
import { EditorSignals } from "../../editor/EditorSignals";
import { ExportFactory, ExportFormat, ExportObjects, ExportParams, ExportQuality, ExportScope, ExportUnits } from "./ExportFactory";

const count = new Intl.NumberFormat();
const bytes = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export class ExportDialog extends AbstractDialog<ExportParams> {
    name = "Export";

    constructor(protected readonly params: ExportFactory, signals: EditorSignals) {
        super(signals);
    }

    private choice<T extends number>(name: keyof ExportParams, value: T, current: T, label: string, disabled = false) {
        const id = `export-${name}-${value}`;
        return <>
            <input type="radio" hidden name={name} id={id} value={value} checked={value === current} disabled={disabled} onClick={this.onChange}></input>
            <label class={`btn ${disabled ? 'opacity-40 pointer-events-none' : ''}`} for={id}>{label}</label>
        </>;
    }

    render() {
        const { format, scope, quality, tolerance, angle, units, objects, hasSelection, summary } = this.params;
        const meshed = format !== ExportFormat.STEP;
        const unit = units === ExportUnits.Inches ? 'in' : 'mm';
        const length = (mm: number) => units === ExportUnits.Inches ? (mm / 25.4).toFixed(3) : mm.toFixed(2);
        const size = summary?.bounds === undefined ? undefined :
            [0, 1, 2].map(k => length(summary.bounds!.max[k] - summary.bounds!.min[k])).join(' × ') + ` ${unit}`;

        render(
            <>
                <ul>
                    <li>
                        <label>Format
                            <solidify-tooltip>3MF keeps units, names and a picture, and slicers prefer it. STL is read everywhere. STEP keeps the exact geometry, for other CAD apps.</solidify-tooltip>
                        </label>
                        <div class="fields">
                            {this.choice('format', ExportFormat.ThreeMF, format, '3MF')}
                            {this.choice('format', ExportFormat.STL, format, 'STL')}
                            {this.choice('format', ExportFormat.OBJ, format, 'OBJ')}
                            {this.choice('format', ExportFormat.STEP, format, 'STEP')}
                        </div>
                    </li>
                    <li>
                        <label>What</label>
                        <div class="fields">
                            {this.choice('scope', ExportScope.Selection, scope, 'Selected', !hasSelection)}
                            {this.choice('scope', ExportScope.Visible, scope, 'Visible')}
                            {this.choice('scope', ExportScope.All, scope, 'All')}
                        </div>
                    </li>
                    {meshed && <li>
                        <label>Quality
                            <solidify-tooltip>How closely the triangles follow curved surfaces. Finer is smoother and makes larger files.</solidify-tooltip>
                        </label>
                        <div class="fields">
                            {this.choice('quality', ExportQuality.Draft, quality, 'Draft')}
                            {this.choice('quality', ExportQuality.Normal, quality, 'Normal')}
                            {this.choice('quality', ExportQuality.Fine, quality, 'Fine')}
                            {this.choice('quality', ExportQuality.Custom, quality, 'Custom')}
                        </div>
                    </li>}
                    {meshed && quality === ExportQuality.Custom && <>
                        <li>
                            <label for="tolerance">Tolerance
                                <solidify-tooltip>How far the triangles may stray from the surface.</solidify-tooltip>
                            </label>
                            <div class="fields">
                                <solidify-number-scrubber name="tolerance" unit="mm" precision={4} min={0.0001} value={tolerance} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                            </div>
                        </li>
                        <li>
                            <label for="angle">Angle
                                <solidify-tooltip>How much neighboring triangles may turn, which adds detail to tight curves.</solidify-tooltip>
                            </label>
                            <div class="fields">
                                <solidify-number-scrubber name="angle" unit="°" min={0.1} max={90} value={angle} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                            </div>
                        </li>
                    </>}
                    <li>
                        <label>Units
                            <solidify-tooltip>STL and OBJ don't say their units, and slicers take them to be millimeters.</solidify-tooltip>
                        </label>
                        <div class="fields">
                            {this.choice('units', ExportUnits.Millimeters, units, 'mm')}
                            {this.choice('units', ExportUnits.Inches, units, 'in')}
                        </div>
                    </li>
                    {(format === ExportFormat.ThreeMF || format === ExportFormat.OBJ) && <li>
                        <label>Objects
                            <solidify-tooltip>Separate objects can be arranged and colored on their own in a slicer.</solidify-tooltip>
                        </label>
                        <div class="fields">
                            {this.choice('objects', ExportObjects.Separate, objects, 'Separate')}
                            {this.choice('objects', ExportObjects.One, objects, 'One')}
                        </div>
                    </li>}
                </ul>
                <div class="px-3 pt-2 pb-1 text-xs text-neutral-300 space-y-0.5 select-text">
                    {summary === undefined ? <div>Measuring…</div> : summary.solids === 0 ? <div class="text-yellow-300">There's nothing to export.</div> : <>
                        <div>
                            {summary.solids === 1 ? '1 solid' : `${count.format(summary.solids)} solids`}
                            {summary.triangles !== undefined && ` · ${count.format(summary.triangles)} triangles`}
                            {summary.size !== undefined && ` · ${format === ExportFormat.STL ? '' : 'about '}${bytes(summary.size)}`}
                        </div>
                        {size !== undefined && <div>Size {size}</div>}
                        {summary.problems.map(problem => <div class="text-yellow-300">⚠ {problem}</div>)}
                    </>}
                </div>
            </>, this);
    }
}
customElements.define('export-dialog', ExportDialog);
