import * as THREE from 'three';
import { PlaneDatabase } from '../../editor/PlaneDatabase';
import { ConstructionPlane } from '../../editor/snaps/ConstructionPlaneSnap';
import { FloorHelper, OrthoModeGrid, CustomGrid } from './FloorHelper';

const floorSize = 120;
const planeGridSize = floorSize * 10;

// Grid sizes in millimeters: the spacing of the construction plane grid's lines, which is also the snap-to-grid increment.
// Each one divides the grids' half-widths evenly, so grid lines always pass through the plane's origin, like the snap points.
export const gridSizes: readonly number[] = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];

export class GridHelper {
    private size = 0.1;
    private floor!: FloorHelper;
    private gridBackground!: OrthoModeGrid;
    private customGrid!: CustomGrid;

    constructor(private readonly color1: THREE.Color, private readonly color2: THREE.Color, private readonly backgroundColor: THREE.Color) {
        this.build();
    }

    // Every grid, the floor included, draws a line every size (thicker every 10). The floor grows with the size so coarse
    // grids still cover enough of it.
    private build() {
        const { size, color1, color2, backgroundColor } = this;
        const planeDivisions = Math.round(planeGridSize / size);
        this.gridBackground = new OrthoModeGrid(planeGridSize, planeDivisions, color1, color2, backgroundColor);
        this.customGrid = new CustomGrid(planeGridSize, planeDivisions, color1, color2, backgroundColor);
        const floorExtent = Math.max(floorSize, floorSize * 10 * size);
        this.floor = new FloorHelper(floorExtent, Math.round(floorExtent / size), color1, color2);
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

    // One size finer (-1) or coarser (+1) along gridSizes; 0 only re-applies the size to the plane.
    resizeGrid(direction: -1 | 0 | 1, constructionPlane: ConstructionPlane) {
        const index = gridSizes.indexOf(this.size);
        const size = gridSizes[Math.min(gridSizes.length - 1, Math.max(0, index + direction))];
        if (size !== this.size) {
            this.size = size;
            this.gridBackground.dispose();
            this.customGrid.dispose();
            this.floor.dispose();
            this.build();
        }
        this.applyTo(constructionPlane);
    }

    // Make the plane snap to this grid's spacing (PlaneSnap.snapToGrid steps by 1 / (10 * gridFactor)).
    applyTo(constructionPlane: ConstructionPlane) {
        constructionPlane.gridFactor = Math.min(10, 0.1 / this.size);
    }

    // Distance between grid lines in millimeters, which is also the snap-to-grid increment.
    get spacing() { return this.size }
}

const Z = new THREE.Vector3(0, 0, 1);
Object.freeze(Z);
