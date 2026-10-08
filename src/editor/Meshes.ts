import * as THREE from "three";
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { hash } from "./Images";

// The reference meshes in the document, by name, each kept as a binary STL in millimetres so the document can be saved with it
export class Meshes {
    private readonly name2geometry = new Map<string, THREE.BufferGeometry>();
    private readonly name2data = new Map<string, Uint8Array>();

    // Named for its content, so a mesh added twice is kept once
    static nameFor(data: Uint8Array): string {
        return `${hash(data)}.stl`;
    }

    add(name: string, data: Uint8Array): THREE.BufferGeometry {
        const existing = this.name2geometry.get(name);
        if (existing !== undefined) return existing;
        const geometry = new STLLoader().parse(data.slice().buffer);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        this.name2geometry.set(name, geometry);
        this.name2data.set(name, data);
        return geometry;
    }

    get(name: string): THREE.BufferGeometry | undefined {
        return this.name2geometry.get(name);
    }

    data(name: string): Uint8Array | undefined {
        return this.name2data.get(name);
    }

    clear() {
        for (const geometry of this.name2geometry.values()) geometry.dispose();
        this.name2geometry.clear();
        this.name2data.clear();
    }

    get names() {
        return this.name2geometry.keys();
    }
}
