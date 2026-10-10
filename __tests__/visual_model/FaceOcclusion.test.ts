/**
 * @jest-environment jsdom
 */
import * as THREE from "three";
import { ThreePointBoxFactory } from "../../src/commands/box/BoxFactory";
import { Editor } from "../../src/editor/Editor";
import { FaceOcclusion } from "../../src/visual_model/FaceOcclusion";
import * as visual from '../../src/visual_model/VisualModel';
import '../matchers';

let editor: Editor;

beforeEach(() => {
    editor = new Editor();
});

async function makeBox(size: THREE.Vector3) {
    const makeBox = new ThreePointBoxFactory(editor._db, editor.materials, editor.signals);
    makeBox.p1 = new THREE.Vector3();
    makeBox.p2 = new THREE.Vector3(size.x, 0, 0);
    makeBox.p3 = new THREE.Vector3(size.x, size.y, 0);
    makeBox.p4 = new THREE.Vector3(size.x, size.y, size.z);
    const box = await makeBox.commit() as visual.Solid;
    box.updateMatrixWorld();
    return box;
}

function cameraAt(position: THREE.Vector3, target: THREE.Vector3) {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    camera.position.copy(position);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    return camera;
}

describe('a unit box seen from above, in front and to the right', () => {
    let occlusion: FaceOcclusion;

    beforeEach(async () => {
        const box = await makeBox(new THREE.Vector3(1, 1, 1));
        const camera = cameraAt(new THREE.Vector3(3, -2, 2.5), new THREE.Vector3(0.5, 0.5, 0.5));
        occlusion = new FaceOcclusion(camera, [box], true);
    });

    test('the faces hide the corners, edges and face centers behind them', () => {
        expect(occlusion.hides(new THREE.Vector3(0, 1, 0))).toBe(true);
        expect(occlusion.hides(new THREE.Vector3(0, 1, 0.5))).toBe(true);
        expect(occlusion.hides(new THREE.Vector3(0, 0.5, 0.5))).toBe(true);
        expect(occlusion.hides(new THREE.Vector3(0.5, 1, 0.5))).toBe(true);
        expect(occlusion.hides(new THREE.Vector3(0.5, 0.5, 0))).toBe(true);
    });

    test('the corners, edges and centers of the faces in view are not hidden, even by their own faces', () => {
        expect(occlusion.hides(new THREE.Vector3(1, 0, 1))).toBe(false);
        expect(occlusion.hides(new THREE.Vector3(1, 0, 0.5))).toBe(false);
        expect(occlusion.hides(new THREE.Vector3(1, 0.5, 1))).toBe(false);
        expect(occlusion.hides(new THREE.Vector3(0.5, 0.5, 1))).toBe(false);
        expect(occlusion.hides(new THREE.Vector3(1, 0.5, 0.5))).toBe(false);
        expect(occlusion.hides(new THREE.Vector3(0, 1, 1))).toBe(false);
    });

    test('what is in front of the box is not hidden', () => {
        expect(occlusion.hides(new THREE.Vector3(2, -1, 0))).toBe(false);
    });
});

test('seen at a steep angle, the far edge of the top is not hidden by the top, the far edge of the bottom is', async () => {
    const box = await makeBox(new THREE.Vector3(1, 1, 1));
    const camera = cameraAt(new THREE.Vector3(4, 0.5, 1.05), new THREE.Vector3(0.5, 0.5, 0.5));
    const occlusion = new FaceOcclusion(camera, [box], true);
    expect(occlusion.hides(new THREE.Vector3(0, 0.5, 1))).toBe(false);
    expect(occlusion.hides(new THREE.Vector3(0, 0.2, 1))).toBe(false);
    expect(occlusion.hides(new THREE.Vector3(0, 0.5, 0))).toBe(true);
});

test('a thin plate hides what is under it', async () => {
    const plate = await makeBox(new THREE.Vector3(1, 1, 0.01));
    const camera = cameraAt(new THREE.Vector3(3, -2, 2.5), new THREE.Vector3(0.5, 0.5, 0));
    const occlusion = new FaceOcclusion(camera, [plate], true);
    expect(occlusion.hides(new THREE.Vector3(0.5, 0.5, 0))).toBe(true);
    expect(occlusion.hides(new THREE.Vector3(0, 1, 0))).toBe(true);
    expect(occlusion.hides(new THREE.Vector3(0.5, 0.5, 0.01))).toBe(false);
    expect(occlusion.hides(new THREE.Vector3(0, 1, 0.01))).toBe(false);
});

test('when faces are not drawn, nothing is hidden', async () => {
    const box = await makeBox(new THREE.Vector3(1, 1, 1));
    const camera = cameraAt(new THREE.Vector3(3, -2, 2.5), new THREE.Vector3(0.5, 0.5, 0.5));
    const occlusion = new FaceOcclusion(camera, [box], false);
    expect(occlusion.hides(new THREE.Vector3(0, 1, 0))).toBe(false);
});

test('along a ray, a face nearer than the distance hides it', async () => {
    const box = await makeBox(new THREE.Vector3(1, 1, 1));
    const camera = cameraAt(new THREE.Vector3(0.5, 0.5, 3), new THREE.Vector3(0.5, 0.5, 0));
    const occlusion = new FaceOcclusion(camera, [box], true);
    const ray = new THREE.Ray(new THREE.Vector3(0.5, 0.5, 3), new THREE.Vector3(0, 0, -1));
    expect(occlusion.hidesAlong(ray, 3)).toBe(true); // the floor under the box
    expect(occlusion.hidesAlong(ray, 2)).toBe(false); // the top itself
    const beside = new THREE.Ray(new THREE.Vector3(2, 0.5, 3), new THREE.Vector3(0, 0, -1));
    expect(occlusion.hidesAlong(beside, 3)).toBe(false);
});
