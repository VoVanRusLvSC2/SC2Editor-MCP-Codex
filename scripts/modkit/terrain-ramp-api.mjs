import {TextDecoder,TextEncoder} from 'node:util';
import {scanXml} from '../../dist/core/xmlScanner.js';
import {requireGeometryListContents} from '../../dist/modules/terrain/nativeGeometry.js';
const decode=b=>new TextDecoder().decode(b),encode=s=>new TextEncoder().encode(s);
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
function section(source,tag,body){
  const p=scanXml(source),hm=p.nodes.find(n=>n.tag==='heightMap'),node=p.nodes.find(n=>n.tag===tag&&n.parentId===hm?.id);
  if(!hm)throw Error('MODKIT_RAMP_HEIGHTMAP_REQUIRED');
  return node?source.slice(0,node.start)+body+source.slice(node.end):source.slice(0,hm.endTagStart)+body+source.slice(hm.endTagStart);
}
function grid(f,files,{donor=false}={}){
  const need=n=>{const b=files.get(n);if(!b?.length)throw Error('MODKIT_RAMP_COMPONENT_REQUIRED: '+n);return b;};
  const source=decode(need('t3Terrain.xml')),params=f.parseTerrainXml(source),parsed=scanXml(source),terrain=parsed.nodes.find(n=>n.tag==='terrain'&&n.parentId===null),heightMaps=parsed.nodes.filter(n=>n.tag==='heightMap'&&n.parentId===terrain?.id),hm=heightMaps[0];
  const vector=(value,fallback)=>String(value??fallback).trim().split(/\s+/).map(Number),scale=vector(hm?.attrs.scale,'1 1 1'),offset=vector(hm?.attrs.offset,'0 0 0');
  // A donor is decoded and sampled only; its descriptor is never rewritten.
  // Native v114 uses the same qualified companion formats. Targets remain v115.
  const supportedVersion=donor?['114','115'].includes(terrain?.attrs.version):terrain?.attrs.version==='115';
  if(!supportedVersion||heightMaps.length!==1||scale.length!==3||offset.length!==3||scale.some(v=>v!==1)||offset.some(v=>v!==0)||files.get('Terrain')?.length)throw Error(donor?'MODKIT_RAMP_DONOR_REQUIRES_V114_OR_V115_IDENTITY_WITHOUT_OPAQUE_TERRAIN':'MODKIT_RAMP_REQUIRES_V115_IDENTITY_WITHOUT_OPAQUE_TERRAIN');
  const height=f.readHeightMap(need('t3HeightMap')),sync=f.readSyncHeightMap(need('t3SyncHeightMap')),cliffLevel=f.readSyncCliffLevel(need('t3SyncCliffLevel')),flags=f.readCellFlags(need('t3CellFlags'));
  if(params.ramps?.some(r=>r.rampHardTileHandles))throw Error('MODKIT_RAMP_HARD_TILE_HANDLES_UNSUPPORTED');
  if(height.version!==101||![100,102].includes(sync.version)||cliffLevel.version!==100||flags.version!==102)throw Error('MODKIT_RAMP_NATIVE_COMPONENT_VERSION_UNSUPPORTED');
  if(height.sizeX!==sync.sizeX||height.sizeY!==sync.sizeY||cliffLevel.sizeX!==height.sizeX-1||cliffLevel.sizeY!==height.sizeY-1||flags.sizeX!==cliffLevel.sizeX||flags.sizeY!==cliffLevel.sizeY)throw Error('MODKIT_RAMP_COMPANION_DIMENSIONS');
  const old=new Map((params.cliffCells??[]).map(c=>[c.index,c]));
  const cliffCells=Array.from({length:cliffLevel.sizeX*cliffLevel.sizeY/4},(_,index)=>old.get(index)??{index,flags:0,cliffSetIndex:0,variation:0});
  return {source,params,height,sync,flags,vertices:f.cliffVertexLevels(height,params),vertexMasks:height.cells.map(c=>c.mask),cliffLevel,cliffCells};
}
export {grid as nativeRampGrid};
/** Transfer only the native ramp support. ModKit owns fitting/widening/placement; our coordinator owns companions. */
export function nativeRampTemplate(f,files,request){const source=grid(f,files,{donor:true}),ramp=source.params.ramps?.[request.rampIndex];if(!ramp)throw Error('MODKIT_RAMP_TEMPLATE_INDEX');return {...source,ramp,bounds:request.bounds};}
export function placeNativeRamp(f,files,donorFiles,op){
  const target=grid(f,files),donor=grid(f,donorFiles,{donor:true}),ramp=donor.params.ramps?.[op.rampIndex];
  if(!ramp)throw Error('MODKIT_RAMP_TEMPLATE_INDEX');
  requireGeometryListContents(target.source);
  if(!target.params.cliffSets?.[op.cliffSetIndex])throw Error('MODKIT_RAMP_CLIFF_SET_REQUIRED');
  let template={vertices:donor.vertices,vertexMasks:donor.vertexMasks,cliffLevel:donor.cliffLevel,cliffCells:donor.cliffCells,ramp,bounds:op.bounds};
  // Run the same native widening transport on SMAP's signed-height channel. No second strip-mapping algorithm.
  let baseTemplate={...template,vertexMasks:donor.height.cells.map(c=>c.heightBase)},heightTemplate={...template,vertexMasks:donor.height.cells.map(c=>c.heightAdjustments)},syncTemplate={...template,vertexMasks:donor.sync.cells.map(c=>c.height&65535)},syncMaskTemplate={...template,vertexMasks:donor.sync.cells.map(c=>c.mask)},holeTemplate={...template,cliffLevel:{...donor.cliffLevel,heights:Array.from(donor.flags.types,v=>v&1)}};
  if(op.extraHalfWidth){template=f.widenDiagonalCliffRampTemplate(template,op.extraHalfWidth);baseTemplate=f.widenDiagonalCliffRampTemplate(baseTemplate,op.extraHalfWidth);heightTemplate=f.widenDiagonalCliffRampTemplate(heightTemplate,op.extraHalfWidth);syncTemplate=f.widenDiagonalCliffRampTemplate(syncTemplate,op.extraHalfWidth);syncMaskTemplate=f.widenDiagonalCliffRampTemplate(syncMaskTemplate,op.extraHalfWidth);holeTemplate=f.widenDiagonalCliffRampTemplate(holeTemplate,op.extraHalfWidth);}
  const placement={offsetX:op.offsetX,offsetY:op.offsetY,levelOffset:op.levelOffset,cliffSetIndex:op.cliffSetIndex};
  const result=f.placeCliffRampTemplate(target,template,placement);
  const heightResult=f.placeCliffRampTemplate(target,heightTemplate,{...placement,levelOffset:0});
  const syncResult=f.placeCliffRampTemplate(target,syncTemplate,{...placement,levelOffset:0});
  const syncMaskResult=f.placeCliffRampTemplate(target,syncMaskTemplate,{...placement,levelOffset:0});
  // Reuse ModKit's exact cell transport for LFCT cutouts as for CLIF samples.
  // A registered f=2 ramp can contain both hole and non-hole cells; deriving
  // them only from the registration flag loses the native side-cap cutouts.
  const holeResult=f.placeCliffRampTemplate({...target,cliffLevel:{...target.cliffLevel,heights:Array.from(target.flags.types,v=>v&1)}},holeTemplate,{...placement,levelOffset:0});
  const changed=[];
  for(let i=0;i<target.height.cells.length;i++)if(result.vertices.levels[i]!==target.vertices.levels[i]||result.vertexMasks[i]!==target.vertexMasks[i]||heightResult.vertexMasks[i]!==target.vertexMasks[i]||syncResult.vertexMasks[i]!==target.vertexMasks[i]||syncMaskResult.vertexMasks[i]!==target.vertexMasks[i]){
    const sourceX=i%target.height.sizeX-op.offsetX,sourceY=Math.floor(i/target.height.sizeX)-op.offsetY;
    if(sourceX<0||sourceY<0||sourceX>=template.vertices.sizeX||sourceY>=template.vertices.sizeY)continue;
    // Qualify a flat base; the library transfers cliff levels, not a donor's sculpted base.
    const base=target.height.cells[i].heightBase*target.params.quantizeScale-target.params.quantizeBias;
    const donorBase=baseTemplate.vertexMasks[sourceY*template.vertices.sizeX+sourceX]*donor.params.quantizeScale-donor.params.quantizeBias;
    if(Math.abs(base-donorBase)>Math.max(target.params.quantizeScale,donor.params.quantizeScale)*2)throw Error('MODKIT_RAMP_BASE_HEIGHT_MISMATCH');
    // Cliff levels are rounded quarter-level metadata. Transport the actual
    // smooth donor offset through the same native mapping, then requantize
    // only when the target descriptor differs. Keep its sculpted base intact.
    const donorOffset=heightResult.vertexMasks[i]*donor.params.quantizeScale-donor.params.quantizeBias;
    const raw=Math.round((donorOffset+op.levelOffset*0.5+target.params.quantizeBias)/target.params.quantizeScale);
    if(raw<0||raw>65535)throw Error('MODKIT_RAMP_QUANTIZATION_RANGE');
    target.height.cells[i]={...target.height.cells[i],heightAdjustments:raw,mask:result.vertexMasks[i]};
    const encoded=syncResult.vertexMasks[i],height=(encoded>32767?encoded-65536:encoded)+op.levelOffset*128;
    if(height< -32768||height>32767)throw Error('MODKIT_RAMP_SYNC_RANGE');
    const syncMask=syncMaskResult.vertexMasks[i],syncLevel=(syncMask&255)+op.levelOffset/4;
    if(op.levelOffset!==0&&((syncMask&255)<1||(syncMask&255)>7||syncLevel<1||syncLevel>7))throw Error('MODKIT_RAMP_SYNC_MASK_RANGE');
    target.sync.cells[i]={...target.sync.cells[i],height,mask:(syncMask&0xff00)|syncLevel};changed.push(i);
  }
  const width=result.cliffLevel.sizeX;
  const beforeCells=new Map(target.cliffCells.map(c=>[c.index,c]));
  for(const c of result.cliffCells){const old=beforeCells.get(c.index);if(old?.flags===c.flags&&old?.cliffSetIndex===c.cliffSetIndex&&old?.variation===c.variation)continue;const x=c.index%(width/2)*2,y=Math.floor(c.index/(width/2))*2;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const i=(y+dy)*width+x+dx,hole=c.flags===2?holeResult.cliffLevel.heights[i]:(c.flags===1?1:0);if(hole!==0&&hole!==1)throw Error('MODKIT_RAMP_HOLE_TRANSPORT_INVALID');target.flags.types[i]=(target.flags.types[i]&~1)|hole;}}
  const parsed=scanXml(target.source),oldList=parsed.nodes.find(n=>n.tag==='cliffCellList');
  if(oldList&&parsed.nodes.some(n=>n.parentId===oldList.id&&n.tag!=='cc'))throw Error('MODKIT_RAMP_UNKNOWN_CLIFF_CHILD_REFUSED');
  const oldAttributes=new Map(parsed.nodes.filter(n=>n.tag==='cc'&&n.parentId===oldList?.id).map(n=>[Number(n.attrs.i),n.attrs]));
  const cells=result.cliffCells.filter(c=>c.flags!==0||oldAttributes.has(c.index));
  const cc=cells.map(c=>{const attrs={...oldAttributes.get(c.index),i:c.index,f:c.flags,cid:c.cliffSetIndex,cvar:c.variation};return '<cc '+Object.entries(attrs).map(([k,v])=>`${k}="${esc(v)}"`).join(' ')+'/>';}).join('');
  const attrs=(tag,update)=>Object.entries({...parsed.nodes.find(n=>n.tag===tag)?.attrs,...update}).map(([k,v])=>`${k}="${esc(v)}"`).join(' ');
  let source=section(target.source,'cliffCellList',`<cliffCellList ${attrs('cliffCellList',{num:width*result.cliffLevel.sizeY/4,numOccupied:cells.filter(c=>c.flags!==0).length})}>${cc}</cliffCellList>`);
  const list=scanXml(source).nodes.find(n=>n.tag==='rampList'),existing=list&&!list.selfClosing?source.slice(list.startTagEnd,list.endTagStart):'';
  const append=f.writeTerrainRampList([result.ramp]).replace(/^<rampList[^>]*>/,'').replace(/<\/rampList>$/,'');
  source=section(source,'rampList',`<rampList ${attrs('rampList',{num:(target.params.ramps?.length??0)+1})}>${existing}${append}</rampList>`);
  files.set('t3Terrain.xml',encode(source));files.set('t3HeightMap',f.writeHeightMap(target.height));files.set('t3SyncHeightMap',f.writeSyncHeightMap(target.sync));files.set('t3SyncCliffLevel',f.writeSyncCliffLevel(result.cliffLevel));files.set('t3CellFlags',f.writeCellFlags(target.flags));
  return {changedVertices:result.changedVertices,changedCells:result.changedCells,updatedSyncVertices:changed.length,extraHalfWidth:op.extraHalfWidth,engineValidated:false};
}
