import singleKernelUrl from 'replicad-opencascadejs/wasm?url';
import threadedKernelUrl from 'replicad-opencascadejs/multi/wasm?url';
import { load, threaded } from './kernel/occt/occt';
import { listenForInstallOffer } from './startup/Install';

// The geometry kernel (OpenCascade, compiled to WebAssembly) is about 23 MB. It's compiled as it downloads, while the
// loading screen in index.html shows how far along it is; the app starts once it's ready.

const screen = document.getElementById('loading')!;
const status = screen.querySelector('.status')!;
const fill = screen.querySelector<HTMLElement>('.fill')!;

// The browser can offer to install the app while the kernel is still loading
listenForInstallOffer();

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function progress(loaded: number) {
    // Counted after decompression, so against the file's own size, whatever the server compressed it to
    const total = Number(threaded ? process.env.THREADED_KERNEL_SIZE : process.env.KERNEL_SIZE) || 0;
    if (total > 0) {
        screen.classList.remove('indeterminate');
        fill.style.width = `${Math.min(100, 100 * loaded / total)}%`;
        status.textContent = `Loading the geometry kernel… ${megabytes(loaded)} of ${megabytes(total)}`;
    } else {
        status.textContent = `Loading the geometry kernel… ${megabytes(loaded)}`;
    }
}

function fail(error: unknown) {
    console.error(error);
    screen.classList.add('failed');
    status.textContent = typeof WebAssembly === 'undefined'
        ? "Solidify needs WebAssembly, which this browser doesn't have. Try a recent Chrome, Edge, Firefox or Safari."
        : `Solidify couldn't start: ${error instanceof Error ? error.message : String(error)}. Reloading may help; if not, try a recent Chrome, Edge, Firefox or Safari.`;
}

async function start() {
    const instantiated = new Promise<void>((resolve, reject) => {
        const instantiateWasm = (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => {
            (async () => {
                const response = await fetch(threaded ? threadedKernelUrl : singleKernelUrl);
                if (!response.ok || response.body === null) throw new Error(`the geometry kernel didn't download (${response.status})`);
                let loaded = 0;
                const counted = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
                    transform(chunk, controller) {
                        loaded += chunk.byteLength;
                        progress(loaded);
                        controller.enqueue(chunk);
                    },
                }));
                const { instance, module } = await WebAssembly.instantiateStreaming(new Response(counted, { headers: { 'Content-Type': 'application/wasm' } }), imports);
                receive(instance, module);
                resolve();
            })().catch(reject);
            // Emscripten waits for receive()
            return {};
        };
        load({ instantiateWasm }).catch(reject);
    });
    await instantiated;
    await load();
    status.textContent = "Starting…";
    await import('./renderer-app');
    document.body.classList.add('started');
    screen.remove();
    // The app expects to start before the window finishes loading; if loading the kernel took longer, replay the event.
    if (document.readyState === 'complete') window.dispatchEvent(new Event('load'));
}

start().catch(fail);
