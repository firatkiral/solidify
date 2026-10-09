import c3d from '../../kernel/kernel';
import * as visual from '../../visual_model/VisualModel';
import { GeometryFactory, PhantomInfo } from '../../command/GeometryFactory';
import { MaterialOverride } from "../../editor/DatabaseLike";
import { MultiBooleanLikeFactory, phantom_red, phantom_green, phantom_blue } from "./BooleanFactory";
import { toArray } from '../../util/Conversion';

export abstract class PossiblyBooleanFactory<GF extends GeometryFactory> extends GeometryFactory {
    protected abstract bool: MultiBooleanLikeFactory;
    protected abstract fantom: GF;

    newBody = false;

    protected _operationType?: c3d.OperationType;
    get operationType() { return this._operationType ?? this.defaultOperationType; }
    set operationType(operationType: c3d.OperationType) { this._operationType = operationType; }
    get defaultOperationType() { return this.isSurface ? c3d.OperationType.Union : c3d.OperationType.Difference; }

    private _targets: { views: visual.Solid[], models: c3d.Solid[] } = { views: [], models: [] };
    get targets() { return this._targets.views }
    set targets(targets: visual.Solid[]) {
        const models = targets.map(t => this.db.lookup(t));
        this._targets = { views: targets, models };
        this.bool.targets = targets;
    }

    protected _isOverlapping = false;
    get isOverlapping() { return this._isOverlapping; }

    protected _isSurface = false;
    get isSurface() { return this._isSurface; }

    // Targets the tool is known to touch, such as the solid an extruded face belongs to: no overlap test is needed
    touching = new Set<visual.Solid>();

    // Previewing the boolean on every change can take seconds on a detailed body. When this is on, the preview shows
    // just the tool while values are changing, and the boolean once they've settled for a moment (and on commit).
    protected get previewsToolWhileChanging() { return false }
    static settleDelay = 300;
    private changing = false;
    private settleTimer?: ReturnType<typeof setTimeout>;
    private toolOnly = false;

    override async update() {
        if (this.previewsToolWhileChanging) {
            this.changing = true;
            if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
            this.settleTimer = setTimeout(() => this.settle(), PossiblyBooleanFactory.settleDelay);
        }
        this.generation++;
        return super.update();
    }

    private settle() {
        this.settleTimer = undefined;
        if (this.done) return;
        this.changing = false;
        this.generation++;
        super.update();
    }

    override async commit() {
        this.stopSettling();
        this.generation++;
        return super.commit();
    }

    override cancel() {
        this.stopSettling();
        super.cancel();
    }

    private stopSettling() {
        if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
        this.settleTimer = undefined;
        this.changing = false;
    }

    // The phantom update and the real update ask for the same tool; build it and test it once per update
    private generation = 0;
    private computed?: { generation: number, result: ReturnType<PossiblyBooleanFactory<GF>['computeBeforeCalculate']> };
    private beforeCalculate() {
        const { generation } = this;
        if (this.computed?.generation !== generation) this.computed = { generation, result: this.computeBeforeCalculate() };
        return this.computed.result;
    }

    private async computeBeforeCalculate() {
        const phantoms = toArray(await this.fantom.calculate()) as c3d.Solid[];
        let isOverlapping, isSurface;
        if (this.targets.length === 0) {
            isOverlapping = false;
            isSurface = false;
        } else if (this.targets.some(target => this.touching.has(target))) {
            isOverlapping = true;
            isSurface = false;
        } else {
            const possible = [];
            for (const phantom of phantoms) {
                const cube1 = phantom.GetCube();
                for (const model of this._targets.models) {
                    const cube2 = model.GetCube();
                    if (cube1.Intersect(cube2)) {
                        possible.push({ phantom, model });
                    }
                }
            }
            if (possible.length === 0) {
                isOverlapping = false;
                isSurface = false;
            } else {
                const names = new c3d.SNameMaker(0, c3d.ESides.SideNone, 0);
                const promises = possible.map(({ phantom, model }) => c3d.Action.IsSolidsIntersectionFast_async(phantom, model, names));
                const intersections = await Promise.all(promises);
                isOverlapping = intersections.some(x => x);
                isSurface = false;
            }
        }
        return { phantoms, isOverlapping, isSurface };
    }

    async calculate() {
        const { phantoms, isOverlapping, isSurface } = await this.beforeCalculate();
        this._isOverlapping = isOverlapping; this._isSurface = isSurface;

        // While values change, the phantom stands in for the boolean, and the targets stay as they are
        this.toolOnly = this.changing && isOverlapping && !this.newBody;
        if (this.toolOnly) return [];

        if (isOverlapping && !this.newBody) {
            this.bool.operationType = this.operationType;
            this.bool.tools = phantoms;
            const result = await this.bool.calculate() as c3d.Solid[];
            return result;
        } else {
            return phantoms;
        }
    }

    async calculatePhantoms(): Promise<PhantomInfo[]> {
        const { phantoms, isOverlapping, isSurface } = await this.beforeCalculate();

        if (this.targets.length === 0)
            return [];
        if (this.newBody)
            return [];
        if (this.operationType === c3d.OperationType.Union && !this.changing)
            return [];
        if (!isOverlapping)
            return [];

        let material: MaterialOverride;
        if (this.operationType === c3d.OperationType.Difference)
            material = phantom_red;
        else if (this.operationType === c3d.OperationType.Intersect)
            material = phantom_green;
        else
            material = phantom_blue;

        return phantoms.map(phantom => ({ phantom, material }));
    }

    get originalItem() { return this.targets }

    get shouldRemoveOriginalItemOnCommit() {
        return this.isOverlapping && this.targets.length !== 0 && !this.newBody;
    }

    protected get shouldHideOriginalItemDuringUpdate() {
        return !this.toolOnly && this.shouldRemoveOriginalItemOnCommit;
    }
}
