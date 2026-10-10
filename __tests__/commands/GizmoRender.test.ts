/**
 * @jest-environment jsdom
 */
import * as THREE from "three";
import { MovementInfo } from "../../src/command/AbstractGizmo";
import { PipeGizmo } from "../../src/commands/evolution/PipeGizmo";
import { PipeParams } from "../../src/commands/evolution/PipeFactory";
import { RevolutionGizmo } from "../../src/commands/evolution/RevolutionGizmo";
import { RevolutionParams } from "../../src/commands/evolution/RevolutionFactory";
import { FilletParams } from "../../src/commands/fillet/FilletFactory";
import { FilletSolidGizmo } from "../../src/commands/fillet/FilletGizmo";
import { OffsetFaceParams } from "../../src/commands/modifyface/OffsetFaceFactory";
import { OffsetFaceGizmo } from "../../src/commands/modifyface/OffsetFaceGizmo";
import { SpiralParams } from "../../src/commands/spiral/SpiralFactory";
import { SpiralGizmo } from "../../src/commands/spiral/SpiralGizmo";
import { MoveGizmo } from "../../src/commands/translate/MoveGizmo";
import { RotateGizmo } from "../../src/commands/translate/RotateGizmo";
import { ScaleGizmo } from "../../src/commands/translate/ScaleGizmo";
import { MoveParams, RotateParams, ScaleParams } from "../../src/commands/translate/TranslateItemFactory";
import { Editor } from "../../src/editor/Editor";
import '../matchers';

// A value changed in a command's dialog shows on its gizmo: each handle holds it, so the next drag goes on from it

let editor: Editor;

beforeEach(() => {
    editor = new Editor();
})

const handles = (gizmo: object, ...names: string[]) => names.map(name => (gizmo as any)[name].value);

test("OffsetFaceGizmo", () => {
    const params = { distance: 5, angle: 0.1, degrees: 0, faces: [] } as unknown as OffsetFaceParams;
    const gizmo = new OffsetFaceGizmo(params, editor);
    gizmo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    gizmo.render(params);
    expect(handles(gizmo, 'distance', 'angle')).toEqual([5, 0.1]);
    expect(gizmo.position).toApproximatelyEqual(new THREE.Vector3(0, 0, 5));
});

test("SpiralGizmo", () => {
    const params = { p1: new THREE.Vector3(), p2: new THREE.Vector3(0, 0, 4), radius: 2, angle: 0.3 } as SpiralParams;
    const gizmo = new SpiralGizmo(params, editor);
    gizmo.render(params);
    expect(handles(gizmo, 'angleGizmo', 'lengthGizmo', 'radiusGizmo')).toEqual([0.3, 4, 2]);
});

test("FilletSolidGizmo", () => {
    const params = { distance1: 2, distance2: 2 } as FilletParams;
    const gizmo = new FilletSolidGizmo(params, editor);
    gizmo.render(params);
    expect(handles(gizmo, 'main', 'stretchFillet', 'stretchChamfer')).toEqual([2, 2, -2]);

    // A chamfer: the angle follows the two distances
    params.distance1 = -1; params.distance2 = -Math.sqrt(3);
    gizmo.render(params);
    expect(handles(gizmo, 'main', 'stretchFillet', 'stretchChamfer')).toEqual([-1, -1, 1]);
    expect(handles(gizmo, 'angle')[0]).toBeCloseTo(Math.PI / 3);
});

test("PipeGizmo", () => {
    const params = { sectionSize: 3, angle: 0.2, thickness1: 0.5 } as PipeParams;
    const gizmo = new PipeGizmo(params, editor);
    gizmo.render(params);
    expect(handles(gizmo, 'sectionSizeGizmo', 'angleGizmo', 'thicknessGizmo')).toEqual([3, 0.2, 0.5]);
});

test("RevolutionGizmo", () => {
    const params = { side1: Math.PI, thickness1: 0.25 } as RevolutionParams;
    const gizmo = new RevolutionGizmo(params, editor);
    gizmo.render(params);
    expect(handles(gizmo, 'angle', 'thickness')).toEqual([Math.PI, 0.25]);
});

describe(MoveGizmo, () => {
    test('the move goes on the axis handles, in the gizmo\'s axes, and the planar and screen handles rest', () => {
        const params = { move: new THREE.Vector3() } as MoveParams;
        const gizmo = new MoveGizmo(params, editor);
        // Turned so that its x points along world y
        gizmo.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
        (gizmo as any).xy.state.original = new THREE.Vector3(5, 5, 0);

        params.move = new THREE.Vector3(1, 2, 3);
        gizmo.render(params);
        const [x, y, z] = handles(gizmo, 'x', 'y', 'z');
        expect(x).toBeCloseTo(2);
        expect(y).toBeCloseTo(-1);
        expect(z).toBeCloseTo(3);
        for (const planar of handles(gizmo, 'xy', 'yz', 'xz', 'screen')) expect(planar).toApproximatelyEqual(new THREE.Vector3());
        expect(gizmo.position).toApproximatelyEqual(new THREE.Vector3(1, 2, 3));
    });
});

test("ScaleGizmo", () => {
    const params = { scale: new THREE.Vector3(1, 1, 1), pivot: new THREE.Vector3() } as ScaleParams;
    const gizmo = new ScaleGizmo(params, editor);
    (gizmo as any).xyz.state.original = 3;

    params.scale = new THREE.Vector3(2, 3, 4);
    gizmo.render(params);
    expect(handles(gizmo, 'x', 'y', 'z')).toEqual([2, 3, 4]);
    expect(handles(gizmo, 'xy', 'yz', 'xz', 'xyz')).toEqual([1, 1, 1, 1]);
});

describe(RotateGizmo, () => {
    const params = { pivot: new THREE.Vector3(1, 1, 1), axis: new THREE.Vector3(0, 1, 0), angle: 0.5 } as RotateParams;

    test('the angle goes on the handle for its axis, the others rest', () => {
        const gizmo = new RotateGizmo(params, editor);
        gizmo.render(params);
        expect(handles(gizmo, 'x', 'y', 'z', 'screen')).toEqual([0, 0.5, 0, 0]);
        expect(gizmo.position).toApproximatelyEqual(params.pivot);

        gizmo.render({ ...params, axis: new THREE.Vector3(0, 0, -1) });
        expect(handles(gizmo, 'x', 'y', 'z')).toEqual([0, 0, -0.5]);
    });

    test('dragging the handle afterwards goes on from it', () => {
        const gizmo = new RotateGizmo(params, editor);
        gizmo.render(params);
        const y = (gizmo as any).y;
        const cb = jest.fn();
        y.onPointerMove(cb, { raycast: jest.fn() }, { angle: 0.25, event: new MouseEvent('move') } as unknown as MovementInfo);
        expect(y.value).toBeCloseTo(0.75);
    });
});
