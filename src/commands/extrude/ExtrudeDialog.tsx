import { render } from 'preact';
import c3d from '../../kernel/kernel';
import { EditorSignals } from "../../editor/EditorSignals";
import { AbstractDialog } from "../../command/AbstractDialog";
import { Measure } from "../../command/MiniGizmos";
import * as visual from '../../visual_model/VisualModel';
import { ExtrudeParams, NewBody } from './ExtrudeFactory';

type ExtrudeDialogParams = ExtrudeParams & { symmetric: boolean, operation: number, readonly targets: visual.Solid[] };

export class ExtrudeDialog extends AbstractDialog<ExtrudeDialogParams> {
    name = "Extrude";

    // measure: what the first distance shows instead of the distance, if anything (see ExtrudeCommand)
    constructor(protected readonly params: ExtrudeDialogParams, signals: EditorSignals, private readonly measure: () => Measure | undefined = () => undefined) {
        super(signals);
    }

    protected fromShown(key: string, value: any) {
        const measure = this.measure();
        return key === 'distance1' && measure !== undefined ? measure.value(value) : value;
    }

    render() {
        const { distance1, distance2, symmetric, operation, targets, race1, race2, thickness1, thickness2 } = this.params;
        const measure = this.measure();
        const choice = (id: string, label: string, value: number) => <>
            <input type="radio" hidden name="operation" id={id} value={value} checked={operation === value} onClick={this.onChange}></input>
            <label for={id}>{label}</label>
        </>;

        render(
            <>
                <ol>
                    <solidify-prompt name="Select target bodies" description="to cut or join into"></solidify-prompt>
                </ol>

                <ul>
                    {targets.length > 0 && <li>
                        <label>Operation</label>
                        <div class="fields compact">
                            {choice('extrude-union', "Union", c3d.OperationType.Union)}
                            {choice('extrude-difference', "Difference", c3d.OperationType.Difference)}
                            {choice('extrude-intersect', "Intersect", c3d.OperationType.Intersect)}
                            {choice('extrude-new-body', "New", NewBody)}
                        </div>
                    </li>}
                    <li>
                        <label for="distance">Distance</label>
                        <div class="fields">
                            <solidify-number-scrubber name="distance1" unit="length" value={measure?.shown(distance1) ?? distance1} measure={measure?.name} onmeasure={() => this.switchMeasure(measure)} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                            <solidify-number-scrubber name="distance2" unit="length" value={distance2} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label for="symmetric">Symmetric</label>
                        <div class="fields">
                            <input type="checkbox" hidden id="symmetric" name="symmetric" checked={symmetric} onClick={this.onChange}></input>
                            <label for="symmetric">Symmetric</label>
                        </div>
                    </li>
                    <li>
                        <label>Race (angle)</label>
                        <div class="fields">
                            <solidify-number-scrubber name="race1" value={race1} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                            <solidify-number-scrubber name="race2" value={race2} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                    <li>
                        <label>Thickness</label>
                        <div class="fields">
                            <solidify-number-scrubber name="thickness1" unit="length" value={thickness1} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                            <solidify-number-scrubber name="thickness2" unit="length" value={thickness2} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                </ul>
            </>, this);
    }
}
customElements.define('extrude-dialog', ExtrudeDialog);
