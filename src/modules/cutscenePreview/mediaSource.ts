import {safeCascPath} from '../casc/workspace.js';

/** Locale assets can also live under Assets/Textures, not only LocalizedData.
 * Resolve each dependency's selected locale before its base assets. */
export async function resolveGameMedia(logical:string,packages:string[],locale:'enUS'|'ruRU',
 read:(file:string)=>Promise<Buffer>,locate:(logical:string,area:string)=>Promise<string|undefined>){
 logical=safeCascPath(logical);
 const explicit=/^(mods|campaigns)\//.test(logical),area=locale.toLowerCase()+'.sc2assets';
 const localized=logical.startsWith('localizeddata/');
 const paths=explicit?[logical]:[...packages].reverse().flatMap(pack=>[
  pack+'/'+area+'/'+logical,
  ...(!localized||logical.endsWith('.fxa')?[pack+'/base.sc2assets/'+logical]:[])
 ]);
 for(const file of paths)try{return {bytes:await read(file),source:file};}
 catch(error){if(/BUILD_CHANGED|BUDGET/.test(String(error)))throw error;}
 if(explicit)return undefined;
 for(const layer of [area,...(!localized||logical.endsWith('.fxa')?['base.sc2assets']:[])]){
  const file=await locate(logical,layer);
  if(file)return {bytes:await read(file),source:file};
 }
 return undefined;
}
