import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createFrameComposition} from '../modules/cutscenePreview/composition.js';
import {previewPage} from '../modules/cutscenePreview/viewer.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import {orbitCamera} from '../modules/cutscenePreview/render.js';
import {createEnvironmentKernel} from '../modules/cutscenePreview/environment.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';

test('output fitting and composition guides share centered geometry without changing camera optics', () => {
    const composition = createFrameComposition();
    assert.deepEqual(composition.fit(1920, 1200, 16 / 9), {x: 0, y: 60, width: 1920, height: 1080});
    assert.deepEqual(composition.fit(1600, 900, 16 / 10), {x: 80, y: 0, width: 1440, height: 900});
    assert.deepEqual(composition.fit(800, 600), {x: 0, y: 0, width: 800, height: 600});
    assert.deepEqual(composition.fit(800, 600, NaN), composition.fit(800, 600));
    const serialized = vm.runInNewContext('(' + createFrameComposition.toString() + ')()');
    assert.deepEqual(JSON.parse(JSON.stringify(serialized.fit(900, 1600, 16 / 9))), composition.fit(900, 1600, 16 / 9));
    assert.equal(composition.stamp(45810), '00:00:45.810');
    assert.equal(composition.stamp(96, 32), '00:00:03.000');
});

test('offline editor includes working controls, independent aspect guides and escaped resource names', () => {
    const scene = parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="1" name="Actor"/><CCutsceneNodeTargetCamera guid="2" fov="40" nearClip=".1" farClip="200"/></CutsceneState>', 'scene <img onerror="evil()">.SC2Cutscene');
    const before = structuredClone(scene.cameras), html = previewPage(scene, orbitCamera(scene), 'director', 'solid');
    for (const id of ['output-aspect', 'guide-169', 'guide-1610', 'render-scale', 'scene-tree', 'asset-search', 'property-rows', 'viewport-clock', 'view-camera', 'loading-progress', 'timeline']) {
        assert.equal(html.split('id="' + id + '"').length, 2, id + ' must be unique');
    }
    assert.match(html, /data-renderer="v\d+"/);
    assert.ok(html.includes('scene &lt;img onerror=&quot;evil()&quot;&gt;'));
    assert.ok(!html.includes('<img onerror="evil()">'));
    assert.deepEqual(scene.cameras, before);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    assert.doesNotThrow(() => new vm.Script(script));
    assert.ok(!/import\s+.+from\s+/.test(script), 'serialized player has no module fetches');
});

test('RTT source view and texture pass select the same timed, filtered camera and authored aspect', () => {
    const scene = parsePreviewScene('<CutsceneState><CCutsceneNodeTargetCamera guid="cam"/><CCutsceneNodeRTTChannel RTTChannel="0"><CCutsceneElementRTTChannel objectGUID="cam" start="0" duration="1000" aspectRatio="1"/><CCutsceneElementRTTChannel objectGUID="cam" start="500" duration="500" aspectRatio="1.6" filter="alternate"/></CCutsceneNodeRTTChannel></CutsceneState>', 'RTT');
    const kernel = createPreviewKernel(), environment = createEnvironmentKernel(kernel);
    const active = environment.rtt(scene, kernel.sample(scene, 600, 'director', undefined, false, {filters: ['alternate']}), 0);
    assert.equal(active?.aspect, 1.6);
    assert.equal(active?.object, 'cam');
    assert.equal(environment.rtt(scene, kernel.sample(scene, 600, 'director', undefined, false, {filters: ['main']}), 0)?.aspect, 1);
    assert.equal(environment.rtt(scene, kernel.sample(scene, 1000), 0), undefined);
});
