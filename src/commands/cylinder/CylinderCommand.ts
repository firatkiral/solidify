import { Z } from "../../util/Constants";
import { targetsLabel } from "../../components/dialog/Prompt";
import * as THREE from "three";
import Command from "../../command/Command";
import { diameter, height, Measurements } from "../../command/Measurements";
import { ObjectPicker } from "../../command/ObjectPicker";
import { PointPicker } from "../../command/point-picker/PointPicker";
import { AxisSnap } from "../../editor/snaps/AxisSnap";
import { SelectionMode } from "../../selection/SelectionModeSet";
import * as visual from "../../visual_model/VisualModel";
import { PossiblyBooleanKeyboardGizmo } from "../boolean/BooleanKeyboardGizmo";
import { CenterCircleFactory } from '../circle/CircleFactory';
import { PossiblyBooleanCylinderFactory } from './CylinderFactory';
import { EditCylinderGizmo } from "./CylinderGizmo";
import { EditCylinderDialog } from "./EditCylinderDialog";

export class CylinderCommand extends Command {
    async execute(): Promise<void> {
        const cylinder = new PossiblyBooleanCylinderFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);
        const selection = this.editor.selection.selected;
        cylinder.targets = [...selection.solids];

        const dialog = new EditCylinderDialog(cylinder, this.editor.signals);
        const gizmo = new EditCylinderGizmo(cylinder, this.editor);

        const circle = new CenterCircleFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);
        let pointPicker = new PointPicker(this.editor);
        pointPicker.facePreferenceMode = 'strong';
        pointPicker.straightSnaps.delete(AxisSnap.Z);
        const { point: p1, info: { snap } } = await pointPicker.execute().resource(this);
        circle.center = p1;
        pointPicker.restrictToPlaneThroughPoint(p1, snap);

        const measurements = new Measurements(this.editor).resource(this);
        const { point: p2, info: { orientation: baseOrientation } } = await pointPicker.execute(({ point: p2, info: { orientation } }) => {
            circle.point = p2;
            circle.orientation = orientation;
            circle.update();
            measurements.set(diameter(p1, p2));
        }).resource(this);
        circle.cancel();

        cylinder.p0 = p1;
        cylinder.p1 = p2;

        const keyboard = new PossiblyBooleanKeyboardGizmo("cylinder", this.editor);
        keyboard.prepare(cylinder).resource(this);

        // Like the box, the height runs along the base's normal wherever the cursor is, instead of falling back to the floor off-axis.
        pointPicker = new PointPicker(this.editor);
        const axis = Z.clone().applyQuaternion(baseOrientation);
        pointPicker.restrictToLine(p1, axis);
        await pointPicker.execute(({ point: p3 }) => {
            cylinder.p2 = p3;
            cylinder.update();
            keyboard.toggle(cylinder.isOverlapping);
            measurements.set(height(p1, axis, p3.clone().sub(p1).dot(axis)));
        }).resource(this);
        measurements.reset();

        dialog.execute(params => {
            gizmo.render(params);
            cylinder.update();
        }).resource(this).then(() => this.finish(), () => this.cancel());

        dialog.prompt("Select target bodies", () => {
            const objectPicker = new ObjectPicker(this.editor);
            objectPicker.selection.selected.add(cylinder.targets);
            return objectPicker.execute(async delta => {
                const targets = [...objectPicker.selection.selected.solids];
                cylinder.targets = targets;
                dialog.promptValue("Select target bodies", targetsLabel(this.editor.scene, cylinder.targets));
                await cylinder.update();
                keyboard.toggle(cylinder.isOverlapping);
            }, 1, Number.MAX_SAFE_INTEGER, SelectionMode.Solid).resource(this)
        }, async () => {
            cylinder.targets = [];
            dialog.promptValue("Select target bodies", targetsLabel(this.editor.scene, cylinder.targets));
            await cylinder.update();
            keyboard.toggle(cylinder.isOverlapping);
        });
        dialog.promptValue("Select target bodies", targetsLabel(this.editor.scene, cylinder.targets));

        gizmo.quaternion.setFromUnitVectors(Z, cylinder.axis);
        gizmo.position.copy(cylinder.p0);
        gizmo.execute(async (params) => {
            dialog.render();
            await cylinder.update();
            keyboard.toggle(cylinder.isOverlapping);
        }).resource(this);

        await this.finished;

        const results = await cylinder.commit() as visual.Solid[];
        selection.add(results);
    }
}
