/**
 * @jest-environment jsdom
 */
import { degToRad } from "three/src/math/MathUtils";
import { Intersector, MovementInfo } from "../../src/command/AbstractGizmo";
import { AxisAngleGizmo } from "../../src/commands/translate/RotateGizmo";
import { Viewport } from "../../src/components/viewport/Viewport";
import { Editor } from "../../src/editor/Editor";
import { MakeViewport } from "../../__mocks__/FakeViewport";
import '../matchers';

let editor: Editor;
let viewport: Viewport;

beforeEach(() => {
    editor = new Editor();
    editor.snaps.settings = editor.settings.Snaps;
    viewport = MakeViewport(editor);
})

describe(AxisAngleGizmo, () => {
    let gizmo: AxisAngleGizmo;

    beforeEach(() => {
        gizmo = new AxisAngleGizmo("rotate:z", editor, editor.gizmos.blue);
    })

    // The readout shows what the drag returns
    test("a drag returns the angle applied: snapped, and counting earlier drags", () => {
        const intersector = { raycast: jest.fn(), snap: jest.fn() } as Intersector;
        const cb = jest.fn();
        const event = new MouseEvent('move');
        editor.snaps.angleSnapping = true;

        const first = gizmo.onPointerMove(cb, intersector, { angle: degToRad(47), viewport, event } as MovementInfo);
        expect(first).toBeCloseTo(degToRad(45));
        expect(cb).toHaveBeenLastCalledWith(first);
        gizmo.onPointerUp(cb, intersector, { viewport, event } as MovementInfo);

        const second = gizmo.onPointerMove(cb, intersector, { angle: degToRad(10), viewport, event } as MovementInfo);
        expect(second).toBeCloseTo(degToRad(55));
        expect(gizmo.value).toBeCloseTo(degToRad(55));
        editor.snaps.angleSnapping = false;
    })
})
