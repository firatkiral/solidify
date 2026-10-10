import Command from '../../command/Command';
import * as like from '../../commands/CommandLike';
import * as cmd from '../../commands/GeometryCommands';
import { DatabaseLike } from "../../editor/DatabaseLike";
import { HasSelection } from '../../selection/SelectionDatabase';
import { GConstructor } from '../../util/Util';
import { tooltips } from '../toolbar/icons';

export type CommandClass = typeof Command & GConstructor<Command>;

interface CommandList {
    sections: CommandClass[][];
    trash?: CommandClass;
}

// What the selection can do, in sections
export class Model {
    constructor(
        private readonly selection: HasSelection,
        private readonly db: DatabaseLike
    ) { }

    get commands(): CommandList {
        const { selection } = this;

        const translations: Set<CommandClass> = new Set();
        const misc: Set<CommandClass> = new Set();
        const bool: Set<CommandClass> = new Set();
        const copy: Set<CommandClass> = new Set();
        const swept: Set<CommandClass> = new Set();
        let trash: CommandClass | undefined = undefined;

        if (selection.curves.size > 0 || selection.solids.size > 0 || selection.faces.size > 0 || selection.controlPoints.size > 0) {
            translations.add(cmd.MoveCommand);
        }
        if (selection.curves.size > 0 || selection.solids.size > 0 || selection.faces.size > 0 || selection.controlPoints.size > 0) {
            trash = cmd.DeleteCommand;
            translations.add(cmd.RotateCommand);
        }
        if (selection.curves.size > 0 || selection.solids.size > 0 || selection.controlPoints.size > 0) {
            translations.add(cmd.ScaleCommand);
        }
        if (selection.curves.size > 0 || selection.solids.size > 0 || selection.faces.size > 0) {
            misc.add(cmd.ShellCommand);
        }
        if (selection.curves.size > 0 || selection.solids.size > 0) {
            misc.add(cmd.MirrorCommand);
            copy.add(cmd.PlaceCommand);
        }
        if (selection.curves.size > 0) {
            swept.add(cmd.PipeCommand);
            bool.add(cmd.CutCommand);
        }
        if (selection.regions.size > 0) {
            swept.add(cmd.ExtrudeCommand);
            swept.add(cmd.RevolutionCommand);
            swept.add(cmd.EvolutionCommand);
        }
        if (selection.solids.size > 0 || selection.curves.size > 0) {
            copy.add(cmd.RadialArrayCommand);
            copy.add(cmd.RectangularArrayCommand);
        }
        if (selection.solids.size > 1) {
            bool.add(cmd.BooleanCommand);
        }
        if (selection.faces.size > 0) {
            misc.add(cmd.OffsetCurveCommand);
            swept.add(cmd.ExtrudeCommand);
            swept.add(cmd.EvolutionCommand);
        }
        if (selection.faces.size > 0 || selection.solids.size > 0) {
            bool.add(cmd.CutCommand);
        }
        if (selection.curves.size > 0) {
            swept.add(cmd.ExtrudeCommand);
            swept.add(cmd.RevolutionCommand);
            misc.add(cmd.OffsetCurveCommand);
        }
        if (selection.curves.size > 1) {
            swept.add(cmd.LoftCommand);
            misc.add(cmd.JoinCurvesCommand);
        }
        if (selection.edges.size > 0) {
            misc.add(cmd.FilletSolidCommand);
            misc.add(cmd.OffsetCurveCommand);
        }
        if (selection.edges.size > 0 || selection.curves.size > 0 || selection.solids.size > 0) {
            copy.add(cmd.DuplicateCommand);
        }
        if (selection.faces.size > 0) {
            misc.add(cmd.OffsetFaceCommand);
        }
        return { sections: [[...translations], [...swept], [...misc], [...bool], [...copy]], trash };
    }
}

export function available({ sections, trash }: CommandList): CommandClass[] {
    return trash === undefined ? sections.flat() : [...sections.flat(), trash];
}

// The few the bar shows for each kind of selection, most useful first; the first kind selected decides, and what else the
// selection can do fills any room left
type Kind = 'regions' | 'faces' | 'edges' | 'curves' | 'solids';
const favourites: [Kind, CommandClass[]][] = [
    ['regions', [cmd.ExtrudeCommand, cmd.RevolutionCommand, cmd.EvolutionCommand]],
    ['faces', [cmd.ExtrudeCommand, cmd.OffsetFaceCommand, cmd.MoveCommand, cmd.RotateCommand]],
    ['edges', [cmd.FilletSolidCommand, cmd.OffsetCurveCommand, cmd.DuplicateCommand]],
    ['curves', [cmd.ExtrudeCommand, cmd.RevolutionCommand, cmd.OffsetCurveCommand, cmd.LoftCommand]],
    ['solids', [cmd.MoveCommand, cmd.RotateCommand, cmd.MirrorCommand, cmd.BooleanCommand]],
];
export const barLength = 4;

export function barCommands(list: CommandList, selection: HasSelection): CommandClass[] {
    const all = available(list);
    const kind = favourites.find(([kind]) => selection[kind].size > 0);
    const result = (kind?.[1] ?? []).filter(command => all.includes(command));
    for (const command of all) {
        if (result.length >= barLength) break;
        if (!result.includes(command)) result.push(command);
    }
    return result;
}

// What each command that works on the selection needs selected, for the menu to say when it can't run
export const needs = new Map<CommandClass, string>([
    [cmd.MoveCommand, "Select a solid, face, curve or point"],
    [cmd.RotateCommand, "Select a solid, face, curve or point"],
    [cmd.DeleteCommand, "Select a solid, face, curve or point"],
    [cmd.ScaleCommand, "Select a solid, curve or point"],
    [cmd.ShellCommand, "Select a solid, face or curve"],
    [cmd.CutCommand, "Select a solid, face or curve"],
    [cmd.MirrorCommand, "Select a solid or curve"],
    [cmd.PlaceCommand, "Select a solid or curve"],
    [cmd.RadialArrayCommand, "Select a solid or curve"],
    [cmd.RectangularArrayCommand, "Select a solid or curve"],
    [cmd.DuplicateCommand, "Select a solid, curve or edge"],
    [cmd.PipeCommand, "Select a curve"],
    [cmd.ExtrudeCommand, "Select a region, face or curve"],
    [cmd.RevolutionCommand, "Select a region or curve"],
    [cmd.EvolutionCommand, "Select a region or face"],
    [cmd.OffsetCurveCommand, "Select a face, curve or edge"],
    [cmd.OffsetFaceCommand, "Select a face"],
    [cmd.FilletSolidCommand, "Select edges"],
    [cmd.BooleanCommand, "Select two solids"],
    [cmd.LoftCommand, "Select two curves"],
    [cmd.JoinCurvesCommand, "Select two curves"],
]);

// Run for the selection they're given by the app itself, not from a menu
const internal: CommandClass[] = [cmd.ActionFaceCommand, cmd.ModifyContourCommand, cmd.DraftSolidCommand];
const runnable = new Set<unknown>([...Object.values(cmd), ...Object.values(like)]);

export interface Found {
    command: CommandClass;
    label: string;
    need?: string; // why it can't run on this selection
}

// Every command whose name has the query in it: those that can run first, those that start with it before the rest
export function search(query: string, possible: readonly CommandClass[]): Found[] {
    const q = query.trim().toLowerCase();
    if (q === '') return [];
    const found: (Found & { rank: number })[] = [];
    for (const [command, label] of tooltips) {
        const klass = command as CommandClass;
        if (!runnable.has(klass) || internal.includes(klass)) continue;
        const at = label.toLowerCase().indexOf(q);
        if (at === -1) continue;
        const need = needs.has(klass) && !possible.includes(klass) ? needs.get(klass) : undefined;
        found.push({ command: klass, label, need, rank: (need === undefined ? 0 : 2) + (at === 0 ? 0 : 1) });
    }
    return found.sort((a, b) => a.rank - b.rank).map(({ command, label, need }) => ({ command, label, need }));
}

export interface Rect { left: number, top: number, right: number, bottom: number }
export interface Size { width: number, height: number }
export interface Position { left: number, top: number }

// Beside what it's for: below and right of it, else whichever other corner fits, else squeezed in
export function placeBeside(anchor: Rect, size: Size, area: Rect, gap: number): Position {
    const { width, height } = size;
    const right = anchor.right + gap, left = anchor.left - gap - width;
    const below = anchor.bottom + gap, above = anchor.top - gap - height;
    for (const [l, t] of [[right, below], [right, above], [left, below], [left, above]]) {
        if (l >= area.left && l + width <= area.right && t >= area.top && t + height <= area.bottom) return { left: l, top: t };
    }
    return clampInto({ left: right, top: below }, size, area);
}

export function clampInto(position: Position, size: Size, area: Rect): Position {
    return {
        left: Math.max(area.left, Math.min(position.left, area.right - size.width)),
        top: Math.max(area.top, Math.min(position.top, area.bottom - size.height)),
    };
}

// Full near the cursor, fading as it moves away, but never quite gone
const near = 48, far = 320;
export const faint = 0.3;
export function fade(distance: number): number {
    if (distance <= near) return 1;
    if (distance >= far) return faint;
    return 1 - (1 - faint) * (distance - near) / (far - near);
}

export function distanceTo(x: number, y: number, rect: Rect): number {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return Math.hypot(dx, dy);
}

// How a command relates to the bar: one that only changes the selection; one the selection started by itself, which
// waits for its gizmo (offset face, fillet, extrude, modify curve); or one the user started
export type CommandKind = 'selecting' | 'waiting' | 'own';

const waiting: CommandClass[] = [cmd.ExtrudeCommand, cmd.ModifyFaceCommand, cmd.OffsetFaceCommand, cmd.RefilletFaceCommand, cmd.FilletSolidCommand, cmd.ModifyContourCommand];
export function kindOf(command: Command): CommandKind {
    if (!command.changesDocument) return 'selecting';
    if (command.agent !== 'user' && waiting.some(klass => command instanceof klass)) return 'waiting';
    return 'own';
}

// When the bar shows: while something's selected, unless a command of the user's is running (or about to, from the bar),
// its gizmo is in use, the view is moving, Shift or Ctrl is held to add to the selection, or the view moved since it was
// placed beside the selection (a bar moved out of the way stays where it is)
export class Visibility {
    private selected = false;
    private own?: Command;
    private launching = false;
    private gizmo?: Command;
    private navigating = false;
    private stale = false;
    private modifier = false;
    pinned = false;

    get shown() {
        return this.selected && this.own === undefined && !this.launching && this.gizmo === undefined
            && !this.navigating && !this.modifier && !(this.stale && !this.pinned);
    }

    selectionChanged(selected: boolean) {
        this.selected = selected;
        this.stale = false;
    }

    // The bar or its menu is starting a command; it's the user's whichever kind it is
    launch() { this.launching = true }

    commandStarted(command: Command, kind: CommandKind) {
        if (kind === 'selecting') return;
        if (this.launching || kind === 'own') {
            this.launching = false;
            this.own = command;
        }
    }

    gizmoUsed(command: Command) { this.gizmo = command }

    // Whether the bar should be placed again, beside where the selection is now
    commandEnded(command: Command): boolean {
        if (this.gizmo === command) this.gizmo = undefined;
        if (this.own !== command) return false;
        this.own = undefined;
        this.stale = false;
        return true;
    }

    navigationStarted() { this.navigating = true }
    // The controls also end a click that never moved the view
    navigationEnded() {
        if (!this.navigating) return;
        this.navigating = false;
        this.stale = true;
    }

    modifierChanged(held: boolean) { this.modifier = held }
}
