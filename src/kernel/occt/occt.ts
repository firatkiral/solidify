import type { OpenCascadeInstance } from 'replicad-opencascadejs';

export type OC = OpenCascadeInstance;

// The OpenCascade WASM instance. Available once load() resolves; the app waits for it before starting.
export let oc: OC = undefined as unknown as OC;

// The threaded build meshes and models on every core, but its shared memory needs the page cross-origin isolated.
// Without that (an older browser, a host without the headers) and in the tests, the single-threaded build.
export const threaded = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;

let loading: Promise<void> | undefined;

// Loads the kernel, once. The app passes Emscripten an instantiateWasm of its own, to show the download's progress;
// the tests let it find its .wasm itself.
export function load(options?: Record<string, unknown>): Promise<void> {
    return loading ??= (threaded ? import('replicad-opencascadejs/multi') : import('replicad-opencascadejs'))
        .then(({ default: init }) => init(options))
        .then(instance => { oc = instance });
}
