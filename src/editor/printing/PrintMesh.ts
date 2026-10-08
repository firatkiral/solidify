// Meshes for 3D printing: one per solid, with positions in millimetres and vertices shared between triangles, as a
// watertight mesh needs.

export interface PrintMesh {
    readonly name: string;
    readonly positions: Float32Array;
    readonly triangles: Uint32Array;
}

// The kernel triangulates each face on its own, but neighbouring faces share their edges' points exactly,
// so vertices at the same place are made one
export function weld(name: string, positions: Float32Array, triangles: Uint32Array): PrintMesh {
    const index = new Map<string, number>();
    const remap = new Uint32Array(positions.length / 3);
    const welded: number[] = [];
    for (let i = 0; i < remap.length; i++) {
        const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
        const key = `${x},${y},${z}`;
        let j = index.get(key);
        if (j === undefined) {
            j = welded.length / 3;
            index.set(key, j);
            welded.push(x, y, z);
        }
        remap[i] = j;
    }
    // Triangles that collapse to a line or a point are dropped
    const kept: number[] = [];
    for (let t = 0; t < triangles.length; t += 3) {
        const a = remap[triangles[t]], b = remap[triangles[t + 1]], c = remap[triangles[t + 2]];
        if (a === b || b === c || c === a) continue;
        kept.push(a, b, c);
    }
    return { name, positions: new Float32Array(welded), triangles: new Uint32Array(kept) };
}

export interface MeshReport {
    readonly triangles: number;
    // Edges of only one triangle: holes, so the mesh isn't watertight
    readonly openEdges: number;
    // Edges of more than two triangles, which slicers can't make sense of
    readonly nonManifoldEdges: number;
    // In cubic millimetres; negative when the triangles face inwards
    readonly volume: number;
}

export function report({ positions, triangles }: PrintMesh): MeshReport {
    const edges = new Map<string, number>();
    let volume = 0;
    for (let t = 0; t < triangles.length; t += 3) {
        const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
        for (const [p, q] of [[a, b], [b, c], [c, a]]) {
            const key = p < q ? `${p},${q}` : `${q},${p}`;
            edges.set(key, (edges.get(key) ?? 0) + 1);
        }
        volume += signedVolume(positions, a, b, c);
    }
    let openEdges = 0, nonManifoldEdges = 0;
    for (const count of edges.values()) {
        if (count === 1) openEdges++;
        else if (count > 2) nonManifoldEdges++;
    }
    return { triangles: triangles.length / 3, openEdges, nonManifoldEdges, volume };
}

// Of the tetrahedron from the origin to the triangle
function signedVolume(p: Float32Array, a: number, b: number, c: number) {
    const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
    const bx = p[3 * b], by = p[3 * b + 1], bz = p[3 * b + 2];
    const cx = p[3 * c], cy = p[3 * c + 1], cz = p[3 * c + 2];
    return (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
}

export interface Bounds {
    readonly min: [number, number, number];
    readonly max: [number, number, number];
}

export function bounds(meshes: readonly PrintMesh[]): Bounds | undefined {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const { positions } of meshes) {
        for (let i = 0; i < positions.length; i++) {
            const k = i % 3;
            if (positions[i] < min[k]) min[k] = positions[i];
            if (positions[i] > max[k]) max[k] = positions[i];
        }
    }
    return min[0] === Infinity ? undefined : { min, max };
}
