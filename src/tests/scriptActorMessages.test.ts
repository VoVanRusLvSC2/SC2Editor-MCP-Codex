import test from 'node:test';import assert from 'node:assert/strict';
import {GalaxyDocument} from '../modules/script/document.js';
test('known invalid ActorSend tint literals are diagnosed before runtime',()=>{
 const d=new GalaxyDocument('void Tick () { ActorSend(ActorFromScope(ActorScopeFromUnit(null), "::Main"), "SetTintColor 1.0,1.0,1.0 0.4"); }');
 assert.ok(d.diagnostics.some(d=>d.code==='ACTOR_MESSAGE_KNOWN_INVALID_FORMAT'));
});
test('comments, dynamic messages and unverified formats are not invented errors',()=>{
 for(const source of ['// ActorSend(null, "SetTintColor 1.0,1.0,1.0 0.4");','void F () { ActorSend(null, "Destroy"); }','void F () { string message; ActorSend(null, message); }','void F () { ActorSend(null, "SetTintColor " + "1.0,1.0,1.0 0.4"); }'])assert.deepEqual(new GalaxyDocument(source).diagnostics,[]);
});
