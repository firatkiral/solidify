import { strToU8, Zippable, zipSync } from 'fflate';
import { PrintMesh } from './PrintMesh';

// Writers for the mesh formats slicers read. Meshes are in millimetres; a file in inches has its positions divided by 25.4.

export type LengthUnit = 'mm' | 'in';

const scaleFor = (unit: LengthUnit) => unit === 'in' ? 1 / 25.4 : 1;

// Binary STL: no units (slicers take millimetres), every triangle on its own, with its normal
export function writeStl(meshes: readonly PrintMesh[], unit: LengthUnit = 'mm'): Uint8Array {
    const scale = scaleFor(unit);
    const count = meshes.reduce((n, m) => n + m.triangles.length / 3, 0);
    const buffer = new ArrayBuffer(84 + 50 * count);
    const view = new DataView(buffer);
    new Uint8Array(buffer).set(strToU8(`Solidify STL, ${unit === 'in' ? 'inches' : 'millimetres'}`.slice(0, 80)));
    view.setUint32(80, count, true);
    let offset = 84;
    for (const { positions: p, triangles } of meshes) {
        for (let t = 0; t < triangles.length; t += 3) {
            const a = 3 * triangles[t], b = 3 * triangles[t + 1], c = 3 * triangles[t + 2];
            const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
            const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const length = Math.hypot(nx, ny, nz) || 1;
            nx /= length; ny /= length; nz /= length;
            for (const value of [nx, ny, nz]) { view.setFloat32(offset, value, true); offset += 4 }
            for (const v of [a, b, c]) {
                for (let k = 0; k < 3; k++) { view.setFloat32(offset, p[v + k] * scale, true); offset += 4 }
            }
            view.setUint16(offset, 0, true); offset += 2;
        }
    }
    return new Uint8Array(buffer);
}

const number = (x: number) => String(+x.toFixed(6));
const escape = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));

export interface ThreeMFOptions {
    readonly unit?: LengthUnit;
    // One object for each mesh, or all of them as one
    readonly separate?: boolean;
    readonly title?: string;
    readonly application?: string;
    // A PNG, which slicers show for the file
    readonly thumbnail?: Uint8Array;
}

// 3MF: a zip with the model as XML, which has its unit, the objects' names, and a thumbnail
export function write3mf(meshes: readonly PrintMesh[], options: ThreeMFOptions = {}): Uint8Array {
    const { unit = 'mm', separate = true, title, application, thumbnail } = options;
    const scale = scaleFor(unit);
    const objects = separate || meshes.length <= 1 ? meshes : [merge(meshes, title ?? 'Model')];

    const xml: string[] = [];
    xml.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    xml.push(`<model unit="${unit === 'in' ? 'inch' : 'millimeter'}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`);
    if (title !== undefined) xml.push(` <metadata name="Title">${escape(title)}</metadata>`);
    if (application !== undefined) xml.push(` <metadata name="Application">${escape(application)}</metadata>`);
    xml.push(` <resources>`);
    objects.forEach(({ name, positions, triangles }, i) => {
        xml.push(`  <object id="${i + 1}" name="${escape(name)}" type="model">`);
        xml.push(`   <mesh>`);
        xml.push(`    <vertices>`);
        for (let v = 0; v < positions.length; v += 3) {
            xml.push(`     <vertex x="${number(positions[v] * scale)}" y="${number(positions[v + 1] * scale)}" z="${number(positions[v + 2] * scale)}"/>`);
        }
        xml.push(`    </vertices>`);
        xml.push(`    <triangles>`);
        for (let t = 0; t < triangles.length; t += 3) {
            xml.push(`     <triangle v1="${triangles[t]}" v2="${triangles[t + 1]}" v3="${triangles[t + 2]}"/>`);
        }
        xml.push(`    </triangles>`);
        xml.push(`   </mesh>`);
        xml.push(`  </object>`);
    });
    xml.push(` </resources>`);
    xml.push(` <build>`);
    objects.forEach((_, i) => xml.push(`  <item objectid="${i + 1}"/>`));
    xml.push(` </build>`);
    xml.push(`</model>`);

    const relationships = [`  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`];
    if (thumbnail !== undefined) relationships.push(`  <Relationship Target="/Metadata/thumbnail.png" Id="rel1" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>`);
    const entries: Zippable = {
        '[Content_Types].xml': strToU8([
            `<?xml version="1.0" encoding="UTF-8"?>`,
            `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`,
            ` <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
            ` <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>`,
            ` <Default Extension="png" ContentType="image/png"/>`,
            `</Types>`].join('\n')),
        '_rels/.rels': strToU8([
            `<?xml version="1.0" encoding="UTF-8"?>`,
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
            ...relationships,
            `</Relationships>`].join('\n')),
        '3D/3dmodel.model': strToU8(xml.join('\n')),
    };
    if (thumbnail !== undefined) entries['Metadata/thumbnail.png'] = [thumbnail, { level: 0 }];
    return zipSync(entries, { level: 6 });
}

export interface ObjOptions {
    readonly unit?: LengthUnit;
    readonly separate?: boolean;
}

// Wavefront OBJ: no units, and every mesh an object of its own, or all of them as one
export function writeObj(meshes: readonly PrintMesh[], options: ObjOptions = {}): Uint8Array {
    const { unit = 'mm', separate = true } = options;
    const scale = scaleFor(unit);
    const lines = [`# Solidify, ${unit === 'in' ? 'inches' : 'millimetres'}`];
    let base = 1;
    meshes.forEach(({ name, positions, triangles }, i) => {
        if (separate || i === 0) lines.push(`o ${separate ? name.replace(/\s+/g, '_') : 'Model'}`);
        for (let v = 0; v < positions.length; v += 3) {
            lines.push(`v ${number(positions[v] * scale)} ${number(positions[v + 1] * scale)} ${number(positions[v + 2] * scale)}`);
        }
        for (let t = 0; t < triangles.length; t += 3) {
            lines.push(`f ${triangles[t] + base} ${triangles[t + 1] + base} ${triangles[t + 2] + base}`);
        }
        base += positions.length / 3;
    });
    return strToU8(lines.join('\n') + '\n');
}

function merge(meshes: readonly PrintMesh[], name: string): PrintMesh {
    const positions = new Float32Array(meshes.reduce((n, m) => n + m.positions.length, 0));
    const triangles = new Uint32Array(meshes.reduce((n, m) => n + m.triangles.length, 0));
    let p = 0, t = 0;
    for (const mesh of meshes) {
        const base = p / 3;
        positions.set(mesh.positions, p);
        for (let i = 0; i < mesh.triangles.length; i++) triangles[t + i] = mesh.triangles[i] + base;
        p += mesh.positions.length;
        t += mesh.triangles.length;
    }
    return { name, positions, triangles };
}
