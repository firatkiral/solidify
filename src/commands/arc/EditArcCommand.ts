import Command from "../../command/Command";
import * as visual from "../../visual_model/VisualModel";
import { CenterPointArcDialog, ThreePointArcDialog } from "./ArcDialog";
import { EditCenterPointArcFactory, EditThreePointArcFactory } from "./ArcFactory";
import { EditCenterPointArcGizmo, EditThreePointArcGizmo } from "./ArcGizmo";

export class EditCenterPointArcCommand extends Command {
    arc!: visual.SpaceInstance<visual.Curve3D>;
    remember = false;
    keepsViewportSelection = true;

    async execute(): Promise<void> {
        const edit = new EditCenterPointArcFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);
        edit.arc = this.arc;

        const dialog = new CenterPointArcDialog(edit, this.editor.signals);
        const gizmo = new EditCenterPointArcGizmo(edit, this.editor);

        // Clicking elsewhere keeps the user's edits; with no edits there is nothing to commit
        dialog.execute(params => {
            edit.update();
            dialog.render();
            gizmo.render(edit);
        }).rejectOnInterrupt(() => edit.state.tag === 'none').resource(this).then(() => this.finish(), () => this.cancel());

        gizmo.position.copy(edit.centre);
        gizmo.quaternion.setFromRotationMatrix(edit.basis);
        gizmo.execute(async params => {
            dialog.render();
            await edit.update();
        }).resource(this);

        await this.finished;

        const result = await edit.commit() as visual.SpaceInstance<visual.Curve3D>;
        this.editor.selection.selected.addCurve(result);
    }
}

export class EditThreePointArcCommand extends Command {
    arc!: visual.SpaceInstance<visual.Curve3D>;
    remember = false;
    keepsViewportSelection = true;

    async execute(): Promise<void> {
        const edit = new EditThreePointArcFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);
        edit.arc = this.arc;

        const dialog = new ThreePointArcDialog(edit, this.editor.signals);
        const gizmo = new EditThreePointArcGizmo(edit, this.editor);

        // Clicking elsewhere keeps the user's edits; with no edits there is nothing to commit
        dialog.execute(params => {
            edit.update();
            dialog.render();
            gizmo.render(edit);
        }).rejectOnInterrupt(() => edit.state.tag === 'none').resource(this).then(() => this.finish(), () => this.cancel());

        gizmo.position.copy(edit.start);
        gizmo.quaternion.setFromRotationMatrix(edit.basis);
        gizmo.execute(async params => {
            dialog.render();
            await edit.update();
        }).resource(this);

        await this.finished;

        const result = await edit.commit() as visual.SpaceInstance<visual.Curve3D>;
        this.editor.selection.selected.addCurve(result);
    }
}
