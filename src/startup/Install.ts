import { Disposable } from 'event-kit';

// The browser's offer to install Solidify as an app, which Chrome and Edge make once the page qualifies, and not once
// it's installed. It can come before the app has started, so it's listened for as soon as the page loads.

let offer: BeforeInstallPromptEvent | undefined;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());

export function listenForInstallOffer() {
    window.addEventListener('beforeinstallprompt', e => {
        // Offered on the start screen, in place of the browser's own banner
        e.preventDefault();
        offer = e;
        changed();
    });
    window.addEventListener('appinstalled', () => {
        offer = undefined;
        changed();
    });
}

export const canInstall = () => offer !== undefined;

export function onInstallOfferChanged(listener: () => void): Disposable {
    listeners.add(listener);
    return new Disposable(() => listeners.delete(listener));
}

// Asks the browser to install the app; an offer can be used once
export async function install() {
    const used = offer;
    if (used === undefined) return;
    offer = undefined;
    changed();
    await used.prompt();
}
