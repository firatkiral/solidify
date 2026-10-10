/**
 * @jest-environment jsdom
 */

import { SnapBypass } from "../../src/editor/snaps/SnapBypass";
import { SnapManager } from "../../src/editor/snaps/SnapManager";

let bypass: jest.Mock;
let snapBypass: SnapBypass;

beforeEach(() => {
    bypass = jest.fn();
    snapBypass = new SnapBypass({ bypass } as unknown as SnapManager);
});

afterEach(() => {
    snapBypass.dispose();
});

const held = () => bypass.mock.calls[bypass.mock.calls.length - 1][0];

test("holding Ctrl bypasses snapping until it is released", () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
    expect(held()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    expect(held()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
    expect(held()).toBe(false);
});

test("Ctrl counts while Shift is down too", () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    expect(held()).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, shiftKey: true }));
    expect(held()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', shiftKey: true }));
    expect(held()).toBe(false);
});

test("a missed release is put right by the next pointer event", () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
    document.dispatchEvent(new MouseEvent('pointermove'));
    expect(held()).toBe(false);
    document.dispatchEvent(new MouseEvent('pointerdown', { ctrlKey: true }));
    expect(held()).toBe(true);
});

test("losing focus releases it", () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
    window.dispatchEvent(new FocusEvent('blur'));
    expect(held()).toBe(false);
});

test("AltGr, which types with Ctrl+Alt on Windows, doesn't count", () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '@', ctrlKey: true, altKey: true, modifierAltGraph: true }));
    expect(held()).toBe(false);
});

test("nothing is heard once disposed", () => {
    snapBypass.dispose();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
    expect(bypass).not.toHaveBeenCalled();
});
