import { render } from 'preact';
import { AbstractDialog } from "../../command/AbstractDialog";
import { EditorSignals } from "../../editor/EditorSignals";
import { EvolutionParams, Mode } from './EvolutionFactory';

export class EvolutionDialog extends AbstractDialog<EvolutionParams> {
    readonly name = "Evolution";

    constructor(protected readonly params: EvolutionParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { thickness1, thickness2, mode } = this.params;

        render(
            <>
                <ol>
                <solidify-prompt name="Select region or face" description="to sweep"></solidify-prompt>
                <solidify-prompt name="Select curve" description="to sweep along"></solidify-prompt>
                </ol>

                <ul>
                    <li>
                        <label for="thickness1">Thickness 1 </label>
                        <div class="fields">
                            <solidify-number-scrubber name="thickness1" value={thickness1} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label for="thickness2">Thickness 1 </label>
                        <div class="fields">
                            <solidify-number-scrubber name="thickness2" value={thickness2} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label for="mode">Mode</label>
                        <div class="fields">
                            <input type="radio" hidden name="mode" id="parallel" value={Mode.Parallel} checked={mode === Mode.Parallel} onClick={this.onChange}></input>
                            <label for="parallel">Parallel</label>

                            <input type="radio" hidden name="mode" id="preserve-angle" value={Mode.PreserveAngle} checked={mode === Mode.PreserveAngle} onClick={this.onChange}></input>
                            <label for="preserve-angle">Preserve</label>

                            <input type="radio" hidden name="mode" id="orthogonal" value={Mode.Orthogonal} checked={mode === Mode.Orthogonal} onClick={this.onChange}></input>
                            <label for="orthogonal">Orthogonal</label>
                        </div>
                    </li>
                </ul></>, this);
    }
}
customElements.define('solidify-evolution-dialog', EvolutionDialog);
