// ModKit owns every native reader/writer used here. This layer supplies bounded brush inputs.
import {TextDecoder,TextEncoder} from 'node:util';
import {placeNativeRamp,nativeRampTemplate} from './terrain-ramp-api.mjs';
const decoder=new TextDecoder(),encoder=new TextEncoder();
const xml=bytes=>decoder.decode(bytes);
const required=(files,name)=>{const b=files.get(name);if(!b?.length)throw Error('MODKIT_TERRAIN_COMPONENT_REQUIRED: '+name);return b;};
const integer=(value,min,max,label)=>{if(!Number.isSafeInteger(value)||value<min||value>max)throw Error('MODKIT_TERRAIN_RANGE: '+label);return value;};
const byte=v=>integer(v,0,255,'byte');
const page=(items,offset,limit)=>({total:items.length,items:items.slice(offset,offset+limit),nextOffset:offset+limit<items.length?offset+limit:null});
export const TERRAIN_READERS={t3HeightMap:'HeightMap',t3SyncHeightMap:'SyncHeightMap',t3SyncCliffLevel:'SyncCliffLevel',t3SyncPathingInfo:'PathingInfo',t3CellFlags:'CellFlags',t3TextureMasks:'TextureMasks',t3SyncTextureInfo:'SyncTextureInfo',t3FluffDoodad:'FluffDoodad',t3Water:'Water',t3VertCol:'VertexColor',t3HardTile:'HardTile',PaintedPathingLayer:'PaintedPathing',PaintedCreepLayer:'PaintedPathing',Terrain:'TerrainBinary'};
export function guardTerrainBytes(name,bytes){
  if(bytes.length>64*1024*1024)throw Error('MODKIT_TERRAIN_COMPONENT_BYTE_LIMIT');
  if(bytes.length<12)return;
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(/^t3(?:HeightMap|SyncHeightMap|SyncCliffLevel|SyncPathingInfo|CellFlags|TextureMasks)$/.test(name)){
    if(v.getUint32(8,true)>4096||v.getUint32(12,true)>4096)throw Error('MODKIT_TERRAIN_GRID_LIMIT');
  }
  if(name==='t3FluffDoodad'&&bytes.length>=28&&v.getUint32(24,true)>100000)throw Error('MODKIT_TERRAIN_RECORD_LIMIT');
  if(name==='t3VertCol'&&v.getUint32(8,true)>16384)throw Error('MODKIT_TERRAIN_RECORD_LIMIT');
}
export function createTerrainApi(f,n,overview){
  function catalogQueries(files,catalog){
    const dims=dimensions(files);if(dims.width*dims.height>65536)throw Error('MODKIT_NAVIGATION_LIMIT_256_MAP');
    const map=f.parseMapEntries(files),refs=new Map(),add=(namespace,entityId)=>{if(entityId)refs.set(namespace+'/'+entityId,{namespace,entityId});};
    for(const unit of map.objects?.units??[])add('Unit',unit.unitType);
    for(const doodad of map.objects?.doodads??[])add('Actor',doodad.type);
    for(const cliff of map.terrain?.cliffSets??[])add('Cliff',cliff);
    for(const ref of overview.overviewCatalogQueries(catalog))add(ref.namespace,ref.entityId);
    if(refs.size>4096)throw Error('MODKIT_NAVIGATION_CATALOG_REF_LIMIT');
    return [...refs.values()];
  }
  function dimensions(files){const h=f.readHeightMap(required(files,'t3HeightMap'));return {width:h.sizeX-1,height:h.sizeY-1};}
  function read(files,name){
    const bytes=required(files,name);guardTerrainBytes(name,bytes);
    if(name.startsWith('CellAttribute_')){const d=dimensions(files);return f.readCellAttribute(bytes,{sizeX:d.width,sizeY:d.height});}
    if(name==='t3Terrain.xml')return f.parseTerrainXml(xml(bytes));
    const reader=TERRAIN_READERS[name];if(!reader)throw Error('MODKIT_TERRAIN_COMPONENT_REFUSED: '+name);
    const value=f['read'+reader](bytes);
    if(name==='t3VertCol'){const roundtrip=f.writeVertexColor(value);if(roundtrip.length!==bytes.length||roundtrip.some((b,i)=>b!==bytes[i]))throw Error('MODKIT_VERTEX_COLOR_OPAQUE_BYTES_REFUSED');}
    return value;
  }
  function inspect(files,{component,offset=0,limit=20,blockIndex}){
    const data=read(files,component),summary={component,byteLength:required(files,component).length,version:data.version};
    if(component==='t3Terrain.xml')return {...summary,tileSet:data.tileSet,quantizeScale:data.quantizeScale,quantizeBias:data.quantizeBias,standardHeight:data.standardHeight,cliffSets:data.cliffSets,cliffCells:page(data.cliffCells??[],offset,limit),ramps:page(data.ramps??[],offset,limit),textures:page(data.textures,offset,limit)};
    if(component==='t3VertCol')return {...summary,...page(data.entries.map((e,index)=>({index,header:{...e.header,raw:undefined},colors:e.data.length,sample:[...e.data.slice(0,16)]})),offset,limit)};
    if(component==='t3FluffDoodad')return {...summary,...page(data.doodads,offset,limit),trailingBytes:data._raw.trailing.length};
    if(component==='t3HardTile'){if(blockIndex!==undefined){const block=data.blocks[integer(blockIndex,0,data.blocks.length-1,'blockIndex')];return {...summary,block:{name:block.name,flags:block.flags,tailWord:block.tailWord},...page(block.subs.map(s=>Object.fromEntries(Object.entries(s).filter(([key])=>key!=='raw'))),offset,limit)};}return {...summary,partial:!!data.rawRemainder,declaredBlocks:data.declaredBlocks,...page(data.blocks.map(b=>({name:b.name,flags:b.flags,tailWord:b.tailWord,placements:b.subs.length})),offset,limit)};}
    if(component.startsWith('Painted'))return {...summary,bounds:data.bounds,structured:!!data.paint,coordinateSpace:'native 512x512 paint grid; raw channels',sample:[...data.paint?.slice(offset*2,(offset+limit)*2)??[]]};
    const values=data.cells??data.blocks??data.types??data.heights;
    if(values)return {...summary,width:data.sizeX,height:data.sizeY,...page(Array.from(values),offset,limit)};
    return {...summary,fields:Object.keys(data),note:'Raw-preserving native format; use existing terrain brushes for coordinated edits'};
  }
  function gridPoints(files,area){
    const h=f.readHeightMap(required(files,'t3HeightMap')),t=f.parseTerrainXml(xml(required(files,'t3Terrain.xml')));
    const width=h.sizeX-1,height=h.sizeY-1;if(width*height>1048576)throw Error('MODKIT_TERRAIN_GRID_LIMIT');
    if((t.scaleX??1)!==1||(t.scaleY??1)!==1||(t.offsetX??0)!==0||(t.offsetY??0)!==0)throw Error('MODKIT_TERRAIN_BRUSH_REQUIRES_IDENTITY_XY');
    const contains=(x,y)=>{
      if(!area)return true;
      if(area.type==='rectangle')return x>=area.minX&&x<area.maxX&&y>=area.minY&&y<area.maxY;
      if(area.type==='circle')return (x-area.center.x)**2+(y-area.center.y)**2<=area.radius**2;
      if(area.type==='polygon'){let inside=false;for(let i=0,j=area.points.length-1;i<area.points.length;j=i++){const a=area.points[i],b=area.points[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
      if(area.type==='corridor')return area.points.slice(1).some((b,i)=>{const a=area.points[i],dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy,u=Math.max(0,Math.min(1,len?((x-a.x)*dx+(y-a.y)*dy)/len:0));return (x-a.x-u*dx)**2+(y-a.y-u*dy)**2<=area.width**2/4;});
      throw Error('MODKIT_TERRAIN_AREA_REQUIRED');
    };
    return {width,height,contains,indices:Array.from({length:width*height},(_,i)=>i).filter(i=>contains(i%width+.5,Math.floor(i/width)+.5))};
  }
  function plan(input,request){
    const operations=Array.isArray(request)?request:request.operations;
    const files=new Map([...input].map(([k,v])=>[k,v.slice()])),reports=[];
    for(const name of request.templateComponents??[])if(name.startsWith('CellAttribute_')){
      const donor=f.readCellAttribute(required(files,name)),d=dimensions(files);
      if(donor._raw.trailing.length)throw Error('MODKIT_PATHING_TEMPLATE_TRAILING_BYTES');
      files.set(name,f.writeCellAttribute({...donor,sizeX:d.width,sizeY:d.height,cells:new Uint8Array(d.width*d.height)}));
    }
    for(const op of operations){
      let changed=0;
      if(op.op==='pathing.paint'||op.op==='pathing.fill'){
        const name={noPathing:'CellAttribute_Pnp',noBuilding:'CellAttribute_Pnb',clearPathing:'CellAttribute_Pcl'}[op.layer];
        const grid=gridPoints(files,op.area),data=read(files,name),value=byte(op.value);
        let indices=grid.indices;
        if(op.op==='pathing.fill'){
          const x=integer(op.seed.x,0,grid.width-1,'seed.x'),y=integer(op.seed.y,0,grid.height-1,'seed.y'),start=y*grid.width+x,target=data.cells[start],seen=new Uint8Array(data.cells.length),queue=[start];seen[start]=1;indices=[];
          for(let at=0;at<queue.length;at++){const i=queue[at],cx=i%grid.width,cy=Math.floor(i/grid.width);if(data.cells[i]!==target||!grid.contains(cx+.5,cy+.5))continue;indices.push(i);for(const j of [cx?i-1:-1,cx+1<grid.width?i+1:-1,cy?i-grid.width:-1,cy+1<grid.height?i+grid.width:-1])if(j>=0&&!seen[j]){seen[j]=1;queue.push(j);}}
        }
        for(const i of indices)if(data.cells[i]!==value){data.cells[i]=value;changed++;}
        files.set(name,f.writeCellAttribute(data));
      }else if(op.op==='painted.set'){
        const name=op.layer,data=read(files,name);if(!data.paint)throw Error('MODKIT_TERRAIN_PAINTED_LAYOUT_UNAVAILABLE');
        const channel=op.channel==='secondary'?1:0;
        for(const c of op.cells){const x=integer(c.x,0,511,'x'),y=integer(c.y,0,511,'y'),i=2*(x+y*512)+channel,v=byte(c.value);if(data.paint[i]!==v){data.paint[i]=v;changed++;}}
        // readPaintedPathing returns a paint view into raw; the original writer preserves the complete file.
        files.set(name,f.writePaintedPathing(data));
      }else if(op.op==='vertexColor.set'){
        const data=read(files,'t3VertCol');for(const e of op.values){const row=data.entries[integer(e.entry,0,data.entries.length-1,'entry')],i=integer(e.index,0,row.data.length-1,'index'),v=byte(e.value);if(row.data[i]!==v){row.data[i]=v;changed++;}}
        files.set('t3VertCol',f.writeVertexColor(data));
      }else if(op.op==='fluff.add'||op.op==='fluff.set'||op.op==='fluff.remove'){
        const data=read(files,'t3FluffDoodad');
        if(op.op==='fluff.add'){if(data.doodads.length+op.doodads.length>100000)throw Error('MODKIT_TERRAIN_RECORD_LIMIT');data.doodads.push(...op.doodads);changed=op.doodads.length;}
        if(op.op==='fluff.remove'){const ids=new Set(op.indices.map(i=>integer(i,0,data.doodads.length-1,'index')));data.doodads=data.doodads.filter((_,i)=>!ids.has(i));changed=ids.size;}
        if(op.op==='fluff.set')for(const e of op.doodads){const i=integer(e.index,0,data.doodads.length-1,'index');data.doodads[i]={...data.doodads[i],...e};delete data.doodads[i].index;changed++;}
        files.set('t3FluffDoodad',f.writeFluffDoodad(data));
      }else if(op.op==='hardTile.repair'){
        const r=f.repairHardTileGroupKeys(required(files,'t3HardTile'));files.set('t3HardTile',r.bytes);changed=r.changes.length;
      }else if(op.op==='hardTile.replace'){
        files.set('t3HardTile',f.replaceHardTileGroups(required(files,'t3HardTile'),op.groups,{maxBytes:64*1024*1024,maxGroups:16384,maxRecords:100000}));changed=op.groups.length;
      }else if(op.op==='pathing.hints'){
        const data=read(files,'t3SyncPathingInfo');for(const c of op.cells){const i=integer(c.y,0,data.sizeY-1,'y')*data.sizeX+integer(c.x,0,data.sizeX-1,'x');data.blocks[i]=integer(c.value,0,65535,'value');changed++;}files.set('t3SyncPathingInfo',f.writePathingInfo(data));
      }else if(op.op==='palette.author'){
        const result=f.authorTerrainTexturePalette({...op,terrainXml:xml(required(files,'t3Terrain.xml')),
          terrainDataXml:files.has('Base.SC2Data/GameData/TerrainData.xml')?xml(files.get('Base.SC2Data/GameData/TerrainData.xml')):'<Catalog/>',
          terrainTexDataXml:files.has('Base.SC2Data/GameData/TerrainTexData.xml')?xml(files.get('Base.SC2Data/GameData/TerrainTexData.xml')):undefined});
        for(const[name,text]of Object.entries({ 't3Terrain.xml':result.terrainXml,'Base.SC2Data/GameData/TerrainData.xml':result.terrainDataXml,'Base.SC2Data/GameData/TerrainTexData.xml':result.terrainTexDataXml}))files.set(name,encoder.encode(text));
        changed=op.textures.length;
      }else if(op.op==='ramp.template'){
        const prefix='@donor:'+op.donorDirectory+':',donor=new Map([...files].filter(([name])=>name.startsWith(prefix)).map(([name,bytes])=>[name.slice(prefix.length),bytes]));
        const r=placeNativeRamp(f,files,donor,op);reports.push({op:op.op,...r});continue;
      }else throw Error('MODKIT_TERRAIN_OPERATION_REFUSED: '+op.op);
      reports.push({op:op.op,changed});
    }
    // Reopen every changed native component through the original parser before returning a candidate.
    for(const[name,bytes]of files){const old=input.get(name);if((!old||bytes.length!==old.length||bytes.some((b,i)=>b!==old[i]))&&!name.startsWith('Base.SC2Data/'))read(files,name);}
    return {next:files,reports,warnings:['Native file round-trip verified; SC2 Editor/game acceptance has not been run','Painted channels and PATH hints are raw native values, not a runtime navigation rebuild','CellAttribute masks do not override unit footprints or all cliff/air rules']};
  }
  function navigation(files,{route,profile='NORMAL_GROUND',maxSize=512,catalogSnapshot,catalogStatus}={}){
    const dims=dimensions(files);if(dims.width*dims.height>65536)throw Error('MODKIT_NAVIGATION_LIMIT_256_MAP');
    const errors=[];const map=f.parseMapEntries(files,{onError:(name,e)=>errors.push({name,error:String(e)})});
    const spatial=n.sc2MapSpatialData(map,catalogSnapshot,{groundCellSize:1});if(spatial.width*spatial.height>65536)throw Error('MODKIT_NAVIGATION_LIMIT_256_MAP');
    const sum=a=>a.reduce((a,b)=>a+b,0),nav=n.analyzeMapNavigation(spatial),counts={walkable:sum(n.walkableMask(spatial)),buildable:sum(n.buildableMask(spatial)),terrainWalkable:sum(spatial.terrainWalkable),blockers:spatial.blockers.length,regions:nav.regions.length,nodes:nav.nodes.length,edges:nav.edges.length};
    let found;
    if(route){const node=p=>{const region=n.regionAt(nav,p.x,p.y);return region?nav.nodes.filter(v=>v.region===region||v.id===region).sort((a,b)=>(a.position[0]-p.x)**2+(a.position[1]-p.y)**2-(b.position[0]-p.x)**2-(b.position[1]-p.y)**2)[0]?.id:undefined;};const a=node(route.from),b=node(route.to);found=a&&b?n.findRoute(nav,a,b,{capabilities:n.PROFILE_CAPABILITIES[profile]}):undefined;}
    const compact=found?{...found,nodes:found.nodes.slice(0,65),steps:found.steps.slice(0,64).map(s=>({...s,edge:{...s.edge,path:s.edge.path.slice(0,64),totalPathPoints:s.edge.path.length,pathTruncated:s.edge.path.length>64}})),blockerIds:found.blockerIds.slice(0,100),totalSteps:found.steps.length,truncated:found.steps.length>64||found.steps.some(s=>s.edge.path.length>64)}:undefined;
    return {summary:{counts,width:spatial.width,height:spatial.height,route:route?compact??null:undefined,profile,parseErrors:errors,
      catalogFootprints:!!catalogSnapshot,catalog:catalogStatus,engineValidated:false,limitations:catalogSnapshot?['Static placed-object footprints; live unit state, exact movement radius and engine pathfinding are not simulated']:['Terrain and authored masks only; catalog=false omits effective footprints and live unit state']},png:n.navigationToPng(map,nav,{spatial,routes:found?[found]:[],overview:{catalog:catalogSnapshot,pixelsPerCell:Math.max(1,Math.min(32,Math.floor(maxSize/Math.max(spatial.width,spatial.height))))}})};
  }
  const fit=(files,request)=>{const template=nativeRampTemplate(f,files,request),all=f.rankDiagonalCliffRampPlacements([template],request.crossings.map(p=>[p.x,p.y]),[request.uphill.x,request.uphill.y]);return {total:all.length,candidates:all.slice(0,16).map(c=>({...c,offsetX:c.center[0]-template.ramp.frames.mid.center[0],offsetY:c.center[1]-template.ramp.frames.mid.center[1]})),engineValidated:false};};
  return {inspect,plan,navigation,read,dimensions,fit,catalogQueries};
}
