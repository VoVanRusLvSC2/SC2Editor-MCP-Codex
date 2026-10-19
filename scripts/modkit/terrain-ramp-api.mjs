import {TextDecoder,TextEncoder} from 'node:util';
import {scanXml} from '../../dist/core/xmlScanner.js';
const decode=b=>new TextDecoder().decode(b),encode=s=>new TextEncoder().encode(s);
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
function section(source,tag,body){
  const p=scanXml(source),hm=p.nodes.find(n=>n.tag==='heightMap'),node=p.nodes.find(n=>n.tag===tag&&n.parentId===hm?.id);
  if(!hm)throw Error('MODKIT_RAMP_HEIGHTMAP_REQUIRED');
  return node?source.slice(0,node.start)+body+source.slice(node.end):source.slice(0,hm.endTagStart)+body+source.slice(hm.endTagStart);
}
function grid(f,files){
  const need=n=>{const b=files.get(n);if(!b?.length)throw Error('MODKIT_RAMP_COMPONENT_REQUIRED: '+n);return b;};
  const source=decode(need('t3Terrain.xml')),params=f.parseTerrainXml(source),height=f.readHeightMap(need('t3HeightMap')),sync=f.readSyncHeightMap(need('t3SyncHeightMap')),cliffLevel=f.readSyncCliffLevel(need('t3SyncCliffLevel')),flags=f.readCellFlags(need('t3CellFlags'));
  if(!/version\s*=\s*"115"/.test(source)||(params.scaleX??1)!==1||(params.scaleY??1)!==1||(params.scaleZ??1)!==1||[params.offsetX??0,params.offsetY??0,params.offsetZ??0].some(v=>v!==0)||files.get('Terrain')?.length)throw Error('MODKIT_RAMP_REQUIRES_V115_IDENTITY_WITHOUT_OPAQUE_TERRAIN');
  if(params.ramps?.some(r=>r.rampHardTileHandles))throw Error('MODKIT_RAMP_HARD_TILE_HANDLES_UNSUPPORTED');
  if(height.version!==101||sync.version!==100||cliffLevel.version!==100||flags.version!==102)throw Error('MODKIT_RAMP_NATIVE_COMPONENT_VERSION_UNSUPPORTED');
  if(height.sizeX!==sync.sizeX||height.sizeY!==sync.sizeY||cliffLevel.sizeX!==height.sizeX-1||cliffLevel.sizeY!==height.sizeY-1||flags.sizeX!==cliffLevel.sizeX||flags.sizeY!==cliffLevel.sizeY)throw Error('MODKIT_RAMP_COMPANION_DIMENSIONS');
  const old=new Map((params.cliffCells??[]).map(c=>[c.index,c]));
  const cliffCells=Array.from({length:cliffLevel.sizeX*cliffLevel.sizeY/4},(_,index)=>old.get(index)??{index,flags:0,cliffSetIndex:0,variation:0});
  return {source,params,height,sync,flags,vertices:f.cliffVertexLevels(height,params),vertexMasks:height.cells.map(c=>c.mask),cliffLevel,cliffCells};
}
/** Transfer only the native ramp support. ModKit owns fitting/widening/placement; our coordinator owns companions. */
export function nativeRampTemplate(f,files,request){const source=grid(f,files),ramp=source.params.ramps?.[request.rampIndex];if(!ramp)throw Error('MODKIT_RAMP_TEMPLATE_INDEX');return {...source,ramp,bounds:request.bounds};}
export function placeNativeRamp(f,files,donorFiles,op){
  const target=grid(f,files),donor=grid(f,donorFiles),ramp=donor.params.ramps?.[op.rampIndex];
  if(!ramp)throw Error('MODKIT_RAMP_TEMPLATE_INDEX');
  if(!target.params.cliffSets?.[op.cliffSetIndex])throw Error('MODKIT_RAMP_CLIFF_SET_REQUIRED');
  let template={vertices:donor.vertices,vertexMasks:donor.vertexMasks,cliffLevel:donor.cliffLevel,cliffCells:donor.cliffCells,ramp,bounds:op.bounds};
  // Run the same native widening transport on SMAP's signed-height channel. No second strip-mapping algorithm.
  let syncTemplate={...template,vertexMasks:donor.sync.cells.map(c=>c.height&65535)},syncMaskTemplate={...template,vertexMasks:donor.sync.cells.map(c=>c.mask)};
  if(op.extraHalfWidth){template=f.widenDiagonalCliffRampTemplate(template,op.extraHalfWidth);syncTemplate=f.widenDiagonalCliffRampTemplate(syncTemplate,op.extraHalfWidth);syncMaskTemplate=f.widenDiagonalCliffRampTemplate(syncMaskTemplate,op.extraHalfWidth);}
  const placement={offsetX:op.offsetX,offsetY:op.offsetY,levelOffset:op.levelOffset,cliffSetIndex:op.cliffSetIndex};
  const result=f.placeCliffRampTemplate(target,template,placement);
  const syncResult=f.placeCliffRampTemplate(target,syncTemplate,{...placement,levelOffset:0});
  const syncMaskResult=f.placeCliffRampTemplate(target,syncMaskTemplate,{...placement,levelOffset:0});
  const changed=[];
  for(let i=0;i<target.height.cells.length;i++)if(result.vertices.levels[i]!==target.vertices.levels[i]||result.vertexMasks[i]!==target.vertexMasks[i]||syncResult.vertexMasks[i]!==target.vertexMasks[i]||syncMaskResult.vertexMasks[i]!==target.vertexMasks[i]){
    const sourceX=i%target.height.sizeX-op.offsetX,sourceY=Math.floor(i/target.height.sizeX)-op.offsetY;
    if(sourceX<0||sourceY<0||sourceX>=template.vertices.sizeX||sourceY>=template.vertices.sizeY)continue;
    // Qualify a flat base; the library transfers cliff levels, not a donor's sculpted base.
    const base=target.height.cells[i].heightBase*target.params.quantizeScale-target.params.quantizeBias;
    const donorBase=donor.height.cells[Math.min(donor.height.cells.length-1,Math.max(0,sourceY*donor.height.sizeX+sourceX))].heightBase*donor.params.quantizeScale-donor.params.quantizeBias;
    if(Math.abs(base-donorBase)>Math.max(target.params.quantizeScale,donor.params.quantizeScale)*2)throw Error('MODKIT_RAMP_BASE_HEIGHT_MISMATCH');
    const raw=Math.round((f.cliffLevelOffsetZ(result.vertices.levels[i])+target.params.quantizeBias)/target.params.quantizeScale);
    if(raw<0||raw>65535)throw Error('MODKIT_RAMP_QUANTIZATION_RANGE');
    target.height.cells[i]={...target.height.cells[i],heightAdjustments:raw,mask:result.vertexMasks[i]};
    const encoded=syncResult.vertexMasks[i],height=(encoded>32767?encoded-65536:encoded)+op.levelOffset*128;
    if(height< -32768||height>32767)throw Error('MODKIT_RAMP_SYNC_RANGE');
    target.sync.cells[i]={...target.sync.cells[i],height,mask:syncMaskResult.vertexMasks[i]};changed.push(i);
  }
  const width=result.cliffLevel.sizeX;
  const beforeCells=new Map(target.cliffCells.map(c=>[c.index,c]));
  for(const c of result.cliffCells){const old=beforeCells.get(c.index);if(old?.flags===c.flags&&old?.cliffSetIndex===c.cliffSetIndex&&old?.variation===c.variation)continue;const x=c.index%(width/2)*2,y=Math.floor(c.index/(width/2))*2;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const i=(y+dy)*width+x+dx;target.flags.types[i]=(target.flags.types[i]&~1)|(c.flags===1?1:0);}}
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
