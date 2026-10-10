import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EditorSignals } from "../editor/EditorSignals";
import { axisColors } from "../util/Constants";

const depthInfo: THREE.MaterialParameters = {
    depthTest: true,
    depthWrite: true,
    fog: false,
    toneMapped: false,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
};

export interface ActiveGizmoMaterial {
    mesh: THREE.MeshBasicMaterial;
    line2: LineMaterial;
    line: THREE.LineBasicMaterial;
}

export interface GizmoMaterial extends ActiveGizmoMaterial {
    hover: ActiveGizmoMaterial;
}

// How solid and how thick a gizmo is drawn, and on hover: handles solid with 2.5px lines, rings thinner so they sit
// behind the handles, plane squares half see-through, hints faint
type Look = { opacity: number, width: number, hoverOpacity: number, hoverWidth: number, lineOpacity?: number };
const handleLook: Look = { opacity: 1, width: 2.5, hoverOpacity: 1, hoverWidth: 3.5 };
const ringLook: Look = { opacity: 1, width: 1.75, hoverOpacity: 1, hoverWidth: 3 };
const planeLook: Look = { opacity: 0.5, width: 2.5, hoverOpacity: 0.95, hoverWidth: 3.5 };
const hintLook: Look = { opacity: 0.5, width: 1.5, hoverOpacity: 0.5, hoverWidth: 1.5, lineOpacity: 0.5 };
// The axis line shown while dragging along an axis
const guideOpacity = 0.45;

// Handles in the logo's cyan; rings light grey. The same in both themes.
const handleColor = '#00d7fe';
const ringColor = '#d4d4d8';

// A gizmo's colour, and on hover a lighter shade of it
function colors(hex: string): [THREE.Color, THREE.Color] {
    const normal = new THREE.Color(hex);
    const hover = normal.clone().lerp(new THREE.Color('#ffffff'), 0.45);
    return [normal.convertSRGBToLinear(), hover.convertSRGBToLinear()];
}

export class GizmoMaterialDatabase {

    static make(normalColor: THREE.Color, hoverColor: THREE.Color, side: THREE.Side = THREE.FrontSide, look = handleLook): GizmoMaterial {
        return {
            mesh: new THREE.MeshBasicMaterial(Object.assign({ opacity: look.opacity, color: normalColor }, depthInfo, { side })),
            line2: new LineMaterial({ ...depthInfo, color: normalColor.getHex(), opacity: look.lineOpacity ?? 1, linewidth: look.width, side }),
            line: new THREE.LineBasicMaterial({ transparent: true, opacity: guideOpacity, color: normalColor }),
            hover: {
                mesh: new THREE.MeshBasicMaterial(Object.assign({ opacity: look.hoverOpacity, color: hoverColor }, depthInfo, { side })),
                line2: new LineMaterial(Object.assign({ color: hoverColor.getHex(), opacity: look.lineOpacity ?? 1, linewidth: look.hoverWidth, }, depthInfo, { side })),
                line: new THREE.LineBasicMaterial({ transparent: true, opacity: guideOpacity, color: hoverColor }),
            }
        }
    }

    private static of(hex: string, side: THREE.Side = THREE.FrontSide, look = handleLook) {
        return GizmoMaterialDatabase.make(...colors(hex), side, look);
    }

    constructor(signals: EditorSignals) {
        signals.renderPrepared.add(({ resolution }) => this.setResolution(resolution));
    }

    readonly invisible = new THREE.MeshBasicMaterial(Object.assign({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        opacity: 0.0,
        side: THREE.DoubleSide,
    }, depthInfo));

    readonly occlude = new THREE.MeshBasicMaterial(Object.assign({
        depthWrite: true,
        transparent: true,
        opacity: 0,
    }, depthInfo));

    // Handles that set a value (distances, radii, thicknesses), and the same drawn from both sides
    readonly default = GizmoMaterialDatabase.of(handleColor);
    readonly doubleSided = GizmoMaterialDatabase.of(handleColor, THREE.DoubleSide);

    // The axes
    readonly red = GizmoMaterialDatabase.of(axisColors.x);
    readonly green = GizmoMaterialDatabase.of(axisColors.y);
    readonly blue = GizmoMaterialDatabase.of(axisColors.z);

    // Plane handles, in the colour of the axis normal to the plane: planeZ is the XY plane
    readonly planeX = GizmoMaterialDatabase.of(axisColors.x, THREE.DoubleSide, planeLook);
    readonly planeY = GizmoMaterialDatabase.of(axisColors.y, THREE.DoubleSide, planeLook);
    readonly planeZ = GizmoMaterialDatabase.of(axisColors.z, THREE.DoubleSide, planeLook);

    // Angle and screen-space rings, and the snap ring
    readonly ring = GizmoMaterialDatabase.of(ringColor, THREE.FrontSide, ringLook);

    // Where a handle can be dragged to
    readonly hint = GizmoMaterialDatabase.of(handleColor, THREE.FrontSide, hintLook);

    // A quirk of three.js is that to render lines with any thickness, you need to use
    // a LineMaterial whose resolution must be set before each render
    setResolution = (size: THREE.Vector2) => {
        const width = size.x, height = size.y;
        for (const color of this.all) {
            color.line2.resolution.set(width, height);
            color.hover.line2.resolution.set(width, height);
        }
    }

    get all() {
        return [this.default, this.doubleSided, this.red, this.green, this.blue, this.planeX, this.planeY, this.planeZ, this.ring, this.hint];
    }
}
