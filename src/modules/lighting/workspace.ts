import {createHash} from 'node:crypto';
import type {Workspace} from '../../core/workspace.js';
import {CascWorkspace,safeCascPath} from '../casc/workspace.js';
import {resolveGlobalLighting} from './catalog.js';
import {decodeAmbientCube} from './cube.js';
export const lightingPackages=['mods/core.sc2mod','mods/liberty.sc2mod','mods/swarm.sc2mod','mods/void.sc2mod'];
export interface LightingResolveOptions {preset?:string;stateIndex?:number;packages?:string[];directory?:string;localTexts?:string[]}
/** Read-only global lighting service. Catalog overlays stay in dependency order. */
export class LightingWorkspace {
 constructor(readonly workspace:Workspace,readonly casc:CascWorkspace){}
 async resolve(options:LightingResolveOptions={}){
  const packages=options.packages??lightingPackages,index=options.stateIndex??0;
  if(packages.length>8||packages.some(p=>! /^(mods|campaigns)\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.sc2(mod|campaign)$/.test(p)))throw new Error('LIGHTING_PACKAGES');
  if(!Number.isInteger(index)||index<0||index>63)throw new Error('LIGHTING_STATE_INDEX');
  const texts:string[]=[],references:Array<{file:string;sha256:string;size:number}>=[],issues:Array<{code:string;detail:string}>=[];
  let build:string|undefined,localReference:{file:string;sha256:string}|undefined;
  const mustPropagate=(error:unknown)=>/CHANGED|MISMATCH|BUDGET|UNSAFE|SYMLINK|ESCAPE/.test(String(error));
  const read=async(file:string,max=4*1024*1024)=>{const r=await this.casc.readLimited(file,max);if(build&&build!==r.metadata.buildKey)throw new Error('LIGHTING_BUILD_CHANGED');build=r.metadata.buildKey;references.push({file,sha256:r.metadata.sha256,size:r.bytes.length});return r.bytes;};
  for(const pack of packages){const file=pack+'/base.sc2data/gamedata/lightdata.xml';try{texts.push((await read(file)).toString('utf8'));}catch(e){if(mustPropagate(e))throw e;issues.push({code:'LIGHTING_CATALOG_UNAVAILABLE',detail:file+': '+String(e).slice(0,256)});}}
  if(options.localTexts)texts.push(...options.localTexts);else{
   const file=(options.directory?options.directory.replaceAll('\\','/')+'/':'')+'Base.SC2Data/GameData/LightData.xml',r=await this.workspace.readRaw(file);
   if(r.text){if(Buffer.byteLength(r.text)>4*1024*1024)throw new Error('LIGHTING_LOCAL_CATALOG_BUDGET');texts.push(r.text);localReference={file,sha256:createHash('sha256').update(r.text).digest('hex')};references.push({...localReference,size:Buffer.byteLength(r.text)});}
  }
  const lighting=resolveGlobalLighting(texts,options.preset??'DefaultLight',index);
  if(!lighting.found)issues.push({code:'LIGHTING_PRESET_FALLBACK',detail:options.preset??'DefaultLight'});
  if(lighting.environmentMap){const logical=safeCascPath(lighting.environmentMap);let bytes:Buffer|undefined;
   for(const pack of [...packages].reverse())try{bytes=await read(pack+'/base.sc2assets/'+logical,16*1024*1024);break;}catch(e){if(mustPropagate(e))throw e;}
   if(bytes)try{lighting.environmentCube=decodeAmbientCube(bytes);}catch(e){issues.push({code:'LIGHTING_ENVIRONMENT_UNSUPPORTED',detail:String(e)});}else issues.push({code:'LIGHTING_ENVIRONMENT_MISSING',detail:logical});
  }
  if(build&&(await this.casc.refreshBuild()).build.buildKey!==build)throw new Error('LIGHTING_BUILD_CHANGED');
  if(localReference&&createHash('sha256').update((await this.workspace.readRaw(localReference.file)).text).digest('hex')!==localReference.sha256)throw new Error('LIGHTING_LOCAL_CATALOG_CHANGED');
  return {lighting,issues,references,build,stateIndex:index,engineValidated:false as const};
 }
 async inspect(options:LightingResolveOptions={}){const result=await this.resolve(options);const {environmentCube,...lighting}=result.lighting;return {...result,lighting:{...lighting,environmentCube:environmentCube?{size:environmentCube.size,faces:environmentCube.faces.length,sha256:environmentCube.sha256}:undefined},equations:'Base98310 lighting.fx/lighttypes.fx/lightingmodels.fx/pstonemap.fx; runtime permutations, shadows and regions remain partial'};}
}
