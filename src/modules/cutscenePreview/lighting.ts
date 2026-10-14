// Backward-compatible entry points; the shared module owns catalog rules and lighting math.
export {resolveGlobalLighting as resolvePreviewLighting} from '../lighting/catalog.js';
export {createGlobalLightingKernel as createLightingKernel} from '../lighting/math.js';
