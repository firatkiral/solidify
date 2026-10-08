import { render } from 'preact';
import { EditorSignals } from "../../editor/EditorSignals";
import { AbstractDialog } from "../../command/AbstractDialog";
import { EditCenterPointArcParams, EditThreePointArcParams } from './ArcFactory';

export class CenterPointArcDialog extends AbstractDialog<EditCenterPointArcParams> {
    name = "Arc";

    constructor(protected readonly params: EditCenterPointArcParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { length, degrees } = this.params;

        render(
            <>
                <ul>
                    <li>
                        <label for="length">Length</label>
                        <div class="fields">
                            <solidify-number-scrubber name="length" unit="mm" min={0.01} value={length} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>

                    <li>
                        <label for="degrees">Angle</label>
                        <div class="fields">
                            <solidify-number-scrubber name="degrees" unit="°" precision={2} min={0.1} max={359.9} value={degrees} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                </ul>
            </>, this);
    }
}
customElements.define('solidify-center-point-arc-dialog', CenterPointArcDialog);

export class ThreePointArcDialog extends AbstractDialog<EditThreePointArcParams> {
    name = "Arc";

    constructor(protected readonly params: EditThreePointArcParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { length, height } = this.params;

        render(
            <>
                <ul>
                    <li>
                        <label for="length">Length</label>
                        <div class="fields">
                            <solidify-number-scrubber name="length" unit="mm" min={0.01} value={length} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>

                    <li>
                        <label for="height">Height</label>
                        <div class="fields">
                            <solidify-number-scrubber name="height" unit="mm" min={0.01} value={height} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                </ul>
            </>, this);
    }
}
customElements.define('solidify-three-point-arc-dialog', ThreePointArcDialog);
