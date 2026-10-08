import { render } from 'preact';
import { EditorSignals } from "../../editor/EditorSignals";
import { AbstractDialog } from "../../command/AbstractDialog";
import { ThinSolidParams } from "./ThinSolidFactory";

export class ThinSolidDialog extends AbstractDialog<ThinSolidParams> {
    name = "Thin solid";

    constructor(protected readonly params: ThinSolidParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        let { thickness1, thickness2 } = this.params;

        render(
            <>
                <ul>
                    <li>
                        <label>Thickness</label>
                        <div class="fields">
                            <solidify-number-scrubber name="thickness1" value={thickness1} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                            <solidify-number-scrubber name="thickness2" value={thickness2} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                </ul></>, this);
    }
}
customElements.define('solidify-thin-solid-dialog', ThinSolidDialog);
