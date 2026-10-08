// The service worker (made by vite-plugin-pwa, see vite.config.mts) keeps the app in the browser, the kernel included,
// so it starts offline and without downloading it again. A new deploy is downloaded in the background while the app
// runs; the app is told once it's ready, and switches to it when the user reloads.

const checkEvery = 30 * 60 * 1000;
// How long to wait for the new version to take over before reloading anyway
const takeOverTimeout = 5000;

let registration: ServiceWorkerRegistration | undefined;
let switching = false;

// Calls updated() when a new version is ready, or has taken over from another window
export async function registerServiceWorker(updated: () => void) {
    // The dev server serves the code as it's edited
    if (process.env.BUILD_ID === 'dev' || !('serviceWorker' in navigator)) return;
    const { serviceWorker } = navigator;
    try {
        registration = await serviceWorker.register(new URL('sw.js', document.baseURI).href);
    } catch (e) {
        console.warn("The app couldn't be kept for using offline", e);
        return;
    }
    const current = registration;

    // A worker that installs while another runs the app is a new version, waiting to take over; with none running,
    // it's the first, and takes over by itself
    const watch = (worker: ServiceWorker | null) => {
        if (worker === null) return;
        const installed = () => {
            if (worker.state === 'installed' && serviceWorker.controller !== null) updated();
        };
        if (worker.state === 'installed') installed();
        else worker.addEventListener('statechange', installed);
    };
    watch(current.waiting);
    current.addEventListener('updatefound', () => watch(current.installing));

    // Another window switched to the new version, so this one is out of date
    serviceWorker.addEventListener('controllerchange', () => {
        if (!switching) updated();
    });

    const check = () => current.update().catch(() => {
        // Offline, most likely; it's asked again later
    });
    setInterval(check, checkEvery);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
    });
}

// Hands the app over to the new version, if one is waiting; once this resolves, a reload starts it
export function switchToUpdate(): Promise<void> {
    const waiting = registration?.waiting;
    if (waiting == null) return Promise.resolve();
    switching = true;
    return new Promise(resolve => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
        setTimeout(resolve, takeOverTimeout);
        waiting.postMessage({ type: 'SKIP_WAITING' });
    });
}
