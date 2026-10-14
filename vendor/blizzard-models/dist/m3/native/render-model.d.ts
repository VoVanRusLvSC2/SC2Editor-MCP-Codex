import type { RenderModel } from '@modkit/codec-kit/legacy/models';
import type { M3Model } from './model.js';
export interface M3RenderModelOptions {
    includeRawMetadata?: boolean;
}
/**
 * M3 camera/light animation references are currently sampled into static
 * preview metadata. This list is emitted with the preview so clients can
 * explain which authored values do not yet update during animation playback.
 */
export declare const M3_PREVIEW_ANIMATION_LIMITATIONS: {
    readonly mode: "bind-pose-default-values";
    readonly cameras: readonly ["boneTransform", "fieldOfView", "farClip", "nearClip", "clip2", "focalDepth", "falloffStart", "falloffEnd", "depthOfField"];
    readonly lights: readonly ["boneTransform", "color", "intensity", "specularColor", "specularIntensity", "decay", "attenuationNear", "attenuationFar", "hotspot", "falloff"];
};
export declare function m3ModelToRenderModel(model: M3Model, options?: M3RenderModelOptions): RenderModel;
