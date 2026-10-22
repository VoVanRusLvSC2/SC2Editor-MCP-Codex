import * as z from 'zod/v4';
import {scanXml} from '../../core/xmlScanner.js';
import {parseTerrainXml} from './surface/format/terrain-params.js';
import {attributesXml,patchGeometrySection} from './nativeGeometry.js';

const row=z.object({key:z.string().min(1).max(512),before:z.string().max(8192).nullable(),after:z.string().max(8192).nullable()}).strict();
export const nativeTopologyPatchSchema=z.object({cells:z.array(row.extend({key:z.string().regex(/^(?:0|[1-9]\d*)$/)})).max(65536),ramps:z.array(row.extend({before:z.null(),after:z.string().min(1).max(8192)})).max(1024),cellCount:z.string().regex(/^[1-9]\d*$/)}).strict();
export type NativeTopologyPatch=z.infer<typeof nativeTopologyPatchSchema>;
type Rows=Map<string,{xml:string;attrs:Record<string,string>}>;
const equivalent=(a:Record<string,string>|undefined,b:Record<string,string>|undefined)=>JSON.stringify(a&&Object.entries(a).sort())===JSON.stringify(b&&Object.entries(b).sort());
function rowAttributes(xml:string|null,tag:string){if(xml===null)return undefined;const p=scanXml(xml),n=p.nodes.find(n=>n.parentId===null);if(p.diagnostics.some(d=>d.severity==='error')||!n||n.tag!==tag||n.start!==0||n.end!==xml.length||n.childIds.length)throw Error('LANDSCAPE_TOPOLOGY_ROW_INVALID');return n.attrs;}

export function topologyRows(xml:string){
 const p=scanXml(xml),terrain=parseTerrainXml(xml),hm=p.nodes.find(n=>n.tag==='heightMap');
 const section=(tag:string)=>p.nodes.find(n=>n.tag===tag&&n.parentId===hm?.id);
 const cc=section('cliffCellList'),rr=section('rampList');
 if(!cc||!rr)throw Error('LANDSCAPE_TOPOLOGY_LISTS_REQUIRED');
 const cells:Rows=new Map(),ramps:Rows=new Map();
 for(const n of cc.childIds.map(id=>p.nodes[id])){
  if(n.tag!=='cc'||n.childIds.length||!/^(?:0|[1-9]\d*)$/.test(n.attrs.i??''))throw Error('LANDSCAPE_TOPOLOGY_ROW_INVALID');
  if(cells.has(n.attrs.i))throw Error('LANDSCAPE_TOPOLOGY_DUPLICATE_CELL');cells.set(n.attrs.i,{xml:xml.slice(n.start,n.end),attrs:n.attrs});
 }
 const nodes=rr.childIds.map(id=>p.nodes[id]);
 if(nodes.length!==(terrain.ramps?.length??0))throw Error('LANDSCAPE_TOPOLOGY_RAMP_LAYOUT');
 for(const [i,n]of nodes.entries()){
  const mid=terrain.ramps![i].frames.mid;
  if(n.tag!=='ramp'||n.childIds.length||!mid)throw Error('LANDSCAPE_TOPOLOGY_RAMP_IDENTITY_UNSUPPORTED');
  const key=JSON.stringify([mid.center,mid.up,mid.right,mid.width,mid.height]);
  if(ramps.has(key))throw Error('LANDSCAPE_TOPOLOGY_DUPLICATE_RAMP');ramps.set(key,{xml:xml.slice(n.start,n.end),attrs:n.attrs});
 }
 let outside=xml;
 for(const n of [cc,rr].sort((a,b)=>b.start-a.start)){
  const attrs={...n.attrs};delete attrs.num;delete attrs.numOccupied;
  outside=outside.slice(0,n.start)+`[${n.tag}:${JSON.stringify(Object.entries(attrs).sort())}]`+outside.slice(n.end);
 }
 return {cells,ramps,outside,cellAttrs:cc.attrs,rampAttrs:rr.attrs};
}

/** Only touched native rows belong to a zone; the variable-length XML component
 * itself must never become a whole-map byte patch. Empty touched cells are also
 * recorded, so an unchanged write cannot hide a later manual insertion. */
export function captureTopologyPatch(before:string,after:string,cellCoverage:ReadonlySet<number>):NativeTopologyPatch{
 const a=topologyRows(before),b=topologyRows(after);
 if(a.outside!==b.outside)throw Error('LANDSCAPE_TOPOLOGY_LAYOUT_CHANGED: prepare the foundation before defining native regions');
 const cells:NativeTopologyPatch['cells']=[],ramps:NativeTopologyPatch['ramps']=[];
 const cellKeys=new Set([...a.cells.keys(),...b.cells.keys(),...[...cellCoverage].map(String)]);
 for(const key of cellKeys){const old=a.cells.get(key),next=b.cells.get(key);
  if(!equivalent(old?.attrs,next?.attrs)&&!cellCoverage.has(Number(key)))throw Error('LANDSCAPE_UNTRACKED_NATIVE_CELL: '+key);
  if(cellCoverage.has(Number(key)))cells.push({key,before:old?.xml??null,after:next?.xml??null});
 }
 for(const key of new Set([...a.ramps.keys(),...b.ramps.keys()])){
  const old=a.ramps.get(key),next=b.ramps.get(key);if(equivalent(old?.attrs,next?.attrs))continue;
  // The current public intent creates ramps. Rebuild removes them through their
  // own preimage; arbitrary deletion/replacement of an unowned ramp is forbidden.
  if(old)throw Error('LANDSCAPE_UNOWNED_RAMP_REPLACEMENT');
  ramps.push({key,before:null,after:next!.xml});
 }
 return nativeTopologyPatchSchema.parse({cells,ramps,cellCount:a.cellAttrs.num});
}

export function topologyConflicts(a:NativeTopologyPatch|undefined,b:NativeTopologyPatch|undefined){
 if(!a||!b)return false;
 const cells=new Set(b.cells.map(v=>v.key)),ramps=new Set(b.ramps.map(v=>v.key));
 return a.cells.some(v=>cells.has(v.key))||a.ramps.some(v=>ramps.has(v.key));
}

export function restoreTopologyPatch(sources:Map<string,Buffer>,patch:NativeTopologyPatch|undefined,zone:string){
 if(!patch)return;
 const xml=sources.get('t3Terrain.xml')?.toString('utf8');if(!xml)throw Error('LANDSCAPE_TOPOLOGY_XML_REQUIRED');
 const current=topologyRows(xml);
 if(current.cellAttrs.num!==patch.cellCount)throw Error('LANDSCAPE_COMPONENT_LAYOUT_CHANGED: native cliff lattice');
 const restore=(rows:Rows,edits:NativeTopologyPatch['cells'],tag:string)=>{
  const seen=new Set<string>();
  for(const edit of edits){
   if(seen.has(edit.key))throw Error('LANDSCAPE_TOPOLOGY_DUPLICATE_PATCH');seen.add(edit.key);
   const before=rowAttributes(edit.before,tag),after=rowAttributes(edit.after,tag);
   if(tag==='cc'&&[before,after].some(v=>v&&v.i!==edit.key))throw Error('LANDSCAPE_TOPOLOGY_CELL_KEY_MISMATCH');
   if(!equivalent(rows.get(edit.key)?.attrs,after))throw Error(`LANDSCAPE_OWNED_TOPOLOGY_CHANGED: ${zone} ${edit.key}`);
   if(edit.before===null)rows.delete(edit.key);
   else rows.set(edit.key,{xml:edit.before,attrs:before!});
  }
 };
 restore(current.cells,patch.cells,'cc');restore(current.ramps,patch.ramps,'ramp');
 const cells=[...current.cells].sort(([a],[b])=>Number(a)-Number(b)).map(([,v])=>v.xml).join('');
 const ramps=[...current.ramps.values()].map(v=>v.xml).join('');
 let next=patchGeometrySection(xml,'cliffCellList',`<cliffCellList ${attributesXml({...current.cellAttrs,numOccupied:current.cells.size})}>${cells}</cliffCellList>`);
 next=patchGeometrySection(next,'rampList',`<rampList ${attributesXml({...current.rampAttrs,num:current.ramps.size})}>${ramps}</rampList>`);
 topologyRows(next);sources.set('t3Terrain.xml',Buffer.from(next));
}
