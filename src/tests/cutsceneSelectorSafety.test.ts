import test from 'node:test';import assert from 'node:assert/strict';
import{CutsceneDocument}from'../modules/cutscene/document.js';
test('Unqualified cutscene IDs cannot silently select the document root',()=>{
const d=new CutsceneDocument('<CutsceneState><CCutsceneNodeCamera guid="12" name="Wide"/></CutsceneState>');
assert.throws(()=>d.resolve({id:'Wide'}),/SELECTOR_ID_INVALID/);
assert.equal(d.resolve({name:'Wide'}).attrs.guid,'12');
assert.equal(d.resolve('guid:12').tag,'CCutsceneNodeCamera');
});
