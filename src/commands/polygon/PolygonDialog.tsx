import { render } from 'preact';
import { EditorSignals } from "../../editor/EditorSignals";
import { AbstractDialog } from "../../command/AbstractDialog";
import { EditPolygonParams } from './PolygonFactory';

export class PolygonDialog extends AbstractDialog<EditPolygonParams> {
    name = "Polygon";

    constructor(protected readonly params: EditPolygonParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { vertexCount, diameter, degrees } = this.params;

        render(
            <>
                <ul>
                    <li>
                        <label for="vertexCount">Vertices</label>
                        <div class="fields">
                            <solidify-number-scrubber name="vertexCount" precision={1} min={3} value={vertexCount} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>

                    <li>
                        <label for="diameter">Diameter</label>
                        <div class="fields">
                            <solidify-number-scrubber name="diameter" unit="length" min={0.01} value={diameter} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>

                    <li>
                        <label for="degrees">Rotation</label>
                        <div class="fields">
                            <solidify-number-scrubber name="degrees" unit="°" precision={2} value={degrees} onchange={this.onChange} onscrub={this.onChange} onfinish={this.onChange}></solidify-number-scrubber>
                        </div>
                    </li>
                </ul>
            </>, this);
    }
}
customElements.define('solidify-polygon-dialog', PolygonDialog);
