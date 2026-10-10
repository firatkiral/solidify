import Command from "../../command/Command";
import { Measurements, polygon as polygonDimensions } from "../../command/Measurements";
import { PointPicker } from "../../command/point-picker/PointPicker";
import { AxisSnap } from "../../editor/snaps/AxisSnap";
import { Z } from "../../util/Constants";
import * as visual from "../../visual_model/VisualModel";
import { CenterCircleFactory } from "../circle/CircleFactory";
import { PolygonDialog } from "./PolygonDialog";
import { EditPolygonFactory, PolygonFactory } from "./PolygonFactory";
import { EditPolygonGizmo } from "./PolygonGizmo";
import { PolygonKeyboardGizmo } from "./PolygonKeyboardGizmo";


export class PolygonCommand extends Command {
    async execute(): Promise<void> {
        const polygon = new PolygonFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);

        // The circumscribed circle and its radius, in the polygon's plane (which the mode can stand up)
        const measurements = new Measurements(this.editor).resource(this);
        const measure = () => {
            const { center, p2, orientation, mode } = polygon;
            if (p2 === undefined) return;
            const [, , normal] = CenterCircleFactory.orientHorizontalOrVertical(p2, center, Z.clone().applyQuaternion(orientation), mode);
            measurements.set(polygonDimensions(center, p2, normal));
        }

        const keyboard = new PolygonKeyboardGizmo(this.editor);
        keyboard.execute(e => {
            switch (e) {
                case 'add-vertex':
                    polygon.vertexCount++;
                    break;
                case 'subtract-vertex':
                    polygon.vertexCount--;
                    break;
                case 'mode':
                    polygon.toggleMode();
                    break;
            }
            polygon.update();
            measure();
        }).resource(this);

        const pointPicker = new PointPicker(this.editor);
        pointPicker.facePreferenceMode = 'strong';
        pointPicker.straightSnaps.delete(AxisSnap.Z);

        const { point, info: { snap } } = await pointPicker.execute().resource(this);
        polygon.center = point;
        pointPicker.restrictToPlaneThroughPoint(point, snap);

        await pointPicker.execute(({ point, info: { orientation } }) => {
            polygon.orientation = orientation;
            polygon.p2 = point;
            polygon.update();
            measure();
        }).resource(this);
        measurements.reset();

        const result = await polygon.commit() as visual.SpaceInstance<visual.Curve3D>;
        this.editor.selection.selected.addCurve(result);

        const next = new EditPolygonCommand(this.editor);
        next.drawn = polygon;
        next.polygon = result;
        this.editor.enqueue(next, false);
    }
}

export class EditPolygonCommand extends Command {
    readonly remember = false;
    readonly keepsViewportSelection = true;
    drawn!: PolygonFactory;
    polygon!: visual.SpaceInstance<visual.Curve3D>;

    async execute(): Promise<void> {
        const { drawn } = this;
        const edit = new EditPolygonFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);
        edit.center = drawn.center;
        edit.p2 = drawn.p2;
        edit.orientation = drawn.orientation;
        edit.mode = drawn.mode;
        edit.vertexCount = drawn.vertexCount;
        edit.polygon = this.polygon;

        const dialog = new PolygonDialog(edit, this.editor.signals);
        const gizmo = new EditPolygonGizmo(edit, this.editor);

        const keyboard = new PolygonKeyboardGizmo(this.editor);
        keyboard.execute(e => {
            switch (e) {
                case 'add-vertex':
                    edit.vertexCount++;
                    break;
                case 'subtract-vertex':
                    edit.vertexCount--;
                    break;
                case 'mode':
                    edit.toggleMode();
                    break;
            }
            edit.update();
            dialog.render();
        }).resource(this);

        // Clicking elsewhere keeps the user's edits; with no edits there is nothing to commit
        dialog.execute(params => {
            edit.update();
            dialog.render();
            gizmo.render(edit);
        }).rejectOnInterrupt(() => edit.state.tag === 'none').resource(this).then(() => this.finish(), () => this.cancel());

        gizmo.position.copy(edit.center);
        gizmo.quaternion.copy(edit.orientation);
        gizmo.execute(async params => {
            dialog.render();
            await edit.update();
        }).resource(this);

        await this.finished;

        const result = await edit.commit() as visual.SpaceInstance<visual.Curve3D>;
        this.editor.selection.selected.addCurve(result);
    }
}
