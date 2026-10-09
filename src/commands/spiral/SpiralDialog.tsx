import { render } from 'preact';
import { AbstractDialog } from "../../command/AbstractDialog";
import { EditorSignals } from "../../editor/EditorSignals";
import { SpiralParams } from './SpiralFactory';

export class SpiralDialog extends AbstractDialog<SpiralParams> {
    name = "Spiral";

    constructor(protected readonly params: SpiralParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { step, radius, degrees } = this.params;

        render(
            <>
                <ul>
                    <li>
                        <label for="step">Step</label>
                        <div class="fields">
                            <solidify-number-scrubber unit="length" name="step" value={step} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label for="step">Radius</label>
                        <div class="fields">
                            <solidify-number-scrubber name="radius" unit="length" value={radius} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label for="degrees">Angle</label>
                        <div class="fields">
                            <solidify-number-scrubber name="degrees" unit="°" value={degrees} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                </ul></>, this);
    }
}
customElements.define('solidify-spiral-dialog', SpiralDialog);
