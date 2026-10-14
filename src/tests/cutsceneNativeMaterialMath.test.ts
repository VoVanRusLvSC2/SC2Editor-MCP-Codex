import assert from 'node:assert/strict';
import test from 'node:test';

// Retained, editable vendor source; the shipped IIFE is regenerated from it.
const vendor = await import(new URL('../../vendor/blizzard-models/browser/material-entry.js', import.meta.url).href);
const math = vendor.nativeMaterialMath;
const close = (actual: number[], expected: number[]) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-10, `${index}: ${value} != ${expected[index]}`));
const layer = (slot: string, color: number[], extra: Record<string, unknown> = {}) => ({slot, texturePath: null, constantColor: {value: color}, uvSource: 0, channels: 1, op: 2, teamColorMode: 0, invert: false, clampResult: false, wrapX: false, wrapY: false, ...extra});
const standard = (layers: Record<string, unknown>) => ({layers, blendMode: 0, priority: 0, specularity: 4, specMult: 1, emisMult: 1, specMode: 0, alphaTestThreshold: 0, twoSided: false, unshaded: true, doubleLambert: false, clampOutput: false, usesVertexColor: false, usesVertexAlpha: false});
const programs = (material: Record<string, unknown>) => vendor.createStandardMaterialPrograms({renderModel: {version: 1, standard: material}}, {budget: {maxDepth: 64, maxNodes: 500000, maxBytes: 16000000}});

test('native alpha factor precedes invert, multiply, add and team-color alpha replacement', () => {
  const input = {texel: [0.2, 0.4, 0.6, 0.8], channels: 1, teamColorMode: 0, alphaFactor: 0.5, invert: true, colorMultiply: 2, colorAdd: 0.1};
  close(math.layerColor(input, [1, 0, 0]), [1.7, 1.3, 0.9, 1.3]);
  const teams = {diffuse: [1, 0, 0], emissive: [0, 1, 0], exponents: [2, 1]};
  close(math.layerColor({...input, invert: false, colorMultiply: 1, colorAdd: 0, teamColorMode: 1}, teams), [0.488, 0.256, 0.384, 1]);
  close(math.layerColor({...input, channels: 0, invert: false, colorMultiply: 1, colorAdd: 0, teamColorMode: 1}, teams), [0.2, 0.4, 0.6, 0.5]);
});

test('native additive diffuse and emissive team colors use distinct tint and exponent paths', () => {
  const teams = {diffuse: [1, 0, 0], emissive: [0, 1, 0], exponents: [1, 2]};
  close(math.combineLayer(4, [1, 1, 1, 0.5], [0, 0, 0], teams), [0, 0.25, 0]);
  close(math.combineLayer(5, [1, 1, 1, 0.5], [0, 0, 0], teams), [0.5, 0, 0]);
});

test('native bounded squared light ramps and Blinn zero exponent are preserved', () => {
  assert.equal(math.pointAttenuation(5, 0.1, 1), 0.25);
  assert.equal(math.pointAttenuation(10, 0.1, 1), 0);
  assert.equal(math.spotFalloff(0.5, 0, 1, 1), 0.25);
  assert.deepEqual(math.blinn(0.25, 0.8, 0), {diffuse: 0.25, specular: 1});
  assert.deepEqual(math.blinn(0.25, 0.8, 8, true), {diffuse: 0, specular: 0});
  assert.deepEqual(math.blinn(2, 2, 4), {diffuse: 1, specular: 1});
});

test('per-property frame samples share shader cache and leave base standards unchanged', () => {
  const diffuse = layer('diffuse', [0.2, 0.4, 0.6, 1]);
  const material = standard({diffuse});
  const sampler = programs(material);
  const a = sampler.sample({time: 0}, {sceneLighting: true}, {propertyValues: {'layers.diffuse.uvOffset': [0.25, 0.5], 'layers.diffuse.constantColor': [0.1, 0.2, 0.3, 1]}})[0];
  const b = sampler.sample({time: 1}, {sceneLighting: true}, {propertyValues: {'layers.diffuse.uvOffset': [0.75, 0.5], 'layers.diffuse.constantColor': [0.3, 0.2, 0.1, 1]}})[0];
  assert.deepEqual(a.uniforms.u_diffuseUvOffset, [0.25, 0.5]);
  assert.deepEqual(b.uniforms.u_diffuseUvOffset, [0.75, 0.5]);
  assert.equal(a.vertexSource, b.vertexSource);
  assert.equal(a.fragmentSource, b.fragmentSource);
  assert.equal(a.defines, b.defines);
  assert.equal(a.key, b.key);
  close(a.shade().rgba, [0.1, 0.2, 0.3, 1]);
  close(b.shade().rgba, [0.3, 0.2, 0.1, 1]);
  assert.deepEqual(diffuse.constantColor.value, [0.2, 0.4, 0.6, 1]);
  assert.equal('uvOffset' in diffuse, false);
  assert.throws(() => sampler.sample({time: 0}, {}, {propertyValues: {'layers.diffuse.uvOffset': [1, 2, 3]}}), /component count/);
});

test('RGB emissive LERP replaces color and a second MOD multiplies the additive accumulator', () => {
  const replace = programs(standard({diffuse: layer('diffuse', [0.1, 0.2, 0.3, 1]), emissive1: layer('emissive1', [0.9, 0.8, 0.7, 1], {channels: 0, op: 3})})).sample({time: 0}, {sceneLighting: true})[0];
  close(replace.shade().rgba, [0.9, 0.8, 0.7, 1]);
  assert.ok(replace.fragmentSource.includes('mix(shaded, emis1Color.rgb, emis1Color.a)'));
  const additive = programs({...standard({diffuse: layer('diffuse', [0.5, 0.5, 0.5, 1]), emissive1: layer('emissive1', [0.2, 0.2, 0.2, 1]), emissive2: layer('emissive2', [0.5, 0.5, 0.5, 1], {op: 0})}), emisMult: 2}).sample({time: 0}, {sceneLighting: true})[0];
  close(additive.shade().rgba, [0.7, 0.7, 0.7, 1]);
  assert.ok(additive.fragmentSource.includes('emissive *= emis2Color.rgb;'));
});

test('separate actor team colors are exposed to matching CPU and GPU paths', () => {
  const material = standard({emissive1: layer('emissive1', [1, 1, 1, 0.5], {op: 4})});
  const pass = programs(material).sample({time: 0}, {sceneLighting: true, teamColor: [1, 0, 0], teamColorDiffuse: [1, 0, 0], teamColorEmissive: [0, 1, 0], teamColorExponents: [1, 2]})[0];
  close(pass.shade().rgba, [0, 0.25, 0, 1]);
  assert.deepEqual(pass.uniforms.u_teamColorDiffuse, [1, 0, 0]);
  assert.deepEqual(pass.uniforms.u_teamColorEmissive, [0, 1, 0]);
  assert.deepEqual(pass.uniforms.u_teamColorExponents, [1, 2]);
  assert.ok(pass.fragmentSource.includes('u_teamColorExponents.y'));
});

test('AO affects ambient without darkening the key light or the albedo', () => {
  const material = {...standard({diffuse: layer('diffuse', [0.5, 0.5, 0.5, 1]), ao: layer('ao', [0.2, 0, 0, 1], {channels: 3})}), unshaded: false};
  const pass = programs(material).sample({time: 0}, {sceneLighting: true})[0];
  close(pass.shade({sceneLighting: {ambientColor: [1, 1, 1], lightColor: [1, 1, 1]}}).rgba, [0.6, 0.6, 0.6, 1]);
  assert.ok(pass.fragmentSource.includes('float ambientOcclusion = computeLayer_ao().a;'));
  assert.ok(!pass.fragmentSource.includes('color *= computeLayer_ao()'));
});

test('a lightmap overrides global diffuse lighting and removes its specular term', () => {
  const material = {...standard({diffuse: layer('diffuse', [0.5, 0.5, 0.5, 1]), lightMap: layer('lightMap', [0.1, 0.2, 0.3, 1]), specular: layer('specular', [1, 1, 1, 1]), ao: layer('ao', [0, 0, 0, 1], {channels: 3})}), unshaded: false};
  const pass = programs(material).sample({time: 0}, {sceneLighting: true})[0];
  close(pass.shade({sceneLighting: {ambientColor: [100, 100, 100], lightColor: [100, 100, 100]}}).rgba, [0.1, 0.2, 0.3, 1]);
  assert.ok(pass.fragmentSource.includes('useLightmap ? vec3(0.0) : spec * u_sceneLightColor'));
  assert.ok(!pass.fragmentSource.includes('color *= computeLayer_lightMap()'));
});
