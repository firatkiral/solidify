import { strFromU8, unzipSync } from 'fflate';
import * as THREE from 'three';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PrintMesh } from './PrintMesh';

export const meshExtensions = ['stl', 'obj', '3mf'];

// 3MF says its unit; STL and OBJ don't, and are taken to be millimetres, as slicers do
const millimetresPer: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

// The meshes in an STL, OBJ or 3MF file, in millimetres, with every triangle on its own
export function readMeshes(fileName: string, data: Uint8Array): PrintMesh[] {
    const base = fileName.replace(/\.[^.]+$/, '');
    const buffer = data.slice().buffer;
    let object: THREE.Object3D;
    if (/\.stl$/i.test(fileName)) {
        object = new THREE.Mesh(new STLLoader().parse(buffer));
    } else if (/\.obj$/i.test(fileName)) {
        object = new OBJLoader().parse(strFromU8(data));
    } else if (/\.3mf$/i.test(fileName)) {
        object = new ThreeMFLoader().parse(buffer);
        object.scale.setScalar(unitOf3mf(data));
    } else {
        throw new Error(`${fileName} isn't an STL, OBJ or 3MF file.`);
    }

    object.updateMatrixWorld(true);
    const meshes: PrintMesh[] = [];
    object.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const geometry = (child.geometry as THREE.BufferGeometry).clone().applyMatrix4(child.matrixWorld);
        const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
        const positions = new Float32Array(flat.getAttribute('position').array);
        geometry.dispose(); flat.dispose();
        if (positions.length === 0) return;
        const triangles = new Uint32Array(positions.length / 3).map((_, i) => i);
        meshes.push({ name: child.name || base, positions, triangles });
    });
    if (meshes.length === 0) throw new Error(`${fileName} has no triangles.`);
    // Several from one file are told apart by number
    if (meshes.length > 1) return meshes.map((m, i) => m.name === base ? { ...m, name: `${base} ${i + 1}` } : m);
    return meshes;
}

function unitOf3mf(data: Uint8Array): number {
    const entries = unzipSync(data, { filter: file => /\.model$/i.test(file.name) });
    for (const entry of Object.values(entries)) {
        const unit = /<model[^>]*\sunit="([a-z]+)"/i.exec(strFromU8(entry))?.[1];
        if (unit !== undefined) return millimetresPer[unit.toLowerCase()] ?? 1;
    }
    return 1;
}
