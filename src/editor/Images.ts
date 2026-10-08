import * as THREE from "three";
import { Delay } from "../util/SequentialExecutor";

// The images in the document, by name, with their data so the document can be saved with them
export class Images {
    private readonly name2texture = new Map<string, THREE.Texture>();
    private readonly name2data = new Map<string, Uint8Array>();

    // Named for its content, so an image added twice is kept once
    static nameFor(fileName: string, data: Uint8Array): string {
        const extension = /\.(png|jpe?g)$/i.exec(fileName)?.[1].toLowerCase() ?? 'png';
        return `${hash(data)}.${extension}`;
    }

    async add(name: string, data: Uint8Array): Promise<THREE.Texture> {
        const delay = new Delay<THREE.Texture>();
        const manager = new THREE.LoadingManager();
        const objectURLs: string[] = [];
        const blob = new Blob([data]);
        manager.setURLModifier(url => {
            url = URL.createObjectURL(blob);
            objectURLs.push(url);
            return url;
        });
        new THREE.TextureLoader(manager).load(name, texture => {
            for (const url of objectURLs)
                URL.revokeObjectURL(url);
            delay.resolve(texture);
        });
        const texture = await delay.promise;
        texture.encoding = THREE.sRGBEncoding;
        this.name2texture.set(name, texture);
        this.name2data.set(name, data);
        return texture;
    }

    get(name: string): THREE.Texture | undefined {
        return this.name2texture.get(name);
    }

    data(name: string): Uint8Array | undefined {
        return this.name2data.get(name);
    }

    clear() {
        this.name2texture.clear();
        this.name2data.clear();
    }

    get names() {
        return this.name2texture.keys();
    }
}

// cyrb53: fast, and plenty to tell the images (or meshes) in one document apart
export function hash(data: Uint8Array): string {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < data.length; i++) {
        h1 = Math.imul(h1 ^ data[i], 2654435761);
        h2 = Math.imul(h2 ^ data[i], 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
