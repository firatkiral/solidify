import Command from "../../command/Command";
import { length, Measurements } from "../../command/Measurements";
import { PointPicker } from "../../command/point-picker/PointPicker";
import { AxisSnap } from "../../editor/snaps/AxisSnap";
import { Z } from "../../util/Constants";
import * as visual from "../../visual_model/VisualModel";
import { CenterEllipseFactory, ThreePointEllipseFactory } from "./EllipseFactory";
import LineFactory from '../line/LineFactory';


export class CenterEllipseCommand extends Command {
    async execute(): Promise<void> {
        const ellipse = new CenterEllipseFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);

        const pointPicker = new PointPicker(this.editor);
        const { point } = await pointPicker.execute().resource(this);
        ellipse.center = point;

        pointPicker.restrictToPlaneThroughPoint(point);
        pointPicker.straightSnaps.delete(AxisSnap.Z);

        // Only the first radius is labelled: the kernel draws these "ellipses" as circular arcs (Arc3D's center-and-two-points form)
        const measurements = new Measurements(this.editor).resource(this);
        const line = new LineFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);
        line.p1 = point;
        const { point: p2 } = await pointPicker.execute(({ point: p2, info: { orientation } }) => {
            line.p2 = p2;
            line.update();
            measurements.set(length(point, p2, Z.clone().applyQuaternion(orientation)));
        }).resource(this);
        line.cancel();
        measurements.reset();
        ellipse.p2 = p2;

        await pointPicker.execute(({ point }) => {
            ellipse.p3 = point;
            ellipse.update();
        }).resource(this);

        const result = await ellipse.commit() as visual.SpaceInstance<visual.Curve3D>;
        this.editor.selection.selected.addCurve(result);
    }
}

export class ThreePointEllipseCommand extends Command {
    async execute(): Promise<void> {
        const ellipse = new ThreePointEllipseFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);

        const pointPicker = new PointPicker(this.editor);
        const { point } = await pointPicker.execute().resource(this);
        ellipse.p1 = point;

        // Only the first radius is labelled: the kernel draws these "ellipses" as circular arcs (Arc3D's center-and-two-points form)
        const measurements = new Measurements(this.editor).resource(this);
        const line = new LineFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);
        line.p1 = point;
        const { point: p2 } = await pointPicker.execute(({ point: p2, info: { orientation } }) => {
            line.p2 = p2;
            line.update();
            measurements.set(length(point, p2, Z.clone().applyQuaternion(orientation)));
        }).resource(this);
        line.cancel();
        measurements.reset();
        ellipse.p2 = p2;

        await pointPicker.execute(({ point: p3 }) => {
            ellipse.p3 = p3;
            ellipse.update();
        }).resource(this);

        const result = await ellipse.commit() as visual.SpaceInstance<visual.Curve3D>;
        this.editor.selection.selected.addCurve(result);
    }
}
