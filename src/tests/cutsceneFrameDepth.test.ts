import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createGpuRenderer} from '../modules/cutscenePreview/gpu.js';
import {createEffectFrames} from '../modules/cutscenePreview/effectFrames.js';
import type {PreviewMesh, StandardMaterial} from '../modules/cutscenePreview/types.js';

async function fixture(rtt: boolean) {
    const scene = parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="near" modelPath="a.m3"><CCutsceneElementObject duration="1000"/></CCutsceneNodeActor><CCutsceneNodeActor guid="far" modelPath="a.m3" position="0,5,0"><CCutsceneElementObject duration="1000"/></CCutsceneNodeActor><CCutsceneNodeTargetCamera guid="cam" eyePositionY="-10" targetPositionY="0" fov="50" nearClip=".1" farClip="100"/></CutsceneState>', 'depth');
    const standard: StandardMaterial = {layers: {diffuse: {slot: 'diffuse', texturePath: null, constantColor: {value: [1, .1, .1, .5]}, uvSource: 0, channels: 1, op: 2, teamColorMode: 0, invert: false, clampResult: false, wrapX: false, wrapY: false}}, blendMode: 1, priority: 0, specularity: 4, specMult: 0, emisMult: 1, alphaTestThreshold: 0, twoSided: true, unshaded: true, usesVertexColor: false, usesVertexAlpha: false};
    Object.assign(standard, {specMode: 0, clampOutput: false, doubleLambert: false});
    const mesh: PreviewMesh = {positions: [-.5, 0, 0, .5, 0, 0, 0, 0, .5], indices: [0, 1, 2], weights: [], joints: [], bones: [], inverseBind: [], clips: [], bounds: {min: [-.5, 0, 0], max: [.5, 0, .5]}, issues: [], source: 'fixture', sha256: 'fixture', pose: 'native-bind-geometry', materials: [{name: 'alpha', standard}], batches: [{start: 0, count: 3, material: 0}]};
    scene.models['a.m3'] = mesh;
    if (rtt) scene.rtt = [{start: 0, end: 1000, channel: 0, object: 'cam', cameraIndex: 0, aspect: 1}];
    let depthWrites = true, world: number[] = [];
    const clears: boolean[] = [], draws: number[] = [];
    const gl = new Proxy({VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, MAX_TEXTURE_IMAGE_UNITS: 16, MAX_FRAGMENT_UNIFORM_VECTORS: 512, FRAMEBUFFER_COMPLETE: 77, COLOR_BUFFER_BIT: 1, DEPTH_BUFFER_BIT: 2} as Record<string, unknown>, {get: (o, key: string) => key in o ? o[key] : (...args: unknown[]) => {
        if (key === 'getShaderParameter' || key === 'getProgramParameter') return true;
        if (key === 'getParameter') return 16;
        if (key === 'checkFramebufferStatus') return 77;
        if (key === 'getUniformLocation') return args[1];
        if (key === 'uniformMatrix4fv' && args[0] === 'u_model') world = Array.from(args[2] as Float32Array);
        if (key === 'depthMask') depthWrites = Boolean(args[0]);
        if (key === 'clear') clears.push(depthWrites);
        if (key === 'drawElements') draws.push(world[13]);
        return {};
    }}) as unknown as WebGL2RenderingContext;
    const materials = await import(new URL('../../vendor/blizzard-models/browser/material-entry.js', import.meta.url).href);
    const effects = await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js', import.meta.url).href);
    const kernel = createPreviewKernel(), renderer = createGpuRenderer(gl, scene, kernel, effects, createEffectFrames, materials);
    await renderer.ready;
    for (const time of [0, 100]) {
        // The shared-context caller may leave depth writes disabled. This is an
        // entry-state robustness check; draw already restores them on return.
        gl.depthMask(false);
        renderer.draw(kernel.sample(scene, time, 'director', undefined, false), 320, 200, 'solid', undefined, false);
    }
    return {clears, draws};
}

test('blended surfaces draw far to near and restore writable depth before clearing', async () => {
    const result = await fixture(false);
    assert.deepEqual(result.draws, [5, 0, 5, 0]);
    assert.equal(result.clears.length, 2);
    assert.ok(result.clears.every(Boolean), 'depth clear must work independently of incoming GL state');
});

test('RTT and main frame both clear writable depth independently of incoming GL state', async () => {
    const result = await fixture(true);
    assert.equal(result.draws.length, 8);
    assert.ok(result.clears.length >= 6, 'two target initializations plus two RTT and main frames');
    assert.ok(result.clears.every(Boolean));
});
