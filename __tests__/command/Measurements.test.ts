import * as THREE from "three";
import { polygon, radius } from "../../src/command/Measurements";
import { formatLength } from "../../src/util/Units";
import '../matchers';

describe(radius, () => {
    test('a line from the center to the point, labelled beside it halfway along with the radius', () => {
        const center = new THREE.Vector3(1, 1, 0), through = new THREE.Vector3(4, 5, 0);
        const [line, label] = radius(center, through);
        expect(line).toEqual({ tag: 'line', from: center, to: through });
        expect(label).toEqual({ tag: 'beside', from: center, to: through, text: formatLength(5) });
    });
});

describe(polygon, () => {
    test('labels the circumscribed circle with its radius, not its diameter', () => {
        const dimensions = polygon(new THREE.Vector3(), new THREE.Vector3(2, 0, 0), new THREE.Vector3(0, 0, 1));
        const label = dimensions.find(d => d.tag === 'beside');
        expect(label).toEqual({ tag: 'beside', from: new THREE.Vector3(), to: new THREE.Vector3(2, 0, 0), text: formatLength(2) });
    });
});
