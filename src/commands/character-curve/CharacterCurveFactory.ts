import c3d from '../../kernel/kernel';
import { GeometryFactory } from '../../command/GeometryFactory';
import { unit } from '../../util/Conversion';
import { fromLengthUnit } from '../../util/Units';

export interface CharacterCurveParams {
    tMin: number;
    tMax: number;
    argument: string;
    xFunction: string;
    yFunction: string;
    zFunction: string;
}

export default class CharacterCurveFactory extends GeometryFactory {
    tMin = 0;
    tMax = Math.PI*2;
    argument = "t";
    xFunction = "sin(t)";
    yFunction = "t";
    zFunction = "2";

    async calculate() {
        const { tMin, tMax, argument, xFunction, yFunction, zFunction } = this;

        const ff = new c3d.FunctionFactory();
        const x = ff.CreateAnalyticalFunction(xFunction, argument, tMin, tMax);
        const y = ff.CreateAnalyticalFunction(yFunction, argument, tMin, tMax);
        const z = ff.CreateAnalyticalFunction(zFunction, argument, tMin, tMax);

        if (x === null || y === null || z === null) throw new Error("invalid");

        const placement = new c3d.Placement3D();
        const curve = new c3d.CharacterCurve3D(x, y, z, c3d.LocalSystemType3D.CartesianSystem, placement, tMin, tMax);
        // The formulas give lengths in the length unit
        const scale = unit(fromLengthUnit(1));
        const matrix = new c3d.Matrix3D();
        matrix.Scale(scale, scale, scale);
        curve.Transform(matrix);
        return new c3d.SpaceInstance(curve);
    }
}
