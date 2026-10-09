import { GridHelper } from "../../src/components/viewport/GridHelper";
import * as THREE from 'three';
import { ConstructionPlaneSnap } from "../../src/editor/snaps/ConstructionPlaneSnap";
import { CustomGrid, FloorHelper, gridLines, OrthoModeGrid } from "../../src/components/viewport/FloorHelper";
import { PlaneDatabase } from "../../src/editor/PlaneDatabase";

let grids: GridHelper

beforeEach(() => {
    grids = new GridHelper({ size: 300, step: 10, majorEvery: 10 }, new THREE.Color(), new THREE.Color(), new THREE.Color());
})

test('getOverlay(true, ...)', () => {
    const result = grids.getOverlay(true, new ConstructionPlaneSnap(new THREE.Vector3(1, 0, 0)), new THREE.OrthographicCamera());
    expect(result).toBeInstanceOf(OrthoModeGrid);
})

test('getOverlay(false, ScreenSpace)', () => {
    const result = grids.getOverlay(false, PlaneDatabase.ScreenSpace, new THREE.OrthographicCamera());
    expect(result).toBeInstanceOf(OrthoModeGrid);
})

test('getOverlay(false, XY)', () => {
    const result = grids.getOverlay(false, PlaneDatabase.XY, new THREE.OrthographicCamera());
    expect(result).toBeInstanceOf(FloorHelper);
})

test('getOverlay(false, ....)', () => {
    const result = grids.getOverlay(false, new ConstructionPlaneSnap(new THREE.Vector3(1, 0, 0)), new THREE.OrthographicCamera());
    expect(result).toBeInstanceOf(CustomGrid);
})

// Each line is two points of x, y, z
const xs = (lines: number[]) => {
    const result = new Set<number>();
    for (let i = 0; i < lines.length; i += 6) if (lines[i] === lines[i + 3]) result.add(lines[i]);
    return [...result].sort((a, b) => a - b);
}

test('lines every step through the origin, heavier ones every majorEvery steps', () => {
    const { minor, major } = gridLines({ size: 300, step: 10, majorEvery: 10 });
    expect(xs(major)).toEqual([-100, 0, 100]);
    expect(xs(minor)).toHaveLength(31 - 3);
    expect(xs(minor)[0]).toBe(-150);
    expect(xs(minor)).toContain(10);
    expect(Math.max(...minor.map(Math.abs))).toBe(150);
})

test('a size that is not a whole number of steps ends at the last step within it', () => {
    const { minor, major } = gridLines({ size: 305, step: 10, majorEvery: 12 });
    expect(xs(major)).toEqual([-120, 0, 120]);
    expect(Math.max(...minor.map(Math.abs))).toBe(150);
})

test('setSpec rebuilds only when something changed', () => {
    const floor = grids.getOverlay(false, PlaneDatabase.XY, new THREE.OrthographicCamera());
    grids.setSpec({ size: 300, step: 10, majorEvery: 10 });
    expect(grids.getOverlay(false, PlaneDatabase.XY, new THREE.OrthographicCamera())).toBe(floor);
    grids.setSpec({ size: 600, step: 10, majorEvery: 10 });
    expect(grids.getOverlay(false, PlaneDatabase.XY, new THREE.OrthographicCamera())).not.toBe(floor);
    expect(grids.size).toBe(600);
})

test('boundingSphere covers the grid on its plane', () => {
    const plane = new ConstructionPlaneSnap(new THREE.Vector3(0, 0, 1), new THREE.Vector3(5, 5, 5));
    const sphere = grids.boundingSphere(plane);
    expect(sphere.center).toEqual(new THREE.Vector3(5, 5, 5));
    expect(sphere.radius).toBeCloseTo(150 * Math.SQRT2);
})

test('minor lines hide once they crowd together on screen', () => {
    const floor = grids.getOverlay(false, PlaneDatabase.XY, new THREE.OrthographicCamera()) as FloorHelper;
    const camera = new THREE.OrthographicCamera(-150, 150, 150, -150); // 300 mm over 1000 px: 10 mm lines are 33 px apart
    floor.update(camera);
    const [minor] = floor.children as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>[];
    expect(minor.visible).toBe(true);
    camera.zoom = 0.1; // 3 m over 1000 px: 3.3 px apart
    floor.update(camera);
    expect(minor.visible).toBe(false);
})
