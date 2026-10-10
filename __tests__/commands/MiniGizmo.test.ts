/**
 * @jest-environment jsdom
 */
import * as THREE from "three";
import { degToRad } from "three/src/math/MathUtils";
import { Intersector, MovementInfo } from "../../src/command/AbstractGizmo";
import { GizmoMaterialDatabase } from "../../src/command/GizmoMaterials";
import { KeyboardInterpreter } from "../../src/command/KeyboardInterpreter";
import { AngleGizmo, DistanceGizmo, LengthGizmo, Measure } from "../../src/command/MiniGizmos";
import { CircleMoveGizmo, MoveAxisGizmo, PlanarMoveGizmo } from "../../src/commands/translate/MoveGizmo";
import { CircleScaleGizmo, PlanarScaleGizmo, ScaleAxisGizmo } from "../../src/commands/translate/ScaleGizmo";
import { Viewport } from "../../src/components/viewport/Viewport";
import { Editor } from "../../src/editor/Editor";
import { EditorSignals } from '../../src/editor/EditorSignals';
import { GeometryDatabase } from '../../src/editor/GeometryDatabase';
import { Helper, Helpers } from "../../src/util/Helpers";
import { formatLength, fromLengthUnit } from "../../src/util/Units";
import { MakeViewport } from "../../__mocks__/FakeViewport";
import '../matchers';

let db: GeometryDatabase;
let gizmos: GizmoMaterialDatabase;
let signals: EditorSignals;
let helpers: Helpers;
let editor: Editor;
let viewport: Viewport;

beforeEach(() => {
    editor = new Editor();
    editor.snaps.settings = editor.settings.Snaps;
    db = editor._db;
    signals = editor.signals;
    helpers = editor.helpers;
    gizmos = editor.gizmos;
    viewport = MakeViewport(editor);
})

describe(AngleGizmo, () => {
    let gizmo: AngleGizmo;

    beforeEach(() => {
        gizmo = new AngleGizmo("name", editor);
        expect(gizmo.value).toBe(0);
    })

    test("it changes the angle, and respects interrupts", () => {
        const intersector = { raycast: jest.fn(), snap: jest.fn() } as Intersector;
        const cb = jest.fn();
        const event = new MouseEvent('move', { ctrlKey: false });
        const info = { viewport, event } as MovementInfo;

        gizmo.onPointerEnter(intersector);
        gizmo.onPointerDown(cb, intersector, info);
        gizmo.onPointerMove(cb, intersector, { angle: Math.PI / 2, viewport, event } as MovementInfo);
        expect(gizmo.value).toBe(Math.PI / 2);
        gizmo.onPointerUp(cb, intersector, info);
        gizmo.onPointerLeave(intersector);

        gizmo.onPointerEnter(intersector);
        gizmo.onPointerDown(cb, intersector, info);
        gizmo.onPointerMove(cb, intersector, { angle: Math.PI / 2, viewport, event } as MovementInfo);
        expect(gizmo.value).toBe(Math.PI);

        gizmo.onInterrupt(() => { });
        expect(gizmo.value).toBe(Math.PI / 2);
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);
    })

    test("it steps by the angle step with angle snapping on", () => {
        const intersector = { raycast: jest.fn(), snap: jest.fn() } as Intersector;
        const cb = jest.fn();
        const event = new MouseEvent("move");
        const info = { viewport, event } as MovementInfo;

        editor.snaps.angleSnapping = true;
        gizmo.onPointerEnter(intersector);
        gizmo.onPointerDown(cb, intersector, info);
        gizmo.onPointerMove(cb, intersector, { angle: degToRad(47), viewport, event } as MovementInfo);
        expect(gizmo.value).toBe(degToRad(45));
        gizmo.onPointerUp(cb, intersector, info);
        gizmo.onPointerLeave(intersector);
        editor.snaps.angleSnapping = false;
    })

    test("angles step to multiples of the angle step, wherever the drag started", () => {
        const intersector = { raycast: jest.fn(), snap: jest.fn() } as Intersector;
        const cb = jest.fn();
        const event = new MouseEvent('move');
        editor.snaps.angleSnapping = true;
        gizmo.value = degToRad(12);
        gizmo.onPointerEnter(intersector);
        gizmo.onPointerDown(cb, intersector, { viewport, event } as MovementInfo);
        gizmo.onPointerMove(cb, intersector, { angle: degToRad(11), viewport, event } as MovementInfo);
        expect(gizmo.value).toBeCloseTo(degToRad(25));
        editor.snaps.angleSnapping = false;
    })

})

describe(CircleScaleGizmo, () => {
    let gizmo: CircleScaleGizmo;

    beforeEach(() => {
        gizmo = new CircleScaleGizmo("name", editor);
        expect(gizmo.value).toBe(1);
    })

    test("it changes size and respects interrupts", () => {
        const intersector = { raycast: jest.fn(), snap: jest.fn() } as Intersector;
        const cb = jest.fn();
        let info = {} as MovementInfo;

        const center2d = new THREE.Vector2();
        const pointStart2d = new THREE.Vector2(0.1, 0.1);

        gizmo.onPointerEnter(intersector);
        gizmo.onPointerDown(cb, intersector, { pointStart2d, center2d } as MovementInfo);
        gizmo.onPointerMove(cb, intersector, { pointStart2d, center2d, pointEnd2d: new THREE.Vector2(0.2, 0.2) } as MovementInfo);
        expect(gizmo.value).toBe(2);
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);

        gizmo.onPointerEnter(intersector);
        gizmo.onPointerDown(cb, intersector, { pointStart2d, center2d } as MovementInfo);
        gizmo.onPointerMove(cb, intersector, { pointStart2d, center2d, pointEnd2d: new THREE.Vector2(0.2, 0.2) } as MovementInfo);
        expect(gizmo.value).toBe(4);

        gizmo.onInterrupt(() => { });
        expect(gizmo.value).toBe(2);
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);
    })

})

describe(CircleMoveGizmo, () => {
    let gizmo: CircleMoveGizmo;

    beforeEach(() => {
        gizmo = new CircleMoveGizmo("name", editor);
        expect(gizmo.value).toEqual(new THREE.Vector3());
    })

    test("it changes vector delta and respects interrupts", () => {
        const intersector = { raycast: jest.fn(), snap: jest.fn() } as Intersector;
        const cb = jest.fn();
        let info = {} as MovementInfo;

        const pointStart3d = new THREE.Vector3(0, 0, 0);
        const pointEnd3d = new THREE.Vector3(1, 1, 1);

        gizmo.onPointerEnter(intersector);
        gizmo.onPointerDown(cb, intersector, {} as MovementInfo);
        gizmo.onPointerMove(cb, intersector, { pointStart3d, pointEnd3d } as MovementInfo);
        expect(gizmo.value).toEqual(pointEnd3d.clone().sub(pointStart3d));
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);

        gizmo.onPointerEnter(intersector);
        gizmo.onPointerDown(cb, intersector, { pointStart3d, pointEnd3d } as MovementInfo);
        gizmo.onPointerMove(cb, intersector, { pointStart3d, pointEnd3d } as MovementInfo);
        expect(gizmo.value).toEqual(pointEnd3d.clone().sub(pointStart3d).multiplyScalar(2));

        gizmo.onInterrupt(() => { });
        expect(gizmo.value).toEqual(pointEnd3d.clone().sub(pointStart3d));
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);
    })
})

describe(LengthGizmo, () => {
    let gizmo: LengthGizmo;

    beforeEach(() => {
        gizmo = new LengthGizmo("name", editor);
        expect(gizmo.value).toBe(0);
    })

    test("it changes size and respects interrupts", () => {
        const intersector = { raycast: jest.fn(), snap: jest.fn() };
        const cb = jest.fn();
        let info = {} as MovementInfo;
        const moveEvent = new MouseEvent('move', { ctrlKey: false });

        gizmo.onPointerEnter(intersector);
        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3() })
        gizmo.onPointerDown(cb, intersector, {} as MovementInfo);
        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3(0, 1, 0) })
        gizmo.onPointerMove(cb, intersector, { viewport, event: moveEvent } as MovementInfo);
        expect(gizmo.value).toBe(1);
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);

        gizmo.onPointerEnter(intersector);
        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3() })
        gizmo.onPointerDown(cb, intersector, {} as MovementInfo);
        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3(0, 1, 0) })
        gizmo.onPointerMove(cb, intersector, { viewport, event: moveEvent } as MovementInfo);
        expect(gizmo.value).toBe(2);

        gizmo.onInterrupt(() => { });
        expect(gizmo.value).toBe(1);
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);
    })

    test("steps by the length step with gizmo snapping on", () => {
        const intersector = { raycast: jest.fn(), snap: jest.fn() };
        const cb = jest.fn();
        const drag = (y: number) => {
            gizmo.onPointerEnter(intersector);
            intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3() })
            gizmo.onPointerDown(cb, intersector, {} as MovementInfo);
            intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3(0, y, 0) })
            gizmo.onPointerMove(cb, intersector, { viewport, event: new MouseEvent('move') } as MovementInfo);
            const value = gizmo.value;
            gizmo.onInterrupt(() => { });
            gizmo.onPointerUp(cb, intersector, {} as MovementInfo);
            gizmo.onPointerLeave(intersector);
            return value;
        }

        expect(drag(37)).toBeCloseTo(37);
        editor.snaps.gizmoSnapping = true;
        expect(drag(37)).toBe(40);
        editor.snaps.stepLengthStep(1); // 20
        expect(drag(37)).toBe(40);
        expect(drag(29)).toBe(20);
        editor.snaps.gizmoSnapping = false;
        editor.snaps.stepLengthStep(-1);
    })

    test("lengths step to multiples of the length step, wherever the drag started", () => {
        const intersector = { raycast: jest.fn(), snap: jest.fn() };
        const cb = jest.fn();
        editor.snaps.gizmoSnapping = true;
        gizmo.value = 37;
        gizmo.onPointerEnter(intersector);
        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3() })
        gizmo.onPointerDown(cb, intersector, {} as MovementInfo);
        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3(0, 23, 0) })
        gizmo.onPointerMove(cb, intersector, { viewport, event: new MouseEvent('move') } as MovementInfo);
        expect(gizmo.value).toBeCloseTo(60);
        editor.snaps.gizmoSnapping = false;
    })

    test("it ignores object snaps and drags along its plane", () => {
        const intersector = { raycast: jest.fn() };
        const cb = jest.fn();
        let info = {} as MovementInfo;
        const moveEvent = new MouseEvent('move');

        editor.snaps.settings = { ...editor.snaps.settings, point: true, face: true, curve: true, edge: true };
        gizmo.update(viewport.camera);

        gizmo.onPointerEnter(intersector);

        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3() })
        gizmo.onPointerDown(cb, intersector, {} as MovementInfo);

        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3(0, 7, 0) })
        gizmo.onPointerMove(cb, intersector, { viewport, event: moveEvent } as MovementInfo);
        expect(gizmo.value).toBe(7);

        gizmo.onPointerUp(cb, intersector, info)

        gizmo.onPointerLeave(intersector);
    })
})

describe(DistanceGizmo, () => {
    let gizmo: DistanceGizmo;

    beforeEach(() => {
        gizmo = new DistanceGizmo("name", editor);
        expect(gizmo.value).toBe(0);
    })

    test("it changes size and respects interrupts", () => {
        const intersector = { raycast: jest.fn(), snap: jest.fn() };
        const cb = jest.fn();
        let info = {} as MovementInfo;

        gizmo.onPointerEnter(intersector);
        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3() })
        gizmo.onPointerDown(cb, intersector, {} as MovementInfo);
        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3(0, 1, 0) })
        gizmo.onPointerMove(cb, intersector, { viewport, event: moveEvent } as MovementInfo);
        expect(gizmo.value).toBe(1);
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);

        gizmo.onPointerEnter(intersector);
        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3() })
        gizmo.onPointerDown(cb, intersector, {} as MovementInfo);
        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3(0, 1, 0) })
        gizmo.onPointerMove(cb, intersector, { viewport, event: moveEvent } as MovementInfo);
        expect(gizmo.value).toBe(2);

        gizmo.onInterrupt(() => { });
        expect(gizmo.value).toBe(1);
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);
    })

    describe("with a measure", () => {
        const type = (text: string) => {
            const keyboard = new KeyboardInterpreter();
            for (const key of text) keyboard.interpret(new KeyboardEvent('keydown', { key }));
            return keyboard;
        }
        const readout = () => [...viewport.domElement.querySelectorAll('.axis-helper')].map(e => e.textContent);
        // A pinned readout goes on the active viewport
        beforeEach(() => { editor.viewports.add(viewport) });

        test("its readout shows the measure from the start, or the offset once switched", () => {
            const measure = new Measure('Total', 30, 1);
            gizmo.measure = measure;
            expect(readout()).toEqual([formatLength(30)]);
            // As the viewport does before it renders
            const render = () => gizmo.traverse(o => { if (o instanceof Helper) o.update(viewport.camera) });
            gizmo.value = 5;
            render();
            expect(readout()).toEqual([formatLength(35)]);

            measure.offset = true;
            render();
            expect(readout()).toEqual([formatLength(5)]);
        })

        test("typing sets the measure, not the offset", () => {
            const cb = jest.fn();
            gizmo.measure = new Measure('Radius', 20, -1);
            gizmo.onKeyPress(cb, type('15'));
            expect(gizmo.value).toBeCloseTo(20 - fromLengthUnit(15));
            expect(cb).toHaveBeenLastCalledWith(gizmo.value);

            gizmo.measure!.offset = true;
            gizmo.onKeyPress(cb, type('15'));
            expect(gizmo.value).toBeCloseTo(fromLengthUnit(15));
        })

        test("snapping rounds the measure", () => {
            const intersector = { raycast: jest.fn(), snap: jest.fn() };
            const cb = jest.fn();
            editor.snaps.gizmoSnapping = true;
            gizmo.measure = new Measure('Total', 33, 1);
            intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3() })
            gizmo.onPointerDown(cb, intersector, {} as MovementInfo);
            intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3(0, 11, 0) })
            gizmo.onPointerMove(cb, intersector, { viewport, event: moveEvent } as MovementInfo);
            // 33 + 11 = 44 rounds to 40, so the offset is 7
            expect(gizmo.value).toBeCloseTo(40 - 33);
            editor.snaps.gizmoSnapping = false;
        })
    })
})

const moveEvent = new MouseEvent('move');

describe(MoveAxisGizmo, () => {
    let gizmo: MoveAxisGizmo;

    beforeEach(() => {
        gizmo = new MoveAxisGizmo("name", editor, gizmos.default);
        expect(gizmo.value).toBe(0);
    })

    test("it changes size and respects interrupts", () => {
        const intersector = { raycast: jest.fn(), snap: jest.fn() };
        const cb = jest.fn();
        let info = {} as MovementInfo;

        gizmo.onPointerEnter(intersector);
        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3() })
        gizmo.onPointerDown(cb, intersector, {} as MovementInfo);
        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3(0, 1, 0) });
        gizmo.onPointerMove(cb, intersector, { viewport, event: moveEvent } as MovementInfo);
        expect(gizmo.value).toBe(1);
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);

        gizmo.onPointerEnter(intersector);
        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3() })
        gizmo.onPointerDown(cb, intersector, {} as MovementInfo);
        intersector.raycast.mockReturnValueOnce({ point: new THREE.Vector3(0, 1, 0) });
        gizmo.onPointerMove(cb, intersector, { viewport, event: moveEvent } as MovementInfo);
        expect(gizmo.value).toBe(2);

        gizmo.onInterrupt(() => { });
        expect(gizmo.value).toBe(1);
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);
    })
})

describe(ScaleAxisGizmo, () => {
    let gizmo: ScaleAxisGizmo;

    beforeEach(() => {
        gizmo = new ScaleAxisGizmo("name", editor, gizmos.default);
        expect(gizmo.value).toBe(1);
    })

    test("it changes size and respects interrupts", () => {
        const intersector = { raycast: jest.fn(), snap: jest.fn() } as Intersector;
        const cb = jest.fn();
        let info = {} as MovementInfo;

        const center2d = new THREE.Vector2();
        const pointStart2d = new THREE.Vector2(0.1, 0.1);

        gizmo.onPointerEnter(intersector);
        gizmo.onPointerDown(cb, intersector, { pointStart2d, center2d } as MovementInfo);
        gizmo.onPointerMove(cb, intersector, { pointStart2d, center2d, pointEnd2d: new THREE.Vector2(0.2, 0.2) } as MovementInfo);
        expect(gizmo.value).toBe(2);
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);

        gizmo.onPointerEnter(intersector);
        gizmo.onPointerDown(cb, intersector, { pointStart2d, center2d } as MovementInfo);
        gizmo.onPointerMove(cb, intersector, { pointStart2d, center2d, pointEnd2d: new THREE.Vector2(0.2, 0.2) } as MovementInfo);
        expect(gizmo.value).toBe(4);

        gizmo.onInterrupt(() => { });
        expect(gizmo.value).toBe(2);
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);
    })
})

describe(PlanarMoveGizmo, () => {
    let gizmo: PlanarMoveGizmo;

    beforeEach(() => {
        gizmo = new PlanarMoveGizmo("name", editor, gizmos.default);
        expect(gizmo.value).toEqual(new THREE.Vector3());
    })

    test("it changes vector delta and respects interrupts", () => {
        const intersector = { raycast: jest.fn(), snap: jest.fn() };
        const cb = jest.fn();
        let info = {} as MovementInfo;

        const pointStart = new THREE.Vector3();
        const pointEnd = new THREE.Vector3(1, 1, 0);

        const event = new MouseEvent('move', { ctrlKey: false });

        gizmo.onPointerEnter(intersector);
        intersector.raycast.mockReturnValueOnce({ point: pointStart })
        gizmo.onPointerDown(cb, intersector, {} as MovementInfo);
        intersector.raycast.mockReturnValueOnce({ point: pointEnd })
        gizmo.onPointerMove(cb, intersector, { event } as MovementInfo);
        expect(gizmo.value).toEqual(pointEnd.clone().sub(pointStart));
        // Object snaps are on by default, but handles only follow their plane
        expect(intersector.snap).not.toHaveBeenCalled();
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);

        gizmo.onPointerEnter(intersector);
        intersector.raycast.mockReturnValueOnce({ point: pointStart })
        gizmo.onPointerDown(cb, intersector, {} as MovementInfo);
        intersector.raycast.mockReturnValueOnce({ point: pointEnd })
        gizmo.onPointerMove(cb, intersector, { event } as MovementInfo);
        expect(gizmo.value).toEqual(pointEnd.clone().sub(pointStart).multiplyScalar(2));

        gizmo.onInterrupt(() => { });
        expect(gizmo.value).toEqual(pointEnd.clone().sub(pointStart));
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);
    })
})

describe(PlanarScaleGizmo, () => {
    let gizmo: PlanarScaleGizmo;

    beforeEach(() => {
        gizmo = new PlanarScaleGizmo("name", editor, gizmos.default);
        expect(gizmo.value).toBe(1);
    })

    test("it changes size and respects interrupts", () => {
        const intersector = { raycast: jest.fn(), snap: jest.fn() };
        const cb = jest.fn();
        let info = {} as MovementInfo;

        const pointStart = new THREE.Vector3();
        const pointEnd = new THREE.Vector3(1, 1, 0);

        gizmo.onPointerEnter(intersector);
        intersector.raycast.mockReturnValueOnce({ point: pointStart })
        gizmo.onPointerDown(cb, intersector, {} as MovementInfo);
        intersector.raycast.mockReturnValueOnce({ point: pointEnd })
        gizmo.onPointerMove(cb, intersector, {} as MovementInfo);
        expect(gizmo.value).toBe(Math.sqrt(2));
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);

        gizmo.onPointerEnter(intersector);
        intersector.raycast.mockReturnValueOnce({ point: pointStart })
        gizmo.onPointerDown(cb, intersector, {} as MovementInfo);
        intersector.raycast.mockReturnValueOnce({ point: pointEnd })
        gizmo.onPointerMove(cb, intersector, {} as MovementInfo);
        expect(gizmo.value).toBeCloseTo(2);

        gizmo.onInterrupt(() => { });
        expect(gizmo.value).toBe(Math.sqrt(2));
        gizmo.onPointerUp(cb, intersector, info)
        gizmo.onPointerLeave(intersector);
    })
})