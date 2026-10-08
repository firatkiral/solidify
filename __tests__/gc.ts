import v8 from 'v8';
import vm from 'vm';

// Runs a full garbage collection and lets FinalizationRegistry callbacks (which free OCCT objects) run.
// Works whether or not node was started with --expose-gc.
v8.setFlagsFromString('--expose-gc');
const gc: () => void = vm.runInNewContext('gc');

export async function collectGarbage() {
    for (let i = 0; i < 3; i++) {
        gc();
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}
