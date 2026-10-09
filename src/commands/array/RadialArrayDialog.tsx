import { render } from 'preact';
import { AbstractDialog } from "../../command/AbstractDialog";
import { EditorSignals } from "../../editor/EditorSignals";
import { RadialArrayParams } from "./ArrayFactory";

export class RadialArrayDialog extends AbstractDialog<RadialArrayParams> {
    readonly name = "Radial array";

    constructor(protected readonly params: RadialArrayParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { step1, num1, degrees, num2 } = this.params;

        render(
            <>
                <ol>
                    <solidify-prompt name="Select solids or curves" description="to duplicate"></solidify-prompt>
                    <solidify-prompt name="Select center point" description="to orient around"></solidify-prompt>
                </ol>

                <ul>
                    {/* <li>
                        <label for="isAlongAxis">Is along axis</label>
                        <div class="fields">
                            <input type="checkbox" hidden id="isAlongAxis" name="isAlongAxis" checked={isAlongAxis} onClick={this.onChange}></input>
                            <label for="isAlongAxis">Add tangent edges</label>
                        </div>
                    </li> */}

                    <li>
                        <label for="degrees">Degrees</label>
                        <div class="fields">
                            <solidify-number-scrubber precision={1} name="degrees" value={degrees} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label for="num2">Number</label>
                        <div class="fields">
                            <solidify-number-scrubber precision={1} name="num2" value={num2} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label for="num1">Repeat</label>
                        <div class="fields">
                            <solidify-number-scrubber precision={1} name="num1" value={num1} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label for="step1">Repeat distance</label>
                        <div class="fields">
                            <solidify-number-scrubber name="step1" unit="length" value={step1} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                </ul></>, this);
    }
}
customElements.define('solidify-array-dialog', RadialArrayDialog);
