import { render } from 'preact';
import { AbstractDialog } from "../../command/AbstractDialog";
import { EditorSignals } from "../../editor/EditorSignals";
import { RectangularArrayParams } from './ArrayFactory';

export class RectangularArrayDialog extends AbstractDialog<RectangularArrayParams> {
    readonly name = "Rectangular array";

    constructor(protected readonly params: RectangularArrayParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { distance1, distance2, num1, num2, step1, step2 } = this.params;

        render(
            <>
                <ol>
                    <solidify-prompt name="Select solids or curves" description="to duplicate"></solidify-prompt>
                    <solidify-prompt name="Select endpoint 1" description="of the first direction of the array"></solidify-prompt>
                    <solidify-prompt name="Select endpoint 2" description="of the second direction of the array"></solidify-prompt>
                </ol>

                <ul>
                    <li>
                        <label for="distance1">Distance 1</label>
                        <div class="fields">
                            <solidify-number-scrubber name="distance1" unit="length" value={distance1} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label for="num1">Number</label>
                        <div class="fields">
                            <solidify-number-scrubber precision={1} name="num1" value={num1} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label for="distance2">Distance 2</label>
                        <div class="fields">
                            <solidify-number-scrubber name="distance2" unit="length" value={distance2} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label for="num2">Repeat</label>
                        <div class="fields">
                            <solidify-number-scrubber precision={1} name="num2" value={num2} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                </ul></>, this);
    }
}
customElements.define('solidify-rectangular-array-dialog', RectangularArrayDialog);
