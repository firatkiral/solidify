//@ts-ignore
global.console = {
    log: console.log,
    error: console.error,
    warn: jest.fn(),
    info: jest.fn(),
    debug: console.debug,
    group: jest.fn(),
    groupCollapsed: jest.fn(),
    groupEnd: jest.fn(),
    table: jest.fn(),
    assert: (cond, ...args) => expect(cond).toBeTruthy(),
    trace: console.trace,
    time: jest.fn(),
    timeEnd: jest.fn(),
};

import '../lib/c3d/enums'
import { load } from '../src/kernel/occt/occt';

// The OpenCascade kernel loads asynchronously
beforeAll(() => load());

jest.mock('three/examples/jsm/loaders/EXRLoader.js');

global.performance = {
    now: () => 0,
    mark: jest.fn(),
    measure: jest.fn(),
}

// jsdom has no TextEncoder or TextDecoder. Node's encodes into its own realm's Uint8Array, which isn't an
// instanceof the tests' one, so it's copied into one of these.
if (typeof TextEncoder === 'undefined') {
    const util = require('util');
    class TextEncoder extends util.TextEncoder {
        encode(input?: string) { return new Uint8Array(super.encode(input)) }
    }
    Object.assign(global, { TextEncoder, TextDecoder: util.TextDecoder });
}

if (typeof navigator !== 'undefined') navigator.keyboard = {
getLayoutMap() {
        return Promise.resolve({
            get() { }
        });
    }
}

// jsdom has no 2D canvas without the native canvas package, so 2D drawing does nothing in tests
if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
        if (type !== '2d') return null;
        const state: Record<string, unknown> = { canvas: this };
        return new Proxy(state, {
            get: (target, prop: string) => prop in target ? target[prop] : prop === 'measureText' ? () => ({ width: 0 }) : () => undefined,
            set: (target, prop: string, value) => { target[prop] = value; return true },
        });
    } as any;
}
