import { CompositeDisposable, Disposable } from 'event-kit';
import { render } from 'preact';
import { Editor } from '../../editor/Editor';
import * as THREE from "three";
import { lengthUnit, lengthUnits, parseLength } from '../../util/Units';

// Time thresholds are in milliseconds, distance thresholds are in pixels.
const consummationTimeThreshold = 200; // once the mouse is down at least this long the drag is consummated
const consummationDistanceThreshold = 4; // once the mouse moves at least this distance the drag is consummated

export class ChangeEvent extends Event {
    constructor(type: string, readonly value: number) {
        super(type);
    }
}

export default (editor: Editor) => {
    type ScrubberState = { tag: 'none' } | { tag: 'cancel' } | { tag: 'down', downEvent: PointerEvent, startValue: number, disposable: CompositeDisposable } | { tag: 'dragging', downEvent: PointerEvent, startEvent: PointerEvent, currentEvent: PointerEvent, startValue: number, currentValue: number, disposable: CompositeDisposable }

    class Scrubber extends HTMLElement {
        private state: ScrubberState = { tag: 'none' };
        static get observedAttributes() { return ['value']; }

        private _precision = 3;
        get precision() { return this._precision }
        set precision(precision: number) { this._precision = Math.abs(precision) }

        private _min = Number.NEGATIVE_INFINITY;
        get min() { return this._min }
        set min(min: number) { this._min = min }

        private _max = Number.POSITIVE_INFINITY;
        get max() { return this._max }
        set max(max: number) { this._max = max }

        private _enabled = true;
        set enabled(enabled: boolean) { this._enabled = enabled }

        constructor() {
            super();
            this.render = this.render.bind(this);
            this.onPointerDown = this.onPointerDown.bind(this);
            this.onPointerMove = this.onPointerMove.bind(this);
            this.onPointerUp = this.onPointerUp.bind(this);
            this.onFocus = this.onFocus.bind(this);
            this.onPointerLockChange = this.onPointerLockChange.bind(this);
            this.change = this.change.bind(this);
            this.toggle = this.toggle.bind(this);
        }

        connectedCallback() {
            editor.signals.settingsChanged.add(this.render);
            this.render();
        }

        disconnectedCallback() {
            editor.signals.settingsChanged.remove(this.render);
        }

        // With unit="length", the value (and min, max, default and disabled) is in millimeters, while the field shows,
        // drags and takes typing in the length unit. Typing may name a unit of its own, e.g. 2 in.
        private get isLength() { return this.getAttribute('unit') === 'length' }
        private get millimetersPerShown() { return this.isLength ? lengthUnits[lengthUnit()].millimeters : 1 }
        // Decimals shown: precision - 1, and for a length, a few more in units larger than millimeters
        private get digits() { return this.precision - 1 + (this.isLength ? lengthUnits[lengthUnit()].digits - lengthUnits.mm.digits : 0) }
        private get shownValue() { return +this.getAttribute('value')! / this.millimetersPerShown }

        toggle(e: Event) {
            e.stopPropagation();
            e.preventDefault();
            let newValue;
            if (this.isDisabled) {
                const value = this.getAttribute('previous') ?? this.getAttribute('default')!;
                this.setAttribute('value', value);
                newValue = value;
            } else {
                const disabled = this.getAttribute('disabled')!;
                this.setAttribute('previous', this.getAttribute('value')!);
                newValue = disabled;
                this.setAttribute('value', newValue);
            }
            const event = new ChangeEvent('change', Number(newValue));
            this.dispatchEvent(event);
            this.render();
        }

        // value is as shown
        scrub(value: number) {
            const truncated = this.trunc(value);
            this.setAttribute("value", String(truncated));
            this.render();
            const event = new ChangeEvent('scrub', truncated);
            this.dispatchEvent(event);
        }

        // From a shown value to the value, cut to the decimals shown and kept within min and max
        private trunc(value: number) {
            const { min, max, digits, millimetersPerShown } = this;
            const exp = Math.pow(10, digits);
            value = Math.trunc(exp * value) / exp * millimetersPerShown;
            value = Math.max(min, Math.min(max, value));
            return value;
        }

        change(e: Event) {
            if (!(e.target instanceof HTMLInputElement)) throw new Error("invalid precondtion");
            e.stopPropagation();

            const value = e.target.value;

            let num = this.isLength ? parseLength(value) : Number(value);
            if (num !== undefined && Number.isFinite(num)) {
                num = Math.max(this.min, Math.min(this.max, num));
                this.setAttribute('value', String(num));
                const event = new ChangeEvent('change', num);
                this.dispatchEvent(event);
            }
            e.target.blur();
            this.state = { tag: 'none' };
            this.render()
        }

        finish(e: PointerEvent) {
            const event = new Event('finish');
            this.dispatchEvent(event);
        }

        cancel() {
            this.state = { tag: 'cancel' }
            this.render();
            const event = new Event('cancel');
            this.dispatchEvent(event);
        }

        onPointerMove(e: PointerEvent) {
            switch (this.state.tag) {
                case 'down': {
                    const { downEvent, disposable, startValue } = this.state;
                    if (e.pointerId !== downEvent.pointerId) return;
                    const currentPosition = new THREE.Vector2(e.clientX, e.clientY);
                    const startPosition = new THREE.Vector2(downEvent.clientX, downEvent.clientY);
                    const dragStartTime = downEvent.timeStamp;
                    if (e.timeStamp - dragStartTime >= consummationTimeThreshold ||
                        currentPosition.distanceTo(startPosition) >= consummationDistanceThreshold
                    ) {
                        this.state = { tag: 'dragging', downEvent, disposable, startValue, startEvent: e, currentEvent: e, currentValue: startValue }
                        document.addEventListener('pointerlockchange', this.onPointerLockChange)
                        disposable.add(new Disposable(() => document.removeEventListener('pointerlockchange', this.onPointerLockChange)));
                        this.requestPointerLock();
                    }
                    break;
                }
                case 'dragging':
                    const precision = this.digits + 1;
                    const { downEvent } = this.state;
                    if (e.pointerId !== downEvent.pointerId) return;

                    // NOTE: in windows only, the first event sometimes has a large jump (>100px)
                    // this is a temporary(?) workaround.
                    const delta = this.state.startEvent === this.state.currentEvent
                        ? 0
                        : e.movementX / 3;

                    // Speed up (10x) when Shift is held. Slow down (0.1x) when alt is held.
                    const precisionSpeedMod = e.shiftKey ? -1 : e.altKey ? 1 : 0;
                    const precisionAndSpeed = precision + precisionSpeedMod;

                    this.state.currentValue += delta * Math.pow(10, -precisionAndSpeed);
                    const value = this.state.currentValue;
                    try { this.scrub(value) }
                    catch (e) { console.error(e) }
                    finally { this.state.currentEvent = e }
                    break;
                default: throw new Error('invalid state: ' + this.state.tag);
            }
        }

        onPointerDown(e: PointerEvent) {
            switch (this.state.tag) {
                case 'none':
                    if (e.button != 0) return;

                    e.stopPropagation();
                    // preventDefault here prevents scrubber from focusing on start of drag
                    // (will focus later with the onCancel: onClick)
                    e.preventDefault();

                    const startValue = this.shownValue;

                    const disposables = new CompositeDisposable();

                    document.addEventListener('pointermove', this.onPointerMove);
                    document.addEventListener('pointerup', this.onPointerUp);
                    disposables.add(new Disposable(() => document.removeEventListener('pointermove', this.onPointerMove)));
                    disposables.add(new Disposable(() => document.removeEventListener('pointerup', this.onPointerUp)));

                    this.state = { tag: 'down', downEvent: e, disposable: disposables, startValue: startValue };
                    break;
                default: throw new Error('invalid state: ' + this.state.tag);
            }
        }

        onFocus(e: FocusEvent) {
            if (this.isDisabled) return;
            this.state = { tag: 'cancel' };
            this.render();
        }

        onPointerUp(e: PointerEvent) {
            switch (this.state.tag) {
                case 'down': {
                    const { downEvent, disposable } = this.state;
                    if (e.pointerId !== downEvent.pointerId) return;
                    disposable.dispose();
                    this.state = { tag: 'none' };
                    this.cancel();
                    break;
                }
                case 'dragging':
                    const { downEvent, disposable } = this.state;
                    if (e.pointerId !== downEvent.pointerId) return;

                    try { this.finish(e) }
                    catch (e) { console.error(e) }
                    finally {
                        document.exitPointerLock();
                        disposable.dispose();
                        this.state = { tag: 'none' };
                    }
                    break;
                default: throw new Error('invalid state: ' + this.state.tag);
            }
        }

        onPointerLockChange() {
            switch (this.state.tag) {
                case 'dragging':
                    if (document.pointerLockElement === this) {
                        document.addEventListener('pointermove', this.onPointerMove);
                        document.addEventListener('pointerup', this.onPointerUp);
                        this.state.disposable.add(new Disposable(() => {
                            document.removeEventListener('pointermove', this.onPointerMove);
                            document.removeEventListener('pointerup', this.onPointerUp);
                        }));
                    }
                    break;
                default: throw new Error('invalid state: ' + this.state.tag);
            }
        }

        render() {
            // The unit attribute ("length" for the length unit, or e.g. "°") is shown after the value; typing edits the bare number
            const attribute = this.getAttribute('unit');
            const unit = attribute === 'length' ? lengthUnit() : attribute;
            const suffix = unit === null || this.isDisabled ? '' : unit === '°' ? unit : `\u00a0${unit}`;
            const shown = this.shownValue;
            const { digits } = this;
            const displayValue = shown.toFixed(digits);
            const hidesDigits = digits > 0 && Math.abs(shown - +displayValue) > 1e-9 * Math.max(1, Math.abs(shown));
            const full = this.isDisabled ? '' : `${displayValue}${hidesDigits ? '...' : ''}`;

            const stringDisabled = this.getAttribute('disabled');
            const disabled = stringDisabled !== null ? +stringDisabled : undefined;

            const that = this;
            const onBlur = () => { that.state = { tag: 'none' }; that.render() };
            let input;

            const classes = `py-1 px-2 w-full h-6 text-xs leading-tight text-center align-middle rounded bg-ui-raised text-ui-text ${this.isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-ui-hover'}`;
            switch (this.state.tag) {
                case 'none':
                case 'dragging':
                    input = <div class={classes} onPointerDown={this.onPointerDown} disabled={this.isDisabled} tabIndex={0} onFocus={this.onFocus}>
                        <span class="prefix"></span>
                        <span class="value">{full}</span>
                        <span class="suffix">{suffix}</span>
                    </div>
                    break;
                case 'cancel':
                    input = <input type="text" value={displayValue} ref={i => { i?.focus(); i?.select() }} onBlur={onBlur} onChange={this.change} onPointerDown={collapseSelection} disabled={this.isDisabled} onKeyDown={e => e.stopPropagation()} class={classes} />
                    break;
                default: throw new Error('invalid state: ' + this.state.tag);
            }

            let checkbox = <></>;
            if (disabled !== undefined) checkbox = <input type="checkbox" checked={!this.isDisabled} onChange={this.toggle} onMouseDown={e => e.preventDefault()}></input>;

            render(<> {checkbox} {input} </>, this);
        }

        attributeChangedCallback(name: string, oldValue: any, newValue: any) {
            switch (this.state.tag) {
                case 'none': this.render();
            }
        }

        get isDisabled() {
            const stringDisabled = this.getAttribute('disabled');
            const stringValue = this.getAttribute('value')!;
            return !this._enabled || stringValue === stringDisabled;
        }
    }
    customElements.define('solidify-number-scrubber', Scrubber);
}

// Pressing on selected text would start dragging it; collapsing the selection first makes the press start a new one.
function collapseSelection(e: PointerEvent) {
    if (e.button !== 0) return;
    const input = e.currentTarget as HTMLInputElement;
    if (input.selectionStart === input.selectionEnd) return;
    input.setSelectionRange(input.selectionEnd, input.selectionEnd);
}