/**
 * @jest-environment jsdom
 */
import Command from '../../src/command/Command';
import * as cmd from '../../src/commands/GeometryCommands';
import { DeselectAllCommand } from '../../src/commands/CommandLike';
import { available, barCommands, CommandClass, fade, faint, kindOf, Model, needs, placeBeside, search, Visibility } from '../../src/components/minibar/MiniBarModel';
import { Editor } from '../../src/editor/Editor';
import { HasSelection } from '../../src/selection/SelectionDatabase';

type Kind = 'solids' | 'curves' | 'faces' | 'edges' | 'regions' | 'controlPoints';
const selection = (sizes: Partial<Record<Kind, number>>) => {
    const result: Record<string, { size: number }> = {};
    for (const kind of ['solids', 'curves', 'faces', 'edges', 'regions', 'controlPoints']) result[kind] = { size: sizes[kind as Kind] ?? 0 };
    return result as unknown as HasSelection;
}
const bar = (sizes: Partial<Record<Kind, number>>) => {
    const selected = selection(sizes);
    return barCommands(new Model(selected, {} as any).commands, selected);
}

describe(barCommands, () => {
    test('shows the few each kind of selection is most likely wanted for', () => {
        expect(bar({ faces: 1 })).toEqual([cmd.ExtrudeCommand, cmd.OffsetFaceCommand, cmd.MoveCommand, cmd.RotateCommand]);
        expect(bar({ edges: 1 })).toEqual([cmd.FilletSolidCommand, cmd.OffsetCurveCommand, cmd.DuplicateCommand]);
        expect(bar({ regions: 1 })).toEqual([cmd.ExtrudeCommand, cmd.RevolutionCommand, cmd.EvolutionCommand]);
        expect(bar({ solids: 2 })).toEqual([cmd.MoveCommand, cmd.RotateCommand, cmd.MirrorCommand, cmd.BooleanCommand]);
        expect(bar({ curves: 2 })).toEqual([cmd.ExtrudeCommand, cmd.RevolutionCommand, cmd.OffsetCurveCommand, cmd.LoftCommand]);
    })

    test('fills the room a favourite that can\'t run leaves with what the selection can do', () => {
        expect(bar({ solids: 1 })).toEqual([cmd.MoveCommand, cmd.RotateCommand, cmd.MirrorCommand, cmd.ScaleCommand]);
        expect(bar({ curves: 1 })).toEqual([cmd.ExtrudeCommand, cmd.RevolutionCommand, cmd.OffsetCurveCommand, cmd.MoveCommand]);
        expect(bar({ controlPoints: 1 })).toEqual([cmd.MoveCommand, cmd.RotateCommand, cmd.ScaleCommand, cmd.DeleteCommand]);
    })

    test('is empty with nothing selected', () => {
        expect(bar({})).toEqual([]);
    })
})

describe(search, () => {
    const everything = available(new Model(selection({ solids: 2, curves: 2, faces: 1, edges: 1, regions: 1, controlPoints: 1 }), {} as any).commands);

    test('says what every command that works on the selection needs', () => {
        for (const command of everything) expect(needs.has(command)).toBe(true);
    })

    test('finds commands by name, those that can\'t run on the selection last with what they need', () => {
        const solid = available(new Model(selection({ solids: 1 }), {} as any).commands);
        const found = search('bo', solid);
        expect(found.map(f => f.command)).toEqual([cmd.ThreePointBoxCommand, cmd.CornerBoxCommand, cmd.CenterBoxCommand, cmd.BooleanCommand]);
        expect(found[3].need).toBe('Select two solids');
        expect(found.slice(0, 3).every(f => f.need === undefined)).toBe(true);
    })

    test('puts names that start with the query first', () => {
        const found = search('curve', everything);
        expect(found[0].command).toBe(cmd.CurveCommand);
        expect(found.map(f => f.command)).toContain(cmd.CutCommand);
        expect(search('circle', []).map(f => f.label)).toEqual(['Center and radius circle', 'Two-point circle', 'Three-point circle']);
    })

    test('finds nothing for nothing typed, and leaves out what only the app runs', () => {
        expect(search('  ', everything)).toEqual([]);
        expect(search('move face', everything)).toEqual([]);
        expect(search('modifycurve', everything)).toEqual([]);
    })
})

describe(placeBeside, () => {
    const area = { left: 0, top: 0, right: 500, bottom: 400 };
    const size = { width: 100, height: 30 };
    const point = (x: number, y: number) => ({ left: x, top: y, right: x, bottom: y });

    test('goes below and right of what it\'s for', () => {
        expect(placeBeside(point(100, 100), size, area, 20)).toEqual({ left: 120, top: 120 });
    })

    test('takes another corner where that doesn\'t fit', () => {
        expect(placeBeside(point(450, 100), size, area, 20)).toEqual({ left: 330, top: 120 });
        expect(placeBeside(point(100, 380), size, area, 20)).toEqual({ left: 120, top: 330 });
    })

    test('squeezes in where no corner fits', () => {
        expect(placeBeside({ left: 0, top: 0, right: 500, bottom: 400 }, size, area, 20)).toEqual({ left: 400, top: 370 });
    })
})

describe(fade, () => {
    test('full near the cursor, fading with distance, never quite gone', () => {
        expect(fade(0)).toBe(1);
        expect(fade(48)).toBe(1);
        expect(fade(184)).toBeCloseTo((1 + faint) / 2);
        expect(fade(1000)).toBe(faint);
    })
})

describe(Visibility, () => {
    let editor: Editor;
    let visibility: Visibility;
    beforeAll(() => { editor = new Editor() });
    beforeEach(() => {
        visibility = new Visibility();
        visibility.selectionChanged(true);
    });
    const command = (klass: CommandClass): Command => new klass(editor);

    test('shows while something\'s selected', () => {
        expect(visibility.shown).toBe(true);
        visibility.selectionChanged(false);
        expect(visibility.shown).toBe(false);
    })

    test('hides while a command of the user\'s runs, and asks to be placed again after', () => {
        const move = command(cmd.MoveCommand);
        visibility.commandStarted(move, 'own');
        expect(visibility.shown).toBe(false);
        expect(visibility.commandEnded(command(cmd.RotateCommand))).toBe(false);
        expect(visibility.shown).toBe(false);
        expect(visibility.commandEnded(move)).toBe(true);
        expect(visibility.shown).toBe(true);
    })

    test('stays while the selection\'s own command waits, and hides once its gizmo is used', () => {
        const extrude = command(cmd.ExtrudeCommand);
        visibility.commandStarted(extrude, 'waiting');
        expect(visibility.shown).toBe(true);
        visibility.gizmoUsed(extrude);
        expect(visibility.shown).toBe(false);
        expect(visibility.commandEnded(extrude)).toBe(false);
        expect(visibility.shown).toBe(true);
    })

    test('a command started from the bar is the user\'s, whatever kind', () => {
        visibility.launch();
        expect(visibility.shown).toBe(false);
        const extrude = command(cmd.ExtrudeCommand);
        visibility.commandStarted(new DeselectAllCommand(editor), 'selecting');
        expect(visibility.shown).toBe(false);
        visibility.commandStarted(extrude, 'waiting');
        expect(visibility.shown).toBe(false);
        visibility.commandEnded(extrude);
        expect(visibility.shown).toBe(true);
    })

    test('hides while the view moves, and stays hidden until the next selection unless moved out of the way', () => {
        visibility.navigationStarted();
        expect(visibility.shown).toBe(false);
        visibility.navigationEnded();
        expect(visibility.shown).toBe(false);
        visibility.selectionChanged(true);
        expect(visibility.shown).toBe(true);

        visibility.pinned = true;
        visibility.navigationStarted();
        expect(visibility.shown).toBe(false);
        visibility.navigationEnded();
        expect(visibility.shown).toBe(true);
    })

    test('a click that never moved the view doesn\'t hide it', () => {
        visibility.navigationEnded();
        expect(visibility.shown).toBe(true);
    })

    test('hides while Shift or Ctrl is held', () => {
        visibility.modifierChanged(true);
        expect(visibility.shown).toBe(false);
        visibility.modifierChanged(false);
        expect(visibility.shown).toBe(true);
    })
})

describe(kindOf, () => {
    let editor: Editor;
    beforeAll(() => { editor = new Editor() });

    test('tells selection changes, the selection\'s own waiting commands and the user\'s apart', () => {
        expect(kindOf(new DeselectAllCommand(editor))).toBe('selecting');
        expect(kindOf(new cmd.ExtrudeCommand(editor))).toBe('waiting');
        expect(kindOf(new cmd.OffsetFaceCommand(editor))).toBe('waiting');
        expect(kindOf(new cmd.MoveCommand(editor))).toBe('own');
        const typed = new cmd.ExtrudeCommand(editor);
        typed.agent = 'user';
        expect(kindOf(typed)).toBe('own');
    })
})
