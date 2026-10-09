import * as THREE from 'three';
import * as visual from "../../visual_model/VisualModel";
import { ProxyCamera } from './ProxyCamera';

// In millimeters: how wide the grid is and the distance between its lines; every majorEvery steps the line is heavier.
export interface GridSpec {
    readonly size: number;
    readonly step: number;
    readonly majorEvery: number;
}

// Lines in the XY plane, every step out to the last one within size / 2 each way, so they always pass through the origin
export function gridLines({ size, step, majorEvery }: GridSpec): { minor: number[], major: number[] } {
    const count = Math.floor(size / 2 / step + 1e-9);
    const extent = count * step;
    const minor: number[] = [], major: number[] = [];
    for (let i = -count; i <= count; i++) {
        const at = i * step;
        const lines = i % majorEvery === 0 ? major : minor;
        lines.push(at, -extent, 0, at, extent, 0);
        lines.push(-extent, at, 0, extent, at, 0);
    }
    return { minor, major };
}

// Lines this many pixels apart or fewer are hidden; they fade in until they're fadedIn pixels apart
const crowded = 4, fadedIn = 12;

abstract class Grid extends THREE.Group {
    protected readonly minor: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
    protected readonly major: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;

    constructor(readonly spec: GridSpec, protected readonly color1: THREE.Color, protected readonly color2: THREE.Color) {
        super();
        const { minor, major } = gridLines(spec);
        this.minor = this.makeLines(minor, color1);
        this.major = this.makeLines(major, color2);
        this.add(this.minor, this.major);
        this.layers.set(visual.Layers.Overlay);
    }

    private makeLines(positions: number[], color: THREE.Color) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({ color });
        material.fog = true;
        this.configure(material);
        return new THREE.LineSegments(geometry, material);
    }

    protected abstract configure(material: THREE.LineBasicMaterial): void;

    dispose() {
        for (const lines of [this.minor, this.major]) {
            lines.geometry.dispose();
            lines.material.dispose();
        }
        this.removeFromParent();
    }

    // 0 while lines step millimeters apart look crowded on screen, rising to 1 once they're clearly apart
    protected fade(step: number, camera: THREE.Camera) {
        const height = camera instanceof ProxyCamera ? camera.offsetHeight : 1000;
        let visibleHeight;
        if (ProxyCamera.isOrthographic(camera)) {
            visibleHeight = (camera.top - camera.bottom) / camera.zoom;
        } else if (ProxyCamera.isPerspective(camera)) {
            const distance = camera.position.distanceTo(camera instanceof ProxyCamera ? camera.target : this.position);
            visibleHeight = 2 * distance * Math.tan(Math.PI * camera.fov / 360);
        } else throw new Error("invalid camera type");
        const pixels = step * height / visibleHeight;
        return THREE.MathUtils.clamp((pixels - crowded) / (fadedIn - crowded), 0, 1);
    }
}

// Behind orthographic views: drawn first, with colors blending into the background rather than transparency
export class OrthoModeGrid extends Grid {
    constructor(spec: GridSpec, color1: THREE.Color, color2: THREE.Color, private readonly backgroundColor: THREE.Color) {
        super(spec, color1, color2);
        this.renderOrder = -1;
    }

    protected configure(material: THREE.LineBasicMaterial) {
        material.depthWrite = false;
        material.depthFunc = THREE.NeverDepth;
    }

    update(camera: THREE.Camera) {
        const { minor, major, spec, backgroundColor, color1, color2 } = this;
        const minorFade = this.fade(spec.step, camera);
        const majorFade = this.fade(spec.step * spec.majorEvery, camera);
        minor.material.color.lerpColors(backgroundColor, color1, minorFade);
        major.material.color.lerpColors(backgroundColor, color2, majorFade);
        minor.visible = minorFade > 0;
        major.visible = majorFade > 0;
        this.updateMatrixWorld();
    }
}

// On a plane seen in perspective: fading as the plane turns edge-on
export class FloorHelper extends Grid {
    protected configure(material: THREE.LineBasicMaterial) {
        material.transparent = true;
    }

    private readonly normal = new THREE.Vector3();
    private readonly eye = new THREE.Vector3();
    update(camera: THREE.Camera) {
        const { normal, eye, minor, major, spec } = this;

        normal.set(0, 0, 1).applyQuaternion(this.quaternion);
        eye.set(0, 0, 1).applyQuaternion(camera.quaternion);
        const dot = normal.dot(eye);
        const facing = dot * dot;
        minor.material.opacity = facing * this.fade(spec.step, camera);
        major.material.opacity = facing * this.fade(spec.step * spec.majorEvery, camera);
        minor.visible = minor.material.opacity > 0;
        major.visible = major.material.opacity > 0;
        this.updateMatrixWorld();
    }
}

// On a construction plane other than the floor
export class CustomGrid extends FloorHelper { }
