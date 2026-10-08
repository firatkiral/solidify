import { render } from 'preact';
import { EditorSignals } from "../../editor/EditorSignals";
import { AbstractDialog } from "../../command/AbstractDialog";
import { BridgeCurvesParams } from './BridgeCurvesFactory';

const levels = [0, 1, 2, 3];

export class BridgeCurvesDialog extends AbstractDialog<BridgeCurvesParams> {
    name = "Bridge curve";

    constructor(protected readonly params: BridgeCurvesParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { t1, t2, direction1, direction2, tension1, tension2, startCurvature, endCurvature, trim } = this.params;
        const continuity = (name: 'startCurvature' | 'endCurvature', value: number) => levels.map(g => <>
            <input type="radio" hidden name={name} id={`${name}_g${g}`} value={g} checked={value === g} onClick={this.onChange}></input>
            <label for={`${name}_g${g}`}>G{g}</label>
        </>);
        // Tension 1 does nothing at a G0 end, tension 2 below G2
        const unused = 'opacity-40 pointer-events-none';
        const tensions = (row: number[], name: string, minimum: number, min: number) => <>
            <solidify-number-scrubber name={`${name}.0`} value={row[0]} min={min} class={startCurvature < minimum ? unused : ''} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
            <solidify-number-scrubber name={`${name}.1`} value={row[1]} min={min} class={endCurvature < minimum ? unused : ''} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
        </>;

        render(
            <ul>
                <li>
                    <label for="t">T (0–1)</label>
                    <div class="fields">
                        <solidify-number-scrubber name="t1" value={t1} min={0} max={1} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        <solidify-number-scrubber name="t2" value={t2} min={0} max={1} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                    </div>
                </li>
                <li>
                    <label for="direction">Direction</label>
                    <div class="fields">
                        <input type="checkbox" hidden id="direction1" name="direction1" checked={direction1} onClick={this.onChange}></input>
                        <label for="direction1">Direction 1</label>
                        <input type="checkbox" hidden id="direction2" name="direction2" checked={direction2} onClick={this.onChange}></input>
                        <label for="direction2">Direction 2</label>
                    </div>
                </li>
                <li class={startCurvature < 1 && endCurvature < 1 ? 'disabled' : ''}>
                    <label for="tension1">Tension 1 (×)</label>
                    <div class="fields">{tensions(tension1, 'tension1', 1, 0.01)}</div>
                </li>
                <li class={startCurvature < 2 && endCurvature < 2 ? 'disabled' : ''}>
                    <label for="tension2">Tension 2 (×)</label>
                    <div class="fields">{tensions(tension2, 'tension2', 2, 0)}</div>
                </li>
                <li>
                    <label for="startCurvature">Start curvature</label>
                    <div class="fields">{continuity('startCurvature', startCurvature)}</div>
                </li>
                <li>
                    <label for="endCurvature">End curvature</label>
                    <div class="fields">{continuity('endCurvature', endCurvature)}</div>
                </li>
                <li>
                    <label for="trim">Trim</label>
                    <div class="fields">
                        <input type="checkbox" hidden id="trim" name="trim" checked={trim} onClick={this.onChange}></input>
                        <label for="trim">Trim</label>
                    </div>
                </li>
            </ul>, this);
    }
}
customElements.define('solidify-bridge-curves-dialog', BridgeCurvesDialog);
