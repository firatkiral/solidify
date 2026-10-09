import { render } from 'preact';
import { EditorSignals } from "../../editor/EditorSignals";
import { AbstractDialog } from "../../command/AbstractDialog";
import { EditSphereParams } from "./SphereFactory";

export class SphereDialog extends AbstractDialog<EditSphereParams> {
    name = "Sphere";

    constructor(protected readonly params: EditSphereParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { radius } = this.params;

        render(
            <>
                <ol>
                    <solidify-prompt name="Select target bodies" description="to cut or join into"></solidify-prompt>
                </ol>

                <ul>
                    <li>
                        <label for="radius">Radius</label>
                        <div class="fields">
                            <solidify-number-scrubber name="radius" unit="length" min={0.01} value={radius} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                </ul>
            </>, this);
    }
}
customElements.define('sphere-dialog', SphereDialog);
