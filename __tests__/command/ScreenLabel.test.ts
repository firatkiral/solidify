/**
 * @jest-environment jsdom
 */
import * as THREE from "three";
import { placeClear } from "../../src/command/ScreenLabel";
import '../matchers';

describe(placeClear, () => {
    // Looking down -Z at a 20 × 20 world-unit view drawn 200 × 200 pixels: 10 pixels a unit, the origin at (100, 100)
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld();
    const domElement = document.createElement('div');
    domElement.getBoundingClientRect = () => ({ width: 200, height: 200 } as DOMRect);
    const viewport = { camera, domElement };

    let element: HTMLElement;
    beforeEach(() => {
        element = document.createElement('div');
        Object.defineProperty(element, 'offsetWidth', { value: 40 });
        Object.defineProperty(element, 'offsetHeight', { value: 20 });
    });

    test('stands past the point the way the direction shows, by a gap and half its own width', () => {
        expect(placeClear(element, viewport, new THREE.Vector3(), new THREE.Vector3(1, 0, 0))).toBe(true);
        expect(element.style.left).toBe('128px');
        expect(element.style.top).toBe('100px');
    });

    test('also clears the radius around the point, as it shows on screen', () => {
        placeClear(element, viewport, new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 1);
        expect(element.style.left).toBe('138px');
        expect(element.style.top).toBe('100px');
    });

    test('goes by its own height along a direction up the screen', () => {
        placeClear(element, viewport, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
        expect(element.style.left).toBe('100px');
        expect(element.style.top).toBe('82px');
    });

    test('goes up when the direction points at the camera, having no way on screen', () => {
        placeClear(element, viewport, new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
        expect(element.style.left).toBe('100px');
        expect(element.style.top).toBe('82px');
    });

    test('says when the point is behind the camera', () => {
        expect(placeClear(element, viewport, new THREE.Vector3(0, 0, 20), new THREE.Vector3(1, 0, 0))).toBe(false);
    });
});
