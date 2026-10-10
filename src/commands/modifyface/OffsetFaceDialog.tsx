import { render } from 'preact';
import { EditorSignals } from "../../editor/EditorSignals";
import { AbstractDialog } from "../../command/AbstractDialog";
import { Measure } from "../../command/MiniGizmos";
import { OffsetFaceParams } from "./OffsetFaceFactory";
import { Agent } from '../../editor/DatabaseLike';

export class OffsetFaceDialog extends AbstractDialog<OffsetFaceParams> {
    name = "Offset face";

    // measure: what the distance shows instead of the offset, if anything (see OffsetFaceGizmo)
    constructor(protected readonly params: OffsetFaceParams, private readonly agent: Agent, signals: EditorSignals, private readonly measure: () => Measure | undefined = () => undefined) {
        super(signals);
    }

    protected fromShown(key: string, value: any) {
        const measure = this.measure();
        return key === 'distance' && measure !== undefined ? measure.value(value) : value;
    }

    render() {
        const { agent } = this;
        const { distance, degrees } = this.params;
        const measure = this.measure();

        render(
            <>
                <ul>
                    {agent === 'user' &&
                        <ol>
                            <solidify-prompt name="Select edges" description="to fillet or chamfer"></solidify-prompt>
                        </ol>
                    }
                    <li>
                        <label for="distance">Distance</label>
                        <div class="fields">
                            <solidify-number-scrubber unit="length" name="distance" value={measure?.shown(distance) ?? distance} measure={measure?.name} onmeasure={() => this.switchMeasure(measure)} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label for="degrees">Degrees</label>
                        <div class="fields">
                            <solidify-number-scrubber name="degrees" value={degrees} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                </ul>
            </>, this);
    }
}
customElements.define('offset-face-dialog', OffsetFaceDialog);
