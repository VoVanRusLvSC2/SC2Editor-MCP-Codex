import {DataDocument} from './document.js';
import type {DataObject} from './types.js';

export interface UnitAbilityAnimationRecipe {
 id:string;actor:string;unit:string;ability:string;
 cast?:string;channel?:string;finish?:string;
 loopCast?:boolean;clearFinishOnMove?:boolean;clearFinishOnStop?:boolean;replace?:boolean;
 expectedAssetRevision?:string;
}
/** Supplied by the workspace's model-asset resolver, never accepted as an
 * unverified user assertion by the MCP wrapper. */
export interface VerifiedUnitAnimationModel {
 actor:string;unit:string;actorModel:string;file:string;sha256:string;animations:readonly string[];
}
const phases=['cast','channel','finish'] as const;
const nativePhase={cast:'SourceCast',channel:'SourceChannel',finish:'SourceFinish'} as const;
const ownPrefix=(id:string)=>'MCP_'+id+'_';
function animationSelector(sequence:string,model:VerifiedUnitAnimationModel){
 if(!/^[A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9]+)*$/.test(sequence))throw Error('UNIT_ANIMATION_SELECTOR_UNSUPPORTED: '+sequence);
 if(!model.animations.includes(sequence))throw Error('UNIT_ANIMATION_SEQUENCE_MISSING: '+sequence);
 return sequence.replaceAll(' ',',');
}
/** Pure writer for one existing main unit Actor. Native playback and asset
 * resolution remain the workspace/test runner's responsibility. This never
 * constructs a second primary Actor or replaces a unit's native animation set. */
export function unitAbilityAnimationRecipe(document:DataDocument,active:readonly DataObject[],args:UnitAbilityAnimationRecipe,model:VerifiedUnitAnimationModel){
 for(const id of [args.id,args.actor,args.unit,args.ability])if(!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(id))throw Error('UNIT_ANIMATION_ID_UNSUPPORTED');
 if(!/^[a-f0-9]{64}$/.test(model.sha256)||!model.file||!model.actorModel||model.actor!==args.actor||model.unit!==args.unit)throw Error('UNIT_ANIMATION_MODEL_EVIDENCE_REQUIRED');
 const actor=document.objects().find(o=>o.domain==='Actor'&&o.id===args.actor);
 if(actor?.ctype!=='CActorUnit'||actor.attrs.unitName!==args.unit)throw Error('UNIT_ANIMATION_LOCAL_MAIN_ACTOR_REQUIRED');
 if(active.filter(o=>o.domain==='Actor'&&o.id===args.actor).length!==1)throw Error('UNIT_ANIMATION_ACTOR_DECLARATION_AMBIGUOUS');
 const all=[...active.filter(o=>!(o.domain==='Actor'&&o.id===args.actor)),actor];
 const units=all.filter(o=>o.domain==='Unit'&&o.id===args.unit),abilities=all.filter(o=>o.domain==='Abil'&&o.id===args.ability);
 if(units.length!==1||abilities.length!==1)throw Error('UNIT_ANIMATION_UNIT_OR_ABILITY_UNRESOLVED');
 if(all.filter(o=>o.ctype==='CActorUnit'&&o.attrs.unitName===args.unit).length!==1)throw Error('UNIT_ANIMATION_PRIMARY_ACTOR_AMBIGUOUS');
 const lineage:DataObject[]=[],seen=new Set<string>();let current:DataObject|undefined=actor;
 while(current){
  if(!current.id||seen.has(current.id)||lineage.length>=64)throw Error('UNIT_ANIMATION_ACTOR_PARENT_CYCLE_OR_DEPTH');seen.add(current.id);lineage.push(current);
  if(!current.parent)break;
  const matches=all.filter(o=>o.domain==='Actor'&&o.id===current!.parent);
  if(matches.length!==1)throw Error('UNIT_ANIMATION_ACTOR_PARENT_UNRESOLVED');current=matches[0];
 }
 const declaredModel=lineage.flatMap(o=>o.fields.filter(f=>f.name==='Model')).at(0);
 if(declaredModel&&(['1','true'].includes(declaredModel.attrs.removed??'')||declaredModel.attrs.reset||declaredModel.value&&!declaredModel.value.includes('##')&&declaredModel.value!==model.actorModel))throw Error('UNIT_ANIMATION_ACTOR_MODEL_UNRESOLVED');
 const prefix=ownPrefix(args.id),eventPrefix='Abil.'+args.ability+'.';
 const labels=new Set(phases.map(p=>prefix+p));
 const isOwned=(f:DataObject['fields'][number])=>f.name==='On'&&['AnimPlay','AnimClear'].includes((f.attrs.Send??'').split(' ')[0])&&labels.has((f.attrs.Send??'').split(' ')[1]);
 const localOwned=actor.fields.filter(isOwned);
 for(const owner of lineage)for(const event of owner.fields.filter(f=>f.name==='On')){
  if(isOwned(event)&&owner!==actor)throw Error('UNIT_ANIMATION_INHERITED_OWNERSHIP_UNVERIFIED');
  if((event.attrs.Terms??'').includes(eventPrefix)&&/^Anim(?:Play|Clear|Bracket|Baseline|Group)/.test(event.attrs.Send??'')&&!isOwned(event))throw Error('UNIT_ANIMATION_EXISTING_BINDING_UNVERIFIED');
 }
 if(localOwned.length&&!args.replace)throw Error('UNIT_ANIMATION_REPLACE_REQUIRED');
 const events:Array<{Terms:string;Send:string}>=[];
 for(const phase of phases){
  const sequence=args[phase];if(sequence===undefined)continue;
  const selector=animationSelector(sequence,model),label=prefix+phase,event=eventPrefix+nativePhase[phase];
  events.push({Terms:event+'Start',Send:'AnimPlay '+label+' '+selector+(phase==='channel'||phase==='cast'&&args.loopCast?' PlayForever':'')});
  // Native Snipe lets the finish animation complete and clears it on movement;
  // clearing an instantaneous finish phase immediately can hide the whole cue.
  if(phase!=='finish'||args.clearFinishOnStop)events.push({Terms:event+'Stop',Send:'AnimClear '+label});
  events.push({Terms:'UnitDeath.'+args.unit,Send:'AnimClear '+label});
  if(phase==='finish'&&args.clearFinishOnMove!==false)events.push({Terms:'UnitMovementUpdate.*.Walk; AnimPlaying '+label,Send:'AnimClear '+label});
 }
 if(!events.length)throw Error('UNIT_ANIMATION_PHASE_REQUIRED');
 for(const event of [...localOwned].reverse())document.removeField({domain:'Actor',id:args.actor},event.path);
 for(const attrs of events)document.addNative({domain:'Actor',id:args.actor},undefined,{name:'On',attrs});
 return {id:args.id,target:document.objectKey(document.resolve({domain:'Actor',id:args.actor})),events:events.length,model:{id:model.actorModel,file:model.file,sha256:model.sha256},sequences:Object.fromEntries(phases.filter(p=>args[p]!==undefined).map(p=>[p,args[p]])),nativePlayback:'not_checked' as const};
}
