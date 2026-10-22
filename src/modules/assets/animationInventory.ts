import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {Workspace} from '../../core/workspace.js';
import {safeCascPath,type CascWorkspace} from '../casc/workspace.js';
import {readM3Metadata} from '../cutscene/assets.js';

export interface AnimationAssetSource {root:string;package?:string}
export interface AnimationModelInventory {
 file:string;sha256:string;revision:string;animations:string[];
 assets:Array<{resource:string;file:string;sha256:string;build?:string}>;
 warnings:string[];supplementalCoverage:'resolved'|'partial';
}
const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
async function guardedFile(root:string,relative:string){
 const base=path.resolve(root),file=path.resolve(base,relative),within=path.relative(base,file);
 if(!within||path.isAbsolute(within)||within==='..'||within.startsWith('..'+path.sep))throw Error('UNIT_ANIMATION_ASSET_PATH_SCOPE');
 let current=base;
 for(const part of ['',...within.split(path.sep)]){
  if(part)current=path.join(current,part);
  try{if((await fs.lstat(current)).isSymbolicLink())throw Error('UNIT_ANIMATION_ASSET_REPARSE_REFUSED');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')break;throw e;}
 }
 const stat=await fs.stat(file).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});
 if(stat&&(!stat.isFile()||stat.size>64*1024*1024))throw Error('UNIT_ANIMATION_ASSET_FILE_LIMIT');
 return file;
}
/** Actual installed/imported bytes, never a caller-provided sequence list.
 * Source order is supplied by the declared Data graph, highest priority first. */
export async function readAnimationInventory(workspace:Workspace,casc:Pick<CascWorkspace,'read'>,resources:string[],sources:AnimationAssetSource[]):Promise<AnimationModelInventory>{
 if(!resources.length||resources.length>8||!sources.length||sources.length>64)throw Error('UNIT_ANIMATION_ASSET_INPUT_LIMIT');
 const assets:AnimationModelInventory['assets']=[],animations=new Set<string>(),warnings:string[]=[];let total=0;
 for(const [index,resource]of resources.entries()){
  safeCascPath(resource);if(!/\.m3a?$/i.test(resource))throw Error('UNIT_ANIMATION_M3_RESOURCE_REQUIRED');
  if(!index&&!/\.m3$/i.test(resource))throw Error('UNIT_ANIMATION_PRIMARY_M3_REQUIRED');
  const relative=resource.replaceAll('\\','/');let found:{file:string;bytes:Buffer;build?:string}|undefined;
  for(const source of sources){
   const local:Array<{file:string;bytes:Buffer}>=[];
   for(const candidate of [relative,'Base.SC2Assets/'+relative]){
    const file=await guardedFile(source.root,candidate);
    if([...workspace.draftFiles(),...workspace.binary.draftFiles()].some(f=>path.relative(path.resolve(workspace.root,f),file)===''))throw Error('UNIT_ANIMATION_ASSET_PENDING_DRAFT');
    const bytes=await workspace.readBinaryDependency(file,true);
    if(bytes.length>64*1024*1024)throw Error('UNIT_ANIMATION_ASSET_FILE_LIMIT');
    if(bytes.length)local.push({file,bytes});
    else if(await fs.stat(file).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;}))throw Error('UNIT_ANIMATION_ASSET_EMPTY');
   }
   if(local.length){if(local.some(f=>sha(f.bytes)!==sha(local[0].bytes)))throw Error('UNIT_ANIMATION_ASSET_OVERRIDE_AMBIGUOUS');found=local[0];break;}
   if(source.package){
    const file=safeCascPath(source.package+'/base.sc2assets/'+relative);
    try{const read=await casc.read(file);found={file,bytes:read.bytes,build:read.metadata.buildKey};break;}catch(e){if(!(e instanceof Error)||e.message!=='CASC_FILE_NOT_FOUND')throw e;}
   }
  }
  if(!found){if(!index)throw Error('UNIT_ANIMATION_MODEL_ASSET_MISSING: '+resource);warnings.push('Supplemental animation asset unavailable: '+resource);continue;}
  total+=found.bytes.length;if(total>128*1024*1024)throw Error('UNIT_ANIMATION_ASSET_TOTAL_LIMIT');
  const metadata=readM3Metadata(found.bytes);if(!metadata.valid)throw Error('UNIT_ANIMATION_MODEL_METADATA_INVALID: '+resource);
  if(index&&!metadata.animations.length)warnings.push('No readable supplemental sequence names: '+resource);
  assets.push({resource,file:found.file,sha256:sha(found.bytes),...found.build?{build:found.build}:{}});
  for(const name of metadata.animations)animations.add(name);
 }
 return {file:assets[0].file,sha256:assets[0].sha256,revision:sha(JSON.stringify({assets,warnings})),animations:[...animations].sort(),assets,warnings,supplementalCoverage:warnings.length?'partial':'resolved'};
}
