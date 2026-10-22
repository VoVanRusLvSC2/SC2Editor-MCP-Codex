import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const load=async()=>await import(pathToFileURL(path.resolve('scripts/toolkit-suite-references.mjs')).href) as {resolveSuiteToolArguments:(tool:string,args:unknown,results:Map<string,unknown>)=>any;suiteNeedsLive:(tool:string,args:unknown)=>boolean};
test('suite resolution preserves internal batch references while resolving outer case data',async()=>{
 const {resolveSuiteToolArguments:resolve}=await load(),results=new Map<string,unknown>([['prior',{value:7}]]),args={steps:[{id:'measured',tool:'terrain.prefab',args:{seed:{$from:'prior.value'}}},{id:'placement',tool:'terrain.landscape.plan',args:{members:{$from:'measured.composeArgs.members'}}}]};
 const value=resolve('modkit.batch',args,results);assert.equal(value.steps[0].args.seed,7);assert.deepEqual(value.steps[1].args.members,{$from:'measured.composeArgs.members'});assert.deepEqual(args.steps[0].args.seed,{$from:'prior.value'});
 assert.throws(()=>resolve('terrain.landscape.plan',{members:{$from:'measured.composeArgs.members'}},results),/Unresolved/);
});
test('direct and nested native suite mutations still require the live flag',async()=>{
 const {suiteNeedsLive}=await load();assert.equal(suiteNeedsLive('modkit.batch',{steps:[{tool:'editor.check',args:{}}]}),true);assert.equal(suiteNeedsLive('modkit.batch',{steps:[{tool:'game.status',args:{}}]}),false);assert.equal(suiteNeedsLive('project.test.run',{}),true);assert.equal(suiteNeedsLive('editor.call',{method:'sc2_modules'}),false);
});
test('suite equality aliases enforce false values; unknown assertions fail before tool dispatch',async()=>{
 const {assertSuiteResult:check,validateSuiteAssertion:validate}=await import(pathToFileURL(path.resolve('scripts/toolkit-suite-assertions.mjs')).href);
 check({ready:false},[{path:'ready',equals:false}]);assert.throws(()=>check({ready:true},[{path:'ready',equals:false}]));
 check({count:3},[{path:'count',value:3},{path:'missing',exists:false}]);
 assert.throws(()=>validate({path:'ready',equal:false}),/Unknown/);assert.throws(()=>validate({path:'ready'}),/no operator/);assert.throws(()=>validate({path:'ready',equals:false,value:false}),/not both/);
 assert.throws(()=>check({},[{path:'count',minimum:1}]));assert.throws(()=>check({count:8},[{path:'count',lessThan:4}]));
});
