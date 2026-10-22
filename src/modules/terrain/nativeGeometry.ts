import {scanXml} from '../../core/xmlScanner.js';
import {TerrainDescriptor,HeightMap,SyncHeightMap} from './document.js';
import {parseTerrainXml} from './surface/format/terrain-params.js';
import type {TerrainState} from './operations.js';
import type {TerrainOperation} from './types.js';
import {CARDINAL_RAMP_VERTICES,CARDINAL_RAMP_CELLS} from './rampProfile.js';
import {nativeCliffSyncLevels,nativeCliffFineLevels} from './cliffProfile.js';

export interface NativeGeometryReport {walls:number;ramps:number;changedVertices:number;changedCells:number;profile:string;engineValidated:false}
export interface NativeGeometryCoverage {vertices:ReadonlySet<number>;cells:ReadonlySet<number>}
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const offsetFor=(level:number)=>level===0?-8:(level-1)*2;
const integer=(v:unknown,name:string,min:number,max:number)=>{if(typeof v!=='number'||!Number.isInteger(v)||v<min||v>max)throw new Error('NATIVE_GEOMETRY_PARAMETER: '+name);return v;};
const frame=(u:number[],r:number[],c:number[],w:number,h:number)=>`u(${u.join(', ')}) r(${r.join(', ')}) c=(${c.join(', ')}) w=${w} h=${h}`;
const rotations:Record<string,number>={west:0,south:1,east:2,north:3};
// Native dir is an enum, not eight evenly spaced compass headings. The original
// City corpus uses 2=west, 0=south, 3=east, 1=north; values 4..7 are diagonals.
const nativeDirections=[2,0,3,1];
function rotate(x:number,y:number,q:number):[number,number]{for(let i=0;i<q;i++)[x,y]=[-y,x];return [x,y];}
export function patchGeometrySection(source:string,tag:string,fragment:string){const p=scanXml(source),hm=p.nodes.find(n=>n.tag==='heightMap'),n=p.nodes.find(n=>n.tag===tag&&n.parentId===hm?.id);if(!n){if(!hm)throw new Error('NATIVE_GEOMETRY_HEIGHTMAP_REQUIRED');return source.slice(0,hm.endTagStart)+fragment+source.slice(hm.endTagStart);}return source.slice(0,n.start)+fragment+source.slice(n.end);}
const patchSection=patchGeometrySection;
export const attributesXml=(attrs:Record<string,string|number>)=>Object.entries(attrs).map(([key,value])=>`${key}="${String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')}"`).join(' ');
function geometryListAttributes(source:string,tag:string){const p=scanXml(source),hm=p.nodes.find(n=>n.tag==='heightMap');return p.nodes.find(n=>n.tag===tag&&n.parentId===hm?.id)?.attrs??{};}
function requireGeometryListContents(source:string){
 const p=scanXml(source),hm=p.nodes.find(n=>n.tag==='heightMap');
 for(const [listTag,rowTag]of [['cliffCellList','cc'],['rampList','ramp']]){
  const list=p.nodes.find(n=>n.tag===listTag&&n.parentId===hm?.id);if(!list)continue;
  let end=list.startTagEnd;
  for(const row of list.childIds.map(id=>p.nodes[id])){
   if(row.tag!==rowTag||row.childIds.length||source.slice(end,row.start).trim()||source.slice(row.startTagEnd,row.endTagStart).trim())throw Error('NATIVE_GEOMETRY_UNKNOWN_LIST_CONTENT: '+listTag);
   end=row.end;
  }
  if(source.slice(end,list.endTagStart).trim())throw Error('NATIVE_GEOMETRY_UNKNOWN_LIST_CONTENT: '+listTag);
 }
}
function patchQuantization(s:TerrainState,bias:number){const old=s.descriptor,q=bias*2/65535,b=s.heights.bytes;for(let y=0;y<s.heights.height;y++)for(let x=0;x<s.heights.width;x++){const at=32+(y*s.heights.width+x)*6;for(const lane of [0,2]){const world=b.readUInt16LE(at+lane)*old.quantizeScale-old.quantizeBias;b.writeUInt16LE(clamp(Math.round((world+bias)/q),0,65535),at+lane);}}const node=old.vert,patches=node.attrSpans.filter(a=>['quantizeScale','quantizeBias'].includes(a.name)).map(a=>({start:a.valueStart,end:a.valueEnd,text:a.name==='quantizeBias'?String(bias):q.toPrecision(12)}));let xml=old.source;for(const p of patches.sort((a,b)=>b.start-a.start))xml=xml.slice(0,p.start)+p.text+xml.slice(p.end);s.descriptor=new TerrainDescriptor(xml);s.heights=new HeightMap(b,s.descriptor);s.sources.set('t3Terrain.xml',Buffer.from(xml));}
function requireProfile(s:TerrainState){const w=s.heights.width-1,h=s.heights.height-1,c=s.sources.get('t3SyncCliffLevel'),f=s.sources.get('t3CellFlags'),sync=s.sources.get('t3SyncHeightMap');if(s.descriptor.version!==115||s.descriptor.scale.some(v=>v!==1)||s.descriptor.offset.some(v=>v!==0)||w%2||h%2)throw new Error('NATIVE_GEOMETRY_PROFILE_REQUIRES_V115_IDENTITY_EVEN_GRID');if(!c||c.toString('ascii',0,4)!=='CLIF'||c.readUInt32LE(4)!==100||c.length!==32+w*h*2||!f||f.toString('ascii',0,4)!=='LFCT'||f.readUInt32LE(4)!==102||f.length!==32+w*h||!sync||!s.sync)throw new Error('NATIVE_GEOMETRY_COMPANION_PROFILE_REQUIRED');if(s.sources.get('Terrain')?.length)throw new Error('NATIVE_GEOMETRY_OPAQUE_TERRAIN_CACHE_UNSUPPORTED');const parsed=parseTerrainXml(s.descriptor.source);if(parsed.ramps?.some(r=>r.rampHardTileHandles))throw new Error('NATIVE_GEOMETRY_RAMP_HARD_TILE_HANDLES_UNSUPPORTED');return {w,h,c,f,sync,parsed};}
/** One-time preparation is separate from regional ownership. Preserve world
 * heights within quantization precision and retain SMAP residuals. Existing
 * registered topology is never globally requantized by this helper. */
export function prepareNativeGeometryFoundation(s:TerrainState,minimumBias=0){
 if(!Number.isFinite(minimumBias)||minimumBias<0||minimumBias>128)throw Error('NATIVE_FOUNDATION_BIAS_RANGE');
 requireGeometryListContents(s.descriptor.source);
 const p=requireProfile(s),before=Buffer.from(s.heights.bytes),xmlBefore=s.descriptor.source;
 const original=new HeightMap(before,s.descriptor),vertices=new Set<number>();
 if(!p.parsed.cliffCells?.length&&!p.parsed.ramps?.length){
  let needed=minimumBias;
  for(let y=0;y<=p.h;y++)for(let x=0;x<=p.w;x++){
   const level=s.heights.mask(x,y)&255;if(level>3)throw Error('NATIVE_GEOMETRY_UNSUPPORTED_VERTEX_LEVEL');
   needed=Math.max(needed,Math.abs(s.heights.z(x,y)-offsetFor(level))+.5);
  }
  if(needed>s.descriptor.quantizeBias)patchQuantization(s,Math.ceil(needed));
  const d=s.descriptor,b=s.heights.bytes;
  for(let y=0;y<=p.h;y++)for(let x=0;x<=p.w;x++){
   const at=32+(y*(p.w+1)+x)*6,level=b.readUInt16LE(at+4)&255,z=original.z(x,y);
   const adj=offsetFor(level),qa=Math.round((adj+d.quantizeBias)/d.quantizeScale);
   // Quantize the sum once. Independently rounding both lanes at a half-integer
   // bias drifts one quantum on every supposedly unchanged preparation.
   const qb=Math.round((z+2*d.quantizeBias)/d.quantizeScale)-qa;
   if(Math.min(qb,qa)<0||Math.max(qb,qa)>65535)throw Error('NATIVE_GEOMETRY_QUANTIZATION_RANGE');
   b.writeUInt16LE(qb,at);b.writeUInt16LE(qa,at+2);
   if(!b.subarray(at,at+6).equals(before.subarray(at,at+6)))vertices.add(y*(p.w+1)+x);
  }
 }
 let xml=s.descriptor.source;
 const parsed=scanXml(xml),hm=parsed.nodes.find(n=>n.tag==='heightMap');
 for(const [tag,fragment]of [['cliffCellList',`<cliffCellList num="${p.w*p.h/4}" numOccupied="0"/>`],['rampList','<rampList num="0"/>']])if(!parsed.nodes.some(n=>n.tag===tag&&n.parentId===hm?.id))xml=patchSection(xml,tag,fragment);
 if(xml!==s.descriptor.source){s.sources.set('t3Terrain.xml',Buffer.from(xml));s.descriptor=new TerrainDescriptor(xml);}
 s.heights=new HeightMap(s.heights.bytes,s.descriptor);s.sync=new SyncHeightMap(p.sync,s.heights);
 let maxWorldDelta=0;for(let y=0;y<=p.h;y++)for(let x=0;x<=p.w;x++)maxWorldDelta=Math.max(maxWorldDelta,Math.abs(s.heights.z(x,y)-original.z(x,y)));
 if(maxWorldDelta>Math.max(original.descriptor.quantizeScale,s.descriptor.quantizeScale)*1.01)throw Error('NATIVE_FOUNDATION_HEIGHT_PRESERVATION_FAILED');
 return {changed:vertices.size>0||xmlBefore!==s.descriptor.source,vertices,maxWorldDelta};
}
/** Writes native geometry components, not doodads or blocker units. Supported profile is explicit. */
export function editNativeGeometry(s:TerrainState,operation:Extract<TerrainOperation,{op:'cliff.paint'|'cliff.repair'|'ramp.create'|'ramp.remove'|'ramp.repair'|'pathing.paint'}>,coverage?:(value:NativeGeometryCoverage)=>void):NativeGeometryReport{
 requireGeometryListContents(s.descriptor.source);
 const p=requireProfile(s),b=s.heights.bytes,initial=s.descriptor,dirty=new Set<number>(),dirtyCells=new Set<number>(),rampOwned=new Map<number,number>(),cells=new Map((p.parsed.cliffCells??[]).map(c=>[c.index,c])),ramps=[...(p.parsed.ramps??[])];const at=(x:number,y:number)=>32+(y*(p.w+1)+x)*6;
 const adjustment=(x:number,y:number)=>b.readUInt16LE(at(x,y)+2)*s.descriptor.quantizeScale-s.descriptor.quantizeBias;
 const level=(x:number,y:number)=>b.readUInt16LE(at(x,y)+4)&255;
 const setVertex=(x:number,y:number,base:number,adj:number,l:number)=>{if(x<0||y<0||x>p.w||y>p.h)throw new Error('NATIVE_GEOMETRY_OUTSIDE_MAP');const i=at(x,y),d=s.descriptor;const qb=Math.round((base+d.quantizeBias)/d.quantizeScale),qa=Math.round((adj+d.quantizeBias)/d.quantizeScale);if(Math.min(qb,qa)<0||Math.max(qb,qa)>65535)throw new Error('NATIVE_GEOMETRY_QUANTIZATION_RANGE');b.writeUInt16LE(qb,i);b.writeUInt16LE(qa,i+2);b.writeUInt16LE((b.readUInt16LE(i+4)&0xff00)|l,i+4);dirty.add(y*(p.w+1)+x);};
 const standard=Number(initial.vert.attrs.standardHeight??8),params=operation.parameters;
 // Existing procedural edits used the adjustment lane. Migrate only a flat document,
 // retaining every world height and all native geometry in already-authored documents.
 if(!['cliff.repair','ramp.repair'].includes(operation.op)&&!cells.size&&!ramps.length){const prepared=prepareNativeGeometryFoundation(s);if(coverage&&prepared.changed)throw Error('LANDSCAPE_NATIVE_PREPARATION_REQUIRED');for(const v of prepared.vertices)dirty.add(v);}
 const touchesExisting=(minX:number,minY:number,maxX:number,maxY:number)=>ramps.some(r=>{const mid=r.frames.mid;if(!mid)return true;const c=mid.center,rx=Math.abs(mid.up[0])*2+Math.abs(mid.right[0])*3,ry=Math.abs(mid.up[1])*2+Math.abs(mid.right[1])*3;return c[0]+rx>=minX&&c[0]-rx<=maxX&&c[1]+ry>=minY&&c[1]-ry<=maxY;});
 if(operation.op==='cliff.paint'){
  if(operation.area?.type!=='rectangle')throw new Error('NATIVE_CLIFF_REQUIRES_RECTANGLE');const a=operation.area,lo=integer(params.level,'level',0,3),cid=integer(params.cliffSet??0,'cliffSet',0,63),variation=integer(params.variation??0,'variation',0,3);if(!s.descriptor.cliffSets.some(c=>Number(c.i)===cid))throw new Error('NATIVE_CLIFF_SET_UNAVAILABLE');for(const n of [a.minX,a.minY,a.maxX,a.maxY])if(!Number.isInteger(n)||n%2)throw new Error('NATIVE_CLIFF_REQUIRES_TWO_CELL_GRID');if(a.minX<2||a.minY<2||a.maxX>p.w-2||a.maxY>p.h-2)throw new Error('NATIVE_CLIFF_REQUIRES_TWO_CELL_MARGIN');if(touchesExisting(a.minX-2,a.minY-2,a.maxX+2,a.maxY+2))throw new Error('NATIVE_CLIFF_TOUCHES_EXISTING_RAMP');
  for(let y=a.minY;y<=a.maxY;y++)for(let x=a.minX;x<=a.maxX;x++)setVertex(x,y,standard,offsetFor(lo),lo);
  // The synchronization halo closes joins; it must not flatten authored hills
  // outside the requested stroke while registering the affected vertices.
  for(let y=a.minY-2;y<=a.maxY+2;y++)for(let x=a.minX-2;x<=a.maxX+2;x++){const l=level(x,y),base=b.readUInt16LE(at(x,y))*s.descriptor.quantizeScale-s.descriptor.quantizeBias;setVertex(x,y,base,adjustment(x,y),l);}
  for(let y=a.minY-2;y<a.maxY+2;y+=2)for(let x=a.minX-2;x<a.maxX+2;x+=2){const i=y/2*(p.w/2)+x/2,old=cells.get(i);cells.set(i,{index:i,flags:old?.flags??0,cliffSetIndex:cid,variation,attributes:old?.attributes});dirtyCells.add(i);}
 }else if(operation.op==='cliff.repair'){
  if(operation.area?.type!=='rectangle')throw Error('NATIVE_CLIFF_REQUIRES_RECTANGLE');
  const a=operation.area;
  for(const n of [a.minX,a.minY,a.maxX,a.maxY])if(!Number.isInteger(n)||n%2)throw Error('NATIVE_CLIFF_REQUIRES_TWO_CELL_GRID');
  if(a.minX<2||a.minY<2||a.maxX>p.w-2||a.maxY>p.h-2)throw Error('NATIVE_CLIFF_REQUIRES_TWO_CELL_MARGIN');
  if(touchesExisting(a.minX,a.minY,a.maxX,a.maxY))throw Error('NATIVE_CLIFF_TOUCHES_EXISTING_RAMP');
  if(Object.keys(params).length)throw Error('NATIVE_CLIFF_REPAIR_PARAMETERS_UNSUPPORTED');
  // Repair registered cliff cells only. Coarse corners, base heights, freeform
  // unregistered depressions and authored hiding are not replacement candidates.
  for(let y=a.minY;y<a.maxY;y+=2)for(let x=a.minX;x<a.maxX;x+=2){const i=y/2*(p.w/2)+x/2,c=cells.get(i);if(!c)continue;if(c.flags!==1)throw Error('NATIVE_CLIFF_REPAIR_CELL_PROFILE_UNSUPPORTED');dirtyCells.add(i);}
  if(!dirtyCells.size)return {walls:[...cells.values()].filter(c=>c.flags===1).length,ramps:ramps.length,changedVertices:0,changedCells:0,profile:'native-v115-cardinal-width4-p-98310',engineValidated:false};
 }else if(operation.op==='ramp.repair'){
  const index=integer(params.index,'index',0,ramps.length-1),r=ramps[index],mid=r.frames.mid;
  if(Object.keys(params).some(k=>k!=='index')||!mid||!r.rawAttributes||r.hi!==r.lo+1||![1,2].includes(r.lo))throw Error('NATIVE_RAMP_REPAIR_PROFILE_UNSUPPORTED');
  const q=[0,1,2,3].find(q=>mid.up.every((v,i)=>v===rotate(-1,0,q)[i])&&mid.right.every((v,i)=>v===rotate(0,1,q)[i]));
  if(q===undefined||mid.width!==1||mid.height!==2)throw Error('NATIVE_RAMP_REPAIR_PROFILE_UNSUPPORTED');
  if(r.dir===nativeDirections[q])return {walls:[...cells.values()].filter(c=>c.flags===1).length,ramps:ramps.length,changedVertices:0,changedCells:0,profile:'native-v115-cardinal-width4-p-98310',engineValidated:false};
  if(r.dir!==[2,4,6,0][q])throw Error('NATIVE_RAMP_REPAIR_UNKNOWN_DIRECTION');
  const [cx,cy]=mid.center;
  if(![cx,cy].every(Number.isInteger)||cx<4||cy<4||cx>p.w-4||cy>p.h-4||(q%2===0?(cx%2!==0||cy%2!==1):(cx%2!==1||cy%2!==0)))throw Error('NATIVE_RAMP_REPAIR_PROFILE_UNSUPPORTED');
  for(const [name,x,y,w,h]of [['leftLo',0,-2,1,2],['rightLo',0,2,1,2],['base',-1,0,3,1]] as const){const f=r.frames[name],[dx,dy]=rotate(x,y,q);if(!f||f.width!==w||f.height!==h||f.center[0]!==cx+dx||f.center[1]!==cy+dy||f.up.some((v,i)=>v!==mid.up[i])||f.right.some((v,i)=>v!==mid.right[i]))throw Error('NATIVE_RAMP_REPAIR_PROFILE_UNSUPPORTED');}
  for(const name of ['leftHi','rightHi'] as const){const f=r.frames[name];if((f?(f.width!==0||f.height!==0||f.up.some(Boolean)||f.right.some(Boolean)):!r.rawFrames?.[name])||Number(r.rawAttributes[name+'Var'])!==4294967295)throw Error('NATIVE_RAMP_REPAIR_PROFILE_UNSUPPORTED');}
  if(r.variations.leftLo!==0||r.variations.rightLo!==0)throw Error('NATIVE_RAMP_REPAIR_PROFILE_UNSUPPORTED');
  // Only the diagnosed old generator profile qualifies. Never relabel an
  // arbitrary native/hand-edited ramp merely because its direction looks odd.
  for(let row=0;row<7;row++)for(let col=0;col<5;col++){const [dx,dy]=rotate(col-2,row-3,q),x=cx+dx,y=cy+dy,v=CARDINAL_RAMP_VERTICES[row][col],base=b.readUInt16LE(at(x,y))*s.descriptor.quantizeScale-s.descriptor.quantizeBias;
   if(Math.abs(base-standard)>s.descriptor.quantizeScale*2||Math.abs(adjustment(x,y)-offsetFor(r.lo)-v[0])>s.descriptor.quantizeScale*2||level(x,y)!==r.lo+v[1]-1||p.sync.readInt16LE(64+(y*(p.w+1)+x)*4)!==Math.round((standard+offsetFor(r.lo))*256)+v[2])throw Error('NATIVE_RAMP_REPAIR_CHANNEL_MISMATCH');
  }
  for(let row=0;row<6;row++)for(let col=0;col<4;col++){const [dx,dy]=rotate(col-1.5,row-2.5,q),x=Math.floor(cx+dx),y=Math.floor(cy+dy),v=CARDINAL_RAMP_CELLS[row][col];if(p.c.readUInt16LE(32+(y*p.w+x)*2)!==r.lo*64+v[0]||(p.f[32+y*p.w+x]&1)!==v[1]||cells.get(Math.floor(y/2)*(p.w/2)+Math.floor(x/2))?.flags!==2)throw Error('NATIVE_RAMP_REPAIR_CHANNEL_MISMATCH');}
  const parsed=scanXml(initial.source),list=parsed.nodes.find(n=>n.tag==='rampList'),nodes=parsed.nodes.filter(n=>n.tag==='ramp'&&n.parentId===list?.id),span=nodes[index]?.attrSpans.find(a=>a.name==='dir');if(!span)throw Error('NATIVE_RAMP_REPAIR_DIRECTION_ATTRIBUTE_REQUIRED');
  const xml=initial.source.slice(0,span.valueStart)+nativeDirections[q]+initial.source.slice(span.valueEnd);s.sources.set('t3Terrain.xml',Buffer.from(xml));s.descriptor=new TerrainDescriptor(xml);
  return {walls:[...cells.values()].filter(c=>c.flags===1).length,ramps:ramps.length,changedVertices:0,changedCells:0,profile:'native-v115-cardinal-width4-p-98310',engineValidated:false};
 }else if(operation.op==='ramp.create'){
  const center=params.center as {x:number;y:number}|undefined;if(!center)throw new Error('NATIVE_RAMP_CENTER_REQUIRED');const cx=integer(center.x,'center.x',4,p.w-4),cy=integer(center.y,'center.y',4,p.h-4),q=rotations[String(params.direction)];if(q===undefined)throw new Error('NATIVE_RAMP_CARDINAL_DIRECTION_REQUIRED');const lower=integer(params.lowerLevel??1,'lowerLevel',1,2),cid=integer(params.cliffSet??0,'cliffSet',0,63);if(params.width!==undefined&&params.width!==4)throw new Error('NATIVE_RAMP_PROFILE_WIDTH_IS_4');if(!s.descriptor.cliffSets.some(c=>Number(c.i)===cid))throw new Error('NATIVE_CLIFF_SET_UNAVAILABLE');if((q%2===0&&(cx%2!==0||cy%2!==1))||(q%2===1&&(cx%2!==1||cy%2!==0)))throw new Error('NATIVE_RAMP_LATTICE_ALIGNMENT');
  const u=rotate(-1,0,q),r=rotate(0,1,q),high={x:cx+u[0]*2,y:cy+u[1]*2},low={x:cx-u[0]*2,y:cy-u[1]*2};if(level(high.x,high.y)!==lower+1||level(low.x,low.y)!==lower)throw new Error('NATIVE_RAMP_REQUIRES_ADJACENT_ONE_LEVEL_STEP');if(touchesExisting(cx-2,cy-2,cx+2,cy+2))throw new Error('NATIVE_RAMP_OVERLAP');
  // A single high/low center pair is insufficient on an organic cliff: the
  // side rails can end in different cliff levels and create black cap seams.
  for(let lateral=-2;lateral<=2;lateral++){
   const hx=high.x+r[0]*lateral,hy=high.y+r[1]*lateral,lx=low.x+r[0]*lateral,ly=low.y+r[1]*lateral;
   if(level(hx,hy)!==lower+1||level(lx,ly)!==lower)
    throw new Error('NATIVE_RAMP_UNEVEN_CLIFF_RAILS: choose a straight one-level cliff boundary across the full ramp width');
  }
  for(let row=0;row<7;row++)for(let col=0;col<5;col++){const [dx,dy]=rotate(col-2,row-3,q),v=CARDINAL_RAMP_VERTICES[row][col];setVertex(cx+dx,cy+dy,standard,offsetFor(lower)+v[0],lower+v[1]-1);p.sync.writeInt16LE(Math.round((standard+offsetFor(lower))*256)+v[2],64+((cy+dy)*(p.w+1)+cx+dx)*4);}
  // The measured donor ramp cuts out the terrain beneath both side caps
  // (rows 0/1 and 4/5). Keep all other LFCT bits, including authored hiding.
  for(let row=0;row<6;row++)for(let col=0;col<4;col++){const [dx,dy]=rotate(col-1.5,row-2.5,q),x=Math.floor(cx+dx),y=Math.floor(cy+dy),v=CARDINAL_RAMP_CELLS[row][col];p.c.writeUInt16LE(lower*64+v[0],32+(y*p.w+x)*2);p.f[32+y*p.w+x]=(p.f[32+y*p.w+x]&~1)|v[1];rampOwned.set(y*p.w+x,0);const i=Math.floor(y/2)*(p.w/2)+Math.floor(x/2);cells.set(i,{index:i,flags:2,cliffSetIndex:cid,variation:0,attributes:cells.get(i)?.attributes});dirtyCells.add(i);}
  const position=(x:number,y:number)=>{const [a,b]=rotate(x,y,q);return [cx+a,cy+b]};const zero=frame([0,0],[0,0],[0,0],0,0),attrs={dir:String(nativeDirections[q]),hi:String(lower+1),lo:String(lower),cid:String(cid),leftLo:frame(u,r,position(0,-2),1,2),rightLo:frame(u,r,position(0,2),1,2),leftHi:zero,rightHi:zero,base:frame(u,r,position(-1,0),3,1),mid:frame(u,r,[cx,cy],1,2),leftLoVar:'0',rightLoVar:'0',leftHiVar:'4294967295',rightHiVar:'4294967295'};ramps.push({dir:Number(attrs.dir),hi:lower+1,lo:lower,cliffSetIndex:cid,frames:{mid:{up:u,right:r,center:[cx,cy],width:1,height:2}},variations:{leftLo:0,rightLo:0},rawAttributes:attrs});
 }else if(operation.op==='ramp.remove'){
  const index=integer(params.index,'index',0,ramps.length-1),r=ramps[index],mid=r.frames.mid;if(!mid||r.hi!==r.lo+1||!nativeDirections.includes(r.dir))throw new Error('NATIVE_RAMP_REMOVE_PROFILE_UNSUPPORTED');const [cx,cy]=mid.center,[ux,uy]=mid.up,q=nativeDirections.indexOf(r.dir),expectedUp=rotate(-1,0,q),expectedRight=rotate(0,1,q);
  if(mid.width!==1||mid.height!==2||mid.up.some((v,i)=>v!==expectedUp[i])||mid.right.some((v,i)=>v!==expectedRight[i])||![cx,cy].every(Number.isInteger))throw Error('NATIVE_RAMP_REMOVE_PROFILE_UNSUPPORTED');
  // Removal restores a 7x7 step. Do not erase a neighboring ramp's vertices.
  if(ramps.some((other,i)=>{if(i===index)return false;const m=other.frames.mid;if(!m)return true;const rx=Math.abs(m.up[0])*2+Math.abs(m.right[0])*3,ry=Math.abs(m.up[1])*2+Math.abs(m.right[1])*3;return m.center[0]+rx>=cx-3&&m.center[0]-rx<=cx+3&&m.center[1]+ry>=cy-3&&m.center[1]-ry<=cy+3;}))throw Error('NATIVE_RAMP_REMOVE_TOUCHES_ANOTHER_RAMP');
  for(let y=cy-3;y<=cy+3;y++)for(let x=cx-3;x<=cx+3;x++){const l=(x-cx)*ux+(y-cy)*uy>=1?r.hi:r.lo;setVertex(x,y,standard,offsetFor(l),l);const i=Math.floor(y/2)*(p.w/2)+Math.floor(x/2);dirtyCells.add(i);if(cells.get(i)?.flags===2)cells.get(i)!.flags=1;}ramps.splice(index,1);
 }else throw new Error('NATIVE_PATHING_PAINT_UNSUPPORTED');
 for(const v of dirty){const x=v%(p.w+1),y=Math.floor(v/(p.w+1));for(const yy of [y-1,y])for(const xx of [x-1,x])if(xx>=0&&yy>=0&&xx<p.w&&yy<p.h)dirtyCells.add(Math.floor(yy/2)*(p.w/2)+Math.floor(xx/2));}
 // Close fine-vertex pits/spikes within the supported cliff lattice. Keep coarse
 // corners, authored base height and upper mask bits; never normalize donor ramps.
 if(operation.op==='cliff.paint'||operation.op==='cliff.repair'||operation.op==='ramp.remove')for(const i of dirtyCells){
  if(cells.get(i)?.flags===2)continue;
  const x=i%(p.w/2)*2,y=Math.floor(i/(p.w/2))*2;
  if(ramps.some(r=>{const m=r.frames.mid;if(!m)return true;const rx=Math.abs(m.up[0])*2+Math.abs(m.right[0])*3,ry=Math.abs(m.up[1])*2+Math.abs(m.right[1])*3;return x+2>=m.center[0]-rx&&x<=m.center[0]+rx&&y+2>=m.center[1]-ry&&y<=m.center[1]+ry;}))continue;
  const fine=nativeCliffFineLevels([[x,y],[x+2,y],[x+2,y+2],[x,y+2]].map(([a,b])=>level(a,b)));
  for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)if(dx%2||dy%2){
   const xx=x+dx,yy=y+dy,l=fine[dy*3+dx],base=b.readUInt16LE(at(xx,yy))*s.descriptor.quantizeScale-s.descriptor.quantizeBias;
   setVertex(xx,yy,base,offsetFor(l),l);
  }
 }
 // Native cliff records occupy 2x2 cells. Wall holes are the low LFCT bit;
 // authored hiding and all unknown higher bits are never overwritten.
 for(const i of dirtyCells){const x=i%(p.w/2)*2,y=Math.floor(i/(p.w/2))*2;const corners=[[x,y],[x+2,y],[x+2,y+2],[x,y+2]].map(([a,b])=>adjustment(a,b));const isRamp=[0,1].some(dy=>[0,1].some(dx=>rampOwned.has((y+dy)*p.w+x+dx)))||cells.get(i)?.flags===2;const wall=Math.max(...corners)-Math.min(...corners)>.1;if(!wall&&!isRamp){cells.delete(i);}else if(!isRamp){const old=cells.get(i);if(old&&old.flags>3)throw new Error('NATIVE_CLIFF_UNKNOWN_CELL_FLAGS');cells.set(i,{index:i,flags:1,cliffSetIndex:old?.cliffSetIndex??0,variation:old?.variation??0,attributes:old?.attributes});}
  const syncLevels=isRamp?undefined:nativeCliffSyncLevels([[x,y],[x+2,y],[x+2,y+2],[x,y+2]].map(([a,b])=>level(a,b)));
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const xx=x+dx,yy=y+dy,key=yy*p.w+xx;if(!rampOwned.has(key)){p.f[32+key]=(p.f[32+key]&~1)|(wall?1:0);p.c.writeUInt16LE(syncLevels?.[dy*2+dx]??level(xx+1,yy+1)*64,32+key*2);} }
 }
 // Preserve measured ramp SMAP correction; outside it sample the new authored vertex height.
 const rampVertex=new Set<number>();if(operation.op==='ramp.create'){const center=params.center as {x:number;y:number},q=rotations[String(params.direction)];for(let y=-3;y<=3;y++)for(let x=-2;x<=2;x++){const [dx,dy]=rotate(x,y,q);rampVertex.add((center.y+dy)*(p.w+1)+center.x+dx);}}
 for(const v of dirty){if(rampVertex.has(v))continue;const x=v%(p.w+1),y=Math.floor(v/(p.w+1)),z=s.heights.z(x,y),raw=Math.round(z*256);if(raw< -32768||raw>32767)throw new Error('NATIVE_SYNC_HEIGHT_RANGE');p.sync.writeInt16LE(raw,64+v*4);}
 const cc=[...cells.values()].sort((a,b)=>a.index-b.index).map(c=>`<cc ${attributesXml({...c.attributes,i:c.index,f:c.flags,cid:c.cliffSetIndex,cvar:c.variation})}/>`).join('');
 let xml=patchSection(s.descriptor.source,'cliffCellList',`<cliffCellList ${attributesXml({...geometryListAttributes(s.descriptor.source,'cliffCellList'),num:p.w*p.h/4,numOccupied:cells.size})}>${cc}</cliffCellList>`);
 const rs=ramps.map(r=>`<ramp ${attributesXml(r.rawAttributes??{})}/>`).join('');xml=patchSection(xml,'rampList',`<rampList ${attributesXml({...geometryListAttributes(xml,'rampList'),num:ramps.length})}>${rs}</rampList>`);s.sources.set('t3Terrain.xml',Buffer.from(xml));s.descriptor=new TerrainDescriptor(xml);s.heights=new HeightMap(b,s.descriptor);s.sync=new SyncHeightMap(p.sync,s.heights);parseTerrainXml(xml);
 coverage?.({vertices:dirty,cells:dirtyCells});
 return {walls:[...cells.values()].filter(c=>c.flags===1).length,ramps:ramps.length,changedVertices:dirty.size,changedCells:dirtyCells.size,profile:'native-v115-cardinal-width4-p-98310',engineValidated:false};
}
