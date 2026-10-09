import { render } from 'preact';
import { Editor } from '../../editor/Editor';
import { humanizeKeystrokes } from '../atom/tooltip-manager';
import { keybindings } from '../toolbar/icons';

export default (editor: Editor) => {
    class Keybindings extends HTMLElement {
        private commands = new Set<string>();

        connectedCallback() {
            editor.signals.keybindingsRegistered.add(this.add);
            editor.signals.keybindingsCleared.add(this.delete);
        }

        disconnectedCallback() {
            editor.signals.keybindingsRegistered.remove(this.add);
            editor.signals.keybindingsCleared.remove(this.delete);
        }

        render() {
            const { commands } = this;
            const keymaps = editor.keymaps;
            const sections = new Map<string, string[]>();
            for (const command of commands) {
                const [, prefix, name] = command.match(/([\w-:]+):([\w-]+)$/)!;
                if (!sections.has(prefix)) sections.set(prefix, []);
                const section = sections.get(prefix)!;
                section.push(name);
            }
            const result = [...sections].map(([prefix, values]) =>
                <dl class="grid grid-cols-2 auto-rows-[1.25rem] w-52 text-xs bg-transparent text-ui-text min-h-24 min-w-[6rem]">
                    {[...values].map(postfix => {
                        const command = `${prefix}:${postfix}`;
                        const bindings = keymaps.findKeyBindings({ command });
                        if (bindings.length == 0) {
                            console.warn("Command missing from keymap (default-keymap.ts):", command);
                            return;
                        }
                        const keystroke = humanizeKeystrokes(bindings[0].keystrokes);
                        const desc = keybindings.get(command);
                        if (desc === undefined) console.error("Description missing from (icons.ts)", command);

                        return <>
                            <dt class="px-1">
                                <label class="float-right px-1 mr-1.5 text-center rounded ring-1 text-[11px] font-medium leading-4 min-w-[1.5rem] bg-ui-surface ring-ui-border text-ui-text">{keystroke}</label>
                            </dt>
                            <dd>{desc}</dd>
                        </>
                    })}
                </dl>
            );
            // Above the command's options; the sections wrap where there isn't room for them side by side
            render(<div class="flex flex-wrap gap-y-2 gap-x-8">
                {result}
            </div>, this);
        }

        add = (commands: string[]) => {
            for (const command of commands) this.commands.add(command);
            this.render();
        }

        delete = (commands: string[]) => {
            for (const command of commands) this.commands.delete(command);
            this.render();
        }
    }
    customElements.define('solidify-keybindings', Keybindings);
};