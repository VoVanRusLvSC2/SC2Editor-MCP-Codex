import * as z from 'zod/v4';
import type {DataObject,DataField} from './types.js';
import type {DataWorkspace} from './workspace.js';

const id=z.string().min(1).max(128);
export const presentationSchema=z.object({effects:z.array(id).min(1).max(16),includeDependencies:z.boolean().default(true),
 invisible:z.array(z.object({effect:id,reason:z.string().min(3).max(240)}).strict()).max(16).default([])}).strict().superRefine((a,c)=>{
 if(new Set(a.effects).size!==a.effects.length)c.addIssue({code:'custom',message:'Duplicate effect ID'});
 if(new Set(a.invisible.map(e=>e.effect)).size!==a.invisible.length||a.invisible.some(e=>!a.effects.includes(e.effect)))c.addIssue({code:'custom',message:'Exceptions must refer to distinct requested effects'});
});
type Declaration=DataObject&{file:string};
const flatten=(fields:DataField[]):DataField[]=>fields.flatMap(f=>[f,...flatten(f.children)]);
/** Bounded declared-event audit. Never treats a link or Model ID as native playback. */
export function inspectEffectPresentation(objects:Declaration[],input:z.input<typeof presentationSchema>){
 const args=presentationSchema.parse(input),actors=objects.filter(o=>o.domain==='Actor'&&o.id),models=objects.filter(o=>o.domain==='Model'&&o.id);
 const results=args.effects.map(effect=>{
  const exception=args.invisible.find(e=>e.effect===effect),definitions=objects.filter(o=>o.domain==='Effect'&&o.id===effect);
  const declaredPoint=definitions.some(o=>o.fields.some(f=>['ImpactLocation','WhichLocation'].includes(f.name)&&f.attrs.Value==='TargetPoint'));
  const escaped=effect.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp('(?:^|[;\\s])Effect\\.'+escaped+'\\.(Start|Stop)(?=[;\\s]|$)');
  const candidates=actors.flatMap(actor=>{
   const events=flatten(actor.fields).filter(f=>f.name==='On'&&f.attrs.removed!=='1'&&pattern.test(f.attrs.Terms??''));
   if(!events.length)return [];
   const model=actor.fields.find(f=>f.name==='Model'&&f.attrs.removed!=='1'),modelId=model?.value??model?.link;
   const found=models.filter(m=>m.id===modelId),visual=/^CActor(?:Model|Action|Beam|Missile)/.test(actor.ctype),creates=events.some(e=>/^Create(?:\s|$)/.test(e.attrs.Send??''));
   return [{actor:actor.id!,ctype:actor.ctype,file:actor.file,parent:actor.parent,visualClassCandidate:visual,declaredCreateEvent:creates,
    model:modelId??null,modelDeclaration:!modelId?'not_declared':found.length===1?'found':found.length?'ambiguous':'unresolved',
    events:events.slice(0,8).map(e=>({terms:e.attrs.Terms,send:e.attrs.Send,target:e.attrs.Target})),eventsTruncated:events.length>8,
    host:actor.fields.find(f=>f.name==='Host')?.attrs.Subject,siteOps:actor.fields.find(f=>f.name==='HostSiteOps')?.attrs.Ops,
    eventScopeReview:declaredPoint&&events.some(e=>/^Create(?:\s|$)/.test(e.attrs.Send??'')&&/(?:^|;)\s*At Target(?:\s*;|\s*$)/.test(e.attrs.Terms??''))
      ?['POINT_EFFECT_TARGET_ACTOR_SCOPE: At Target can filter out point-only execution. Review the location-bearing effect event and ground site operations; verify actual actor creation and rendered playback.']:[],
    nativePlayback:'not_checked',assetResolution:'not_checked'}];
  });
  const linked=candidates.some(c=>c.visualClassCandidate&&c.declaredCreateEvent&&c.modelDeclaration==='found');
  return {effect,effectDeclaration:definitions.length===1?'found':definitions.length?'ambiguous':'unresolved',
   presentation:exception?'intentionally_invisible':linked?'declared_links_found':candidates.some(c=>c.visualClassCandidate)?'needs_resolution':'no_declared_visual_binding',
   ...(exception?{reason:exception.reason}:{}),bindings:candidates.slice(0,12),bindingsTruncated:candidates.length>12,nativePlayback:'not_checked'};
 });
 return {effects:results,coverage:'declared_only',nativePlayback:'not_checked',
  limits:['No event execution, asset loading or rendered verification','Inherited/tokenized events, overlays, actor aliases/macros and non-Create presentations need separate resolution','A sound-only actor does not establish a visible effect; no_declared_visual_binding is a review finding, not proof of absence']};
}
export async function checkEffectPresentation(data:DataWorkspace,input:z.input<typeof presentationSchema>){
 const args=presentationSchema.parse(input);
 return data.workspace.withReadSet(async()=>{
  const records=await data.catalog(),selected=records.filter(r=>args.includeDependencies||r.layer==='workspace');
  const objects=selected.flatMap(r=>r.document.objects().filter(o=>['Effect','Actor','Model'].includes(o.domain??'')).map(o=>({...o,file:r.file})));
  if(objects.length>50000)throw Error('DATA_PRESENTATION_CATALOG_LIMIT');
  return {...inspectEffectPresentation(objects,args),catalogIssues:records.issues.slice(0,8).map(issue=>({...issue})),catalogIssueCount:records.issues.length};
 });
}
