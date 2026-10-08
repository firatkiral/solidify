import Command from "../../command/Command";
import { diameter, Measurements } from "../../command/Measurements";
import { ObjectPicker } from "../../command/ObjectPicker";
import { PointPicker } from "../../command/point-picker/PointPicker";
import { AxisSnap } from "../../editor/snaps/AxisSnap";
import { SelectionMode } from "../../selection/SelectionModeSet";
import { X, Y } from "../../util/Constants";
import * as visual from "../../visual_model/VisualModel";
import { PossiblyBooleanKeyboardGizmo } from "../boolean/BooleanKeyboardGizmo";
import { SphereDialog } from "./SphereDialog";
import { PossiblyBooleanSphereFactory } from './SphereFactory';
import { EditSphereGizmo } from "./SphereGizmo";

export class SphereCommand extends Command {
    async execute(): Promise<void> {
        const sphere = new PossiblyBooleanSphereFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);
        const selection = this.editor.selection.selected;
        sphere.targets = [...selection.solids];

        const pointPicker = new PointPicker(this.editor);
        pointPicker.straightSnaps.delete(AxisSnap.Z);
        const { point: p1 } = await pointPicker.execute().resource(this);
        sphere.center = p1;
        pointPicker.restrictToPlaneThroughPoint(p1);

        const keyboard = new PossiblyBooleanKeyboardGizmo("sphere", this.editor);
        keyboard.prepare(sphere).resource(this);

        const measurements = new Measurements(this.editor).resource(this);
        const { point: p2 } = await pointPicker.execute(({ point: p2 }) => {
            const radius = p1.distanceTo(p2);
            sphere.radius = radius;
            sphere.update();
            keyboard.toggle(sphere.isOverlapping);
            measurements.set(diameter(p1, p2));
        }).resource(this);
        measurements.reset();

        const dialog = new SphereDialog(sphere, this.editor.signals);
        const gizmo = new EditSphereGizmo(sphere, this.editor);

        dialog.execute(params => {
            gizmo.render(params);
            sphere.update();
        }).resource(this).then(() => this.finish(), () => this.cancel());

        dialog.prompt("Select target bodies", () => {
            const objectPicker = new ObjectPicker(this.editor);
            objectPicker.selection.selected.add(sphere.targets);
            return objectPicker.execute(async delta => {
                const targets = [...objectPicker.selection.selected.solids];
                sphere.targets = targets;
                await sphere.update();
                keyboard.toggle(sphere.isOverlapping);
            }, 1, Number.MAX_SAFE_INTEGER, SelectionMode.Solid).resource(this)
        }, async () => {
            sphere.targets = [];
            await sphere.update();
            keyboard.toggle(sphere.isOverlapping);
        });

        // The radius pin points toward where the radius was dragged to
        const direction = p2.clone().sub(p1);
        if (direction.lengthSq() < 1e-12) direction.copy(X);
        gizmo.quaternion.setFromUnitVectors(Y, direction.normalize());
        gizmo.position.copy(p1);
        gizmo.execute(async (params) => {
            dialog.render();
            await sphere.update();
            keyboard.toggle(sphere.isOverlapping);
        }).resource(this);

        await this.finished;

        const results = await sphere.commit() as visual.Solid[];
        selection.add(results);
    }
}
