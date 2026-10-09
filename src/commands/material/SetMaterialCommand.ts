import * as THREE from "three";
import * as cmd from "../../command/Command";
import { Empty, SurfaceEmpty } from "../../editor/Empties";
import { RealNodeItem } from "../../editor/Nodes";
import { defaultPhysicalMaterial } from "../../visual_model/RenderedSceneBuilder";
import { MaterialDialog } from "./MaterialDialog";

export interface MaterialParams {
    color: THREE.Color;
}

export interface PhysicalMaterialParams extends MaterialParams {
    metalness: number;
    roughness: number;
    ior: number;
    clearcoat: number;
    clearcoatRoughness: number;
    sheen: number;
    sheenRoughness: number;
    sheenColor: THREE.Color;
    specularIntensity: number;
    specularColor: THREE.Color;
    transmission: number;
    thickness: number;
}

// The selection's material, made and given to it if it has none: what Set material and Properties › Add material do
function materialForSelection(editor: cmd.EditorLike) {
    const { scene, selection: { selected }, materials } = editor;
    const node = selected.solids.first ?? selected.groups.first ?? selected.empties.first;
    let material = scene.getMaterial(node);
    if (material === undefined) {
        if (node instanceof Empty) {
            material = defaultImageEmptyMaterial.clone();
            const id = materials.add("New material", material);
            for (const empty of [...selected.empties]) {
                scene.setMaterial(empty, id);
            }
        } else {
            material = defaultPhysicalMaterial.clone();
            const id = materials.add("New material", material);
            for (const solid of [...selected.solids, ...selected.groups]) {
                scene.setMaterial(solid, id);
            }
        }
    }
    return material;
}

export class SetMaterialCommand extends cmd.CommandLike {
    async execute(): Promise<void> {
        const { editor: { selection: { selected }, signals } } = this;
        const material = materialForSelection(this.editor);

        const dialog = new MaterialDialog(material, signals);
        dialog.execute(() => {
            signals.factoryUpdated.dispatch();
            for (const empty of [...selected.empties]) {
                if (empty instanceof SurfaceEmpty) {
                    const existing = empty.surface.material as THREE.Material;
                    existing.depthWrite = material!.depthFunc !== THREE.NeverDepth; 
                    existing.depthFunc = material!.depthFunc;
                    existing.opacity = material!.opacity;
                    existing.transparent = material!.opacity < 1;
                }
            }
        }).resource(this).then(() => this.finish(), () => this.cancel());

        await this.finished;
    }
}

export class AddMaterialCommand extends cmd.CommandLike {
    async execute(): Promise<void> {
        materialForSelection(this.editor);
    }
}

// One of a material's settings, as Properties edits it: set straight away while it's being dragged, and through the
// command once it's let go, for the history and the document's unsaved changes
export function setMaterialSetting(editor: cmd.EditorLike, nodes: RealNodeItem[], key: string, value: unknown) {
    const material = editor.scene.getMaterial(nodes[0]);
    if (material === undefined) return;
    (material as unknown as Record<string, unknown>)[key] = value;
    for (const node of nodes) {
        if (node instanceof SurfaceEmpty) {
            const existing = node.surface.material as THREE.Material;
            existing.depthWrite = material.depthFunc !== THREE.NeverDepth;
            existing.depthFunc = material.depthFunc;
            existing.opacity = material.opacity;
            existing.transparent = material.opacity < 1;
        }
        editor.signals.itemMaterialChanged.dispatch(node);
    }
}

export class EditMaterialCommand extends cmd.CommandLike {
    constructor(editor: cmd.EditorLike, private readonly nodes: RealNodeItem[], private readonly key: string, private readonly value: unknown) {
        super(editor);
    }

    async execute(): Promise<void> {
        setMaterialSetting(this.editor, this.nodes, this.key, this.value);
    }
}

export class RemoveMaterialCommand extends cmd.CommandLike {
    async execute(): Promise<void> {
        const { editor: { scene, selection: { selected } } } = this;
        const node = selected.solids.first ?? selected.groups.first;
        scene.setMaterial(node, undefined);
    }
}

const defaultImageEmptyMaterial = new THREE.MeshBasicMaterial();