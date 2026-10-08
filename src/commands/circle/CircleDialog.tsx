import { render } from 'preact';
import { EditorSignals } from "../../editor/EditorSignals";
import { AbstractDialog } from "../../command/AbstractDialog";
import { EditCircleParams } from './CircleFactory';

export class CircleDialog extends AbstractDialog<EditCircleParams> {
    name = "Circle";

    constructor(protected readonly params: EditCircleParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { radius } = this.params;

        render(
            <>
                <ul>
                    <li>
                        <label for="radius">Radius</label>
                        <div class="fields">
                            <solidify-number-scrubber name="radius" unit="mm" value={radius} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                </ul>
            </>, this);
    }
}
customElements.define('solidify-center-circle-dialog', CircleDialog);
