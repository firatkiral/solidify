import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { Viewport } from "../components/viewport/Viewport";
import { NoOpError } from "./GeometryFactory";
import { EditorSignals } from "../editor/EditorSignals";
import theme from '../startup/default-theme.json';
import { CancellableRegisterable } from "../util/CancellableRegisterable";
import { CancellableRegistor } from "../util/CancellableRegistor";
import { Helper, Helpers } from "../util/Helpers";
import { formatAngle, formatLength } from "../util/Units";

// The dimensions shown while drawing a shape, as in Plasticity: faint guide lines (diameters, angle arcs, dimension
// brackets) with labels that state their units. Offsets are in gizmo units (see Helper.scaleIndependentOfZoom), so
// they keep their size on screen as the camera moves.

export type Dimension =
    | { tag: 'line', from: THREE.Vector3, to: THREE.Vector3 }
    | { tag: 'polyline', points: THREE.Vector3[] }
    // A label centered on a point
    | { tag: 'label', at: THREE.Vector3, text: string }
    // A label just off the middle of a segment, on its left when looking down the normal
    | { tag: 'beside', from: THREE.Vector3, to: THREE.Vector3, normal: THREE.Vector3, text: string }
    // A dimension bracket standing off a segment towards outward, labelled with the segment's length
    | { tag: 'bracket', from: THREE.Vector3, to: THREE.Vector3, outward: THREE.Vector3 }
    // A gizmo-style readout standing off base along direction
    | { tag: 'readout', base: THREE.Vector3, direction: THREE.Vector3, text: string };

const besideOffset = 0.1, bracketOffset = 1, readoutOffset = 2;
const labelClass = 'absolute z-50 px-2 py-1 text-xs text-center whitespace-nowrap rounded pointer-events-none text-neutral-50 opacity-30 -translate-x-1/2 -translate-y-1/2';
const readoutClass = 'axis-helper';

const lineColor = new THREE.Color(theme.colors.neutral[50]).convertSRGBToLinear();
// Plasticity draws guides at 10% opacity blending in sRGB; blending in linear space as here, 3% looks the same
const lineOpacity = 0.03;

type Label = { at: THREE.Vector3, text: string, readout: boolean };

export class Measurements extends Helper implements CancellableRegisterable {
    private readonly material = new LineMaterial({ color: lineColor.getHex(), opacity: lineOpacity, transparent: true, linewidth: 1, depthWrite: false, fog: false, toneMapped: false });
    private readonly lines = new LineSegments2(new LineSegmentsGeometry(), this.material);
    private dimensions: Dimension[] = [];
    private readonly elements = new Map<Viewport, HTMLElement[]>();

    constructor(private readonly editor: { helpers: Helpers, viewports: Iterable<Viewport>, signals: EditorSignals }) {
        super();
        this.lines.frustumCulled = false;
        this.add(this.lines);
        editor.helpers.add(this);
    }

    get shouldRescaleOnZoom() { return false }

    set(dimensions: Dimension[]) {
        this.dimensions = dimensions;
        this.editor.signals.gizmoChanged.dispatch();
    }

    reset() { this.set([]) }

    // Called before each viewport renders, with that viewport's camera
    update(camera: THREE.Camera) {
        super.update(camera);
        const viewport = [...this.editor.viewports].find(v => v.camera === camera);
        if (viewport === undefined) return;

        const positions: number[] = [];
        const labels: Label[] = [];
        const segment = (a: THREE.Vector3, b: THREE.Vector3) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        for (const d of this.dimensions) {
            switch (d.tag) {
                case 'line': segment(d.from, d.to); break;
                case 'polyline':
                    for (let i = 1; i < d.points.length; i++) segment(d.points[i - 1], d.points[i]);
                    break;
                case 'label': labels.push({ at: d.at, text: d.text, readout: false }); break;
                case 'beside': {
                    const mid = d.from.clone().lerp(d.to, 0.5);
                    const direction = d.to.clone().sub(d.from).normalize();
                    const side = d.normal.clone().cross(direction);
                    // A segment along the normal has no left; step off it sideways on screen instead
                    if (side.lengthSq() < 1e-12) side.copy(this.eye).cross(direction);
                    side.normalize().multiplyScalar(besideOffset * this.factor(camera, mid));
                    labels.push({ at: mid.add(side), text: d.text, readout: false });
                    break;
                }
                case 'bracket': {
                    const stand = d.outward.clone().multiplyScalar(bracketOffset * this.factor(camera, d.from));
                    const a = d.from.clone().add(stand), b = d.to.clone().add(stand);
                    segment(d.from, a); segment(a, b); segment(b, d.to);
                    labels.push({ at: a.clone().lerp(b, 0.5), text: formatLength(d.from.distanceTo(d.to)), readout: false });
                    break;
                }
                case 'readout': {
                    const at = d.direction.clone().multiplyScalar(readoutOffset * this.factor(camera, d.base)).add(d.base);
                    labels.push({ at, text: d.text, readout: true });
                    break;
                }
            }
        }

        this.lines.visible = positions.length > 0;
        if (positions.length > 0) this.lines.geometry.setPositions(positions);
        this.material.resolution.set(viewport.domElement.offsetWidth, viewport.domElement.offsetHeight);
        this.place(viewport, camera, labels);
    }

    private readonly scratch = new THREE.Object3D();
    private factor(camera: THREE.Camera, at: THREE.Vector3) {
        return Helper.scaleIndependentOfZoom(this.scratch, camera, at);
    }

    private readonly projected = new THREE.Vector3();
    private place(viewport: Viewport, camera: THREE.Camera, labels: Label[]) {
        let elements = this.elements.get(viewport);
        if (elements === undefined) this.elements.set(viewport, elements = []);
        while (elements.length < labels.length) {
            const element = document.createElement('div');
            viewport.domElement.appendChild(element);
            elements.push(element);
        }
        while (elements.length > labels.length) elements.pop()!.remove();

        const rect = viewport.domElement.getBoundingClientRect();
        labels.forEach((label, i) => {
            const element = elements![i];
            const projected = this.projected.copy(label.at).project(camera);
            element.className = label.readout ? readoutClass : labelClass;
            element.textContent = label.text;
            element.hidden = projected.z < -1 || projected.z > 1;
            element.style.left = (1 + projected.x) / 2 * rect.width + 'px';
            element.style.top = (1 - projected.y) / 2 * rect.height + 'px';
        });
    }

    private dispose() {
        for (const elements of this.elements.values()) for (const element of elements) element.remove();
        this.elements.clear();
        this.removeFromParent();
        this.lines.geometry.dispose();
        this.material.dispose();
    }

    cancel() { this.dispose() }
    finish() { this.dispose() }
    interrupt() { this.dispose() }

    resource(reg: CancellableRegistor): this {
        reg.resource(this);
        return this;
    }
}

// The diameter through the cursor, labelled at the center: center circle, sphere and cylinder base
export function diameter(center: THREE.Vector3, point: THREE.Vector3): Dimension[] {
    const opposite = center.clone().multiplyScalar(2).sub(point);
    return [
        { tag: 'line', from: opposite, to: point.clone() },
        { tag: 'label', at: center.clone(), text: formatLength(2 * center.distanceTo(point)) },
    ];
}

// The diameter through a point on the circle, labelled with the radius: two- and three-point circles
export function radius(center: THREE.Vector3, through: THREE.Vector3): Dimension[] {
    const opposite = center.clone().multiplyScalar(2).sub(through);
    return [
        { tag: 'line', from: opposite, to: through.clone() },
        { tag: 'label', at: center.clone(), text: formatLength(center.distanceTo(through)) },
    ];
}

// A regular polygon's circumscribed circle and the diameter through the vertex, labelled with that diameter
export function polygon(center: THREE.Vector3, vertex: THREE.Vector3, normal: THREE.Vector3): Dimension[] {
    const start = vertex.clone().sub(center).normalize();
    return [...diameter(center, vertex), arc(center, start, normal, 2 * Math.PI, center.distanceTo(vertex))];
}

// A length labelled beside its segment: the radius of a center-point arc or ellipse, the ends of a three-point arc, a
// spiral's axis and radius
export function length(from: THREE.Vector3, to: THREE.Vector3, normal: THREE.Vector3): Dimension[] {
    return [{ tag: 'beside', from: from.clone(), to: to.clone(), normal: normal.clone(), text: formatLength(from.distanceTo(to)) }];
}

// The height of an arc's middle above the line between its ends, drawn from the middle of that line: three-point arcs
export function arcHeight(start: THREE.Vector3, end: THREE.Vector3, middle: THREE.Vector3, normal: THREE.Vector3): Dimension[] {
    const base = start.clone().lerp(end, 0.5);
    return [{ tag: 'line', from: base, to: middle.clone() }, ...length(base, middle, normal)];
}

// A line segment's length beside it, and the angle it turns from the reference direction, drawn as a ray and an arc
// as long as the segment
export function segment(from: THREE.Vector3, to: THREE.Vector3, normal: THREE.Vector3, reference: THREE.Vector3): Dimension[] {
    const result = length(from, to, normal);
    const distance = from.distanceTo(to);
    if (distance < 1e-6) return result;

    const direction = to.clone().sub(from).normalize();
    const angle = reference.angleTo(direction);
    if (angle < 1e-6) return result;
    const axis = reference.clone().cross(direction);
    if (axis.lengthSq() < 1e-12) axis.copy(normal);
    axis.normalize();

    const guide = arc(from, reference, axis, angle, distance);
    guide.points.unshift(from.clone());
    const middle = reference.clone().applyAxisAngle(axis, angle / 2).multiplyScalar(distance).add(from);
    return [...result, guide, { tag: 'label', at: middle, text: formatAngle(angle) }];
}

// How far a center-point arc sweeps around the axis from its start, drawn just outside the arc
export function sweep(center: THREE.Vector3, start: THREE.Vector3, axis: THREE.Vector3, angle: number): Dimension[] {
    const r = 1.1 * center.distanceTo(start);
    const direction = start.clone().sub(center).normalize();
    const middle = direction.clone().applyAxisAngle(axis, angle / 2).multiplyScalar(r).add(center);
    return [arc(center, direction, axis, angle, r), { tag: 'label', at: middle, text: formatAngle(angle) }];
}

// Dimension brackets on the two sides of a rectangle that meet at its first corner, standing off outwards
export function rectangle(corners: { p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3 }): Dimension[] {
    const { p1, p2, p4 } = corners;
    return [
        { tag: 'bracket', from: p1.clone(), to: p2.clone(), outward: p1.clone().sub(p4).normalize() },
        { tag: 'bracket', from: p1.clone(), to: p4.clone(), outward: p1.clone().sub(p2).normalize() },
    ];
}

// The brackets for a rectangle being drawn; none while it has no area
export function rectangleOf(rect: { corners: { p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3 } }): Dimension[] {
    try { return rectangle(rect.corners) }
    catch (e) {
        if (!(e instanceof NoOpError)) throw e;
        return [];
    }
}

// A height read out like a gizmo's, standing off the base center along the height
export function height(base: THREE.Vector3, direction: THREE.Vector3, h: number): Dimension[] {
    return [{ tag: 'readout', base: base.clone(), direction: direction.clone().multiplyScalar(Math.sign(h) || 1), text: formatLength(Math.abs(h)) }];
}

function arc(center: THREE.Vector3, start: THREE.Vector3, axis: THREE.Vector3, angle: number, r: number, segments = 64) {
    const points = [];
    for (let i = 0; i <= segments; i++) {
        points.push(start.clone().applyAxisAngle(axis, angle * i / segments).multiplyScalar(r).add(center));
    }
    return { tag: 'polyline' as const, points };
}
