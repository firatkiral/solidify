import { Mode } from "../../command/AbstractGizmo";
import { CompositeGizmo } from "../../command/CompositeGizmo";
import { CancellablePromise } from "../../util/CancellablePromise";
import { RadiusDistanceGizmo } from "../cylinder/CylinderGizmo";
import { EditSphereParams, minRadius } from "./SphereFactory";

// Sits at the sphere's centre, with its Y toward the point the radius was dragged to
export class EditSphereGizmo extends CompositeGizmo<EditSphereParams> {
    private readonly radiusGizmo = new RadiusDistanceGizmo("sphere:radius", this.editor);

    protected prepare(mode: Mode) {
        const { radiusGizmo, params } = this;
        radiusGizmo.relativeScale.setScalar(0.8);
        radiusGizmo.state.min = minRadius;
        radiusGizmo.value = params.radius;
        this.add(radiusGizmo);
    }

    execute(cb: (params: EditSphereParams) => void, finishFast: Mode = Mode.Persistent): CancellablePromise<void> {
        const { radiusGizmo, params } = this;

        this.addGizmo(radiusGizmo, radius => {
            params.radius = radius;
        });

        return super.execute(cb, finishFast);
    }

    get shouldRescaleOnZoom() { return false }

    render(params: EditSphereParams) {
        this.radiusGizmo.value = params.radius;
    }
}
