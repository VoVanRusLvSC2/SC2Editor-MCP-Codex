import test from 'node:test';import assert from 'node:assert/strict';
import {mergeAssetEntries} from '../modules/browse/assetIndex.js';import type {PhysicalAssetEntry} from '../modules/browse/types.js';
const asset=(id:string,path='Shared.m3',extra:Partial<PhysicalAssetEntry>={}):PhysicalAssetEntry=>({path,file:id+'.xml',kind:'Model',sourceLayer:'dependency',dependency:'mods/core.sc2mod',availability:'AVAILABLE_THROUGH_DEPENDENCY',referencedBy:[{catalogType:'Actor',id,field:'Model'}],evidence:['OBSERVED_CATALOG_XML','OBSERVED_ASSET_PATH'],...extra});
function legacy(entries:PhysicalAssetEntry[]){const assets=new Map<string,PhysicalAssetEntry>();for(const entry of entries){const key=`${entry.sourceLayer}:${entry.dependency}:${entry.path}`.toLowerCase(),prior=assets.get(key);assets.set(key,prior?{...prior,referencedBy:[...new Set([...prior.referencedBy,...entry.referencedBy].map(v=>JSON.stringify(v)))].map(v=>JSON.parse(v)),evidence:[...new Set([...prior.evidence,...entry.evidence])]}:entry);}return [...assets.values()].sort((a,b)=>a.path.localeCompare(b.path));}
test('asset provenance preserves legacy identity, metadata, ordering and duplicate behavior',()=>{
 const input=Array.from({length:1200},(_,i)=>asset('Actor'+(i%93),'Shared'+(i%7)+(i%2?'.m3':'.M3'),{sourceLayer:i%11?'dependency':'workspace',dependency:i%13?'mods/core.sc2mod':'mods/void.sc2mod',evidence:i%3?['OBSERVED_ASSET_PATH']:['INFERRED','OBSERVED_CATALOG_XML']}));
 const only=asset('Only','Only.m3');only.referencedBy.push({...only.referencedBy[0]});input.unshift(only,asset('Physical','Shared1.m3',{referencedBy:[],evidence:['OBSERVED_ASSET_PATH'],file:'physical.m3'}));
 const before=JSON.stringify(input),expected=legacy(input);assert.deepEqual(mergeAssetEntries(input),expected);assert.equal(JSON.stringify(input),before);assert.equal(mergeAssetEntries([only])[0].referencedBy.length,2);
});
test('shared asset accumulation consumes each reference once without mutating frozen inputs',()=>{
 let reads=0;const count=6000,input=Array.from({length:count},(_,i)=>{const ref={catalogType:'Actor',get id(){reads++;return 'Actor'+(i%3000)},field:'Model'},entry=asset('unused');entry.referencedBy=[ref];Object.freeze(ref);Object.freeze(entry.referencedBy);Object.freeze(entry.evidence);return Object.freeze(entry)});
 const result=mergeAssetEntries(input);assert.equal(result.length,1);assert.equal(result[0].referencedBy.length,3000);assert.equal(result[0].file,'unused.xml');assert.deepEqual(result[0].referencedBy[2999],{catalogType:'Actor',id:'Actor2999',field:'Model'});assert.ok(reads<=count+1,`Expected linear reference visits, got ${reads}`);
});
test('case-folded asset paths retain separate source layers and dependencies',()=>{
 const input=[asset('A','shared.m3'),asset('B','SHARED.M3'),asset('C','shared.m3',{sourceLayer:'workspace'}),asset('D','shared.m3',{dependency:'mods/void.sc2mod'})];assert.deepEqual(mergeAssetEntries(input),legacy(input));assert.equal(mergeAssetEntries(input).length,3);assert.equal(mergeAssetEntries([]).length,0);
});
