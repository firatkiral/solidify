// How values are shown in the UI. View units are millimeters (model units are hundredths of a millimeter, see Conversion.ts);
// lengths show a hundredth of a millimeter and angles a tenth of a degree.

export function formatLength(millimeters: number) {
    return `${millimeters.toFixed(2)} mm`;
}

export function formatDegrees(degrees: number) {
    return `${degrees.toFixed(1)}°`;
}

export function formatAngle(radians: number) {
    return formatDegrees(radians * 180 / Math.PI);
}
