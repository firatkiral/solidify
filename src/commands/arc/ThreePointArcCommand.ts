import * as THREE from "three";
import Command from "../../command/Command";
import { arcHeight, length, Measurements } from "../../command/Measurements";
import { PointPicker } from "../../command/point-picker/PointPicker";
import * as visual from "../../visual_model/VisualModel";
import { ThreePointArcFactory } from "./ArcFactory";
import { EditThreePointArcCommand } from "./EditArcCommand";
import LineFactory from '../line/LineFactory';


export class ThreePointArcCommand extends Command {
    async execute(): Promise<void> {
        const arc = new ThreePointArcFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);

        const pointPicker = new PointPicker(this.editor);
        const { point: p1 } = await pointPicker.execute().resource(this);
        arc.p1 = p1;

        const measurements = new Measurements(this.editor).resource(this);
        const line = new LineFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);
        line.p1 = p1;
        const { point: end } = await pointPicker.execute(({ point, info: { orientation } }) => {
            line.p2 = point;
            line.update();
            measurements.set(length(p1, point, Z.clone().applyQuaternion(orientation)));
        }).resource(this);
        line.cancel();
        measurements.reset();
        arc.p3 = end;

        await pointPicker.execute(({ point }) => {
            arc.p2 = point;
            arc.update();
            const normal = end.clone().sub(p1).cross(point.clone().sub(p1)).normalize();
            try { measurements.set(arcHeight(p1, end, arc.middle, normal)) }
            catch { measurements.reset() } // collinear points have no arc
        }).resource(this);
        measurements.reset();

        const result = await arc.commit() as visual.SpaceInstance<visual.Curve3D>;
        this.editor.selection.selected.addCurve(result);

        const next = new EditThreePointArcCommand(this.editor);
        next.arc = result;
        this.editor.enqueue(next, false);
    }
}

const Z = new THREE.Vector3(0, 0, 1);
