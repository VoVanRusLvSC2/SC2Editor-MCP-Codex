import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveGameMedia} from '../modules/cutscenePreview/mediaSource.js';

const packages=['mods/core.sc2mod','campaigns/void.sc2campaign'];
const logical='assets/textures/body.dds';
test('media honors selected locale and dependency overrides for ordinary texture paths',async()=>{
 const requests:string[]=[],files=new Map([
  ['mods/core.sc2mod/enus.sc2assets/'+logical,'core-en'],
  ['mods/core.sc2mod/ruru.sc2assets/'+logical,'core-ru'],
  ['campaigns/void.sc2campaign/base.sc2assets/'+logical,'void-base']
 ]);
 const read=async(file:string)=>{requests.push(file);if(!files.has(file))throw Error('missing');return Buffer.from(files.get(file)!);};
 const locate=async()=>{throw Error('must not use cross-package fallback');};
 assert.equal((await resolveGameMedia(logical,packages,'enUS',read,locate))?.bytes.toString(),'void-base');
 assert.deepEqual(requests,['campaigns/void.sc2campaign/enus.sc2assets/'+logical,'campaigns/void.sc2campaign/base.sc2assets/'+logical]);
 files.delete('campaigns/void.sc2campaign/base.sc2assets/'+logical);
 for(const [locale,expected]of [['enUS','core-en'],['ruRU','core-ru']] as const){
  requests.length=0;assert.equal((await resolveGameMedia(logical,packages,locale,read,locate))?.bytes.toString(),expected);
  assert.ok(requests.every(p=>!p.includes(locale==='enUS'?'/ruru.':'/enus.')));
 }
});

test('texture fallback searches only the chosen locale and base, while explicit paths stay explicit',async()=>{
 const layers:string[]=[],target='other/enus.sc2assets/'+logical;
 const locate=async(_path:string,area:string)=>{layers.push(area);return area==='enus.sc2assets'?target:undefined;};
 const read=async(file:string)=>{if(file!==target)throw Error('missing');return Buffer.from('localized');};
 assert.equal((await resolveGameMedia(logical,[], 'enUS',read,locate))?.source,target);
 assert.deepEqual(layers,['enus.sc2assets']);layers.length=0;
 const absent=async()=>{throw Error('missing');};
 assert.equal(await resolveGameMedia('mods/core.sc2mod/ruru.sc2assets/'+logical,packages,'enUS',absent,locate),undefined);
 assert.equal(layers.length,0);
 await resolveGameMedia(logical,[],'ruRU',absent,async(_p,area)=>{layers.push(area);return undefined;});
 assert.deepEqual(layers,['ruru.sc2assets','base.sc2assets']);
});

test('localized voices do not fall into base language, while FXA retains its base fallback',async()=>{
 for(const ext of ['ogg','fxa']){
  const requests:string[]=[],p='localizeddata/voice.'+ext;
  await resolveGameMedia(p,['mods/core.sc2mod'],'ruRU',async(file)=>{requests.push(file);throw Error('missing');},async()=>undefined);
  assert.deepEqual(requests,['mods/core.sc2mod/ruru.sc2assets/'+p,...(ext==='fxa'?['mods/core.sc2mod/base.sc2assets/'+p]:[])]);
 }
});

test('media source guards propagate stale build and byte limits without trying another asset',async()=>{
 for(const reason of ['CUTSCENE_PREVIEW_BUILD_CHANGED','CUTSCENE_MEDIA_BYTE_BUDGET']){
  let calls=0;await assert.rejects(resolveGameMedia(logical,packages,'enUS',async()=>{calls++;throw Error(reason);},async()=>{throw Error('unexpected');}),new RegExp(reason));assert.equal(calls,1);
 }
 await assert.rejects(resolveGameMedia('../bad',packages,'enUS',async()=>Buffer.alloc(0),async()=>undefined),/CASC_PATH_UNSAFE/);
});
