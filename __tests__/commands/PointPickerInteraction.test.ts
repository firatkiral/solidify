/**
 * @jest-environment jsdom
 */

import * as THREE from "three";
import { PointPicker, PointResult } from "../../src/command/point-picker/PointPicker";
import { Viewport } from "../../src/components/viewport/Viewport";
import { Editor } from '../../src/editor/Editor';
import { PointSnap } from "../../src/editor/snaps/PointSnap";
import { MakeViewport } from "../../__mocks__/FakeViewport";
import '../matchers';

let editor: Editor;
let viewport: Viewport;
let pointPicker: PointPicker;

beforeEach(() => {
    editor = new Editor();
    viewport = MakeViewport(editor);
    pointPicker = new PointPicker(editor);
    editor.viewports.add(viewport);
    document.body.appendChild(viewport.domElement);
});

afterEach(() => {
    editor.dispose();
});

let domElement: HTMLCanvasElement;

beforeEach(() => {
    domElement = [...editor.viewports][0].renderer.domElement;
    domElement.setPointerCapture = jest.fn();
})

test('basic move and click', async () => {
    const promise = pointPicker.execute();
    const move = new MouseEvent('pointermove', { clientX: 50, clientY: 50 });
    domElement.dispatchEvent(move);
    domElement.dispatchEvent(new MouseEvent('pointerdown'));
    domElement.dispatchEvent(new MouseEvent('pointerup'));
    const { point } = await promise;
    expect(point).toApproximatelyEqual(new THREE.Vector3());
});

test('dragging while the button is held keeps the pressed point', async () => {
    const cb = jest.fn();
    const promise = pointPicker.execute(cb);
    domElement.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }));
    domElement.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 50 }));
    expect(cb).toHaveBeenCalledTimes(1);
    domElement.dispatchEvent(new MouseEvent('pointermove', { clientX: 80, clientY: 20 }));
    expect(cb).toHaveBeenCalledTimes(1);
    domElement.dispatchEvent(new MouseEvent('pointerup', { clientX: 80, clientY: 20 }));
    const { point } = await promise;
    expect(point).toApproximatelyEqual(new THREE.Vector3());
});

test('pressing without a prior move picks the pressed point', async () => {
    const promise = pointPicker.execute();
    domElement.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 50 }));
    domElement.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, clientY: 50 }));
    const { point } = await promise;
    expect(point).toApproximatelyEqual(new THREE.Vector3());
});

test('the point follows the mouse again once pointer capture is lost', async () => {
    const promise = pointPicker.execute();
    domElement.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }));
    domElement.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 50 }));
    domElement.dispatchEvent(new MouseEvent('lostpointercapture'));
    domElement.dispatchEvent(new MouseEvent('pointermove', { clientX: 80, clientY: 20 }));
    domElement.dispatchEvent(new MouseEvent('pointerup', { clientX: 80, clientY: 20 }));
    const { point } = await promise;
    expect(point.length()).toBeGreaterThan(0.1);
});

test('tapping Shift over a snap adds guide lines through it, as in Plasticity', async () => {
    const activate = jest.spyOn((pointPicker as any).model, 'activateSnapped');
    const promise = pointPicker.execute();
    domElement.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    expect(activate).toHaveBeenCalledTimes(1);
    domElement.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 50 }));
    domElement.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, clientY: 50 }));
    await promise;
});

test('Alt does not', async () => {
    const activate = jest.spyOn((pointPicker as any).model, 'activateSnapped');
    const promise = pointPicker.execute();
    domElement.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }));
    expect(activate).not.toHaveBeenCalled();
    domElement.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 50 }));
    domElement.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, clientY: 50 }));
    await promise;
});

test('execute with no callback and preresult', async () => {
    const preresult: PointResult = { point: new THREE.Vector3(), info: { orientation: new THREE.Quaternion(), snap: new PointSnap() } };
    const result = await pointPicker.execute({ result: preresult });
    expect(result).toBe(preresult);
});

test('execute with callback and preresult', async () => {
    const preresult: PointResult = { point: new THREE.Vector3(), info: { orientation: new THREE.Quaternion(), snap: new PointSnap() } };
    const cb = jest.fn();
    const promise = pointPicker.execute(cb, { result: preresult });
    expect(cb).toBeCalledWith(preresult);

    const move = new MouseEvent('pointermove', { clientX: 50, clientY: 50 });
    domElement.dispatchEvent(move);
    domElement.dispatchEvent(new MouseEvent('pointerdown'));
    domElement.dispatchEvent(new MouseEvent('pointerup'));

    promise.finish();
});

test('defaults', async () => {
    const position = new THREE.Vector3(1, 2, 3);
    const orientation = new THREE.Quaternion();
    const promise = pointPicker.execute({ default: { position, orientation } });
    editor.onViewportActivated(viewport);
    domElement.dispatchEvent(new CustomEvent('point-picker:finish', { bubbles: true }));
    const { point } = await promise;
    expect(point).toApproximatelyEqual(position);
})
test('holding Ctrl turns snapping off until released', async () => {
    editor.snaps.snapToGrid = true;
    editor.snaps.gridStep = 1e6;
    const cb = jest.fn();
    const promise = pointPicker.execute(cb);
    domElement.dispatchEvent(new MouseEvent('pointermove', { clientX: 80, clientY: 20 }));
    expect(cb.mock.calls[0][0].point).toApproximatelyEqual(new THREE.Vector3());

    // The point moves off the grid as soon as Ctrl goes down, without waiting for the mouse
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0].point.length()).toBeGreaterThan(0.1);

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
    expect(cb).toHaveBeenCalledTimes(3);
    expect(cb.mock.calls[2][0].point).toApproximatelyEqual(new THREE.Vector3());

    domElement.dispatchEvent(new MouseEvent('pointerdown', { clientX: 80, clientY: 20 }));
    domElement.dispatchEvent(new MouseEvent('pointerup', { clientX: 80, clientY: 20 }));
    await promise;
});

test('over a gizmo nothing snaps, and a click there does nothing', async () => {
    // A gizmo under the cursor takes the move (prevents its default) and the press (stops it), before the point picker
    const takeMove = (e: Event) => e.preventDefault();
    const takePress = (e: Event) => e.stopImmediatePropagation();
    domElement.addEventListener('pointermove', takeMove, { capture: true });
    domElement.addEventListener('pointerdown', takePress, { capture: true });

    const cb = jest.fn();
    let picked = false;
    const promise = pointPicker.execute(cb);
    promise.then(() => picked = true, () => { });
    domElement.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50, cancelable: true }));
    expect(cb).toHaveBeenCalledTimes(0);
    domElement.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 50 }));
    domElement.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, clientY: 50 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(picked).toBe(false);

    domElement.removeEventListener('pointermove', takeMove, { capture: true });
    domElement.removeEventListener('pointerdown', takePress, { capture: true });
    domElement.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }));
    expect(cb).toHaveBeenCalledTimes(1);
    domElement.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 50 }));
    domElement.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, clientY: 50 }));
    const { point } = await promise;
    expect(point).toApproximatelyEqual(new THREE.Vector3());
});
