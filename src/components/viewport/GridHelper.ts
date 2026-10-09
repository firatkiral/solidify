import * as THREE from 'three';
import { PlaneDatabase } from '../../editor/PlaneDatabase';
import { ConstructionPlane } from '../../editor/snaps/ConstructionPlaneSnap';
import { CustomGrid, FloorHelper, GridSpec, OrthoModeGrid } from './FloorHelper';

// The most lines a grid has each way; a finer step widens to size / maxGridLines
export const maxGridLines = 2000;

// The grid drawn on the floor, on other construction planes, and behind orthographic views. Its size and step come from
// Settings › Units & grid; snapping to the grid has a step of its own (SnapManager.gridStep).
export class GridHelper {
    private floor!: FloorHelper;
    private gridBackground!: OrthoModeGrid;
    private customGrid!: CustomGrid;

    constructor(private spec: GridSpec, private readonly color1: THREE.Color, private readonly color2: THREE.Color, private readonly backgroundColor: THREE.Color) {
        this.build();
    }

    private build() {
        const { spec, color1, color2, backgroundColor } = this;
        this.gridBackground = new OrthoModeGrid(spec, color1, color2, backgroundColor);
        this.customGrid = new CustomGrid(spec, color1, color2);
        this.floor = new FloorHelper(spec, color1, color2);
    }

    // After the colors it was made with changed
    recolor() {
        for (const grid of [this.gridBackground, this.customGrid, this.floor]) grid.recolor();
    }

    // Rebuilds the grids when the size, step or heavier-line rhythm changed
    setSpec(spec: GridSpec) {
        const { size, step, majorEvery } = this.spec;
        if (spec.size === size && spec.step === step && spec.majorEvery === majorEvery) return;
        this.spec = spec;
        this.gridBackground.dispose();
        this.customGrid.dispose();
        this.floor.dispose();
        this.build();
    }

    getOverlay(isOrthoMode: boolean, constructionPlane: ConstructionPlane, camera: THREE.Camera): THREE.Object3D {
        const { floor, gridBackground, customGrid } = this;

        if (isOrthoMode || constructionPlane === PlaneDatabase.ScreenSpace) {
            gridBackground.position.copy(constructionPlane.p);
            gridBackground.quaternion.copy(constructionPlane.orientation);
            gridBackground.update(camera);
            return gridBackground;
        } else if (constructionPlane !== PlaneDatabase.XY) {
            customGrid.position.copy(constructionPlane.p);
            customGrid.quaternion.copy(constructionPlane.orientation);
            customGrid.update(camera);
            return customGrid;
        } else {
            floor.update(camera);
            return floor;
        }
    }

    // Around the grid on a plane, e.g. to fit the view to it or to keep it inside the camera's clipping
    boundingSphere(constructionPlane: ConstructionPlane, into = new THREE.Sphere()) {
        into.center.copy(constructionPlane.p);
        into.radius = this.spec.size / 2 * Math.SQRT2;
        return into;
    }

    get size() { return this.spec.size }
}
