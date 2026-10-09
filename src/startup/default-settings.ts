import { LengthUnit } from "../util/Units";

export default {
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
        // with) and degrees
        grid: false,
        handles: false,
        angles: false,
        point: false,
        face: false,
        curve: false,
        edge: false,
        gridStep: 10,
        lengthStep: 10,
        angleStep: 5,
    },

    Layout: {
        // How wide or tall the panes are, as their flex-grow in the order they're in the page; empty until one is resized
        panes: [] as number[],
    },

    Autosave: {
        // How many documents with a file that aren't open keep an autosave, which File › Restore offers; untitled
        // work always has one, the newest
        keep: 3,
    },
}
