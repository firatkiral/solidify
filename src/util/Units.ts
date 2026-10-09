// How values are shown in the UI. View units are millimeters (model units are hundredths of a millimeter, see Conversion.ts);
// lengths show and are typed in the length unit (Settings › Units & grid), angles show a tenth of a degree.

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type UnitSystem = 'metric' | 'imperial';

interface UnitInfo {
    readonly name: string;
    readonly millimeters: number; // how many in one of the unit
    readonly digits: number; // decimals shown, about a hundredth of a millimeter
    readonly system: UnitSystem;
}

export const lengthUnits: Readonly<Record<LengthUnit, UnitInfo>> = {
    mm: { name: "Millimeters", millimeters: 1, digits: 2, system: 'metric' },
    cm: { name: "Centimeters", millimeters: 10, digits: 3, system: 'metric' },
    m: { name: "Meters", millimeters: 1000, digits: 4, system: 'metric' },
    in: { name: "Inches", millimeters: 25.4, digits: 3, system: 'imperial' },
    ft: { name: "Feet", millimeters: 304.8, digits: 4, system: 'imperial' },
};

interface SystemInfo {
    readonly grid: { readonly size: number, readonly step: number }; // the grid a new user, or a move to this system, starts with
    readonly majorEvery: number; // grid steps between the grid's heavier lines
    readonly steps: readonly number[]; // the snap and handle-drag steps, which include one of each unit
}

// In millimeters: 1-2-5 steps in metric; binary fractions of an inch, then inches and feet, in imperial
const inch = 25.4;
export const unitSystems: Readonly<Record<UnitSystem, SystemInfo>> = {
    metric: {
        grid: { size: 300, step: 10 },
        majorEvery: 10,
        steps: [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
    },
    imperial: {
        grid: { size: 304.8, step: inch }, // a foot, every inch
        majorEvery: 12,
        steps: [1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 3, 6, 12, 24, 60, 120].map(inches => inches * inch),
    },
};

let current: LengthUnit = 'cm';
export function lengthUnit() { return current }
export function setLengthUnit(unit: LengthUnit) { current = unit }
export function unitSystem(unit = current) { return lengthUnits[unit].system }

// From millimeters to the length unit, and back
export function toLengthUnit(millimeters: number, unit = current) {
    return millimeters / lengthUnits[unit].millimeters;
}

export function fromLengthUnit(value: number, unit = current) {
    return value * lengthUnits[unit].millimeters;
}

export function formatLength(millimeters: number, unit = current) {
    return `${toLengthUnit(millimeters, unit).toFixed(lengthUnits[unit].digits)} ${unit}`;
}

// A step, like 0.1 cm or 0.0625 in: no trailing zeros
const stepFormat = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4, useGrouping: false });
export function formatStep(millimeters: number, unit = current) {
    return `${stepFormat.format(toLengthUnit(millimeters, unit))} ${unit}`;
}

// Typed text in millimeters: a number in the length unit, or followed by a unit of its own (e.g. 5mm, 2 in, 3", 1.5 ft, 2')
const typedUnits: Record<string, LengthUnit> = { mm: 'mm', cm: 'cm', m: 'm', in: 'in', '"': 'in', ft: 'ft', "'": 'ft' };
export function parseLength(text: string, unit = current): number | undefined {
    const match = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(mm|cm|m|in|"|ft|')?\s*$/i.exec(text);
    if (match === null) return undefined;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return undefined;
    return fromLengthUnit(value, match[2] === undefined ? unit : typedUnits[match[2].toLowerCase()]);
}

export function formatDegrees(degrees: number) {
    return `${degrees.toFixed(1)}°`;
}

export function formatAngle(radians: number) {
    return formatDegrees(radians * 180 / Math.PI);
}
