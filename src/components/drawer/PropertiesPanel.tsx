import { JSX, render } from 'preact';
import * as THREE from 'three';
import { AddMaterialCommand, EditMaterialCommand, RemoveMaterialCommand, setMaterialSetting } from '../../commands/material/SetMaterialCommand';
import { Editor } from '../../editor/Editor';
import { Empty } from '../../editor/Empties';
import { Group } from '../../editor/Groups';
import { RealNodeItem } from '../../editor/Nodes';
import { formatLength } from '../../util/Units';
import * as visual from '../../visual_model/VisualModel';
import { ChangeEvent } from '../dialog/NumberScrubber';
import { SetNameCommand, ToggleHiddenCommand, ToggleSelectableCommand } from '../outliner/OutlinerItems';

const section = "px-2 mt-4 mb-1 text-[11px] font-semibold tracking-wider uppercase first:mt-0 text-ui-faint";

// A physical material's settings, as Set material's panel has them: name, label, and the range of the numbers
const physical: { key: string, label: string, min?: number, max?: number, length?: boolean, color?: boolean }[] = [
    { key: 'color', label: "Color", color: true },
    { key: 'metalness', label: "Metalness", min: 0, max: 1 },
    { key: 'roughness', label: "Roughness", min: 0, max: 1 },
    { key: 'ior', label: "IOR", min: 1, max: 2.333 },
    { key: 'clearcoat', label: "Clearcoat", min: 0, max: 1 },
    { key: 'clearcoatRoughness', label: "Clearcoat roughness", min: 0, max: 1 },
    { key: 'sheen', label: "Sheen", min: 0, max: 1 },
    { key: 'sheenRoughness', label: "Sheen roughness", min: 0, max: 1 },
    { key: 'sheenColor', label: "Sheen color", color: true },
    { key: 'specularIntensity', label: "Specular intensity", min: 0, max: 1 },
    { key: 'specularColor', label: "Specular color", color: true },
    { key: 'transmission', label: "Transmission", min: 0, max: 1 },
    { key: 'thickness', label: "Thickness", min: 0, length: true },
];

const depths = [["Normal", THREE.LessEqualDepth], ["Front", THREE.AlwaysDepth], ["Behind", THREE.NeverDepth]] as const;

export default (editor: Editor) => {
    const { scene } = editor;

    const kind = (node: RealNodeItem) =>
        node instanceof visual.Solid ? "Solid" : node instanceof visual.SpaceInstance ? "Curve" : node instanceof Group ? "Group" : "Empty";
    const icon = (node: RealNodeItem) =>
        node instanceof visual.Solid ? 'solid' : node instanceof visual.SpaceInstance ? 'curve' : node instanceof Group ? 'group' : 'face';
    // As the Scene panel names it
    const defaultName = (node: RealNodeItem) => {
        const id = node instanceof Group || node instanceof Empty ? node.simpleName : editor.db.lookupId(node.simpleName);
        return `${kind(node)} ${id}`;
    }
    const nameOf = (node: RealNodeItem) => scene.getName(node) ?? defaultName(node);

    // What a node is drawn as, a group's being what's in it
    const objectsOf = (node: RealNodeItem): THREE.Object3D[] => node instanceof Group
        ? scene.walk(node).flatMap<THREE.Object3D>(listing => listing.tag === 'Item' ? [listing.item] : listing.tag === 'Empty' ? [listing.empty] : [])
        : [node];

    // The selection's name, state, size and material, and what to change of them
    class PropertiesPanel extends HTMLElement {
        connectedCallback() {
            const { signals } = editor;
            for (const signal of [signals.selectionChanged, signals.sceneGraphChanged, signals.historyChanged, signals.commandEnded, signals.settingsChanged]) {
                signal.add(this.render);
            }
            this.render();
        }

        disconnectedCallback() {
            const { signals } = editor;
            for (const signal of [signals.selectionChanged, signals.sceneGraphChanged, signals.historyChanged, signals.commandEnded, signals.settingsChanged]) {
                signal.remove(this.render);
            }
        }

        render = () => {
            const { selected } = editor.selection;
            const nodes: RealNodeItem[] = [...selected.solids, ...selected.curves, ...selected.groups, ...selected.empties];
            const parts = [[selected.faces.size, "face"], [selected.edges.size, "edge"]] as const;
            render(
                <>
                    <div class="panel-header">
                        <solidify-icon name="properties"></solidify-icon>
                        <h1 class="panel-title">Properties</h1>
                    </div>
                    <div class="p-4">
                        {nodes.length === 0
                            ? <p class="px-2 text-xs text-ui-muted">{parts.some(([n]) => n > 0) ? `${count(parts)} selected` : "Select something to see its properties."}</p>
                            : <>
                                {nodes.length === 1 ? this.one(nodes[0]) : this.several(nodes)}
                                {this.size(nodes)}
                                {this.material(nodes)}
                            </>
                        }
                    </div>
                </>, this);
        }

        private one(node: RealNodeItem) {
            const hidden = scene.isHidden(node);
            const locked = !scene.isSelectable(node);
            return <>
                <div class="flex items-center px-2 space-x-2">
                    <solidify-icon name={icon(node)} class="flex-none text-ui-muted"></solidify-icon>
                    <input type="text" aria-label="Name" spellcheck={false} autocomplete="off"
                        class="flex-grow px-2 min-w-0 h-7 text-xs rounded-md ring-1 ring-transparent bg-ui-raised text-ui-title focus:ring-ui-focus"
                        value={nameOf(node)} placeholder={defaultName(node)}
                        onKeyDown={e => this.onNameKey(e, node)} onKeyUp={e => e.stopPropagation()} onBlur={e => this.rename(e.currentTarget, node)} />
                </div>
                <p class="px-2 mt-1 text-[11px] text-ui-faint">{kind(node)}</p>

                <h2 class={section}>State</h2>
                {this.toggle("Hidden", hidden, () => editor.enqueue(new ToggleHiddenCommand(editor, node, !hidden), true))}
                {this.toggle("Locked", locked, () => editor.enqueue(new ToggleSelectableCommand(editor, node, locked), true))}
            </>;
        }

        // Typing goes into the name, not to the shortcuts; Enter keeps it, Escape puts it back
        private onNameKey(e: KeyboardEvent, node: RealNodeItem) {
            e.stopPropagation();
            const input = e.currentTarget as HTMLInputElement;
            if (e.key === 'Enter') input.blur();
            else if (e.key === 'Escape') {
                input.value = nameOf(node);
                input.blur();
            }
        }

        private rename(input: HTMLInputElement, node: RealNodeItem) {
            if (input.value === nameOf(node)) return;
            editor.enqueue(new SetNameCommand(editor, node, input.value), true);
        }

        private several(nodes: RealNodeItem[]) {
            const kinds = ["Solid", "Curve", "Group", "Empty"].map(k => [nodes.filter(node => kind(node) === k).length, k.toLowerCase()] as const);
            return <p class="px-2 text-xs text-ui-text">{count(kinds)}</p>;
        }

        private size(nodes: RealNodeItem[]) {
            const box = new THREE.Box3();
            for (const node of nodes) for (const object of objectsOf(node)) box.expandByObject(object);
            if (box.isEmpty()) return null;
            const size = box.getSize(new THREE.Vector3());
            return <>
                <h2 class={section}>Size</h2>
                {this.row("Width", <span class="text-xs text-ui-text">{formatLength(size.x)}</span>)}
                {this.row("Depth", <span class="text-xs text-ui-text">{formatLength(size.y)}</span>)}
                {this.row("Height", <span class="text-xs text-ui-text">{formatLength(size.z)}</span>)}
            </>;
        }

        // Solids, groups and empties have materials; curves don't
        private material(nodes: RealNodeItem[]) {
            const withMaterials = nodes.filter(node => !(node instanceof visual.SpaceInstance));
            if (withMaterials.length === 0) return null;
            const materials = withMaterials.map(node => scene.getMaterial(node));
            const material = materials[0];
            const button = "py-1 px-3 mx-2 mt-1 text-xs rounded-md bg-ui-raised text-ui-title hover:bg-ui-hover";
            let body;
            if (!materials.every(m => m === material)) {
                body = <p class="px-2 text-xs text-ui-muted">Different materials. Select one to edit its material.</p>;
            } else if (material === undefined) {
                body = <button class={button} onClick={() => editor.enqueue(new AddMaterialCommand(editor), true)}>Add material</button>;
            } else {
                const live = (key: string, value: unknown) => setMaterialSetting(editor, withMaterials, key, value);
                const keep = (key: string, value: unknown) => editor.enqueue(new EditMaterialCommand(editor, withMaterials, key, value), true);
                const settings = material instanceof THREE.MeshBasicMaterial ? this.basic(material, live, keep) : this.physical(material as THREE.MeshPhysicalMaterial, live, keep);
                body = <>
                    {settings}
                    {nodes.length === 1 && <button class={button} onClick={() => editor.enqueue(new RemoveMaterialCommand(editor), true)}>Remove material</button>}
                </>;
            }
            return <>
                <h2 class={section}>Material</h2>
                {body}
            </>;
        }

        private physical(material: THREE.MeshPhysicalMaterial, live: (key: string, value: unknown) => void, keep: (key: string, value: unknown) => void) {
            const values = material as unknown as Record<string, unknown>;
            return physical.map(({ key, label, min, max, length, color }) => this.row(label, color
                ? <input type="color" aria-label={label} class="block w-24 h-6 bg-transparent rounded cursor-pointer"
                    value={`#${(values[key] as THREE.Color).getHexString()}`}
                    onInput={e => live(key, new THREE.Color(e.currentTarget.value))}
                    onChange={e => keep(key, new THREE.Color(e.currentTarget.value))} />
                : <solidify-number-scrubber class="block w-24" name={key} value={values[key] as number} min={min} max={max} unit={length ? 'length' : undefined}
                    onscrub={(e: ChangeEvent) => live(key, e.value)}
                    onchange={(e: ChangeEvent) => keep(key, e.value)}
                    onfinish={(e: ChangeEvent) => keep(key, e.value)}></solidify-number-scrubber>));
        }

        // An empty's image: whether it's drawn in front of or behind the model, and how see-through it is
        private basic(material: THREE.MeshBasicMaterial, live: (key: string, value: unknown) => void, keep: (key: string, value: unknown) => void) {
            return <>
                <div class="flex gap-0.5 p-0.5 mx-2 mb-1 rounded-md bg-ui-raised">
                    {depths.map(([label, depth]) =>
                        <button class={`flex-1 py-1 text-xs rounded ${material.depthFunc === depth ? 'bg-ui-tint text-ui-accent' : 'text-ui-muted hover:text-ui-title'}`}
                            aria-pressed={material.depthFunc === depth} onClick={() => keep('depthFunc', depth)}>{label}</button>)}
                </div>
                {this.row("Opacity", <solidify-number-scrubber class="block w-24" name="opacity" value={material.opacity} min={0} max={1}
                    onscrub={(e: ChangeEvent) => live('opacity', e.value)}
                    onchange={(e: ChangeEvent) => keep('opacity', e.value)}
                    onfinish={(e: ChangeEvent) => keep('opacity', e.value)}></solidify-number-scrubber>)}
            </>;
        }

        private row(label: string, control: JSX.Element) {
            return <div class="flex items-center px-2 py-1 space-x-2">
                <span class="flex-grow min-w-0 text-xs truncate text-ui-muted">{label}</span>
                {control}
            </div>;
        }

        private toggle(name: string, on: boolean, onClick: () => void) {
            return <button class="flex items-center px-2 py-1.5 w-full rounded-md hover:bg-ui-hover" role="switch" aria-checked={on} onClick={onClick}>
                <span class={`flex-grow text-xs text-left ${on ? 'text-ui-text' : 'text-ui-muted'}`}>{name}</span>
                <span class={`relative flex-none w-7 h-4 rounded-full ${on ? 'bg-ui-tint' : 'bg-ui-hover'}`}>
                    <span class={`absolute top-0.5 w-3 h-3 rounded-full ${on ? 'left-3.5 bg-ui-accent' : 'left-0.5 bg-ui-muted'}`}></span>
                </span>
            </button>;
        }
    }
    customElements.define('solidify-properties-panel', PropertiesPanel);
}

// Like "2 solids, 1 curve"
function count(counts: readonly (readonly [number, string])[]) {
    return counts.filter(([n]) => n > 0).map(([n, noun]) => `${n} ${noun}${n === 1 ? '' : 's'}`).join(", ");
}
