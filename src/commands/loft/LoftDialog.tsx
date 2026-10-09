import { render } from 'preact';
import { AbstractDialog } from "../../command/AbstractDialog";
import { EditorSignals } from "../../editor/EditorSignals";
import { LoftParams } from "./LoftFactory";


export class LoftDialog extends AbstractDialog<LoftParams> {
    name = "Loft";

    constructor(protected readonly params: LoftParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { thickness1, thickness2, closed } = this.params;
        
        render(
            <>
                <ol>
                    <solidify-prompt name="Select spine" description="to loft along"></solidify-prompt>
                </ol>

                <ul>
                    <li>
                        <label>Thickness</label>
                        <div class="fields">
                            <solidify-number-scrubber unit="length" name="thickness1" value={thickness1} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                            <solidify-number-scrubber unit="length" name="thickness2" value={thickness2} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>

                    <li>
                        <label for="closed">Closed</label>
                        <div class="fields">
                            <input type="checkbox" hidden id="closed" name="closed" checked={closed} onClick={this.onChange}></input>
                            <label for="closed">Closed</label>
                        </div>
                    </li>
                </ul>
            </>, this);
    }
}

customElements.define('loft-dialog', LoftDialog);
