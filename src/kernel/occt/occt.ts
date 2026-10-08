import init, { OpenCascadeInstance } from 'replicad-opencascadejs';

export type OC = OpenCascadeInstance;

// The OpenCascade WASM instance. Available once load() resolves; the app waits for it before starting.
export let oc: OC = undefined as unknown as OC;

let loading: Promise<void> | undefined;

// Loads the kernel, once. The app passes Emscripten an instantiateWasm of its own, to show the download's progress;
// the tests let it find its .wasm itself.
export function load(options?: Record<string, unknown>): Promise<void> {
    return loading ??= init(options).then(instance => { oc = instance });
}
