import test from 'node:test';
import assert from 'node:assert/strict';
import {GalaxyDocument} from '../modules/script/document.js';
import {checkGalaxyTypes} from '../modules/script/typecheck.js';

const check=(source:string)=>checkGalaxyTypes(new GalaxyDocument(source),new Map());

test('nullable Galaxy strings and string compound concatenation retain type checks',()=>{
 const good=check('void Consume(string value) {} void Run() { string value = null; value += "x"; Consume(null); }');
 assert.deepEqual(good.diagnostics,[]);
 const bad=check('void Run() { string value = ""; value += true; int count = null; }');
 assert.ok(bad.diagnostics.some(x=>x.code==='GALAXY_OPERATOR_TYPE'));
 assert.ok(bad.diagnostics.some(x=>x.code==='GALAXY_ASSIGN_TYPE'));
});

test('unbound record/array and bitwise expressions remain incomplete rather than inventing operand types',()=>{
 const good=check('struct Row { int flags; }; Row state; unit hero; void Run(int flags) { if (hero == state.hero) {} if (true || (flags & 1) != 0) {} if (flags == state.flags[0]) {} }');
 assert.deepEqual(good.diagnostics,[]);
 assert.equal(good.status,'INCOMPLETE');
 assert.ok(good.unknown>0);
 const bad=check('struct Row { unit hero; }; Row state; void Consume(unit hero) {} void Run() { Consume(state.hero, 2); }');
 assert.ok(bad.diagnostics.some(x=>x.code==='GALAXY_CALL_ARITY'));
});
