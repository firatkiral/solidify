import { Disposable } from "event-kit";

// Once the pointer moves this far between press and release, it's a drag, not a click
const dragThreshold = 4;

// While a command runs, a plain left click anywhere but on its edit panel finishes it, as right-click, Enter and OK do.
// It listens on the window, after everything else, so a click that a gizmo handle, a picker or the selection took (they
// stop it there) never arrives. While a gizmo value is being dragged or typed, or points are being placed (the body's
// gizmo attribute, as it was when the button went down), the click is theirs too.
export class ClickToFinish {
    // Without a window (as in tests outside a browser) there are no clicks
    constructor(private readonly finish: () => void, private readonly target: Window | undefined = globalThis.window) { }

    execute(): Disposable {
        const { target } = this;
        if (target === undefined) return new Disposable();
        let gizmoActive = false;
        let down: MouseEvent | undefined;

        // First of all, before a gizmo's own handlers can end its drag and clear the attribute
        const onPointerDownCapture = (e: Event) => {
            down = undefined;
            gizmoActive = target.document.body.hasAttribute('gizmo');
        }
        // Last of all, only for a press that nothing took
        const onPointerDown = (e: Event) => {
            const event = e as MouseEvent;
            if (event.button !== 0 || gizmoActive) return;
            if (event.target instanceof Element && event.target.closest('solidify-dialog') !== null) return;
            down = event;
        }
        const onPointerUp = (e: Event) => {
            const start = down;
            down = undefined;
            const event = e as MouseEvent;
            if (start === undefined || event.button !== 0) return;
            if ((event as PointerEvent).pointerId !== (start as PointerEvent).pointerId) return;
            if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) >= dragThreshold) return;
            this.finish();
        }

        target.addEventListener('pointerdown', onPointerDownCapture, { capture: true });
        target.addEventListener('pointerdown', onPointerDown);
        target.addEventListener('pointerup', onPointerUp);
        return new Disposable(() => {
            target.removeEventListener('pointerdown', onPointerDownCapture, { capture: true });
            target.removeEventListener('pointerdown', onPointerDown);
            target.removeEventListener('pointerup', onPointerUp);
        });
    }
}
