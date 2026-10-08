import { GridHelper } from "../../src/components/viewport/GridHelper";
import * as THREE from 'three';
import { ConstructionPlaneSnap } from "../../src/editor/snaps/ConstructionPlaneSnap";
import { CustomGrid, FloorHelper, OrthoModeGrid } from "../../src/components/viewport/FloorHelper";
import { PlaneDatabase } from "../../src/editor/PlaneDatabase";

let grids: GridHelper

beforeEach(() => {
    grids = new GridHelper(new THREE.Color(), new THREE.Color(), new THREE.Color());
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

test('resizeGrid steps along the grid sizes, and the plane snaps to the size', () => {
    const cplane = new ConstructionPlaneSnap();
    expect(grids.spacing).toBe(0.1);
    grids.resizeGrid(1, cplane);
    expect(grids.spacing).toBe(0.2);
    expect(cplane.gridFactor).toBe(0.5);
    grids.resizeGrid(1, cplane);
    grids.resizeGrid(1, cplane);
    expect(grids.spacing).toBe(1);
    grids.resizeGrid(-1, cplane);
    expect(grids.spacing).toBe(0.5);
    grids.resizeGrid(0, cplane);
    expect(grids.spacing).toBe(0.5);
});

test('resizeGrid stops at the smallest and largest sizes', () => {
    const cplane = new ConstructionPlaneSnap();
    for (let i = 0; i < 20; i++) grids.resizeGrid(-1, cplane);
    expect(grids.spacing).toBe(0.01);
    expect(cplane.gridFactor).toBe(10);
    for (let i = 0; i < 20; i++) grids.resizeGrid(1, cplane);
    expect(grids.spacing).toBe(10);
    expect(cplane.gridFactor).toBe(0.01);
})

test('snapping to the plane steps by the grid size', () => {
    const cplane = new ConstructionPlaneSnap();
    grids.resizeGrid(1, cplane); grids.resizeGrid(1, cplane); grids.resizeGrid(1, cplane); // 1 m
    const p = new THREE.Vector3(2.4, -3.6, 0);
    cplane.snapToGrid(p, cplane);
    expect(p.x).toBeCloseTo(2);
    expect(p.y).toBeCloseTo(-4);
})
