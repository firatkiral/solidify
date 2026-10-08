import * as THREE from "three";
import Command from "../../command/Command";
import { Measurements, segment } from "../../command/Measurements";
import { PointPicker } from "../../command/point-picker/PointPicker";
import { Viewport } from "../../components/viewport/Viewport";
import { PointSnap } from "../../editor/snaps/PointSnap";
import c3d from '../../kernel/kernel';
import { Finish } from "../../util/Cancellable";
import * as visual from "../../visual_model/VisualModel";
import { CurveWithPreviewFactory } from "./CurveFactory";
import { CurveKeyboardEvent, CurveKeyboardGizmo, LineKeyboardGizmo } from "./CurveKeyboardGizmo";

export class CurveCommand extends Command {
    protected type = c3d.SpaceType.Hermit3D;
    protected get keyboard() { return new CurveKeyboardGizmo(this.editor); };

    async execute(): Promise<void> {
        this.editor.layers.showControlPoints();
        this.ensure(() => this.editor.layers.hideControlPoints());

        const makeCurve = new CurveWithPreviewFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);
        makeCurve.type = this.type;
        makeCurve.constructionPlane = this.editor.activeViewport?.constructionPlane;

        const pointPicker = new PointPicker(this.editor);
        pointPicker.facePreferenceMode = 'weak';
        const keyboard = this.keyboard;
        keyboard.execute((e: CurveKeyboardEvent) => {
            switch (e.tag) {
                case 'type':
                    makeCurve.type = e.type;
                    makeCurve.update();
                    break;
                case 'undo':
                    pointPicker.undo();
                    makeCurve.undo();
                    makeCurve.update();
                    addSnaps(makeCurve, pointPicker);
                    break;
            }
        }).resource(this);

        // Lines show each segment's length and the angle it turns: from the plane's X axis at first, then from the previous segment
        const measurements = new Measurements(this.editor).resource(this);
        const measure = (point: THREE.Vector3, orientation: THREE.Quaternion) => {
            const { points, type } = makeCurve.underlying;
            if (type !== c3d.SpaceType.Polyline3D || points.length === 0) return measurements.reset();
            const from = points[points.length - 1];
            const reference = points.length > 1
                ? points[points.length - 2].clone().sub(from).normalize()
                : new THREE.Vector3(1, 0, 0).applyQuaternion(orientation);
            measurements.set(segment(from, point, new THREE.Vector3(0, 0, 1).applyQuaternion(orientation), reference));
        }

        // Closing works with snapping off too: a point within a few pixels of the start point lands on it
        const towardsClose = (point: THREE.Vector3, viewport: Viewport) => {
            if (!makeCurve.canBeClosed) return point;
            const { startPoint } = makeCurve;
            return screenDistance(point, startPoint, viewport) < CloseDistance ? startPoint.clone() : point;
        }

        while (true) {
            addSnaps(makeCurve, pointPicker);
            try {
                const { point: picked, info: { snap, viewport } } = await pointPicker.execute(async ({ point, info: { snap, orientation, viewport } }) => {
                    point = towardsClose(point, viewport);
                    makeCurve.preview.last = point;
                    makeCurve.preview.closed = makeCurve.wouldBeClosed(point);
                    makeCurve.preview.snap = snap;
                    measure(point, orientation);
                    if (makeCurve.preview.hasEnoughPoints)
                        await makeCurve.preview.update();
                }, { rejectOnFinish: true }).resource(this);
                const point = towardsClose(picked, viewport);
                if (makeCurve.wouldBeClosed(point)) {
                    makeCurve.closed = true;
                    throw new Finish();
                }
                makeCurve.push(point);
                makeCurve.snap = snap;
                makeCurve.update();
            } catch (e) {
                if (!(e instanceof Finish)) throw e;
                break;
            }
        }

        measurements.reset();
        makeCurve.preview.cancel();
        const result = await makeCurve.commit() as visual.SpaceInstance<visual.Curve3D>;
        this.editor.selection.selected.addCurve(result);
    }
}

export class LineCommand extends CurveCommand {
    protected type = c3d.SpaceType.Polyline3D;
    protected get keyboard() { return new LineKeyboardGizmo(this.editor); };
}

const CloseDistance = 12; // px, about the reach of a point snap

function screenDistance(a: THREE.Vector3, b: THREE.Vector3, viewport: Viewport) {
    const { camera, domElement: { offsetWidth, offsetHeight } } = viewport;
    const sa = a.clone().project(camera), sb = b.clone().project(camera);
    return Math.hypot((sa.x - sb.x) * offsetWidth / 2, (sa.y - sb.y) * offsetHeight / 2);
}

function addSnaps(makeCurve: CurveWithPreviewFactory, pointPicker: PointPicker) {
    pointPicker.clearAddedSnaps();
    if (makeCurve.canBeClosed) {
        for (const point of makeCurve.otherPoints) {
            pointPicker.addSnap(new PointSnap(undefined, point));
        }
        pointPicker.addEssentialSnap(new PointSnap("Closed", makeCurve.startPoint));
    }
}
