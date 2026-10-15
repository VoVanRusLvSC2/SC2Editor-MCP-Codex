import test from 'node:test';
import assert from 'node:assert/strict';
import {mountEditorUi} from '../modules/cutscenePreview/editorUi.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createLightingKernel} from '../modules/cutscenePreview/lighting.js';
import {orbitCamera} from '../modules/cutscenePreview/render.js';
import {createObjectInspector} from '../modules/cutscenePreview/objectInspector.js';

// A controller unit test, not a browser/layout or WebGL fidelity test.
class Element {
    dataset: Record<string, string> = {};
    attributes: Record<string, string> = {};
    childNodes: Element[] = [];
    textContent = ''; value = ''; title = ''; type = ''; open = false;
    onclick?: () => void; oninput?: () => void;
    append(...nodes: Element[]) {this.childNodes.push(...nodes);}
    replaceChildren(...nodes: Element[]) {this.childNodes = nodes;}
    setAttribute(name: string, value: string) {this.attributes[name] = value;}
    getAttribute(name: string) {return this.attributes[name]??null;}
    querySelectorAll(): Element[] {return this.childNodes.flatMap(n => [n, ...n.querySelectorAll()]).filter(n => n.dataset.treeObject !== undefined);}
}

test('scene tree, resource tabs, search, sound seek and property selection use loaded scene data', () => {
    const original = globalThis.document;
    const nodes = new Map<string, Element>();
    const element = (id: string) => {if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id)!;};
    const tabs = ['Models', 'Sounds', 'Files', 'Conversations'].map(name => {const e = new Element(); e.dataset.assetTab = name; return e;});
    const selected: string[] = [], actions: string[] = [];
    const scene = parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="a" name="Actor" modelPath="a.m3"><CCutsceneElementObject duration="1000"/></CCutsceneNodeActor><CCutsceneNodeTargetCamera guid="cam"/></CutsceneState>', 'Scene.SC2Cutscene');
    scene.speech = [{id: 'sound', start: 125, end: 500, soundLink: 'SpeechA', speaker: 'Raynor', variation: 0, offset: 0, volume: 1, pitch: 1, mode: 0, position: [0, 0, 0], curves: []}];
    scene.references = [{file: 'Assets/a.m3', sha256: 'abc', size: 20}];
    globalThis.document = {getElementById: element, createElement: () => new Element(), querySelectorAll: (selector: string) => selector === '[data-asset-tab]' ? tabs : []} as unknown as Document;
    try {
        const ui = mountEditorUi(scene, id => selected.push(id), id => actions.push(id),createObjectInspector(createPreviewKernel()));
        assert.equal(element('asset-list').childNodes[0].textContent, 'Actor');
        element('asset-list').childNodes[0].onclick!(); assert.deepEqual(selected, ['a']);
        tabs[1].onclick!();
        assert.equal(element('asset-list').childNodes[0].textContent, 'Raynor · SpeechA');
        element('asset-list').childNodes[0].onclick!(); assert.deepEqual(actions, ['seek:125']);
        element('asset-search').value = 'no such sound'; element('asset-search').oninput!();
        assert.equal(element('asset-list').childNodes[0].textContent, 'Нет записей');
        element('asset-search').value = ''; tabs[2].onclick!(); element('asset-list').childNodes[0].onclick!();
        assert.equal(element('asset-path').textContent, 'Assets/a.m3');
        ui.select('a');
        assert.equal(element('scene-tree').querySelectorAll().find(n => n.dataset.treeObject === 'a')!.attributes['aria-pressed'], 'true');
        ui.update(createPreviewKernel().sample(scene, 500), orbitCamera(scene), createLightingKernel().fallback);
        const rows = element('property-rows').childNodes;
        assert.equal(rows.find(n => n.childNodes.length===2&&n.childNodes[0].textContent === 'name')!.childNodes[1].textContent, 'Actor');
        assert.equal(rows.find(n => n.childNodes[0].textContent === 'visibleNow')!.childNodes[1].textContent, 'true');
        assert.ok(rows.some(n => n.childNodes[0].textContent === 'Camera · FOV / near / far'));
        ui.update(createPreviewKernel().sample(scene, 750), orbitCamera(scene), createLightingKernel().fallback);
        assert.equal(element('property-rows').childNodes,rows,'same object settings retain their DOM rows across frames');
    } finally {globalThis.document = original;}
});
