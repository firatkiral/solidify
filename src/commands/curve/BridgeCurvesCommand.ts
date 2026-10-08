import Command from "../../command/Command";
import { CommandKeyboardInput } from "../../command/CommandKeyboardInput";
import { PointPicker, PointResult } from "../../command/point-picker/PointPicker";
import { CurvePointSnap, CurveSnap } from "../../editor/snaps/Snaps";
import { Snap } from "../../editor/snaps/Snap";
import { Y } from "../../util/Constants";
import * as visual from "../../visual_model/VisualModel";
import { BridgeCurvesDialog } from "./BridgeCurvesDialog";
import BridgeCurvesFactory from "./BridgeCurvesFactory";
import { BridgeCurvesGizmo } from "./BridgeCurvesGizmo";
import CurveFactory from "./CurveFactory";

const onCurve = (snap: Snap): snap is CurveSnap | CurvePointSnap => snap instanceof CurveSnap || snap instanceof CurvePointSnap;

export class BridgeCurvesCommand extends Command {
    async execute(): Promise<void> {
        const { editor } = this;
        const factory = new BridgeCurvesFactory(editor.db, editor.materials, editor.signals).resource(this);
        const selected = editor.selection.selected;

        // Both picks have to be on curves, so curves snap whatever the Snaps panel says
        const curvesSnap = editor.snaps.forceLayers(visual.Layers.Curve);
        this.ensure(() => curvesSnap.dispose());

        const gizmo = new BridgeCurvesGizmo(factory, editor);
        const placeGizmo = () => {
            const frame = factory.startFrame;
            if (frame === undefined) return;
            gizmo.position.copy(frame.position);
            gizmo.quaternion.setFromUnitVectors(Y, frame.direction);
        }
        const update = () => {
            factory.update();
            dialog.render();
            placeGizmo();
        }

        const dialog = new BridgeCurvesDialog(factory, editor.signals);
        dialog.execute(() => {
            gizmo.tensionValue = factory.tension1[0];
            if (factory.hasEnd) update();
        }).resource(this).then(() => this.finish(), () => this.cancel());

        const keyboard = new CommandKeyboardInput('bridge-curves', editor, ['keyboard:bridge-curves:cycle', 'keyboard:bridge-curves:trim']);
        keyboard.execute(command => {
            switch (command) {
                case 'cycle': factory.startCurvature = factory.endCurvature = (factory.startCurvature + 1) % 4; break;
                case 'trim': factory.trim = !factory.trim; break;
            }
            if (factory.hasEnd) update(); else dialog.render();
        }).resource(this);

        const pointPicker = new PointPicker(editor);
        pointPicker.raycasterParams.Line2.threshold = 50;
        const line = new CurveFactory(editor.db, editor.materials, editor.signals).resource(this);
        line.style = 1;

        // A click off every curve is ignored rather than ending the command
        const pickOnCurve = async (cb?: (pt: PointResult) => void) => {
            while (true) {
                const result = await pointPicker.execute(cb).resource(this);
                if (onCurve(result.info.snap)) return { point: result.point, snap: result.info.snap };
            }
        }

        const start = await pickOnCurve();
        factory.setStart(start.snap.view, start.snap.t(start.point));
        line.push(start.point);
        line.push(start.point);
        dialog.render();

        const end = await pickOnCurve(({ point, info: { snap } }) => {
            line.last = point;
            if (line.hasEnoughPoints) line.update();
            if (!onCurve(snap)) return;
            factory.setEnd(snap.view, snap.t(point));
            factory.chooseDirections();
            update();
        });
        factory.setEnd(end.snap.view, end.snap.t(end.point));
        factory.chooseDirections();
        line.cancel();
        curvesSnap.dispose();
        update();

        gizmo.execute(() => update()).resource(this);

        await this.finished;

        const results = await factory.commit() as visual.Item[];
        const bridge = results[results.length - 1] as visual.SpaceInstance<visual.Curve3D>;
        selected.addCurve(bridge);
    }
}
