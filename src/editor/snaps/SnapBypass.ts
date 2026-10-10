import { CompositeDisposable, Disposable } from "event-kit";
import { SnapManager } from "./SnapManager";

/**
 * Holding Ctrl turns every snap toggle off until it is released (see SnapManager.bypass). Ctrl is read off every key
 * and pointer event rather than bound in the keymap: a keystroke there names every modifier held, so Ctrl pressed or
 * released while Shift (the point picker's snap lock) is down wouldn't match, and a release missed here is put right by
 * the next event. Capturing on window comes before the Settings dialog, which stops keys there.
 */
export class SnapBypass {
    private readonly disposable = new CompositeDisposable();
    dispose() { this.disposable.dispose() }

    constructor(private readonly snaps: SnapManager) {
        for (const type of ['keydown', 'keyup', 'pointerdown', 'pointermove']) {
            window.addEventListener(type, this.onEvent, true);
            this.disposable.add(new Disposable(() => window.removeEventListener(type, this.onEvent, true)));
        }
        // A key released while another window has focus never reaches us
        window.addEventListener('blur', this.onBlur);
        this.disposable.add(new Disposable(() => window.removeEventListener('blur', this.onBlur)));
    }

    // AltGr types with Ctrl+Alt on Windows, so it doesn't count
    private onEvent = (e: Event) => {
        if (!(e instanceof KeyboardEvent || e instanceof MouseEvent)) return;
        this.snaps.bypass(e.ctrlKey && !e.getModifierState('AltGraph'));
    }

    private onBlur = () => this.snaps.bypass(false);
}
