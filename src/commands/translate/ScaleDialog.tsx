import { render } from 'preact';
import { EditorSignals } from "../../editor/EditorSignals";
import { AbstractDialog } from "../../command/AbstractDialog";
import { ScaleParams } from "./TranslateItemFactory";

export class ScaleDialog extends AbstractDialog<ScaleParams> {
    name = "Scale";

    constructor(protected readonly params: ScaleParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { scale } = this.params;

        render(
            <>
                <ul>
                    <li>
                        <label for="scale">XYZ</label>
                        <div class="fields">
                            <solidify-number-scrubber name="scale.x" value={scale.x} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                            <solidify-number-scrubber name="scale.y" value={scale.y} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                            <solidify-number-scrubber name="scale.z" value={scale.z} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                </ul>
            </>, this);
    }
}
customElements.define('scale-dialog', ScaleDialog);