// Curves whose coordinates are formulas of a parameter.

import { SpaceType } from './constants';
import { CubicSpline } from './curve2d';
import { Curve3D } from './curve3d';
import { CartPoint, CartPoint3D, Matrix3D, Placement3D } from './math';
import { KFunction } from './misc';

type Evaluate = (t: number) => number;

const functions: Record<string, (...args: number[]) => number> = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10,
    sqrt: Math.sqrt, abs: Math.abs, pow: Math.pow, min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil,
    sign: Math.sign, sqr: (x: number) => x * x,
};
const constants: Record<string, number> = { pi: Math.PI, e: Math.E };

// Parses a formula of one argument: numbers, + - * / and ^ (power), parentheses, the constants pi and e, and the
// functions above. Throws on anything else.
export function parseFormula(text: string, argument: string): Evaluate {
    const tokens = text.match(/\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|\*\*|[-+*/^(),]|\S/g) ?? [];
    let i = 0;
    const peek = () => tokens[i], next = () => tokens[i++];
    const expect = (s: string) => { if (next() !== s) throw new Error(`Expected ${s}`) };

    const sum = (): Evaluate => {
        let left = product();
        while (peek() === '+' || peek() === '-') {
            const op = next(), a = left, b = product();
            left = op === '+' ? t => a(t) + b(t) : t => a(t) - b(t);
        }
        return left;
    };
    const product = (): Evaluate => {
        let left = unary();
        while (peek() === '*' || peek() === '/') {
            const op = next(), a = left, b = unary();
            left = op === '*' ? t => a(t) * b(t) : t => a(t) / b(t);
        }
        return left;
    };
    const unary = (): Evaluate => {
        if (peek() === '-') { next(); const a = unary(); return t => -a(t) }
        if (peek() === '+') { next(); return unary() }
        return power();
    };
    const power = (): Evaluate => {
        const base = atom();
        if (peek() === '^' || peek() === '**') { next(); const exponent = unary(); return t => Math.pow(base(t), exponent(t)) }
        return base;
    };
    const atom = (): Evaluate => {
        const token = next();
        if (token === undefined) throw new Error("Unexpected end of formula");
        if (token === '(') { const a = sum(); expect(')'); return a }
        if (/^[\d.]/.test(token)) { const v = Number(token); if (Number.isNaN(v)) throw new Error(`Bad number ${token}`); return () => v }
        if (/^[A-Za-z_]/.test(token)) {
            if (token === argument) return t => t;
            const fn = functions[token.toLowerCase()];
            if (fn !== undefined && peek() === '(') {
                next();
                const args: Evaluate[] = [];
                if (peek() !== ')') { args.push(sum()); while (peek() === ',') { next(); args.push(sum()) } }
                expect(')');
                return t => fn(...args.map(a => a(t)));
            }
            const c = constants[token.toLowerCase()];
            if (c !== undefined) return () => c;
        }
        throw new Error(`Unexpected ${token}`);
    };

    const result = sum();
    if (i < tokens.length) throw new Error(`Unexpected ${tokens[i]}`);
    return result;
}

// A function given by a formula, kept as text so it can be saved.
export class AnalyticalFunction extends KFunction {
    private readonly evaluate: Evaluate;
    constructor(readonly text: string, readonly argument: string, readonly tmin: number, readonly tmax: number) {
        super();
        this.evaluate = parseFormula(text, argument);
    }
    value(t: number) { return this.evaluate(t) }
}

export class FunctionFactory {
    // null if the formula cannot be read or has no value anywhere in the range
    CreateAnalyticalFunction(data: string, argument: string, tmin: number, tmax: number): AnalyticalFunction | null {
        try {
            const f = new AnalyticalFunction(data, argument, tmin, tmax);
            for (let i = 0; i <= 8; i++) if (Number.isFinite(f.value(tmin + (tmax - tmin) * i / 8))) return f;
            return null;
        } catch (e) {
            return null;
        }
    }
}

const LocalSystem = { Cartesian: 0, Cylindrical: 1, Spherical: 2 };

// The point (x(t), y(t), z(t)) in a placement: Cartesian, cylindrical (radius, angle, height) or spherical (radius,
// angle around Z, angle up from the XY plane) coordinates.
export class CharacterCurve3D extends Curve3D {
    matrix = new Matrix3D();
    sense = 1;

    constructor(readonly x: AnalyticalFunction, readonly y: AnalyticalFunction, readonly z: AnalyticalFunction, readonly system: number, readonly placement: Placement3D, readonly t1: number, readonly t2: number) {
        super();
    }

    IsA(): number { return SpaceType.CharacterCurve3D }
    get tmin() { return this.t1 }
    get tmax() { return this.t2 }
    IsClosed() { return this._PointOn(this.t1).distanceTo(this._PointOn(this.t2)) < 1e-6 }
    IsPeriodic() { return false }

    _PointOn(t: number): CartPoint3D {
        const u = this.sense > 0 ? t : this.t1 + this.t2 - t;
        const a = this.x.value(u), b = this.y.value(u), c = this.z.value(u);
        let local: [number, number, number];
        switch (this.system) {
            case LocalSystem.Cylindrical: local = [a * Math.cos(b), a * Math.sin(b), c]; break;
            case LocalSystem.Spherical: local = [a * Math.cos(c) * Math.cos(b), a * Math.cos(c) * Math.sin(b), a * Math.sin(c)]; break;
            default: local = [a, b, c];
        }
        return this.matrix.applyPoint(this.placement.GetPointFrom(...local));
    }

    Inverse() { this.sense = -this.sense }
    Transform(m: Matrix3D) { this.matrix = Matrix3D.fromRows(this.matrix.m).multiply(m) }

    Duplicate(): CharacterCurve3D {
        const result = new CharacterCurve3D(this.x, this.y, this.z, this.system, new Placement3D(this.placement), this.t1, this.t2);
        result.matrix = Matrix3D.fromRows(this.matrix.m);
        result.sense = this.sense;
        return result;
    }

    samples(_sag: number) {
        const n = 256, result = [];
        for (let i = 0; i <= n; i++) result.push(this.t1 + (this.t2 - this.t1) * i / n);
        return result;
    }

    // In a plane, the curve is approximated by a spline through its sample points.
    to2d(place: Placement3D) {
        const points = this.samples(0).map(t => { const p = place.PointProjection(this._PointOn(t)); return new CartPoint(p.x, p.y) });
        const closed = this.IsClosed();
        if (closed) points.pop();
        return new CubicSpline(points, closed);
    }
}
