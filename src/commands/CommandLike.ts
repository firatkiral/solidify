import * as visual from "../visual_model/VisualModel";
import * as cmd from "../command/Command";
import { PointPicker } from "../command/point-picker/PointPicker";
import { ExportDialog } from './export/ExportDialog';
import { ExportFactory, ExportFormat, ExportScope } from './export/ExportFactory';
import { objFile, stepFile, stlFile, threeMFFile } from '../editor/ImporterExporter';
import { OpenedFile } from '../platform/Platform';
import { RebuildFactory } from "./rebuild/RebuildFactory";
import { RebuildKeyboardGizmo } from './rebuild/RebuildKeyboardGizmo';

/**
 * These aren't typical commands, with a set of steps and gizmos to perform a geometrical operation.
 * But these represent actions/state-changes that are meant to be atomic (for the purpose of UNDO).
 */

export class DeselectAllCommand extends cmd.CommandLike {
    readonly changesDocument = false;

    async execute(): Promise<void> {
        this.editor.selection.selected.removeAll();
    }

    shouldAddToHistory(selectionChanged: boolean) {
        return selectionChanged;
    }
}

export class RebuildCommand extends cmd.CommandLike {
    index?: number;

    async execute(): Promise<void> {
        const rebuild = new RebuildFactory(this.editor.db, this.editor.materials, this.editor.signals).resource(this);
        const item = this.editor.selection.selected.solids.first;

        rebuild.item = item;
        rebuild.index = this.index;
        if (this.index !== undefined) await rebuild.update()

        const keyboard = new RebuildKeyboardGizmo(this.editor);
        await keyboard.execute(e => {
            switch (e) {
                case 'forward':
                    rebuild.index = rebuild.index + 1;
                    break;
                case 'backward':
                    rebuild.index = rebuild.index - 1;
                    break;
            }
            rebuild.update();
        }).resource(this);

        const selection = await rebuild.commit() as visual.Solid;
        this.editor.selection.selected.removeSolid(item);
        this.editor.selection.selected.addSolid(selection);
    }
}

export class LockSelectedCommand extends cmd.CommandLike {
    async execute(): Promise<void> {
        const { solids, curves, regions } = this.editor.selection.selected;
        const selectedItems = [...solids, ...curves, ...regions];
        for (const item of selectedItems) this.editor.scene.makeSelectable(item, false);
        this.editor.selection.selected.removeAll();
    }
}

export class HideSelectedCommand extends cmd.CommandLike {
    async execute(): Promise<void> {
        const { solids, curves, regions, empties } = this.editor.selection.selected;
        const selectedItems = [...solids, ...curves, ...regions, ...empties];
        for (const item of selectedItems) this.editor.scene.makeHidden(item, true);
    }
}

export class HideUnselectedCommand extends cmd.CommandLike {
    async execute(): Promise<void> {
        const db = this.editor.db;
        const { solids, curves, regions, empties } = this.editor.selection.selected;
        const selectedItems = new Set([...solids.ids, ...curves.ids, ...regions.ids]);
        for (const { view } of db.findAll()) {
            if (!selectedItems.has(view.simpleName)) this.editor.scene.makeHidden(view, true);
        }
    }
}

export class InvertHiddenCommand extends cmd.CommandLike {
    async execute(): Promise<void> {
        const { scene, db } = this.editor;
        for (const { view } of db.findAll()) {
            scene.makeHidden(view, !scene.isHidden(view));
        }
    }
}

export class UnhideAllCommand extends cmd.CommandLike {
    async execute(): Promise<void> {
        this.editor.scene.unhideAll();
    }
}

export class ExportCommand extends cmd.CommandLike {
    async execute(): Promise<void> {
        const { editor } = this;
        const { db, scene, selection: { selected }, platform } = editor;
        const factory = new ExportFactory(db, editor.materials, editor.signals).resource(this);
        factory.title = editor.document.name.replace(/\.solidify$/i, '');
        factory.application = `Solidify ${process.env.APP_VERSION ?? ''}`.trim();
        // Before the preview takes the solids' place
        factory.thumbnail = editor.thumbnail();
        const chosen = [...selected.solids];
        factory.hasSelection = chosen.length > 0;
        factory.scope = factory.hasSelection ? ExportScope.Selection : ExportScope.Visible;
        const choose = () => {
            const all = db.find(visual.Solid).map(({ view }) => view);
            const solids = factory.scope === ExportScope.Selection ? chosen
                : factory.scope === ExportScope.Visible ? all.filter(solid => scene.isVisible(solid))
                    : all;
            factory.setSolids(solids, solids.map((solid, i) => scene.getName(solid) ?? `Solid ${i + 1}`));
        }

        choose();
        const dialog = new ExportDialog(factory, editor.signals);
        await factory.update();
        dialog.render();
        await dialog.execute(async () => {
            choose();
            await factory.update();
            dialog.render();
        }).resource(this);

        const type = { [ExportFormat.STL]: stlFile, [ExportFormat.ThreeMF]: threeMFFile, [ExportFormat.OBJ]: objFile, [ExportFormat.STEP]: stepFile }[factory.format];
        const name = `${factory.title}${type.extensions[0]}`;
        // The browser shows its picker only right after the click that finished the dialog, so it opens while the file is made
        const data = factory.commit().then(() => new Blob([factory.output!], { type: type.mimeTypes[0] }));
        data.catch(() => { });
        try {
            await platform.files.save(data, name, type);
        } catch (e) {
            await platform.dialogs.showMessageBox({ type: 'error', message: `“${name}” could not be exported.`, detail: e instanceof Error ? e.message : String(e) });
        }
    }

    shouldAddToHistory(_: boolean) { return false }
}

export class ImportCommand extends cmd.CommandLike {
    files!: readonly OpenedFile[];

    async execute(): Promise<void> {
        await this.editor.importer.import(this.files, this.editor.activeViewport?.constructionPlane);
    }
}

export class GroupSelectedCommand extends cmd.CommandLike {
    async execute(): Promise<void> {
        const { solids, curves, groups } = this.editor.selection.selected;
        const selectedItems = [...solids, ...curves, ...groups];
        const group = this.editor.scene.createGroup();
        for (const item of selectedItems) this.editor.scene.moveToGroup(item, group);
    }
}

export class UngroupSelectedCommand extends cmd.CommandLike {
    async execute(): Promise<void> {
        const { solids, curves } = this.editor.selection.selected;
        const selectedItems = [...solids, ...curves];
        for (const item of selectedItems) this.editor.scene.moveToGroup(item, this.editor.scene.root);
    }
}

export class CreateViewspaceConstructionPlaneAtOriginCommand extends cmd.CommandLike {
    async execute(): Promise<void> {
        const viewport = this.editor.activeViewport;
        if (viewport === undefined) return;
        viewport.constructionPlane = viewport.cplanes.constructionPlaneForCamera(viewport.camera.quaternion);
    }

    shouldAddToHistory(_: boolean) { return false }
}

export class CreateViewspaceConstructionPlaneCommand extends cmd.CommandLike {
    async execute(): Promise<void> {
        const pointPicker = new PointPicker(this.editor);
        const { point, info: { viewport, cameraOrientation } } = await pointPicker.execute().resource(this);
        viewport.constructionPlane = viewport.cplanes.constructionPlaneForCamera(cameraOrientation, point);
    }

    shouldAddToHistory(_: boolean) { return false }
}
