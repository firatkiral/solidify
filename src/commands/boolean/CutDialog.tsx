import { render } from 'preact';
import { AbstractDialog } from "../../command/AbstractDialog";
import { EditorSignals } from "../../editor/EditorSignals";
import { CutParams } from "./CutFactory";


export class CutDialog extends AbstractDialog<CutParams> {
    name = "Cut";

    constructor(protected readonly params: CutParams, signals: EditorSignals) {
        super(signals);
    }

    render() {
        const { mergingFaces, mergingEdges } = this.params;
        render(
            <>
                <ol>
                    <solidify-prompt name="Select target bodies" description="to cut or join into"></solidify-prompt>
                    <solidify-prompt name="Select cutters" description="— curves or faces to cut with"></solidify-prompt>
                </ol>

                <ul>
                    <li>
                        <label for="mergingFaces">Merge</label>
                        <div class="fields">
                            <input type="checkbox" hidden id="mergingFaces" name="mergingFaces" checked={mergingFaces} onClick={this.onChange}></input>
                            <label for="mergingFaces">Coplanar faces</label>
                            <input type="checkbox" hidden id="mergingEdges" name="mergingEdges" checked={mergingEdges} onClick={this.onChange}></input>
                            <label for="mergingEdges">Tangent edges</label>
                        </div>
                    </li>
                </ul>
            </>, this);
    }
}

customElements.define('cut-dialog', CutDialog);
