/**
 * @jest-environment jsdom
 */
import * as THREE from "three";
import './matchers';
import { EditorSignals } from '../src/editor/EditorSignals';
import { BasicMaterialDatabase } from "../src/editor/MaterialDatabase";
import { GizmoMaterialDatabase } from "../src/command/GizmoMaterials";

let materials: BasicMaterialDatabase;
let gizmos: GizmoMaterialDatabase;
let signals: EditorSignals;

beforeEach(() => {
    signals = new EditorSignals();
    materials = new BasicMaterialDatabase(signals);
    gizmos = new GizmoMaterialDatabase(signals);
})

let camera: THREE.Camera;

describe('setResolution', () => {
    test('BasicMaterialDatabase', () => {
        const r1 = new THREE.Vector2(640, 480);
        signals.renderPrepared.dispatch({ camera, resolution: r1 });
        const line = materials.line();
        expect(line.resolution.width).toEqual(r1.width);
        expect(line.resolution.height).toEqual(r1.height);

        const r2 = new THREE.Vector2(1024, 768);
        signals.renderPrepared.dispatch({ camera, resolution: r2 });
        expect(line.resolution.width).toEqual(r2.width);
        expect(line.resolution.height).toEqual(r2.height);
    })

    test('GizmoMaterialDatabase', () => {
        const r1 = new THREE.Vector2(640, 480);
        signals.renderPrepared.dispatch({ camera, resolution: r1 });
        const line = gizmos.blue.line2;
        expect(line.resolution.width).toEqual(r1.width);
        expect(line.resolution.height).toEqual(r1.height);

        const r2 = new THREE.Vector2(1024, 768);
        signals.renderPrepared.dispatch({ camera, resolution: r2 });
        expect(line.resolution.width).toEqual(r2.width);
        expect(line.resolution.height).toEqual(r2.height);
    })
});
describe('mementos', () => {
    test('undoing an edit restores the material it was made on', () => {
        const id = materials.add("Red", new THREE.MeshPhysicalMaterial({ color: 0xff0000, roughness: 0.5 }));
        const material = materials.get(id) as THREE.MeshPhysicalMaterial;
        const before = materials.saveToMemento();

        material.color.set(0x00ff00);
        material.roughness = 0.9;
        materials.restoreFromMemento(before);

        expect(materials.get(id)).toBe(material);
        expect(material.color.getHex()).toBe(0xff0000);
        expect(material.roughness).toBe(0.5);
    });

    test('restoring leaves the memento as it was, for restoring again', () => {
        const id = materials.add("Red", new THREE.MeshPhysicalMaterial({ color: 0xff0000 }));
        const before = materials.saveToMemento();

        materials.restoreFromMemento(before);
        materials.get(id).color.set(0x0000ff);
        materials.restoreFromMemento(before);

        expect(materials.get(id).color.getHex()).toBe(0xff0000);
    });

    test('materials added since are removed, and removed ones come back', () => {
        const kept = materials.add("Kept", new THREE.MeshPhysicalMaterial({ color: 0xff0000 }));
        const before = materials.saveToMemento();
        const added = materials.add("Added", new THREE.MeshPhysicalMaterial());

        materials.restoreFromMemento(before);
        expect(() => materials.get(added)).toThrow();
        expect(materials.get(kept).color.getHex()).toBe(0xff0000);

        materials.clear();
        materials.restoreFromMemento(before);
        expect(materials.get(kept).color.getHex()).toBe(0xff0000);
    });
});
