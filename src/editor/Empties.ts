import * as THREE from "three";
import { assertUnreachable } from "../util/Util";
import * as visual from '../visual_model/VisualModel';
import { EditorSignals } from "./EditorSignals";
import { EmptyMemento, MementoOriginator } from "./History";
import { Images } from "./Images";
import { Meshes } from "./Meshes";
import { EmptyJSON } from "./serialization/SolidifyDocument";
import { MeshSurfaceSnap } from "./snaps/MeshSurfaceSnap";

export type EmptyId = number;

// An image's path is its name in Images; a mesh's, its name in Meshes
export type EmptyInfo = { tag: 'Image', path: string } | { tag: 'Mesh', path: string }

export abstract class Empty extends visual.SpaceItem {
    constructor(readonly simpleName: EmptyId) {
        super();
        this.layers.set(visual.Layers.Empty);
    }
}

const startCounter = 0;

// An empty with a surface, which is what's picked, outlined and given a material
export abstract class SurfaceEmpty extends Empty {
    abstract readonly surface: THREE.Mesh;

    get outline(): THREE.Object3D | undefined {
        if (!this.visible) return undefined;
        return this;
    }
}

export class ImageEmpty extends SurfaceEmpty {
    readonly plane: THREE.Mesh;
    get surface() { return this.plane }

    constructor(simpleName: EmptyId, readonly texture: THREE.Texture) {
        super(simpleName);
        const aspect = texture.image.width / texture.image.height;
        const fac = 5;
        const geometry = new THREE.PlaneGeometry(fac * aspect, fac, 1, 1);
        const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
        this.plane = new THREE.Mesh(geometry, material);
        this.add(this.plane);
        this.renderOrder = visual.RenderOrder.ImageEmpty;
    }

    dispose() {
        const material = this.plane.material as THREE.MeshLambertMaterial;
        material.dispose();
        material.map!.dispose();
    }
}

// A mesh brought in to model against, like a scan or a part from elsewhere: shown, picked and snapped to, but not geometry
export class MeshEmpty extends SurfaceEmpty {
    readonly surface: THREE.Mesh;

    constructor(simpleName: EmptyId, readonly geometry: THREE.BufferGeometry) {
        super(simpleName);
        // Without a matcap texture, shaded by how each triangle faces the view; meshes from elsewhere may face either way
        const material = new THREE.MeshMatcapMaterial({ color: 0xc4c4cc, side: THREE.DoubleSide });
        this.surface = new THREE.Mesh(geometry, material);
        this.add(this.surface);
    }

    // Where a ray hit it
    snapAt(intersection: THREE.Intersection): MeshSurfaceSnap {
        const normal = intersection.face?.normal.clone() ?? new THREE.Vector3(0, 0, 1);
        normal.transformDirection(this.surface.matrixWorld);
        return new MeshSurfaceSnap(intersection.point.clone(), normal);
    }

    dispose() {
        (this.surface.material as THREE.Material).dispose();
    }
}

export class Empties implements MementoOriginator<EmptyMemento>{
    private counter: EmptyId = startCounter;
    private readonly id2info = new Map<EmptyId, Readonly<EmptyInfo>>();
    private readonly id2empty = new Map<EmptyId, Empty>();

    constructor(
        private readonly images: Images,
        private readonly signals: EditorSignals,
        private readonly meshes = new Meshes(),
    ) { }

    addImage(filePath: string): ImageEmpty {
        const id = this.counter++;
        const info = { tag: 'Image', path: filePath } as EmptyInfo;
        const texture = this.images.get(filePath);
        if (texture === undefined) throw new Error("invalid precondition: " + filePath);
        const empty = new ImageEmpty(id, texture);
        return this.add(id, empty, info);
    }

    addMesh(name: string): MeshEmpty {
        const id = this.counter++;
        const info: EmptyInfo = { tag: 'Mesh', path: name };
        const geometry = this.meshes.get(name);
        if (geometry === undefined) throw new Error("invalid precondition: " + name);
        return this.add(id, new MeshEmpty(id, geometry), info);
    }

    duplicate<T extends Empty>(empty: T): T {
        const id = this.counter++;
        const info = this.id2info.get(empty.simpleName);
        if (info === undefined) throw new Error("Empty has no info");
        if (empty instanceof ImageEmpty) {
            return this.add(id, new ImageEmpty(id, empty.texture), info) as unknown as T;
        } else if (empty instanceof MeshEmpty) {
            return this.add(id, new MeshEmpty(id, empty.geometry), info) as unknown as T;
        } else {
            throw new Error('Invalid empty type');
        }
    }

    infoOf(empty: Empty): Readonly<EmptyInfo> | undefined {
        return this.id2info.get(empty.simpleName);
    }

    private add<T extends Empty>(id: EmptyId, empty: T, info: EmptyInfo): T {
        this.id2empty.set(id, empty);
        this.id2info.set(id, info);
        this.signals.emptyAdded.dispatch(empty);
        return empty;
    }

    delete(empty: Empty) {
        const id = empty.simpleName;
        this.id2empty.delete(id);
        this.id2info.delete(id);
        this.signals.emptyRemoved.dispatch(empty);
    }

    lookupById(id: EmptyId): Empty {
        return this.id2empty.get(id)!;
    }

    get items(): Empty[] {
        return [...this.id2empty.values()];
    }

    removeItem(empty: Empty) {
        this.id2info.delete(empty.simpleName);
        this.id2empty.delete(empty.simpleName);
        empty.dispose();
    }

    saveToMemento(): EmptyMemento {
        return new EmptyMemento(
            this.counter,
            new Map(this.id2info),
            new Map(this.id2empty),
        );
    }

    restoreFromMemento(m: EmptyMemento) {
        (this.counter as Empties['counter']) = m.counter;
        (this.id2info as Empties['id2info']) = new Map(m.id2info);
        (this.id2empty as Empties['id2empty']) = new Map(m.id2empty);
    }

    clear() {
        this.id2info.clear();
        this.id2empty.clear();
        this.counter = startCounter;
    }

    async deserialize(jsons: EmptyJSON[]) {
        for (const json of jsons) {
            switch (json.type) {
                case 'Image':
                    this.addImage(json.image!);
                    break;
                case 'Mesh':
                    this.addMesh(json.mesh!);
                    break;
                default: assertUnreachable(json.type);
            }
        }
    }

    validate() { }
    debug() { }
}
