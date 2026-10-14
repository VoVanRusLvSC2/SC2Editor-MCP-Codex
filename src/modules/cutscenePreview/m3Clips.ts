import type {AnimCollection,AnimTrack,ModelClip,NativeAnimEvent} from './types.js';
export interface M3ClipReadOptions {sourceBundle?:string;sourceSha256?:string;sourceGuid?:string;sourceGuids?:string[];includeGlobalLoops?:boolean}
/** A name can belong to several bundles/sequences. Preserve origins instead of overwriting by name. */
export function mergeM3Clips(target:ModelClip[],incoming:ModelClip[]){
 const key=(clip:ModelClip)=>JSON.stringify([clip.name,clip.sourceBundle??'',clip.sourceSha256??'',clip.sequenceIndex??-1,clip.sourceGuid??'',clip.sourceGuids??[]]);
 const collectionKey=(c:AnimCollection)=>JSON.stringify([c.sourceBundle??'',c.sourceSha256??'',c.sourceGuid??'',c.sourceGuids??[],c.stcIndex]);
 for(const clip of incoming){const previous=target.find(c=>key(c)===key(clip));
  if(previous){previous.tracks={...previous.tracks,...clip.tracks};if(clip.collections){const collections=previous.collections??=[];
   for(const c of clip.collections)if(!collections.some(old=>collectionKey(old)===collectionKey(c)))collections.push(c);}}
  else target.push({...clip,tracks:{...clip.tracks},...(clip.collections?{collections:[...clip.collections]}:{})});
 }
 return target;
}
/** Native typed MD34 channels. Raw header/collection metadata is evidence, not an engine-parity claim. */
export function readM3Clips(b:Buffer,wantedNames?:string[],keepMetadata=false,options:M3ClipReadOptions={}):ModelClip[]{
 const tag=(at:number)=>b.toString('ascii',at,at+4).replace(/\0/g,'').split('').reverse().join('');
 if(b.length<24||tag(0)!=='MD34')throw new Error('CUTSCENE_M3A_REQUIRES_MD34');
 const off=b.readUInt32LE(4),count=b.readUInt32LE(8);
 // Shipped Artanis InteractiveAnims has 117,567 entries in an 11.5 MB file.
 if(!count||count>250000||off<24||off+count*16>b.length)throw new Error('CUTSCENE_M3A_INDEX');
 const sections=Array.from({length:count},(_,i)=>{const at=off+i*16;return {tag:tag(at),offset:b.readUInt32LE(at+4),count:b.readUInt32LE(at+8),version:b.readUInt32LE(at+12)};});
 const range=(at:number,size:number)=>{if(!Number.isSafeInteger(at)||!Number.isSafeInteger(size)||at<0||size<0||at+size>b.length)throw new Error('CUTSCENE_M3A_BOUNDS');};
 const ref=(at:number,expected:string,stride:number)=>{range(at,12);const n=b.readUInt32LE(at);if(!n)return undefined;const s=sections[b.readUInt32LE(at+4)];if(!s||s.tag!==expected||n>s.count)throw new Error('CUTSCENE_M3A_REFERENCE: '+expected);range(s.offset,n*stride);return {...s,count:n};};
 const model=ref(12,'MODL',124);
 if(!model||model.count!==1||![20,21,23,24,25,26,28,29,30].includes(model.version))throw new Error('CUTSCENE_M3A_MODEL');
 const floats=(at:number,n:number)=>{range(at,n*4);return Array.from({length:n},(_,i)=>{const v=b.readFloatLE(at+i*4);if(!Number.isFinite(v))throw new Error('CUTSCENE_M3A_FLOAT');return v;});};
 const string=(at:number)=>{const s=ref(at,'CHAR',1);if(!s)return '';if(s.count>4096)throw new Error('CUTSCENE_M3A_STRING');return b.toString('utf8',s.offset,s.offset+s.count).replace(/\0.*$/s,'');};
 const seq=ref(model.offset+16,'SEQS',1),stc=ref(model.offset+28,'STC_',204),stg=ref(model.offset+40,'STG_',24),sts=ref(model.offset+68,'STS_',28);
 if(seq&&(seq.count>256||![1,2].includes(seq.version)))throw new Error('CUTSCENE_M3_SEQUENCE_UNSUPPORTED');
 if(stc&&stc.version!==4)throw new Error('CUTSCENE_M3_STC_UNSUPPORTED');
 if(stg&&stg.version!==0)throw new Error('CUTSCENE_M3_STG_UNSUPPORTED');
 if(sts&&sts.version!==0)throw new Error('CUTSCENE_M3_STS_UNSUPPORTED');
 const descriptors=[
  ['SDEV','EVNT',0,0],['SD2V','VEC2',8,2],['SD3V','VEC3',12,3],['SD4Q','QUAT',16,4],
  ['SDCC','COL',4,4],['SDR3','REAL',4,1],['SDU8','U8__',1,1],['SDS6','I16_',2,1],
  ['SDU6','U16_',2,1],['SDS3','I32_',4,1],['SDU3','U32_',4,1],['SDFG','FLAG',4,1],['SDMB','BNDS',28,7],
 ] as const;
 let keyBudget=0;
 const collectionCache=new Map<number,AnimCollection>();
 const decodeCollection=(index:number):AnimCollection=>{
  const cached=collectionCache.get(index);if(cached)return cached;
  if(!stc||index<0||index>=stc.count)throw new Error('CUTSCENE_M3_STC_INDEX');
  const at=stc.offset+index*204;range(at,204);
  const member=sts?b.readUInt16LE(at+16):undefined;
  if(member!==undefined&&member>=sts!.count)throw new Error('CUTSCENE_M3_STS_INDEX');
  const membership=member===undefined?undefined:ref(sts!.offset+member*28,'U32_',4);
  const stsAnimIds=member===undefined?undefined:membership?Array.from({length:membership.count},(_,i)=>b.readUInt32LE(membership.offset+i*4)):[];
  const ids=ref(at+20,'U32_',4),refs=ref(at+32,'U32_',4);
  if(Boolean(ids)!==Boolean(refs)||ids&&refs&&ids.count!==refs.count||ids&&ids.count>20000)throw new Error('CUTSCENE_M3_TRACK_INDEX');
  const stsAt=member===undefined?undefined:sts!.offset+member*28;
  const collection:AnimCollection={stcIndex:index,name:string(at),priority:b.readUInt16LE(at+14),concurrent:b.readUInt16LE(at+12)!==0,
   stsIndex:member,stsIndexFallback:b.readUInt16LE(at+18),stsAnimIds,
   ...(stsAt===undefined?{}:{stsHierarchy:{parentIndex:b.readInt32LE(stsAt+12),nextIndex:b.readInt32LE(stsAt+16),childIndex:b.readInt32LE(stsAt+20),s1:b.readInt16LE(stsAt+24),s2:b.readUInt16LE(stsAt+26)}}),
   referenceCount:b.readUInt32LE(at+44),animIds:[],animRefs:[],tracks:{},entries:[],sourceBundle:options.sourceBundle,sourceSha256:options.sourceSha256,sourceGuid:options.sourceGuid,sourceGuids:options.sourceGuids};
  collectionCache.set(index,collection);
  for(let i=0;i<(ids?.count??0);i++){
   const id=b.readUInt32LE(ids!.offset+i*4),packed=b.readUInt32LE(refs!.offset+i*4),type=packed>>>16,entry=packed&65535;
   collection.animIds.push(id);collection.animRefs.push(packed);
   const descriptor=descriptors[type];if(!descriptor)throw new Error('CUTSCENE_M3_TRACK_TYPE: '+type);
   const [blockTag,keyTag,keyStride,dimensions]=descriptor,blocks=ref(at+48+type*12,blockTag,32);
   if(!blocks||blocks.version!==0||entry>=blocks.count)throw new Error('CUTSCENE_M3_TRACK_BLOCK');
   const block=blocks.offset+entry*32,times=ref(block,'I32_',4);
   let stride:number=keyStride;
   if(type===0){range(block+20,12);const index=b.readUInt32LE(block+24),section=sections[index];if(b.readUInt32LE(block+20)&&(!section||section.tag!=='EVNT'||![0,1,2].includes(section.version)))throw new Error('CUTSCENE_M3_EVENT_BLOCK');stride=section?.version===2?108:section?.version===1?104:100;}
   const keys=ref(block+20,keyTag,stride);
   if(!times&&!keys)continue;
   if(!times||!keys||times.count!==keys.count||times.count>20000)throw new Error('CUTSCENE_M3_KEY_COUNT');
   keyBudget+=keys.count*Math.max(dimensions,type===0?16:1);if(keyBudget>2000000)throw new Error('CUTSCENE_M3_KEY_BUDGET');
   const ts=Array.from({length:times.count},(_,k)=>b.readInt32LE(times.offset+k*4));
   if(ts.some((t,k)=>k>0&&t<ts[k-1]))throw new Error('CUTSCENE_M3_KEY_ORDER');
   const events:NativeAnimEvent[]=[];
   const values=Array.from({length:keys.count},(_,k)=>{
    const key=keys.offset+k*stride;
    if(type===0){events.push({time:ts[k],name:string(key),id:b.readInt32LE(key+12),bone:b.readInt16LE(key+16),matrix:floats(key+20,16),flags:b.readUInt32LE(key+84),payload:string(key+88),
      ...(keys.version>=1?{dataParam0:b.readUInt32LE(key+100)}:{}),...(keys.version>=2?{dataParam1:b.readUInt32LE(key+104)}:{})});return [];}
    if(type===4)return [b[key+2]/255,b[key+1]/255,b[key]/255,b[key+3]/255];
    if(type===6)return [b[key]];
    if(type===7)return [b.readInt16LE(key)];
    if(type===8)return [b.readUInt16LE(key)];
    if(type===9)return [b.readInt32LE(key)];
    if(type===10||type===11)return [b.readUInt32LE(key)];
    return floats(key,dimensions);
   });
   const fend=b.readUInt32LE(block+16),track:AnimTrack={times:ts,values,quaternion:type===3,type,flags:b.readUInt32LE(block+12),fend,
    ...(type===11||type===0?{step:true}:{}),...(collection.concurrent&&fend>0?{wrap:fend}:{}),...(events.length?{events}:{})};
   collection.entries.push({id,packed,track});
   if(!collection.tracks[String(id)])collection.tracks[String(id)]=track;
  }
  return collection;
 };
 const normalize=(name:string)=>name.toLowerCase().replace(/[^a-z0-9]/g,'');
 const wanted=wantedNames?new Set(wantedNames.map(normalize)):undefined;
 const includeGlobals=options.includeGlobalLoops!==false;
 const clips:ModelClip[]=Array.from({length:seq?.count??0},(_,i)=>{
  const at=seq!.offset+i*(seq!.version===1?96:92),name=string(at+8),start=b.readUInt32LE(at+20),end=b.readUInt32LE(at+24),sequenceFlags=b.readUInt32LE(at+32);
  if(end<start)throw new Error('CUTSCENE_M3_SEQUENCE_TIME');
  const collections:AnimCollection[]=[],tracks:Record<string,AnimTrack>={};
  const isGlobal=(sequenceFlags&2)!==0||/^glstand(?:$|[\s_,]|\d)/i.test(name);
  const selected=!wanted||wanted.has(normalize(name))||includeGlobals&&(/^gl/i.test(name)||(sequenceFlags&2)!==0);
  if(selected&&stg&&i<stg.count){
   const indices=ref(stg.offset+i*24+12,'U32_',4);
   if(indices){if(indices.count>128)throw new Error('CUTSCENE_M3_STG_BUDGET');for(let k=0;k<indices.count;k++){
    const collection=decodeCollection(b.readUInt32LE(indices.offset+k*4));collections.push(collection);
    const allowed=collection.stsAnimIds===undefined?undefined:new Set(collection.stsAnimIds);
    for(const e of collection.entries)if((!allowed||allowed.has(e.id))&&!tracks[String(e.id)])tracks[String(e.id)]=e.track;
   }}
  }
  return {name,start,end,tracks,collections,sequenceIndex:i,sequenceId:b.readInt32LE(at),sequenceStoredIndex:b.readInt32LE(at+4),sequenceFlags,blendMs:b.readUInt32LE(at+48),movementSpeed:floats(at+28,1)[0],looping:!(sequenceFlags&1),
   globalLoop:isGlobal,sourceBundle:options.sourceBundle,sourceSha256:options.sourceSha256,sourceGuid:options.sourceGuid,sourceGuids:options.sourceGuids};
 });
 return wanted&&!keepMetadata?clips.filter(c=>wanted.has(normalize(c.name))||includeGlobals&&(/^gl/i.test(c.name)||(c.sequenceFlags!&2)!==0)):clips;
}
