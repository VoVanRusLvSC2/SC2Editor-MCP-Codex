import { scanXml } from "../../core/xmlScanner.js";
import {TerrainDescriptor,HeightMap,SyncHeightMap} from './document.js';
import type {TerrainState} from './operations.js';
import type {TerrainIssue} from './types.js';

/** Checks editor-load prerequisites absent from the generic Terrain readers.
 * Allocation tags are executed by the native XML reader, not inferred from HMAP.
 * This is structural validation; it does not replace an Editor open test.
 */
export function validateTerrainLoadContract(files: ReadonlyMap<string, Buffer>, width: number, height: number) {
    const xml = files.get('t3Terrain.xml')?.toString('utf8');
    if (!xml) throw new Error('DOCUMENT_TERRAIN_XML_MISSING');
    const parsed = scanXml(xml);
    const heightMap = parsed.nodes.find(n => n.tag === 'heightMap');
    if (!heightMap || (heightMap.attrs.dim??'').trim().split(/\s+/).map(Number).join(' ') !== `${width + 1} ${height + 1}`)
        throw new Error('DOCUMENT_TERRAIN_LOAD_DIMENSIONS');
    for (const [tag, count] of [['cliffCellList', width * height / 4], ['blockTextureSetList', width * height / 64]] as const) {
        const nodes = parsed.nodes.filter(n => n.tag === tag && n.parentId === heightMap.id);
        if (nodes.length !== 1 || Number(nodes[0].attrs.num) !== count)
            throw new Error('DOCUMENT_TERRAIN_ALLOCATION_REQUIRED: ' + tag);
    }
    const sync = files.get('t3SyncHeightMap');
    if (!sync || sync.length !== 64 + (width + 1) * (height + 1) * 4 || sync.toString('ascii', 0, 4) !== 'SMAP' || sync.readUInt32LE(4) !== 102 || sync.readUInt32LE(8) !== width + 1 || sync.readUInt32LE(12) !== height + 1)
        throw new Error('DOCUMENT_SYNC_HEIGHT_GRID_INVALID');
    // Newly created documents use identity geometry in Q12. Existing map
    // transforms remain the responsibility of their preserving Terrain codec.
    if ([16, 20, 24].some(o => sync.readInt32LE(o) !== 0) || [28, 32, 36].some(o => sync.readInt32LE(o) !== 4096))
        throw new Error('DOCUMENT_SYNC_HEIGHT_TRANSFORM_INVALID');
    return { cliffCells: width * height / 4, textureBlocks: width * height / 64, syncScaleQ12: [4096, 4096, 4096] };
}

/** A known identity-grid contract; unsupported transforms are preserved, not guessed. */
export function inspectTerrainLoadContract(files:ReadonlyMap<string,Buffer>) {
 const xml=files.get('t3Terrain.xml')?.toString('utf8');
 if(!xml)return {supported:false,valid:false,issues:[] as TerrainIssue[],scope:'No terrain descriptor; load contract not checked'};
 let d:TerrainDescriptor;
 try{d=new TerrainDescriptor(xml);}catch(e){return {supported:true,valid:false,issues:[{severity:'error' as const,code:'TERRAIN_LOAD_DESCRIPTOR_INVALID',message:String(e)}]};}
 if(![114,115].includes(d.version)||d.offset.some(v=>v!==0)||d.scale.some(v=>v!==1)||(d.width-1)%8||(d.height-1)%8)return {supported:false,valid:false,issues:[{severity:'warning' as const,code:'TERRAIN_LOAD_PROFILE_UNVERIFIED',message:'Load structure is measured only for aligned v114/v115 identity grids'}]};
 const sync=files.get('t3SyncHeightMap'),frame=sync&&sync.length>=64?{origin:[16,20,24].map(o=>sync.readInt32LE(o)),scale:[28,32,36].map(o=>sync.readInt32LE(o))}:undefined;
 try{const details=validateTerrainLoadContract(files,d.width-1,d.height-1);return {supported:true,valid:true,issues:[] as TerrainIssue[],details,syncFrame:frame,scope:'Native load structure; not topology, navigation or engine execution'};}
 catch(e){
  const message=String(e),unknownFrame=!!frame&&!frame.scale.every(v=>v===0)&&message.includes('SYNC_HEIGHT_TRANSFORM_INVALID');
  const issues:TerrainIssue[]=[{severity:unknownFrame?'warning':'error',code:unknownFrame?'TERRAIN_LOAD_TRANSFORM_UNVERIFIED':'TERRAIN_LOAD_CONTRACT_INVALID',message}];
  if(frame&&frame.scale.every(v=>v===0)&&!message.includes('SYNC_HEIGHT_TRANSFORM_INVALID'))issues.push({severity:'error',code:'TERRAIN_LOAD_SYNC_TRANSFORM_SINGULAR',message:'SMAP has an all-zero scale; the native identity grid cannot be reconstructed from this transform'});
  return {supported:!unknownFrame,valid:false,issues,syncFrame:frame};
 }
}

/** Repairs only the diagnosed old generator's all-zero scale/missing empty allocation. */
export function repairLegacyTerrainLoadContract(state:TerrainState) {
 const before=inspectTerrainLoadContract(state.sources);
 if(before.valid)return {changed:[] as string[],before,after:before};
 const d=state.descriptor,sync=state.sources.get('t3SyncHeightMap');
 if(!before.supported||d.version!==115||!sync||sync.length!==64+state.heights.width*state.heights.height*4||!before.syncFrame)throw Error('TERRAIN_LOAD_REPAIR_PROFILE_UNSUPPORTED');
 const hm=state.heights,clif=state.sources.get('t3SyncCliffLevel'),flags=state.sources.get('t3CellFlags'),width=hm.width-1,height=hm.height-1;
 const cliffs=d.parsed.nodes.filter(n=>n.tag==='cliffCellList'&&n.parentId===d.heightMap.id),{scale,origin}=before.syncFrame;
 if(origin.some(v=>v!==0)||!(scale.every(v=>v===0)||scale.every(v=>v===4096)))throw Error('TERRAIN_LOAD_REPAIR_TRANSFORM_NOT_DIAGNOSED');
 if(d.ramps.length||state.sources.get('Terrain')?.length||!clif||clif.length!==32+width*height*2||clif.toString('ascii',0,4)!=='CLIF'||clif.readUInt32LE(4)!==100||!flags||flags.length!==32+width*height||flags.toString('ascii',0,4)!=='LFCT'||flags.readUInt32LE(4)!==102)throw Error('TERRAIN_LOAD_REPAIR_REQUIRES_LEGACY_FLAT_CLIFF_PROFILE');
 for(let y=0;y<hm.height;y++)for(let x=0;x<hm.width;x++)if(hm.mask(x,y)!==1)throw Error('TERRAIN_LOAD_REPAIR_REQUIRES_LEVEL_ONE_VERTICES');
 for(let i=32;i<clif.length;i+=2)if(clif.readUInt16LE(i)!==64)throw Error('TERRAIN_LOAD_REPAIR_REQUIRES_FLAT_CLIF');
 for(let i=32;i<flags.length;i++)if(flags[i]!==2&&flags[i]!==6)throw Error('TERRAIN_LOAD_REPAIR_REQUIRES_UNCUT_GROUND');
 if(cliffs.length>1||cliffs.length===1&&Number(cliffs[0].attrs.num)!==width*height/4)throw Error('TERRAIN_LOAD_REPAIR_ALLOCATION_NOT_DIAGNOSED');
 let xml=d.source;const changed:string[]=[],nextSync=Buffer.from(sync),next=new Map(state.sources);
 if(scale.every(v=>v===0)){for(const offset of [28,32,36])nextSync.writeInt32LE(4096,offset);changed.push('t3SyncHeightMap');}
 if(!cliffs.length){const nl=xml.includes('\r\n')?'\r\n':'\n',at=d.heightMap.endTagStart;xml=xml.slice(0,at)+`    <cliffCellList num="${width*height/4}" numOccupied="0"/>${nl}    `+xml.slice(at);changed.push('t3Terrain.xml');}
 next.set('t3Terrain.xml',Buffer.from(xml));next.set('t3SyncHeightMap',nextSync);
 const after=inspectTerrainLoadContract(next);if(!after.valid)throw Error('TERRAIN_LOAD_REPAIR_CANNOT_INFER_REMAINING_FIELDS: '+JSON.stringify(after.issues));
 for(const name of changed)state.sources.set(name,next.get(name)!);
 state.descriptor=new TerrainDescriptor(xml);state.heights=new HeightMap(state.heights.bytes,state.descriptor);state.sync=new SyncHeightMap(nextSync,state.heights);
 return {changed,before,after};
}
