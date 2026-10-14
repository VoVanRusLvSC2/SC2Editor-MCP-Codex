// Locally derived math, verified against copied SC2 Base98310 shader sources.
// psmateriallayer.fx:194-243,271-290; lighttypes.fx:26-70; lightingmodels.fx:20-49.
// These functions establish shader operations, not runtime uniform defaults or pass order.
const saturate = value => Math.max(0, Math.min(1, value));
export function nativeTeamColors(value = [1, 0, 0]) {
  if (Array.isArray(value)) return {diffuse: value, emissive: value, exponents: [1, 1]};
  const legacy = value.teamColor ?? [1, 0, 0];
  return {
    diffuse: value.diffuse ?? value.teamColorDiffuse ?? legacy,
    emissive: value.emissive ?? value.teamColorEmissive ?? legacy,
    exponents: value.exponents ?? value.teamColorExponents ?? [1, 1],
  };
}
export function nativeChooseChannel(channel, texel) {
  if (channel === 0) return [texel[0], texel[1], texel[2], 1];
  if (channel === 1) return [...texel];
  const component = texel[channel === 2 ? 3 : channel === 3 ? 0 : channel === 4 ? 1 : 2];
  return [component, component, component, component];
}
export function nativeLayerFresnel(fresnel, normal = [0, 0, 1], eyeToVertex = [0, 0, -1]) {
  // The native interpolant is a unit eye-to-vertex direction. A caller can
  // supply the actual transformed vector; authored yaw/pitch are not guessed.
  const unit = vector => {
    const length = Math.hypot(...vector);
    return length > 1e-9 ? vector.map(value => value / length) : [0, 0, 1];
  };
  normal = unit(normal);
  let direction = unit(eyeToVertex);
  if (fresnel.transformMatrix && fresnel.transformMode) {
    const matrix = fresnel.transformMatrix;
    direction = [0, 1, 2].map(row => matrix[row * 4] * direction[0] + matrix[row * 4 + 1] * direction[1] + matrix[row * 4 + 2] * direction[2] + matrix[row * 4 + 3]);
    if (fresnel.transformMode === 2) direction = unit(direction);
  }
  const dot = normal.reduce((sum, value, index) => sum + value * direction[index], 0);
  const edge = fresnel.doNotMirror ? 1 - saturate(-dot) : 1 - Math.abs(dot);
  let factor = Math.pow(Math.max(edge, 0.0001), fresnel.exponent);
  if (fresnel.mode === 2) factor = 1 - factor;
  return saturate(factor * fresnel.maxOffset + fresnel.min);
}
export function nativeLayerColor(sample, teams, normal = [0, 0, 1], eyeToVertex = [0, 0, -1]) {
  const original = sample.texel;
  const mask = sample.maskFactor ?? 1;
  let color = nativeChooseChannel(sample.channels, original.map(value => value * mask));
  // Native alpha factor precedes team color and invert/multiply/add.
  color[3] *= sample.alphaFactor ?? 1;
  const team = nativeTeamColors(teams);
  if (sample.channels !== 0 && (sample.teamColorMode === 1 || sample.teamColorMode === 2)) {
    const diffuse = sample.teamColorMode === 1;
    const tint = diffuse ? team.diffuse : team.emissive;
    const ratio = diffuse ? saturate(Math.pow(original[3], team.exponents[0])) : original[3];
    color = [...color.slice(0, 3).map((value, index) => tint[index] + (value - tint[index]) * ratio), 1];
  }
  if (sample.invert) color = color.map(value => 1 - value);
  color = color.map(value => value * (sample.colorMultiply ?? 1) + (sample.colorAdd ?? 0));
  if (sample.clampResult) color = color.map(saturate);
  if (sample.fresnel) {
    const factor = nativeLayerFresnel(sample.fresnel, normal, eyeToVertex);
    color = color.map(value => value * factor);
  }
  return color;
}
export function nativeCombineLayer(op, color, result, teams) {
  const team = nativeTeamColors(teams);
  return result.map((value, index) => {
    if (op === 0) return value * color[index];
    if (op === 1) return value * color[index] * 2;
    if (op === 2) return value + color[index] * color[3];
    if (op === 3) return value + (color[index] - value) * color[3];
    if (op === 4) return value + saturate(Math.pow(color[3], team.exponents[1])) * team.emissive[index];
    if (op === 5) return value + color[3] * team.diffuse[index];
    if (op === 6) return value + color[index];
    return value;
  });
}
export function nativePointAttenuation(distance, reciprocalRange, multiplier) {
  const ramp = saturate((1 - saturate(distance * reciprocalRange)) * multiplier);
  return ramp * ramp;
}
export function nativeSpotFalloff(lightToSurfaceDot, bias, scale, hotspotMultiplier) {
  const ramp = saturate(saturate((saturate(lightToSurfaceDot) + bias) * scale) * hotspotMultiplier);
  return ramp * ramp;
}
export function nativeBlinn(normalDotLight, normalDotHalf, exponent, doubleLambert = false) {
  const rawDiffuse = doubleLambert ? 2 * normalDotLight - 1 : normalDotLight;
  return {diffuse: saturate(rawDiffuse), specular: saturate(Math.pow(saturate(normalDotHalf), exponent) * Math.sign(rawDiffuse))};
}
export const nativeMaterialMath = Object.freeze({
  layerColor: nativeLayerColor, combineLayer: nativeCombineLayer,
  fresnel: nativeLayerFresnel, chooseChannel: nativeChooseChannel,
  pointAttenuation: nativePointAttenuation, spotFalloff: nativeSpotFalloff,
  blinn: nativeBlinn,
});
