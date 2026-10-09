import { render } from 'preact';
import c3d from '../../kernel/kernel';
import { AbstractDialog } from "../../command/AbstractDialog";
import { EditorSignals } from "../../editor/EditorSignals";
import { OffsetImprintParams } from "./OffsetContourFactory";

export class OffsetCurveDialog extends AbstractDialog<OffsetImprintParams> {
    constructor(protected readonly params: OffsetImprintParams, readonly name: string, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { distance, gapFill } = this.params;

        render(
            <ul>
                <li>
                    <label for="distance">Distance</label>
                    <div class="fields">
                        <solidify-number-scrubber unit="length" name="distance" value={distance} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                    </div>
                </li>
                <li>
                    <label for="gapFill">Gap fill</label>
                    <div class="fields">
                        <input type="radio" hidden name="gapFill" id="offset-gap-round" value={c3d.OffsetGapFill.Round} checked={gapFill === c3d.OffsetGapFill.Round} onClick={this.onChange}></input>
                        <label for="offset-gap-round">Round</label>
                        <input type="radio" hidden name="gapFill" id="offset-gap-linear" value={c3d.OffsetGapFill.Linear} checked={gapFill === c3d.OffsetGapFill.Linear} onClick={this.onChange}></input>
                        <label for="offset-gap-linear">Linear</label>
                        <input type="radio" hidden name="gapFill" id="offset-gap-natural" value={c3d.OffsetGapFill.Natural} checked={gapFill === c3d.OffsetGapFill.Natural} onClick={this.onChange}></input>
                        <label for="offset-gap-natural">Natural</label>
                    </div>
                </li>
            </ul>, this);
    }
}
customElements.define('offset-curve-dialog', OffsetCurveDialog);
