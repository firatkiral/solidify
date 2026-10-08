import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { EditorLike, Mode } from "../../command/AbstractGizmo";
import { CompositeGizmo } from "../../command/CompositeGizmo";
import { AbstractAxialScaleGizmo, CompositeHelper, DashedLineMagnitudeHelper, lineGeometry, MagnitudeStateMachine, NumberHelper, sphereGeometry } from "../../command/MiniGizmos";
import { CancellablePromise } from "../../util/CancellablePromise";
import { BridgeCurvesParams } from "./BridgeCurvesFactory";

// The G1 tension of both ends (D), dragged from a handle at the start of the bridge that points the way it leaves the
// first curve.
export class BridgeCurvesGizmo extends CompositeGizmo<BridgeCurvesParams> {
    private readonly tension = new TensionGizmo("bridge-curves:tension", this.editor);

    protected prepare(mode: Mode) {
        const { tension, params } = this;
        tension.relativeScale.setScalar(0.8);
        tension.value = params.tension1[0];
        this.add(tension);
    }

    execute(cb: (params: BridgeCurvesParams) => void, mode: Mode = Mode.Persistent): CancellablePromise<void> {
        const { tension, params } = this;
        this.addGizmo(tension, t => {
            params.tension1[0] = t;
            params.tension1[1] = t;
        });
        return super.execute(cb, mode);
    }

    // After the dialog changes the start's tension
    set tensionValue(t: number) { this.tension.value = t }
}

class TensionGizmo extends AbstractAxialScaleGizmo {
    readonly state = new MagnitudeStateMachine(1);
    readonly tip: THREE.Mesh<any, any> = new THREE.Mesh(sphereGeometry, this.material.mesh);
    protected readonly shaft = new Line2(lineGeometry, this.material.line2);
    protected readonly knob = new THREE.Mesh(new THREE.SphereGeometry(0.2), this.editor.gizmos.invisible);
    readonly helper = new CompositeHelper<number>([new DashedLineMagnitudeHelper(), new NumberHelper(t => `×${t.toFixed(2)}`)]);
    protected readonly handleLength = 0;

    constructor(name: string, editor: EditorLike) {
        super(name, editor, editor.gizmos.default);
        this.state.min = 0.01;
        this.add(this.helper);
        this.setup();
    }

    protected accumulate(original: number, dist: number, denom: number): number {
        return original * dist / denom;
    }

    // A multiplier, not a length, so it never steps in millimeters
    protected override get stepsAsLength() { return false }
}
