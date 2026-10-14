import type {AnimCollection,AnimTrack,ModelClip,PreviewMesh} from './types.js';

interface PackedCollection extends Omit<AnimCollection,'tracks'|'entries'> {trackRefs:Array<[string,number]>;entryRefs:Array<[number,number,number]>}
interface PackedClip extends Omit<ModelClip,'tracks'|'collections'> {trackRefs:Array<[string,number]>;collectionRefs?:number[]}
interface PackedAnimationData {version:1;tracks:AnimTrack[];collections:PackedCollection[]}

/** Canonicalize by object identity. Distinct duplicate-ID entries remain distinct. */
export function packModelAnimation(mesh:PreviewMesh):{clips:PackedClip[];animationData:PackedAnimationData}{
 const tracks:AnimTrack[]=[],collections:PackedCollection[]=[],trackIndices=new Map<AnimTrack,number>(),collectionIndices=new Map<AnimCollection,number>();
 const trackIndex=(track:AnimTrack)=>{let index=trackIndices.get(track);if(index===undefined){index=tracks.length;trackIndices.set(track,index);tracks.push(track);}return index;};
 const collectionIndex=(collection:AnimCollection)=>{let index=collectionIndices.get(collection);if(index===undefined){index=collections.length;collectionIndices.set(collection,index);const {tracks:map,entries,...metadata}=collection;collections.push({...metadata,trackRefs:Object.entries(map).map(([id,track]):[string,number]=>[id,trackIndex(track)]),entryRefs:entries.map((e):[number,number,number]=>[e.id,e.packed,trackIndex(e.track)])});}return index;};
 const clips=mesh.clips.map(clip=>{const {tracks:map,collections:groups,...metadata}=clip;return {...metadata,trackRefs:Object.entries(map).map(([id,track]):[string,number]=>[id,trackIndex(track)]),...(groups===undefined?{}:{collectionRefs:groups.map(collectionIndex)})};});
 return {clips,animationData:{version:1,tracks,collections}};
}

/** Self-contained: serialized into the offline browser without imports or evaluation. */
export function unpackModelAnimation(mesh:PreviewMesh){
 const object=mesh as unknown as {animationData?:PackedAnimationData;clips:PackedClip[]|ModelClip[]},data=object.animationData;
 if(!data)return mesh;
 if(data.version!==1||!Array.isArray(data.tracks)||!Array.isArray(data.collections))throw new Error('CUTSCENE_PACKED_ANIMATION_VERSION');
 const track=(index:number)=>{if(!Number.isInteger(index)||index<0||index>=data.tracks.length)throw new Error('CUTSCENE_PACKED_ANIMATION_TRACK_INDEX');return data.tracks[index];};
 const collections:AnimCollection[]=data.collections.map(collection=>{const {trackRefs,entryRefs,...metadata}=collection;return {...metadata,tracks:Object.fromEntries(trackRefs.map(([id,index])=>[id,track(index)])),entries:entryRefs.map(([id,packed,index])=>({id,packed,track:track(index)}))};});
 object.clips=(object.clips as PackedClip[]).map(clip=>{const {trackRefs,collectionRefs,...metadata}=clip;return {...metadata,tracks:Object.fromEntries(trackRefs.map(([id,index])=>[id,track(index)])),...(collectionRefs===undefined?{}:{collections:collectionRefs.map(index=>{if(!Number.isInteger(index)||index<0||index>=collections.length)throw new Error('CUTSCENE_PACKED_ANIMATION_COLLECTION_INDEX');return collections[index];})})};});
 delete object.animationData;
 return mesh;
}
