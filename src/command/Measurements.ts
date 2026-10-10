import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { Viewport } from "../components/viewport/Viewport";
import { NoOpError } from "./GeometryFactory";
import { EditorSignals } from "../editor/EditorSignals";
import { paletteColor } from "../startup/Appearance";
import theme from '../startup/default-theme.json';
import { CancellableRegisterable } from "../util/CancellableRegisterable";
import { CancellableRegistor } from "../util/CancellableRegistor";
import { Helper, Helpers } from "../util/Helpers";
import { formatAngle, formatLength } from "../util/Units";
import { placeClear } from "./ScreenLabel";

// The dimensions shown while drawing a shape, as in Plasticity: faint guide lines (radii, angle arcs, dimension
// brackets) with labels that state their units. Bracket offsets are in gizmo units (see Helper.scaleIndependentOfZoom),
// so they keep their size on screen as the camera moves; labels stand clear of what they mark on screen (see
// placeClear), so they never cover it.

export type Dimension =
    | { tag: 'line', from: THREE.Vector3, to: THREE.Vector3 }
    | { tag: 'polyline', points: THREE.Vector3[] }
    // A label clear of a point, past it the way away points
    | { tag: 'label', at: THREE.Vector3, away: THREE.Vector3, text: string }
    // A label beside the middle of a segment: on its left when looking down the normal, or to its side on screen
    | { tag: 'beside', from: THREE.Vector3, to: THREE.Vector3, normal?: THREE.Vector3, text: string }
    // A dimension bracket standing off a segment towards outward, labelled with the segment's length outside it
    | { tag: 'bracket', from: THREE.Vector3, to: THREE.Vector3, outward: THREE.Vector3 }
    // A gizmo-style readout past the end of a length, along its direction, clear of what spreads radius around the end
    | { tag: 'readout', at: THREE.Vector3, direction: THREE.Vector3, radius: number, text: string };

const bracketOffset = 1;
const labelClass = 'absolute z-50 px-2 py-1 text-xs text-center whitespace-nowrap rounded pointer-events-none text-ui-title opacity-30 -translate-x-1/2 -translate-y-1/2';
const readoutClass = 'axis-helper';

// The 3D view's text colour, as the theme has it
const lineColor = () => new THREE.Color(paletteColor('title') || theme.colors.neutral[50]).convertSRGBToLinear();
// Plasticity draws guides at 10% opacity blending in sRGB; blending in linear space as here, 3% looks the same
const lineOpacity = 0.03;

type Label = { at: THREE.Vector3, away: THREE.Vector3, radius?: number, text: string, readout: boolean };

export class Measurements extends Helper implements CancellableRegisterable {
    private readonly material = new LineMaterial({ color: lineColor().getHex(), opacity: lineOpacity, transparent: true, linewidth: 1, depthWrite: false, fog: false, toneMapped: false });
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
                case 'label': labels.push({ at: d.at, away: d.away, text: d.text, readout: false }); break;
                case 'beside': {
                    const mid = d.from.clone().lerp(d.to, 0.5);
                    const direction = d.to.clone().sub(d.from).normalize();
                    const side = d.normal !== undefined ? d.normal.clone().cross(direction) : new THREE.Vector3();
                    // Without a normal, or along it, there's no left; go to its side on screen instead
                    if (side.lengthSq() < 1e-12) side.setFromMatrixColumn(camera.matrixWorld, 2).cross(direction);
                    labels.push({ at: mid, away: side, text: d.text, readout: false });
                    break;
                }
                case 'bracket': {
                    const stand = d.outward.clone().multiplyScalar(bracketOffset * this.factor(camera, d.from));
                    const a = d.from.clone().add(stand), b = d.to.clone().add(stand);
                    segment(d.from, a); segment(a, b); segment(b, d.to);
                    // A rectangle without width yet has no outward; go to the bracket's side on screen instead
                    const away = d.outward.lengthSq() > 1e-12 ? d.outward : new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).cross(d.to.clone().sub(d.from));
                    labels.push({ at: a.clone().lerp(b, 0.5), away, text: formatLength(d.from.distanceTo(d.to)), readout: false });
                    break;
                }
                case 'readout': labels.push({ at: d.at, away: d.direction, radius: d.radius, text: d.text, readout: true }); break;
            }
        }

        this.lines.visible = positions.length > 0;
        if (positions.length > 0) this.lines.geometry.setPositions(positions);
        this.material.resolution.set(viewport.domElement.offsetWidth, viewport.domElement.offsetHeight);
        this.place(viewport, labels);
    }

    private readonly scratch = new THREE.Object3D();
    private factor(camera: THREE.Camera, at: THREE.Vector3) {
        return Helper.scaleIndependentOfZoom(this.scratch, camera, at);
    }

    private place(viewport: Viewport, labels: Label[]) {
        let elements = this.elements.get(viewport);
        if (elements === undefined) this.elements.set(viewport, elements = []);
        while (elements.length < labels.length) {
            const element = document.createElement('div');
            viewport.domElement.appendChild(element);
            elements.push(element);
        }
        while (elements.length > labels.length) elements.pop()!.remove();

        labels.forEach((label, i) => {
            const element = elements![i];
            element.className = label.readout ? readoutClass : labelClass;
            element.textContent = label.text;
            element.hidden = false; // so it has a size to stand clear by
            element.hidden = !placeClear(element, viewport, label.at, label.away, label.radius);
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

// The radius from the center to a point on the circle, labelled beside it halfway along: circles, spheres and cylinder
// bases. Round things are sized by their radius everywhere, as in their dialogs and gizmos.
export function radius(center: THREE.Vector3, through: THREE.Vector3): Dimension[] {
    return [
        { tag: 'line', from: center.clone(), to: through.clone() },
        { tag: 'beside', from: center.clone(), to: through.clone(), text: formatLength(center.distanceTo(through)) },
    ];
}

// A regular polygon's circumscribed circle and its radius to the vertex
export function polygon(center: THREE.Vector3, vertex: THREE.Vector3, normal: THREE.Vector3): Dimension[] {
    const start = vertex.clone().sub(center).normalize();
    return [...radius(center, vertex), arc(center, start, normal, 2 * Math.PI, center.distanceTo(vertex))];
}

// A length labelled beside its segment: the radius of a center-point arc or ellipse, the ends of a three-point arc, a
// spiral's axis and radius
export function length(from: THREE.Vector3, to: THREE.Vector3, normal: THREE.Vector3): Dimension[] {
    return [{ tag: 'beside', from: from.clone(), to: to.clone(), normal: normal.clone(), text: formatLength(from.distanceTo(to)) }];
}

// The height of an arc's middle above the line between its ends, drawn from the middle of that line: three-point arcs.
// It's labelled past the arc's middle, where the arc never reaches however deep it is.
export function arcHeight(start: THREE.Vector3, end: THREE.Vector3, middle: THREE.Vector3): Dimension[] {
    const base = start.clone().lerp(end, 0.5);
    return [
        { tag: 'line', from: base, to: middle.clone() },
        { tag: 'label', at: middle.clone(), away: middle.clone().sub(base), text: formatLength(base.distanceTo(middle)) },
    ];
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
    return [...result, guide, { tag: 'label', at: middle, away: middle.clone().sub(from), text: formatAngle(angle) }];
}

// How far a center-point arc sweeps around the axis from its start, drawn just outside the arc
export function sweep(center: THREE.Vector3, start: THREE.Vector3, axis: THREE.Vector3, angle: number): Dimension[] {
    const r = 1.1 * center.distanceTo(start);
    const direction = start.clone().sub(center).normalize();
    const middle = direction.clone().applyAxisAngle(axis, angle / 2).multiplyScalar(r).add(center);
    return [arc(center, direction, axis, angle, r), { tag: 'label', at: middle, away: middle.clone().sub(center), text: formatAngle(angle) }];
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

// A height read out like a gizmo's, past the top of the height from the base center and clear of the top, which spreads
// radius around it (a box's half diagonal, a cylinder's radius)
export function height(base: THREE.Vector3, direction: THREE.Vector3, h: number, radius: number): Dimension[] {
    const up = direction.clone().multiplyScalar(Math.sign(h) || 1);
    return [{ tag: 'readout', at: base.clone().addScaledVector(up, Math.abs(h)), direction: up, radius, text: formatLength(Math.abs(h)) }];
}

function arc(center: THREE.Vector3, start: THREE.Vector3, axis: THREE.Vector3, angle: number, r: number, segments = 64) {
    const points = [];
    for (let i = 0; i <= segments; i++) {
        points.push(start.clone().applyAxisAngle(axis, angle * i / segments).multiplyScalar(r).add(center));
    }
    return { tag: 'polyline' as const, points };
}
