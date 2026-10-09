import { render } from 'preact';
import { AbstractDialog } from "../../command/AbstractDialog";
import { EditorSignals } from "../../editor/EditorSignals";
import { EditBoxParams } from "./BoxFactory";

export class BoxDialog extends AbstractDialog<EditBoxParams> {
    name = "Box";

    constructor(protected readonly params: EditBoxParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { width, length, height } = this.params;

        render(
            <>
                <ol>
                    <solidify-prompt name="Select target bodies" description="to cut or join into"></solidify-prompt>
                </ol>

                <ul>
                    <li>
                        <label for="width">Width</label>
                        <div class="fields">
                            <solidify-number-scrubber name="width" unit="length" value={width} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label for="length">Length</label>
                        <div class="fields">
                            <solidify-number-scrubber name="length" unit="length" value={length} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label for="height">Height</label>
                        <div class="fields">
                            <solidify-number-scrubber name="height" unit="length" value={height} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>

                </ul>
            </>, this);
    }
}
customElements.define('box-dialog', BoxDialog);
