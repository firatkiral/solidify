import { ChangeEvent } from "src/components/creators/NumberScrubber";
import * as visual from '../../VisualModel';
import c3d from '../../kernel/kernel';

export declare global {
    export namespace preact.createElement.JSX {
        export interface IntrinsicElements {
            'solidify-tooltip': { 'command'?: string; 'placement'?: 'top' | 'bottom' | 'left' | 'right', 'children'?: JSX.Element | JSX.Element[] | string };
            'solidify-number-scrubber': { 'name': string, 'value': number, 'class'?: string, 'precision'?: number, 'onscrub': (e: ChangeEvent) => void, 'onchange': (e: ChangeEvent) => void, 'onfinish': (e: ChangeEvent) => void, min?: number, max?: number, disabled?: number, default?: number, enabled?: boolean, unit?: string }
            [tag: string]: any
        }
    }
}
