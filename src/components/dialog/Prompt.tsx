import { CompositeDisposable, Disposable } from 'event-kit';
import { Editor } from '../../editor/Editor';
import type { Scene } from '../../editor/Scene';
import type * as visual from '../../visual_model/VisualModel';
import { CancellablePromise } from '../../util/CancellablePromise';
import { render } from 'preact';

export type State = { tag: 'none' } | { tag: 'executing' } | { tag: 'finished' }

export class Prompt extends HTMLElement {
    private state: State = { tag: 'none' };

    private _name!: string;
    get name() { return this._name }
    set name(name: string) {
        this.setAttribute('name', name); // used by AbstractDialog to find the prompt
        this._name = name;
    }

    private _description!: string;
    get description() { return this._description }
    set description(description: string) { this._description = description }

    private _onclear?: () => void;
    get onclear() { return this._onclear }
    set onclear(onclear: (() => void) | undefined) { this._onclear = onclear }

    // What the prompt holds, like the target bodies: shown with a check in place of the description, and once a prompt
    // holds values, an empty one shows as not done
    private _value?: string;
    private holdsValue = false;
    get value() { return this._value }
    set value(value: string | undefined) {
        this._value = value;
        this.holdsValue = true;
        if (this.state.tag !== 'executing') this.state = this.doneState;
        this.render();
    }
    private get doneState(): State { return this.holdsValue && this._value === undefined ? { tag: 'none' } : { tag: 'finished' } }

    connectedCallback() { this.render() }
    disconnectedCallback() { }

    render() {
        const { name, description, value, state: { tag }, onclear } = this;
        let icon;
        switch (tag) {
            case 'executing': icon = <div class="w-4 h-4 rounded-full bg-ui-muted"> <div class="w-full h-full rounded-full animate-ping bg-ui-muted"> </div></div>; break;
            case 'finished': icon = <solidify-icon name="check" class="rounded-full bg-ui-success"></solidify-icon>; break;
            default: icon = <div class="w-4 h-4 bg-transparent rounded-full"> </div>; break;;
        }
        const clear = onclear !== undefined
            ? <button class="rounded-full group text-ui-text group-hover:text-ui-title hover:bg-ui-hover" onClick={e => { e.stopPropagation(); onclear() }}>
                <solidify-icon name="cancel"></solidify-icon>
            </button>
            : <></>;

        render(<li class={`flex items-center py-1 pl-1 pr-2 justify-between text-xs rounded-full ${tag === 'executing' ? 'bg-ui-raised' : 'cursor-pointer'}`}>
            <div class="flex items-center space-x-2">
                {icon}
                <div class="font-bold text-ui-text">{name}</div>
                {value !== undefined
                    ? <div class="text-ui-text">{value}</div>
                    : <div class="text-ui-faint">{description}</div>}
            </div>
            {clear}
        </li>, this);
    }

    execute() {
        const cancellable = new CancellablePromise<void>((resolve, reject) => {
            const disposables = new CompositeDisposable();
            disposables.add(new Disposable(() => {
                this.state = this.doneState;
                this.render();
            }));

            return { dispose: () => disposables.dispose(), finish: resolve };
        });
        this.state = { tag: 'executing' };
        this.render();
        return cancellable;
    }
}

// Target bodies as a prompt shows them: one by its name, more by how many
export function targetsLabel(scene: Scene, targets: readonly visual.Solid[]): string | undefined {
    if (targets.length === 0) return undefined;
    if (targets.length === 1) return scene.nameOf(targets[0]);
    return `${targets.length} bodies`;
}

export default (editor: Editor) => {
    customElements.define('solidify-prompt', Prompt);
}