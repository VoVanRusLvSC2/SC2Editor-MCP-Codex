import {inspectArchive,readArchiveEntry} from './archiveAdapter.js';
import {inspectTerrainLoadContract} from '../modules/terrain/loadContract.js';

/** Bounded neutral reads; no extraction, source mutation or engine process. */
export async function readArchiveTerrainLoadContract(archive:string,manifest?:unknown){
 const m=(manifest??await inspectArchive(archive))as {entries?:Array<{name:string}>};
 const entries=m.entries??[],xml=entries.find(e=>e.name.toLowerCase()==='t3terrain.xml'),sync=entries.find(e=>e.name.toLowerCase()==='t3syncheightmap');
 if(!xml&&!sync)return {kind:'absent' as const};
 const files=new Map<string,Buffer>();
 try{
  if(xml)files.set('t3Terrain.xml',await readArchiveEntry(archive,xml.name));
  if(sync)files.set('t3SyncHeightMap',await readArchiveEntry(archive,sync.name));
  const result=inspectTerrainLoadContract(files);
  if(!xml)return {kind:'checked' as const,result:{...result,issues:[{severity:'error' as const,code:'TERRAIN_LOAD_XML_MISSING',message:'A sync grid exists without t3Terrain.xml'}]}};
  return {kind:'checked' as const,result};
 }catch(e){return {kind:'unavailable' as const,reason:String(e).slice(0,640)};}
}
