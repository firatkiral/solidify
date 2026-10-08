import { render } from 'preact';
import { EditorSignals } from "../../editor/EditorSignals";
import { AbstractDialog } from "../../command/AbstractDialog";
import { EditRectangleParams } from './RectangleFactory';

export class RectangleDialog extends AbstractDialog<EditRectangleParams> {
    name = "Rectangle";

    constructor(protected readonly params: EditRectangleParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { width, length } = this.params;

        render(
            <>
                <ul>
                    <li>
                        <label for="width">Width</label>
                        <div class="fields">
                            <solidify-number-scrubber name="width" unit="mm" value={width} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>

                    <li>
                        <label for="length">Length</label>
                        <div class="fields">
                            <solidify-number-scrubber name="length" unit="mm" value={length} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>

                </ul>
            </>, this);
    }
}
customElements.define('solidify-rectangle-dialog', RectangleDialog);
