import { AnalyticalFunction, CharacterCurve3D } from './character';
import { Arc, Bezier, Contour, CubicSpline, Curve, Hermit, Line, LineSegment, Nurbs, Polyline, Region, Spline, TrimmedCurve } from './curve2d';
import { Arc3D, Bezier3D, ConeSpiral, Contour3D, CubicSpline3D, Curve3D, Hermit3D, Line3D, LineSegment3D, Nurbs3D, PlaneCurve, Polyline3D, Spline3D, TrimmedCurve3D } from './curve3d';
import { Item, SpaceItem } from './base';
import { Model, PlaneInstance, SpaceInstance } from './items';
import { CartPoint, CartPoint3D, Matrix3D, Placement3D, Vector3D } from './math';
import { oc } from './occt';
import { Solid } from './solid';
import { Creator, extend } from './history';

// The document format of the OCCT kernel: JSON with curves described by their definitions and solids as BREP text.

type Json = any;

const p2 = (p: { x: number, y: number }) => [p.x, p.y];
const p3 = (p: { x: number, y: number, z: number }) => [p.x, p.y, p.z];
const toP2 = (a: number[]) => new CartPoint(a[0], a[1]);
const toP3 = (a: number[]) => new CartPoint3D(a[0], a[1], a[2]);
const toV3 = (a: number[]) => new Vector3D(a[0], a[1], a[2]);

function placement(p: Placement3D): Json {
    return { o: p3(p.origin), x: p3(p.axisX), y: p3(p.axisY), z: p3(p.axisZ) };
}

function toPlacement(j: Json): Placement3D {
    const p = new Placement3D();
    p.origin = toP3(j.o); p.axisX = toV3(j.x); p.axisY = toV3(j.y); p.axisZ = toV3(j.z);
    return p;
}

function curve2d(c: Curve): Json {
    if (c instanceof LineSegment) return { k: 'LineSegment', a: p2(c.p1), b: p2(c.p2) };
    if (c instanceof Line) return { k: 'Line', a: p2(c.p1), b: p2(c.p2) };
    if (c instanceof Polyline) return { k: 'Polyline', points: c.points.map(p2), closed: c.closed };
    if (c instanceof Hermit) return { k: 'Hermit', points: c.points.map(p2), closed: c.closed, data: c.data };
    if (c instanceof Spline) return { k: c.constructor.name, points: c.points.map(p2), closed: c.closed };
    if (c instanceof Arc) return { k: 'Arc', c: p2(c.c), a: c.a, b: c.b, u: p2(c.u), v: p2(c.v), t1: c.t1, t2: c.t2, closed: c.closed };
    if (c instanceof Contour) return { k: 'Contour', segments: c.segments.map(curve2d), closed: c.IsClosed() };
    if (c instanceof TrimmedCurve) return { k: 'TrimmedCurve', basis: curve2d(c.basis), t1: c.t1, t2: c.t2, sense: c.sense };
    throw new Error(`Saving ${c.constructor.name} is not implemented by the OCCT kernel`);
}

function toCurve2d(j: Json): Curve {
    switch (j.k) {
        case 'LineSegment': return new LineSegment(toP2(j.a), toP2(j.b));
        case 'Line': return new Line(toP2(j.a), toP2(j.b));
        case 'Polyline': return new Polyline(j.points.map(toP2), j.closed);
        case 'Hermit': return new Hermit(j.points.map(toP2), j.closed, j.data);
        case 'CubicSpline': return new CubicSpline(j.points.map(toP2), j.closed);
        case 'Bezier': return new Bezier(j.points.map(toP2), j.closed);
        case 'Nurbs': return new Nurbs(j.points.map(toP2), j.closed);
        case 'Arc': return Arc.make(toP2(j.c), j.a, j.b, toP2(j.u), toP2(j.v), j.t1, j.t2, j.closed);
        case 'Contour': { const c = new Contour(j.segments.map(toCurve2d), true); c.InitClosed(j.closed); return c }
        case 'TrimmedCurve': return new TrimmedCurve(toCurve2d(j.basis), j.t1, j.t2, j.sense);
    }
    throw new Error(`Unknown curve ${j.k}`);
}

function curve3d(c: Curve3D): Json {
    if (c instanceof LineSegment3D) return { k: 'LineSegment3D', a: p3(c.p1), b: p3(c.p2) };
    if (c instanceof Line3D) return { k: 'Line3D', a: p3(c.p1), b: p3(c.p2) };
    if (c instanceof Polyline3D) return { k: 'Polyline3D', points: c.points.map(p3), closed: c.closed };
    if (c instanceof Hermit3D) return { k: 'Hermit3D', points: c.points.map(p3), closed: c.closed, data: c.data };
    if (c instanceof Spline3D) return { k: c.constructor.name, points: c.points.map(p3), closed: c.closed };
    if (c instanceof Arc3D) return { k: 'Arc3D', placement: placement(c.placement), a: c.a, b: c.b, t1: c.t1, t2: c.t2, closed: c.closed };
    if (c instanceof CharacterCurve3D) {
        const fn = (f: AnalyticalFunction) => ({ text: f.text, argument: f.argument, tmin: f.tmin, tmax: f.tmax });
        return { k: 'CharacterCurve3D', x: fn(c.x), y: fn(c.y), z: fn(c.z), system: c.system, placement: placement(c.placement), t1: c.t1, t2: c.t2, matrix: c.matrix.m, sense: c.sense };
    }
    if (c instanceof ConeSpiral) return { k: 'ConeSpiral', o: p3(c.origin), x: p3(c.X), y: p3(c.Y), z: p3(c.Z), radius: c.radius, step: c.step, tg: c.tgAlpha, t2: c.t2 };
    if (c instanceof PlaneCurve) return { k: 'PlaneCurve', placement: placement(c.placement), curve: curve2d(c.curve) };
    if (c instanceof Contour3D) return { k: 'Contour3D', segments: c.segments.map(curve3d) };
    if (c instanceof TrimmedCurve3D) return { k: 'TrimmedCurve3D', basis: curve3d(c.basis), t1: c.t1, t2: c.t2, sense: c.sense };
    throw new Error(`Saving ${c.constructor.name} is not implemented by the OCCT kernel`);
}

function toCurve3d(j: Json): Curve3D {
    switch (j.k) {
        case 'LineSegment3D': return new LineSegment3D(toP3(j.a), toP3(j.b));
        case 'Line3D': return new Line3D(toP3(j.a), toP3(j.b));
        case 'Polyline3D': return new Polyline3D(j.points.map(toP3), j.closed);
        case 'Hermit3D': return new Hermit3D(j.points.map(toP3), j.closed, j.data);
        case 'CubicSpline3D': return new CubicSpline3D(j.points.map(toP3), j.closed);
        case 'Bezier3D': return new Bezier3D(j.points.map(toP3), j.closed);
        case 'Nurbs3D': return new Nurbs3D(j.points.map(toP3), j.closed);
        case 'Arc3D': {
            const arc = new Arc3D();
            arc.placement = toPlacement(j.placement);
            arc.a = j.a; arc.b = j.b; arc.t1 = j.t1; arc.t2 = j.t2; arc.closed = j.closed;
            return arc;
        }
        case 'ConeSpiral': {
            const spiral = new ConeSpiral();
            spiral.origin = toP3(j.o); spiral.X = toV3(j.x); spiral.Y = toV3(j.y); spiral.Z = toV3(j.z);
            spiral.radius = j.radius; spiral.step = j.step; spiral.tgAlpha = j.tg; spiral.t2 = j.t2;
            return spiral;
        }
        case 'CharacterCurve3D': {
            const fn = (f: Json) => new AnalyticalFunction(f.text, f.argument, f.tmin, f.tmax);
            const curve = new CharacterCurve3D(fn(j.x), fn(j.y), fn(j.z), j.system, toPlacement(j.placement), j.t1, j.t2);
            curve.matrix = Matrix3D.fromRows(j.matrix);
            curve.sense = j.sense;
            return curve;
        }
        case 'PlaneCurve': return new PlaneCurve(toPlacement(j.placement), toCurve2d(j.curve), true);
        case 'Contour3D': return Contour3D.of(j.segments.map(toCurve3d));
        case 'TrimmedCurve3D': return new TrimmedCurve3D(toCurve3d(j.basis), j.t1, j.t2, j.sense);
    }
    throw new Error(`Unknown curve ${j.k}`);
}

function item(i: Item): Json | undefined {
    const base = { name: i.GetItemName(), style: i.GetStyle() };
    if (i instanceof Solid) {
        const history = i.creators.map(c => ({ type: c.IsA(), status: c.GetStatus(), matrix: c.matrix.m, brep: oc.BRepToolsWrapper.Write(c.snapshot) }));
        return { ...base, k: 'Solid', brep: oc.BRepToolsWrapper.Write(i.shape), history, numbering: i.numbering };
    }
    if (i instanceof SpaceInstance) {
        const space = i.GetSpaceItem();
        if (space instanceof Curve3D) return { ...base, k: 'SpaceInstance', curve: curve3d(space) };
    }
    if (i instanceof PlaneInstance) {
        const regions = [];
        for (let k = 0; k < i.PlaneItemsCount(); k++) {
            const region = i.GetPlaneItem(k);
            if (!(region instanceof Region)) return skipped(i);
            regions.push(region.contours.map(curve2d));
        }
        return { ...base, k: 'PlaneInstance', placement: placement(i.GetPlacement()), regions };
    }
    return skipped(i);
}

function skipped(i: Item) {
    console.warn(`Saving ${i.constructor.name} is not implemented by the OCCT kernel; it was skipped`);
    return undefined;
}

function toItem(j: Json): Item {
    let result: Item;
    switch (j.k) {
        case 'Solid': {
            const solid = new Solid(oc.BRepToolsWrapper.Read(j.brep));
            let creators: Creator[] = [];
            for (const h of j.history ?? []) {
                creators = extend(creators, h.type, [], oc.BRepToolsWrapper.Read(h.brep));
                const last = creators[creators.length - 1];
                last.SetStatus(h.status); last.matrix = Matrix3D.fromRows(h.matrix);
            }
            solid.creators = creators;
            solid.numbering = j.numbering;
            result = solid;
            break;
        }
        case 'SpaceInstance': result = new SpaceInstance(toCurve3d(j.curve) as SpaceItem); break;
        case 'PlaneInstance': {
            const [first, ...rest] = j.regions.map((contours: Json[]) => new Region(contours.map(c => toCurve2d(c) as Contour)));
            const instance = new PlaneInstance(first, toPlacement(j.placement));
            for (const region of rest) instance.AddPlaneItem(region);
            result = instance;
            break;
        }
        default: throw new Error(`Unknown item ${j.k}`);
    }
    result.SetItemName(j.name);
    result.SetStyle(j.style);
    return result;
}

const MAGIC = 'solidify-occt';

export function writeItems(model: Model): { size: number, memory: Uint8Array } {
    const items = model.GetItems().map(item).filter(i => i !== undefined);
    const memory = new TextEncoder().encode(JSON.stringify({ format: MAGIC, version: 1, items }));
    return { size: memory.length, memory };
}

export function readItems(memory: Uint8Array): Model {
    const json = JSON.parse(new TextDecoder().decode(memory));
    if (json.format !== MAGIC) throw new Error("Not a document saved by the OCCT kernel");
    const model = new Model();
    for (const j of json.items) model.AddItem(toItem(j), j.name);
    return model;
}
