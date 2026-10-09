import { formatLength, formatStep, fromLengthUnit, lengthUnit, parseLength, setLengthUnit, toLengthUnit, unitSystem } from "../src/util/Units";

afterEach(() => setLengthUnit('cm'));

test("lengths start in centimeters", () => {
    expect(lengthUnit()).toBe('cm');
    expect(formatLength(12.345)).toBe('1.235 cm');
    expect(toLengthUnit(25)).toBe(2.5);
    expect(fromLengthUnit(2.5)).toBe(25);
});

test("each unit shows about a hundredth of a millimeter", () => {
    expect(formatLength(12.345, 'mm')).toBe('12.35 mm');
    expect(formatLength(1234.5, 'm')).toBe('1.2345 m');
    expect(formatLength(25.4, 'in')).toBe('1.000 in');
    expect(formatLength(304.8, 'ft')).toBe('1.0000 ft');
});

test("steps drop trailing zeros", () => {
    expect(formatStep(1)).toBe('0.1 cm');
    expect(formatStep(10)).toBe('1 cm');
    expect(formatStep(25.4 / 16, 'in')).toBe('0.0625 in');
});

test("typed lengths are in the length unit, unless they name one", () => {
    expect(parseLength('2')).toBe(20);
    expect(parseLength(' -1.5 ')).toBe(-15);
    expect(parseLength('.5')).toBe(5);
    expect(parseLength('5mm')).toBe(5);
    expect(parseLength('2 in')).toBeCloseTo(50.8);
    expect(parseLength('3"')).toBeCloseTo(76.2);
    expect(parseLength("1.5 ft")).toBeCloseTo(457.2);
    expect(parseLength("2'")).toBeCloseTo(609.6);
    expect(parseLength('1 M')).toBe(1000);
    expect(parseLength('abc')).toBeUndefined();
    expect(parseLength('2 yd')).toBeUndefined();
    expect(parseLength('')).toBeUndefined();
});

test("the length unit decides the system", () => {
    expect(unitSystem()).toBe('metric');
    setLengthUnit('ft');
    expect(unitSystem()).toBe('imperial');
    expect(parseLength('1')).toBeCloseTo(304.8);
});
