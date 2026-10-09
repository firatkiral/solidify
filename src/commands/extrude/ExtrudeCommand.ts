import * as THREE from "three";
import Command, { EditorLike } from "../../command/Command";
import { ObjectPicker } from "../../command/ObjectPicker";
import { targetsLabel } from "../../components/dialog/Prompt";
import { PointPicker } from "../../command/point-picker/PointPicker";
import { SelectionMode } from "../../selection/SelectionModeSet";
import { Y, Z } from "../../util/Constants";
import * as visual from "../../visual_model/VisualModel";
import { MultiBooleanFactory } from "../boolean/BooleanFactory";
import { PossiblyBooleanKeyboardGizmo } from "../boolean/BooleanKeyboardGizmo";
import { PhantomLineFactory } from "../line/LineFactory";
import { ExtrudeDialog } from "./ExtrudeDialog";
import { CurveExtrudeFactory, FaceExtrudeFactory, MultiExtrudeFactory, PossiblyBooleanExtrudeFactory, RegionExtrudeFactory, solidsUnderRegion } from "./ExtrudeFactory";
import { ExtrudeGizmo } from "./ExtrudeGizmo";
import { ExtrudeKeyboardGizmo } from "./ExtrudeKeyboardGizmo";

export class ExtrudeCommand extends Command {
    point?: THREE.Vector3;

    async execute(): Promise<void> {
        const { selection: { selected } } = this.editor;

        const extrude = ExtrudeFactory(this.editor).resource(this);

        const gizmo = new ExtrudeGizmo(extrude, this.editor);
        const booleanKeyboard = new PossiblyBooleanKeyboardGizmo("extrude", this.editor);
        const directionKeyboard = new ExtrudeKeyboardGizmo(this.editor);
        const dialog = new ExtrudeDialog(extrude, this.editor.signals);

        booleanKeyboard.prepare(extrude, () => dialog.render()).resource(this);
        directionKeyboard.execute(onKeyPress(extrude, gizmo, dialog).bind(this)).resource(this);

        gizmo.position.copy(this.point ?? extrude.center);
        gizmo.quaternion.setFromUnitVectors(Y, extrude.direction);

        gizmo.execute(async params => {
            extrude.syncDistances();
            await extrude.update();
            booleanKeyboard.toggle(extrude.isOverlapping);
            dialog.render();
        }).resource(this);

        dialog.execute(params => {
            extrude.syncDistances();
            gizmo.render(params);
            dialog.render();
            extrude.update();
        }).resource(this).then(() => this.finish(), () => this.cancel());

        const showTargets = () => dialog.promptValue("Select target bodies", targetsLabel(this.editor.scene, extrude.targets));
        dialog.prompt("Select target bodies", () => {
            const objectPicker = new ObjectPicker(this.editor);
            objectPicker.selection.selected.add(extrude.targets);
            return objectPicker.execute(async delta => {
                const targets = [...objectPicker.selection.selected.solids];
                extrude.targets = targets;
                showTargets();
                await extrude.update();
                booleanKeyboard.toggle(extrude.isOverlapping);
                dialog.render();
            }, 1, Number.MAX_SAFE_INTEGER, SelectionMode.Solid).resource(this)
        }, async () => {
            extrude.targets = [];
            showTargets();
            await extrude.update();
            booleanKeyboard.toggle(extrude.isOverlapping);
            dialog.render();
        });
        showTargets();

        await this.finished;

        const results = await extrude.commit() as visual.Solid[];
        selected.add(results);

        for (const face of selected.faces) { selected.removeFace(face) }
        for (const region of selected.regions) { selected.removeRegion(region) }
    }
}

function ExtrudeFactory(editor: EditorLike) {
    const { db, materials, signals, scene, selection: { selected } } = editor;

    const factories = [];
    const targets = [...selected.solids];
    const visibleSolids = scene.visibleObjects.filter((item): item is visual.Solid => item instanceof visual.Solid);
    const regionSupports = new Set<visual.Solid>();
    for (const region of selected.regions) {
        const phantom = new RegionExtrudeFactory(db, materials, signals);
        phantom.regions = [region];
        // A region drawn on a solid's face joins or cuts that solid, as extruding the face would
        for (const { solid, normal } of solidsUnderRegion(db, region, visibleSolids)) {
            regionSupports.add(solid);
            phantom.faceNormal = normal;
        }
        factories.push(phantom);
    }
    const faceParents = new Set<visual.Solid>();
    for (const face of selected.faces) {
        const phantom = new FaceExtrudeFactory(db, materials, signals);
        phantom.face = face;
        faceParents.add(face.parentItem);
        factories.push(phantom);
    }
    for (const curve of selected.curves) {
        const phantom = new CurveExtrudeFactory(db, materials, signals);
        phantom.curves = [curve];
        factories.push(phantom);
    }
    const phantom = new MultiExtrudeFactory(factories);
    const bool = new MultiBooleanFactory(db, materials, signals);
    const extrude = new PossiblyBooleanExtrudeFactory(bool, phantom);
    extrude.targets = [...new Set([...regionSupports, ...faceParents, ...targets])];
    // Extruding a face or a region on it always touches that solid
    extrude.touching = new Set([...regionSupports, ...faceParents]);
    return extrude;
}

export function onKeyPress(factory: PossiblyBooleanExtrudeFactory, gizmo: ExtrudeGizmo, dialog: ExtrudeDialog) {
    return async function (this: Command, s: string) {
        switch (s) {
            case 'symmetric': {
                factory.symmetric = !factory.symmetric;
                await factory.update();
                dialog.render();
                gizmo.render(factory);
                break;
            }
            case 'pivot': {
                gizmo.disable();
                const pointPicker = new PointPicker(this.editor);
                await pointPicker.execute(({ point: pivot, info: { snap } }) => {
                    const { orientation } = snap.project(pivot);
                    factory.direction = Z.clone().applyQuaternion(orientation);
                    gizmo.position.copy(pivot);
                    gizmo.quaternion.copy(orientation).multiply(Y2Z);
                }).resource(this);
                gizmo.enable();
                break;
            }
            case 'free':
                const editor = this.editor;
                const line = new PhantomLineFactory(editor.db, editor.materials, editor.signals).resource(this);
                const pointPicker = new PointPicker(editor);
                const center = factory.center;
                pointPicker.addAxesAt(center);
                gizmo.disable();
                line.p1 = center;
                await pointPicker.execute(({ point: p2 }) => {
                    line.p2 = p2;
                    const delta = p2.clone().sub(center);
                    factory.distance1 = delta.length();
                    factory.syncDistances();
                    factory.direction = delta.normalize();
                    line.update();
                    factory.update();
                    dialog.render();
                    gizmo.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(Y, factory.direction));
                    gizmo.render(factory);
                }).resource(this);
                line.cancel();
                gizmo.enable();
        }
    }
}

const Y2Z = new THREE.Quaternion().setFromUnitVectors(Y, Z);