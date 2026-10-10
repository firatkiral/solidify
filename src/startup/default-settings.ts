import { LengthUnit } from "../util/Units";
import { ThemeSetting } from "./Appearance";

export default {
    Appearance: {
        // Light, dark, or as the system is; dark unless chosen otherwise
        theme: 'dark' as ThemeSetting,
    },

    Viewport: {
        navigator: {
            size: 100,
            padding: 10,
        },
    },

    OrbitControls: {
        zoomSpeed: 1,
        rotateSpeed: 1,
        panSpeed: 1,
    },

    Units: {
        // How lengths are shown and typed; the model, documents and files stay in millimeters
        length: 'cm' as LengthUnit,
    },

    Grid: {
        // In millimeters: how wide the grid is, and the distance between its lines
        size: 300,
        step: 10,
    },

    Snaps: {
        // The Snaps panel as it was last left: what snaps, and the steps in millimeters (one of the length unit to begin
        // with) and degrees. Points snap to the grid from the first launch.
        grid: true,
        handles: false,
        angles: false,
        point: true,
        face: true,
        curve: true,
        edge: true,
        gridStep: 10,
        lengthStep: 10,
        angleStep: 5,
    },

    Layout: {
        // The drawer beside the viewport as it was last left: which tab it shows ('' while closed), and its width in pixels
        drawerTab: 'scene',
        drawerWidth: 280,
    },

    Autosave: {
        // How many documents with a file that aren't open keep an autosave, which File › Restore offers; untitled
        // work always has one, the newest
        keep: 3,
    },
}
