// Bridge curves: a single Bézier curve from a point on one curve to a point on another that matches each curve there
// up to G0, G1, G2 or G3 (position, tangent, curvature, rate of change of curvature).

import { Bezier3D, Curve3D, Derivatives } from './curve3d';
import { CartPoint3D, dot, Vector3D } from './math';
import { KernelError } from './solid';

export interface BlendEnd {
    curve: Curve3D;
    t: number;
    // Which way along the curve's parameter the bridge heads off. The curve on the other side of t is the part the
    // bridge continues (and what trimming keeps).
    sense: number;
    // 0–3 for G0–G3
    continuity: number;
    // How far the bridge follows the curve's direction: scales the first control point's distance from the end
    tension1: number;
    // Scales the second control point's offset along the tangent; the curvature at the end stays the same
    tension2: number;
}

const MIN_TENSION = 0.01;

type P3 = { x: number, y: number, z: number };
const add = (a: P3, b: P3) => new Vector3D(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: P3, b: P3) => new Vector3D(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a: P3, s: number) => new Vector3D(a.x * s, a.y * s, a.z * s);
const norm = (a: P3) => Math.hypot(a.x, a.y, a.z);

export function blendCurve(start: BlendEnd, end: BlendEnd): Bezier3D {
    const a = local(start), b = local(end);
    const chord = norm(sub(a.point, b.point));
    if (chord < 1e-9) throw new KernelError("The ends of the bridge coincide");
    const n = a.continuity + b.continuity + 1;
    const poles = [...endPoles(a, n, chord), ...endPoles(b, n, chord).reverse()];
    return new Bezier3D(poles, false);
}

interface Local {
    point: CartPoint3D;
    // The curve's derivatives heading away from the attach point, with respect to w = sense·(t' − t)
    c1: Vector3D; c2: Vector3D; c3: Vector3D;
    speed: number;
    continuity: number;
    tension1: number; tension2: number;
}

function local(end: BlendEnd): Local {
    const s = end.sense < 0 ? -1 : 1;
    // Derivatives of the part the bridge continues
    const [point, d1, d2, d3]: Derivatives = end.curve.derivatives(end.t, -s);
    const c1 = scale(d1, s), c3 = scale(d3, s);
    const speed = norm(c1);
    let continuity = Math.max(0, Math.min(3, Math.round(end.continuity)));
    // Without a direction there, only the position can be matched
    if (speed < 1e-12) continuity = 0;
    return { point, c1, c2: d2, c3, speed, continuity, tension1: Math.max(MIN_TENSION, end.tension1), tension2: end.tension2 };
}

// The control points at one end of a degree-n Bézier, from the end inwards. The bridge, seen from this end with its
// parameter v, follows the curve reparametrized by w = φ(v) with φ'(0) = α, φ''(0) = β, φ'''(0) = 0: its derivatives are
// those of the curve composed with φ, which makes it G^k there for any α > 0 and β.
function endPoles(end: Local, n: number, chord: number): Vector3D[] {
    const { point: P, c1, c2, c3, speed, continuity: k, tension1, tension2 } = end;
    const poles = [new Vector3D(P.x, P.y, P.z)];
    if (k === 0) return poles;

    // At tension 1, the bridge leaves at the speed of a straight line across the gap
    const alpha = tension1 * chord / speed;
    const Q1 = add(P, scale(c1, alpha / n));
    poles.push(Q1);
    if (k === 1) return poles;

    // From the curvature with β = 0, then slid along the tangent by tension 2 (which is what β does)
    const T = scale(c1, 1 / speed);
    const nn1 = n * (n - 1);
    const Q2plain = add(sub(scale(Q1, 2), P), scale(c2, alpha * alpha / nn1));
    const shift = (tension2 - 1) * dot(sub(Q2plain, Q1), T);
    const Q2 = add(Q2plain, scale(T, shift));
    poles.push(Q2);
    if (k === 2) return poles;

    const beta = nn1 * shift / speed;
    const E3 = add(scale(c3, alpha * alpha * alpha), scale(c2, 3 * alpha * beta));
    const Q3 = add(add(sub(scale(Q2, 3), scale(Q1, 3)), P), scale(E3, 1 / (nn1 * (n - 2))));
    poles.push(Q3);
    return poles;
}
