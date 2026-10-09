import { render } from 'preact';
import { MessageBoxOptions } from './Platform';

const button = "px-3 py-1 rounded-md text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus";

// The app's own message box: the browser's confirm can't name its buttons, as in Save / Don't Save / Cancel.
// Enter chooses the focused button, which starts as the default one, or the default one from the text field;
// Escape chooses the cancel one.
export function showMessageBox(options: MessageBoxOptions): Promise<{ response: number, input?: string }> {
    const { type, message, detail, buttons = ['OK'] } = options;
    const defaultId = options.defaultId ?? 0;
    const cancelId = options.cancelId ?? buttons.length - 1;
    let input = options.input;

    return new Promise(resolve => {
        const host = document.createElement('div');
        document.body.appendChild(host);

        // While open, keystrokes don't reach the app's shortcuts
        const onKey = (e: KeyboardEvent) => {
            e.stopPropagation();
            if (e.type !== 'keydown' || e.isComposing) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                finish(cancelId);
            } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
                e.preventDefault();
                finish(defaultId);
            }
        };
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('keyup', onKey, true);

        const finish = (response: number) => {
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('keyup', onKey, true);
            render(null, host);
            host.remove();
            resolve(input === undefined ? { response } : { response, input });
        };

        render(
            <div class="fixed inset-0 z-50 flex items-center justify-center bg-ui-backdrop" role="alertdialog" aria-modal="true">
                <div class="w-[420px] max-w-[90vw] p-4 rounded-lg bg-ui-surface text-ui-text shadow-ui-shadow shadow-xl ring-1 ring-ui-border">
                    <div class={`text-sm font-semibold ${type === 'error' ? 'text-ui-danger-text' : 'text-ui-title'}`}>{message}</div>
                    {detail !== undefined && <div class="mt-1 text-xs text-ui-muted select-text break-words">{detail}</div>}
                    {input !== undefined &&
                        <input type="text" value={input} spellcheck={false} aria-label={message}
                            class="w-full mt-3 px-2 py-1 rounded-md text-sm text-ui-title bg-ui-bg ring-1 ring-ui-border focus:outline-none focus:ring-ui-focus"
                            onInput={e => input = e.currentTarget.value} />}
                    <div class="flex justify-end mt-4 space-x-2">
                        {buttons.map((label, i) =>
                            <button
                                class={`${button} ${i === defaultId ? 'text-ui-on-primary bg-ui-primary hover:bg-ui-primary-hover' : 'text-ui-title bg-ui-raised hover:bg-ui-hover'}`}
                                data-default={i === defaultId ? '' : undefined}
                                onClick={() => finish(i)}>
                                {label}
                            </button>)}
                    </div>
                </div>
            </div>, host);

        // Focused once it's in the page; refs come before that
        const field = host.querySelector('input');
        if (field !== null) {
            field.focus();
            field.select();
        } else host.querySelector<HTMLElement>('[data-default]')?.focus();
    });
}
