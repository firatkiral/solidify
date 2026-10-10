/**
 * @jest-environment jsdom
 */
import { ClickToFinish } from "../../src/command/ClickToFinish";

let finish: jest.Mock;
let canvas: HTMLCanvasElement;
let panel: HTMLElement;
let field: HTMLInputElement;

beforeEach(() => {
    document.body.innerHTML = '';
    document.body.removeAttribute('gizmo');
    canvas = document.createElement('canvas');
    panel = document.createElement('solidify-dialog');
    field = document.createElement('input');
    panel.appendChild(field);
    document.body.append(canvas, panel);
    finish = jest.fn();
});

function press(target: Element, init: MouseEventInit = {}) {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10, ...init }));
}
function release(target: Element, init: MouseEventInit = {}) {
    target.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 10, clientY: 10, ...init }));
}
function click(target: Element, init: MouseEventInit = {}) { press(target, init); release(target, init) }

describe(ClickToFinish, () => {
    test('a left click in the viewport finishes the command', () => {
        const disposable = new ClickToFinish(finish).execute();
        click(canvas);
        expect(finish).toHaveBeenCalledTimes(1);
        disposable.dispose();
    });

    test('so does a left click on other parts of the page', () => {
        const toolbar = document.createElement('button');
        document.body.append(toolbar);
        const disposable = new ClickToFinish(finish).execute();
        click(toolbar);
        expect(finish).toHaveBeenCalledTimes(1);
        disposable.dispose();
    });

    test('a click on the edit panel does not', () => {
        const disposable = new ClickToFinish(finish).execute();
        click(field);
        click(panel);
        expect(finish).not.toHaveBeenCalled();
        disposable.dispose();
    });

    test('a click something else took (a gizmo handle, a picker, the selection) does not', () => {
        canvas.addEventListener('pointerdown', e => e.stopPropagation());
        const disposable = new ClickToFinish(finish).execute();
        click(canvas);
        expect(finish).not.toHaveBeenCalled();
        disposable.dispose();
    });

    test('a click while a gizmo value is dragged or typed, or points are placed, does not', () => {
        document.body.setAttribute('gizmo', 'point-picker');
        const disposable = new ClickToFinish(finish).execute();
        click(canvas);
        expect(finish).not.toHaveBeenCalled();
        disposable.dispose();
    });

    test('nor the click that ends a gizmo drag, though the gizmo clears its attribute on the way', () => {
        document.body.setAttribute('gizmo', 'extrude');
        canvas.addEventListener('pointerdown', () => document.body.removeAttribute('gizmo'));
        const disposable = new ClickToFinish(finish).execute();
        click(canvas);
        expect(finish).not.toHaveBeenCalled();
        // The next click is a plain one
        click(canvas);
        expect(finish).toHaveBeenCalledTimes(1);
        disposable.dispose();
    });

    test('a drag does not', () => {
        const disposable = new ClickToFinish(finish).execute();
        press(canvas);
        release(canvas, { clientX: 20, clientY: 10 });
        expect(finish).not.toHaveBeenCalled();
        disposable.dispose();
    });

    test('a right or middle click does not (right-click finishes through the keymap)', () => {
        const disposable = new ClickToFinish(finish).execute();
        click(canvas, { button: 2 });
        click(canvas, { button: 1 });
        expect(finish).not.toHaveBeenCalled();
        disposable.dispose();
    });

    test('a release without a press it saw (the press that started the command) does not', () => {
        const disposable = new ClickToFinish(finish).execute();
        release(canvas);
        expect(finish).not.toHaveBeenCalled();
        disposable.dispose();
    });

    test('once disposed, clicks do nothing', () => {
        new ClickToFinish(finish).execute().dispose();
        click(canvas);
        expect(finish).not.toHaveBeenCalled();
    });
});
