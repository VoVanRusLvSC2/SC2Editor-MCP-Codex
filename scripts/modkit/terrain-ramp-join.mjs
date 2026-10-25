// Compose existing cliff strokes and ModKit ramp transport in one candidate.
import {Buffer} from 'node:buffer';
import {nativeRampGrid,nativeRampTemplate,placeNativeRamp} from './terrain-ramp-api.mjs';
import {parseState} from '../../dist/modules/terrain/operations.js';
import {editNativeGeometry} from '../../dist/modules/terrain/nativeGeometry.js';
import {scanXml} from '../../dist/core/xmlScanner.js';
import {PlacementDocument} from '../../dist/modules/placement/document.js';
const components=['t3Terrain.xml','t3HeightMap','t3SyncHeightMap','t3SyncCliffLevel','t3CellFlags'];
const offset=level=>(level-1)*2;
const fail=(code,point)=>{throw Error('MODKIT_RAMP_JOIN_'+code+(point?' at '+point.x+','+point.y:''));};
const inside=(p,b)=>p.x>=b.minX&&p.x<=b.maxX&&p.y>=b.minY&&p.y<=b.maxY;
export function placeJoinedRamp(f,files,donorFiles,op){
 const target=nativeRampGrid(f,files),donor=nativeRampTemplate(f,donorFiles,op),ramp=donor.ramp,mode=op.adjoining??'prepare_closed';
 if(!['prepare_closed','verify'].includes(mode))fail('MODE_UNSUPPORTED');
 if(![1,2].includes(ramp.lo)||ramp.hi!==ramp.lo+1||!Number.isInteger(op.levelOffset/4)||ramp.lo+op.levelOffset/4<1||ramp.hi+op.levelOffset/4>3)fail('LEVEL_PROFILE_UNSUPPORTED');
 let template={vertices:donor.vertices,vertexMasks:donor.vertexMasks,cliffLevel:donor.cliffLevel,cliffCells:donor.cliffCells,ramp,bounds:op.bounds},baseTemplate={...template,vertexMasks:donor.height.cells.map(c=>c.heightBase)},offsetTemplate={...template,vertexMasks:donor.height.cells.map(c=>c.heightAdjustments)},syncTemplate={...template,vertexMasks:donor.sync.cells.map(c=>c.height)},syncMaskTemplate={...template,vertexMasks:donor.sync.cells.map(c=>c.mask)},flagTemplate={...template,cliffLevel:{...donor.cliffLevel,heights:Array.from(donor.flags.types,(value,index)=>{const x=index%donor.flags.sizeX,y=Math.floor(index/donor.flags.sizeX),owner=donor.cliffCells[Math.floor(y/2)*(donor.flags.sizeX/2)+Math.floor(x/2)];return value|((owner?.flags??0)<<8);})}};
 if(op.extraHalfWidth){template=f.widenDiagonalCliffRampTemplate(template,op.extraHalfWidth);baseTemplate=f.widenDiagonalCliffRampTemplate(baseTemplate,op.extraHalfWidth);offsetTemplate=f.widenDiagonalCliffRampTemplate(offsetTemplate,op.extraHalfWidth);syncTemplate=f.widenDiagonalCliffRampTemplate(syncTemplate,op.extraHalfWidth);syncMaskTemplate=f.widenDiagonalCliffRampTemplate(syncMaskTemplate,op.extraHalfWidth);flagTemplate=f.widenDiagonalCliffRampTemplate(flagTemplate,op.extraHalfWidth);}
 // The original placer validates bounds, lattice, native versions and overlap
 // without mutating either grid. No second ramp placement algorithm.
 f.placeCliffRampTemplate(target,template,{offsetX:op.offsetX,offsetY:op.offsetY,levelOffset:op.levelOffset,cliffSetIndex:op.cliffSetIndex});
 const b=template.bounds,w=template.vertices.sizeX,columns=template.cliffLevel.sizeX/2,cellMap=new Map(template.cliffCells.map(c=>[c.index,c])),shift=op.levelOffset/4,lower=ramp.lo+shift,higher=ramp.hi+shift;
 if((b.maxX-b.minX)*(b.maxY-b.minY)>16384)fail('REGION_LIMIT');
 const envelope={minX:b.minX+op.offsetX-2,minY:b.minY+op.offsetY-2,maxX:b.maxX+op.offsetX+2,maxY:b.maxY+op.offsetY+2};
 if(envelope.minX<0||envelope.minY<0||envelope.maxX>=target.height.sizeX||envelope.maxY>=target.height.sizeY)fail('PREPARATION_MARGIN');
 const expectedBase=target.params.standardHeight,tolerance=Math.max(target.params.quantizeScale,donor.params.quantizeScale)*2,world=(g,c)=>(c.heightBase+c.heightAdjustments)*g.params.quantizeScale-2*g.params.quantizeBias;
 if(!Number.isFinite(expectedBase))fail('STANDARD_HEIGHT_REQUIRED');
 const isFlat=(g,x,y,level,syncHeight)=>{const i=y*g.height.sizeX+x,c=g.height.cells[i],s=g.sync.cells[i];return (c.mask&255)===level&&!(c.mask&0xff00)&&(s.mask&255)===level&&!(s.mask&0xff00)&&Math.abs(c.heightBase*g.params.quantizeScale-g.params.quantizeBias-expectedBase)<=tolerance&&Math.abs(c.heightAdjustments*g.params.quantizeScale-g.params.quantizeBias-offset(level))<=tolerance&&(syncHeight===undefined?Math.abs(s.height/256-world(g,c))<=1/256+tolerance:s.height===syncHeight);};
 const mapped=(x,y)=>({x:x+op.offsetX,y:y+op.offsetY});
 const checkFlags=(x,y)=>{const i=y*target.flags.sizeX+x;if(target.flags.types[i]&4)fail('HIDDEN_TARGET',{x,y});};
 if(files.has('Objects')){const xml=Buffer.from(files.get('Objects')).toString('utf8');if(scanXml(xml).diagnostics.some(d=>d.severity==='error'))fail('OBJECTS_INVALID');for(const o of new PlacementDocument(xml).list()){const[x,y]=String(o.position).split(',').map(Number);if(o.position!==undefined&&(!Number.isFinite(x)||!Number.isFinite(y)))fail('OBJECT_POSITION_INVALID');if(Number.isFinite(x)&&Number.isFinite(y)&&inside({x,y},envelope))fail('OBJECT_CONFLICT',{x,y});}}
 for(let y=envelope.minY;y<envelope.maxY;y++)for(let x=envelope.minX;x<envelope.maxX;x++)checkFlags(x,y);
 if(mode==='prepare_closed'){
  for(let y=b.minY;y<=b.maxY;y+=2)for(let x=b.minX;x<=b.maxX;x+=2)if((x===b.minX||x===b.maxX||y===b.minY||y===b.maxY)&&template.vertices.levels[y*w+x]!==ramp.lo*4)fail('OPEN_DONOR_BOUNDARY',{x,y});
  for(let y=envelope.minY;y<=envelope.maxY;y++)for(let x=envelope.minX;x<=envelope.maxX;x++)if(!isFlat(target,x,y,lower))fail('TARGET_NOT_CLEAR_FLAT',{x,y});
  for(const c of target.params.cliffCells??[]){const x=c.index%(target.cliffLevel.sizeX/2)*2,y=Math.floor(c.index/(target.cliffLevel.sizeX/2))*2;if(c.flags!==0&&x+2>=envelope.minX&&x<=envelope.maxX&&y+2>=envelope.minY&&y<=envelope.maxY)fail('EXISTING_TOPOLOGY',{x,y});}
  for(let y=envelope.minY;y<envelope.maxY;y++)for(let x=envelope.minX;x<envelope.maxX;x++){const i=y*target.flags.sizeX+x;if(target.flags.types[i]&1)fail('TARGET_HOLE',{x,y});if(target.cliffLevel.heights[i]!==lower*64)fail('TARGET_CLIF_MISMATCH',{x,y});}
 }
 // Do not import a second unlisted ramp's support inside the requested fragment.
 for(const[rampIndex,other]of (donor.params.ramps??[]).entries())if(rampIndex!==op.rampIndex&&Object.values(other.frames??{}).some(frame=>frame&&(frame.width||frame.height)&&(()=>{const ex=Math.abs(frame.up[0]*frame.height)+Math.abs(frame.right[0]*frame.width),ey=Math.abs(frame.up[1]*frame.height)+Math.abs(frame.right[1]*frame.width);return frame.center[0]+ex>=b.minX&&frame.center[0]-ex<=b.maxX&&frame.center[1]+ey>=b.minY&&frame.center[1]-ey<=b.maxY;})()))fail('MULTIPLE_DONOR_RAMPS');
 const high=[],flat=[],support=new Set();
 for(let y=b.minY;y<b.maxY;y+=2)for(let x=b.minX;x<b.maxX;x+=2)if(cellMap.get(y/2*columns+x/2)?.flags===2)for(let dy=0;dy<=2;dy++)for(let dx=0;dx<=2;dx++)support.add((y+dy)*w+x+dx);
 const nearGeometry=(x,y)=>{for(let cy=Math.max(0,Math.floor((y-2)/2));cy<=Math.min(template.cliffLevel.sizeY/2-1,Math.floor((y+2)/2));cy++)for(let cx=Math.max(0,Math.floor((x-2)/2));cx<=Math.min(columns-1,Math.floor((x+2)/2));cx++)if(cellMap.get(cy*columns+cx)?.flags)return true;return false;};
 for(let y=b.minY;y<b.maxY;y+=2)for(let x=b.minX;x<b.maxX;x+=2){
  const c=cellMap.get(y/2*columns+x/2);if(!c||![0,1,2].includes(c.flags))fail('DONOR_CELL_PROFILE',{x,y});if(c.flags!==0)continue;
  const levels=[[x,y],[x+2,y],[x+2,y+2],[x,y+2]].map(([xx,yy])=>template.vertices.levels[yy*w+xx]);
  if(!levels.every(l=>l===levels[0])||![ramp.lo*4,ramp.hi*4].includes(levels[0]))fail('DONOR_FLAT_CELL_UNSUPPORTED',{x,y});
  const sourceLevel=levels[0]/4,level=sourceLevel+shift,p=mapped(x,y);flat.push({...p,level});
  for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){const i=(y+dy)*w+x+dx;if(Math.abs(baseTemplate.vertexMasks[i]*donor.params.quantizeScale-donor.params.quantizeBias-expectedBase)>tolerance||Math.abs(offsetTemplate.vertexMasks[i]*donor.params.quantizeScale-donor.params.quantizeBias-offset(sourceLevel))>tolerance)fail('DONOR_SCULPTED_LANDING',{x,y});}
  // The same ModKit strip mapping supplies every donor landing channel.
  for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){
   const i=(y+dy)*w+x+dx,worldHeight=expectedBase+offset(sourceLevel);
   if(template.vertices.levels[i]!==sourceLevel*4||template.vertexMasks[i]!==sourceLevel)fail('DONOR_LANDING_PROFILE',{x,y});
   // Original SMAP smooths native cliff edges even where HMAP is flat.
   // The admitted corpus has residuals up to124/256 beside registered cells;
   // allow the half-unit edge band there, never across a flat interior.
   const syncTolerance=nearGeometry(x+dx,y+dy)?0.5+tolerance:1/256+tolerance;
   if(syncMaskTemplate.vertexMasks[i]!==sourceLevel||Math.abs(syncTemplate.vertexMasks[i]/256-worldHeight)>syncTolerance)fail('DONOR_LANDING_SYNC',{x,y});
  }
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
   const i=(y+dy)*flagTemplate.cliffLevel.sizeX+x+dx;
   // Widening maps fine samples and coarse registration independently. A
   // borrowed native wall cutout is not a hole in the source flat landing.
   const flag=flagTemplate.cliffLevel.heights[i];
   if((flag&4)||((flag&1)&&![1,2].includes(flag>>>8)))fail('DONOR_LANDING_HOLE',{x,y});
   if(template.cliffLevel.heights[i]!==sourceLevel*64)fail('DONOR_LANDING_CLIF',{x,y});
  }
  if(sourceLevel===ramp.hi)high.push(p);
  if(mode==='verify'){
   for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)if(!isFlat(target,p.x+dx,p.y+dy,level))fail('ADJOINING_LEVEL_MISMATCH',{x:p.x+dx,y:p.y+dy});
   for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const i=(p.y+dy)*target.flags.sizeX+p.x+dx;if(target.flags.types[i]&1)fail('ADJOINING_HOLE',{x:p.x+dx,y:p.y+dy});if(target.cliffLevel.heights[i]!==level*64)fail('ADJOINING_CLIF_MISMATCH',{x:p.x+dx,y:p.y+dy});}
  }
 }
 if(!high.length)fail('HIGH_PLATFORM_REQUIRED');
 const highKeys=new Set(high.map(p=>p.x+','+p.y)),strokes=[];
 for(let y=b.minY+op.offsetY;y<b.maxY+op.offsetY;y+=2){let start=null;for(let x=b.minX+op.offsetX;x<=b.maxX+op.offsetX;x+=2){const yes=x<b.maxX+op.offsetX&&highKeys.has(x+','+y);if(yes&&start===null)start=x;if(!yes&&start!==null){strokes.push({op:'cliff.paint',area:{type:'rectangle',minX:start,minY:y,maxX:x,maxY:y+2},parameters:{level:higher,cliffSet:op.cliffSetIndex,variation:0}});start=null;}}}
 if(strokes.length>128)fail('STROKE_LIMIT');
 const candidate=new Map(files);
 for(const name of components)candidate.set(name,Buffer.from(files.get(name)));
 if(mode==='prepare_closed'){
  const sources=new Map(components.map(name=>[name,candidate.get(name)])),state=parseState(sources);
  for(const stroke of strokes)editNativeGeometry(state,stroke);
  sources.set('t3HeightMap',state.heights.bytes);if(state.sync)sources.set('t3SyncHeightMap',state.sync.bytes);
  for(const name of components)candidate.set(name,sources.get(name));
 }
 const placed=placeNativeRamp(f,candidate,donorFiles,op),after=nativeRampGrid(f,candidate);
 for(const p of flat)for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){
  const i=(p.y+dy-op.offsetY)*w+p.x+dx-op.offsetX,syncHeight=support.has(i)?syncTemplate.vertexMasks[i]+op.levelOffset*128:undefined;
  if(!isFlat(after,p.x+dx,p.y+dy,p.level,syncHeight))fail('POSTCONDITION',{x:p.x+dx,y:p.y+dy});
 }
 // Native foundation preparation may re-encode a fresh unregistered HMAP.
 // Outside the guarded envelope this may change quantization, never authored
 // world heights beyond one quantum, masks, SMAP, CLIF or cell flags.
 const fresh=!(target.params.cliffCells?.length||target.params.ramps?.length),quantum=Math.max(target.params.quantizeScale,after.params.quantizeScale)*1.01;
 for(let y=0;y<target.height.sizeY;y++)for(let x=0;x<target.height.sizeX;x++)if(!inside({x,y},envelope)){
  const i=y*target.height.sizeX+x,a=target.height.cells[i],b=after.height.cells[i],sa=target.sync.cells[i],sb=after.sync.cells[i];
  if(a.mask!==b.mask||sa.mask!==sb.mask||sa.height!==sb.height||Math.abs(world(target,a)-world(after,b))>quantum||(!fresh&&(a.heightBase!==b.heightBase||a.heightAdjustments!==b.heightAdjustments)))fail('OUTSIDE_ENVELOPE_CHANGED',{x,y});
 }
 for(let y=0;y<target.flags.sizeY;y++)for(let x=0;x<target.flags.sizeX;x++)if(x<envelope.minX||x>=envelope.maxX||y<envelope.minY||y>=envelope.maxY){
  const i=y*target.flags.sizeX+x;if(target.flags.types[i]!==after.flags.types[i]||target.cliffLevel.heights[i]!==after.cliffLevel.heights[i])fail('OUTSIDE_ENVELOPE_CHANGED',{x,y});
 }
 for(const name of components)files.set(name,candidate.get(name));
 return {...placed,adjoining:{mode,highCells:high.length,checkedFlatCells:flat.length,preparedStrokes:mode==='prepare_closed'?strokes.length:0,envelope,strokes:mode==='prepare_closed'?strokes:[],scope:'Existing cliff writer prepares measured whole-level high landings; original ModKit transfers support. Object centers/hidden ground/manual mismatches reject. Native footprints, navigation, water and visual acceptance remain separate.'}};
}
