import type {ModelAttachment,ModelLookGroup} from './types.js';
interface SectionResolver {getSectionByReference(ref:unknown):{content:Record<string,unknown>[]}|undefined}
export function readRigMetadata(model:Record<string,unknown>,sections:SectionResolver,attachments:ModelAttachment[],groups:Array<{name:string;parts:Array<{boneIndex:number}>}>){
 const raw=sections.getSectionByReference(model.turret_parts)?.content??[],number=(v:unknown,fallback=0)=>typeof v==='number'&&Number.isFinite(v)?v:fallback;
 const matrix=(v:unknown)=>{const m=v as Record<string,Record<string,number>>|undefined;return ['x','y','z','w'].flatMap(c=>['x','y','z','w'].map(r=>number(m?.[c]?.[r])));};
 const lookup=new Map(raw.map(p=>[number(p.bone,-1),p]));
 const lookAtGroups:ModelLookGroup[]=groups.map(g=>({name:g.name,parts:g.parts.flatMap(part=>{const p=lookup.get(part.boneIndex);if(!p)return [];return [{boneIndex:part.boneIndex,forward:matrix(p.matrix_forward),yawLimited:!!(number(p.yaw_flags)&2),yawMin:number(p.yaw_min),yawMax:number(p.yaw_max),yawWeight:number(p.yaw_weight,1),pitchLimited:!!(number(p.pitch_flags)&2),pitchMin:number(p.pitch_min),pitchMax:number(p.pitch_max),pitchWeight:number(p.pitch_weight,1)}];})}));
 return {attachmentPoints:attachments.map(a=>({name:a.name,boneIndex:a.boneIndex})),lookAtGroups};
}
