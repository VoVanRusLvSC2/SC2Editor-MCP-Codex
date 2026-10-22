import * as z from 'zod/v4';
import {createHash} from 'node:crypto';
import {createLocationSchema} from '../placement/locationSchemas.js';
import {terrainLandscapeSchema,terrainLocationSchema} from './schemas.js';
import type {TerrainState,TerrainTouches} from './operations.js';
import type {PlacementDocument} from '../placement/document.js';
import {measuredGroupSchema} from '../placement/measuredGroups.js';
import {nativeTopologyPatchSchema,captureTopologyPatch} from './nativeTopologyOwnership.js';
import type {NativeGeometryCoverage} from './nativeGeometry.js';

const name=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const config=createLocationSchema.extend({terrain:terrainLocationSchema,includeUnits:z.literal(false).default(false),objectCount:z.number().int().min(0).max(5000).optional(),groups:z.array(measuredGroupSchema).max(16).default([])}).strict();
export const landscapeZoneSchema=z.object({id:name,dependsOn:z.array(name).max(31).default([]),purpose:z.string().max(160).default(''),condition:z.enum(['operational','abandoned','damaged','destroyed']).default('operational'),config}).strict();
export const landscapeIntentSchema=z.object({zones:z.array(landscapeZoneSchema).min(1).max(32)}).strict();
export const landscapePlanSchema=z.union([terrainLandscapeSchema,z.object({intent:landscapeIntentSchema}).strict()]);
export const LANDSCAPE_RECIPE_REVISION=3;
const hash=z.string().regex(/^[a-f0-9]{64}$/),encoded=z.string().max(2**24);
const run=z.object({offset:z.number().int().nonnegative(),before:encoded,after:encoded,mask:encoded}).strict();
const patch=z.object({file:z.enum(['t3HeightMap','t3SyncHeightMap','t3TextureMasks','t3SyncTextureInfo','t3SyncCliffLevel','t3CellFlags']),length:z.number().int().positive().max(2**27),header:encoded.optional(),runs:z.array(run).max(200000)}).strict();
export const landscapeStateSchema=z.object({version:z.literal(1),context:hash,zones:z.array(landscapeZoneSchema.extend({requestHash:hash,browseFingerprint:hash,generatorRevision:z.number().int().positive(),patches:z.array(patch).max(6),topology:nativeTopologyPatchSchema.optional(),objects:z.array(z.object({id:z.number().int().positive(),fingerprint:hash,slot:z.string().regex(/^(?:scatter:\d+|group:[A-Za-z][A-Za-z0-9_-]{0,63}:\d+)$/).optional()}).strict()).max(5000)}).strict()).max(32)}).strict();
export type LandscapeZone=z.infer<typeof landscapeZoneSchema>;
export type LandscapeState=z.infer<typeof landscapeStateSchema>;
type Patch=z.infer<typeof patch>;
export const landscapeHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const objectFingerprints=(document:PlacementDocument)=>new Map(document.list().flatMap(o=>o.id===undefined?[]:[[o.id,landscapeHash({...o,nodeId:undefined})] as const]));
export const objectFingerprint=(document:PlacementDocument,id:number)=>{const o=document.list().find(o=>o.id===id);return o?landscapeHash({...o,nodeId:undefined}):null;};
export function landscapeOrder(zones:readonly Pick<LandscapeZone,'id'|'dependsOn'>[]):string[]{
 const byId=new Map(zones.map(z=>[z.id,z]));if(byId.size!==zones.length)throw Error('LANDSCAPE_DUPLICATE_ZONE');
 const visited=new Set<string>(),active=new Set<string>(),order:string[]=[];
 const visit=(id:string)=>{if(visited.has(id))return;if(active.has(id))throw Error('LANDSCAPE_DEPENDENCY_CYCLE: '+id);const zone=byId.get(id);if(!zone)throw Error('LANDSCAPE_DEPENDENCY_MISSING: '+id);active.add(id);for(const parent of zone.dependsOn)visit(parent);active.delete(id);visited.add(id);order.push(id);};
 for(const id of byId.keys())visit(id);return order;
}
export function landscapeClosure(zones:readonly Pick<LandscapeZone,'id'|'dependsOn'>[],roots:Iterable<string>):Set<string>{
 const result=new Set(roots);let changed=true;while(changed){changed=false;for(const z of zones)if(!result.has(z.id)&&z.dependsOn.some(id=>result.has(id))){result.add(z.id);changed=true;}}return result;
}
export function landscapeAncestors(zones:readonly Pick<LandscapeZone,'id'|'dependsOn'>[],id:string):Set<string>{
 const byId=new Map(zones.map(z=>[z.id,z])),out=new Set<string>();const add=(key:string)=>{for(const p of byId.get(key)?.dependsOn??[])if(!out.has(p)){out.add(p);add(p);}};add(id);return out;
}
export function landscapeContext(s:TerrainState):string{
 const d=s.descriptor;
 return landscapeHash({version:d.version,width:d.width,height:d.height,scale:d.scale,offset:d.offset,quantizeScale:d.quantizeScale,quantizeBias:d.quantizeBias,tileSet:d.heightMap.attrs.tileSet,textures:d.textures,blocks:d.parsed.nodes.filter(n=>n.tag==='blockTextureSet').map(n=>n.attrs),cliffs:d.cliffSets,headers:['t3HeightMap','t3SyncHeightMap','t3TextureMasks'].map(file=>s.sources.get(file)?.subarray(0,file==='t3HeightMap'?32:64).toString('base64')),syncHeader:s.syncTextures?.bytes.subarray(0,s.syncTextures.dataOffset).toString('base64')});
}
function decode(text:string):Buffer{const b=Buffer.from(text,'base64');if(b.toString('base64')!==text)throw Error('LANDSCAPE_OWNERSHIP_ENCODING');return b;}
function decoded(p:Patch,r:Patch['runs'][number]){
 const before=decode(r.before),after=decode(r.after),mask=decode(r.mask);
 if(!before.length||before.length!==after.length||before.length!==mask.length||r.offset+before.length>p.length||mask.some(v=>v===0))throw Error('LANDSCAPE_OWNERSHIP_RANGE');
 return {before,after,mask};
}
export function restoreLandscapePatch(sources:Map<string,Buffer>,patches:readonly Patch[],zone:string){
 for(const p of patches){const b=sources.get(p.file);if(!b||b.length!==p.length)throw Error('LANDSCAPE_COMPONENT_LAYOUT_CHANGED: '+p.file);let end=0;
  if(p.header){const h=decode(p.header);if(h.length!==32||!b.subarray(0,32).equals(h))throw Error('LANDSCAPE_COMPONENT_LAYOUT_CHANGED: '+p.file+' header');}
  for(const r of p.runs){const {before,after,mask}=decoded(p,r);if(r.offset<end)throw Error('LANDSCAPE_OWNERSHIP_OVERLAPPING_RUNS');end=r.offset+mask.length;
   for(let i=0;i<mask.length;i++){const at=r.offset+i;if((b[at]&mask[i])!==(after[i]&mask[i]))throw Error(`LANDSCAPE_OWNED_TERRAIN_CHANGED: ${zone} ${p.file}@${at}`);b[at]=(b[at]&~mask[i])|(before[i]&mask[i]);}
  }
 }
}
/** Records actual brush coverage, including writes whose resulting values are unchanged. */
export class LandscapeTouches implements TerrainTouches {
 readonly masks=new Map<string,Buffer>();
 readonly nativeCells=new Set<number>();
 nativeTouched=false;
 constructor(readonly state:TerrainState){}
 private mark(file:string,offset:number,length:number,bits=255){const source=this.state.sources.get(file);if(!source||offset<0||offset+length>source.length)throw Error('LANDSCAPE_TOUCH_OUTSIDE_COMPONENT');let mask=this.masks.get(file);if(!mask){mask=Buffer.alloc(source.length);this.masks.set(file,mask);}for(let i=offset;i<offset+length;i++)mask[i]|=bits;}
 height(x:number,y:number){const i=y*this.state.heights.width+x;this.mark('t3HeightMap',32+i*6,6);this.mark('t3SyncHeightMap',64+i*4,4);}
 texture(x:number,y:number){const masks=this.state.masks!,sync=this.state.syncTextures!;for(let layer=0;layer<8;layer++)this.mark('t3TextureMasks',masks.byteIndex(x,y,layer),1,x%2?15:240);this.mark('t3SyncTextureInfo',sync.dataOffset+(Math.floor(y/8)*sync.width+Math.floor(x/8))*8,1);}
 nativeGeometry(coverage:NativeGeometryCoverage){
  this.nativeTouched=true;
  for(const i of coverage.vertices){this.mark('t3HeightMap',32+i*6,5);this.mark('t3SyncHeightMap',64+i*4,2);}
  const width=this.state.heights.width-1,coarseWidth=width/2;
  for(const i of coverage.cells){this.nativeCells.add(i);const x=i%coarseWidth*2,y=Math.floor(i/coarseWidth)*2;
   for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const cell=(y+dy)*width+x+dx;this.mark('t3SyncCliffLevel',32+cell*2,2);this.mark('t3CellFlags',32+cell,1,1);}
  }
 }
 topology(before:Map<string,Buffer>,after:Map<string,Buffer>){return this.nativeTouched?captureTopologyPatch(before.get('t3Terrain.xml')!.toString('utf8'),after.get('t3Terrain.xml')!.toString('utf8'),this.nativeCells):undefined;}
 patches(before:Map<string,Buffer>,after:Map<string,Buffer>):Patch[]{
  for(const [file,b]of before){if(file==='t3Terrain.xml'&&this.nativeTouched){this.topology(before,after);continue;}const a=after.get(file);if(!a||a.length!==b.length)throw Error('LANDSCAPE_COMPONENT_LAYOUT_CHANGED: '+file);const m=this.masks.get(file);for(let i=0;i<b.length;i++)if(((b[i]^a[i])&~(m?.[i]??0))!==0)throw Error('LANDSCAPE_UNTRACKED_WRITE: '+file);}
  return [...this.masks].map(([file,mask])=>{const b=before.get(file)!,a=after.get(file)!,runs:Patch['runs']=[];for(let i=0;i<mask.length;){if(!mask[i]){i++;continue;}const start=i;while(i<mask.length&&mask[i]&&i-start<65536)i++;runs.push({offset:start,before:b.subarray(start,i).toString('base64'),after:a.subarray(start,i).toString('base64'),mask:mask.subarray(start,i).toString('base64')});}return {file:file as Patch['file'],length:mask.length,...['t3SyncCliffLevel','t3CellFlags'].includes(file)?{header:b.subarray(0,32).toString('base64')}:{},runs};});
 }
 conflicts(patches:readonly Patch[]):boolean{
  for(const p of patches){const m=this.masks.get(p.file);if(!m)continue;if(m.length!==p.length)throw Error('LANDSCAPE_COMPONENT_LAYOUT_CHANGED: '+p.file);for(const r of p.runs){const {mask}=decoded(p,r);for(let i=0;i<mask.length;i++)if(m[r.offset+i]&mask[i])return true;}}return false;
 }
}
