import * as THREE from "three";
import Command from "../../command/Command";
import { CommandKeyboardInput } from "../../command/CommandKeyboardInput";
import { Y, Z } from '../../util/Constants';
import * as visual from "../../visual_model/VisualModel";
import { MultiOffsetImprintFactory, OffsetSpaceCurveFactory } from "./OffsetContourFactory";
import { OffsetCurveDialog } from "./OffsetCurveDialog";
import { OffsetCurveGizmo } from "./OffsetCurveGizmo";

// Faces and edges of solids are offset across their faces into new edges; curves into new curves.
export class OffsetCurveCommand extends Command {
    async execute(): Promise<void> {
        const { editor } = this;
        const { faces, edges, curves } = editor.selection.selected;

        if (faces.size > 0) {
            const selected = [...faces];
            await this.imprint(MultiOffsetImprintFactory.faceLoops(editor.db, editor.materials, editor.signals, selected), "Offset face loop");
            for (const face of selected) editor.selection.selected.removeFace(face);
        } else if (edges.size > 0) {
            const selected = [...edges];
            // A positive distance goes into the faces turned to the camera
            const toward = editor.activeViewport?.camera.getWorldDirection(new THREE.Vector3()).negate() ?? Z.clone();
            await this.imprint(MultiOffsetImprintFactory.edges(editor.db, editor.materials, editor.signals, selected, toward), "Offset edge");
            for (const edge of selected) editor.selection.selected.removeEdge(edge);
        } else if (curves.size > 0) {
            await this.offsetCurve(curves.first);
        }
    }

    private async imprint(offset: MultiOffsetImprintFactory, name: string) {
        const { editor } = this;
        offset.resource(this);

        const gizmo = new OffsetCurveGizmo(offset, editor);
        gizmo.position.copy(offset.center);
        gizmo.quaternion.setFromUnitVectors(Y, offset.normal);
        gizmo.relativeScale.setScalar(0.8);

        const dialog = new OffsetCurveDialog(offset, name, editor.signals);
        dialog.execute(params => {
            gizmo.render(params.distance);
            offset.update();
        }).resource(this).then(() => this.finish(), () => this.cancel());

        const keyboard = new CommandKeyboardInput('offset-curve', editor, ['keyboard:offset-curve:gap-fill']);
        keyboard.execute(command => {
            if (command === 'gap-fill') offset.gapFill = (offset.gapFill + 1) % 3;
            dialog.render();
            offset.update();
        }).resource(this);

        gizmo.execute(() => {
            offset.update();
            dialog.render();
        }).resource(this);
        gizmo.start('gizmo:offset-curve:distance');

        await this.finished;

        const results = await offset.commit() as visual.Solid[];
        for (const edge of offset.newEdges(results)) editor.selection.selected.addEdge(edge);
    }

    private async offsetCurve(curve: visual.SpaceInstance<visual.Curve3D>) {
        const { editor } = this;
        const offset = new OffsetSpaceCurveFactory(editor.db, editor.materials, editor.signals).resource(this);
        const constructionPlane = editor.activeViewport?.constructionPlane;
        if (constructionPlane !== undefined) offset.constructionPlane = constructionPlane;
        offset.curve = curve;

        const gizmo = new OffsetCurveGizmo(offset, editor);
        gizmo.position.copy(offset.center);
        gizmo.quaternion.setFromUnitVectors(Y, offset.normal);
        gizmo.relativeScale.setScalar(0.8);

        gizmo.execute(() => {
            offset.update();
        }).resource(this);
        gizmo.start('gizmo:offset-curve:distance');

        await this.finished;

        editor.selection.selected.removeCurve(curve);
        const result = await offset.commit() as visual.SpaceInstance<visual.Curve3D>;
        editor.selection.selected.addCurve(result);
    }
}
