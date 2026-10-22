import {DataDocument} from './document.js';
import type {DataObject,DataField,DataNativeFieldSpec} from './types.js';

export interface ProjectileEffectRecipe {
 id:string;sourceEffect:string;sourceActor:string;impactEffect:string;damageEffect:string;impactModel:string;actor?:string;replace?:boolean;
}
export interface CatalogPreload {tag:'Actor'|'Model'|'Effect'|'Unit'|'Sound';id:string}
const field=(o:DataObject,name:string)=>o.fields.find(f=>f.name===name)?.value;
const copy=(f:DataField):DataNativeFieldSpec=>({name:f.name,index:f.index,value:f.value,link:f.link,attrs:Object.fromEntries(Object.entries(f.attrs).filter(([key])=>!['index','Index','value','Link'].includes(key))),children:f.children.map(copy)});

/** Observed GenericAttack / GenericAttackMissile token profile. Keep a checked
 * native ammo/mover profile; bind the new effect tree and pin presentation links
 * rather than letting inherited ##id## links silently follow a new Action ID. */
export function projectileEffectRecipe(document:DataDocument,available:DataObject[],args:ProjectileEffectRecipe){
 const actor=args.actor??args.id+'Action',unique=(domain:string,id:string)=>{
  const found=available.filter(o=>o.domain===domain&&o.id===id);
  if(found.length!==1)throw Error('PROJECTILE_REFERENCE_AMBIGUOUS_OR_MISSING: '+domain+':'+id);
  return found[0];
 };
 for(const id of [args.id,actor,args.sourceEffect,args.sourceActor,args.impactEffect,args.damageEffect,args.impactModel])if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id))throw Error('PROJECTILE_ID_INVALID');
 if(args.id===args.sourceEffect||actor===args.sourceActor)throw Error('PROJECTILE_SOURCE_CANNOT_BE_REPLACED');
 const source=unique('Effect',args.sourceEffect),action=unique('Actor',args.sourceActor);
 if(source.ctype!=='CEffectLaunchMissile'||!field(source,'AmmoUnit')||!field(source,'ImpactEffect'))throw Error('PROJECTILE_LAUNCH_TEMPLATE_UNSUPPORTED');
 if(action.ctype!=='CActorAction'||action.parent!=='GenericAttack'||action.attrs.effectLaunch!==source.id||action.attrs.effectImpact!==field(source,'ImpactEffect')||action.attrs.effectAttack)throw Error('PROJECTILE_ACTION_TEMPLATE_UNSUPPORTED');
 unique('Effect',args.impactEffect);if(unique('Effect',args.damageEffect).ctype!=='CEffectDamage')throw Error('PROJECTILE_DAMAGE_EFFECT_REQUIRED');unique('Model',args.impactModel);
 const ammo=field(source,'AmmoUnit')!;unique('Unit',ammo);
 const missiles=available.filter(o=>o.ctype==='CActorMissile'&&o.attrs.unitName===ammo);
 if(missiles.length!==1||missiles[0].parent!=='GenericAttackMissile')throw Error('PROJECTILE_MISSILE_ACTOR_UNSUPPORTED');
 const missile=missiles[0],parent=unique('Actor','GenericAttackMissile');
 const model=(field(missile,'Model')??field(parent,'Model'))?.replaceAll('##unitName##',ammo);
 if(!model||model.includes('##'))throw Error('PROJECTILE_MISSILE_MODEL_UNRESOLVED');unique('Model',model);
 const damageEvents=action.fields.filter(f=>f.name==='On');
 if(damageEvents.length!==1||damageEvents[0].attrs.Send!=='ActionDamage'||damageEvents[0].attrs.Target||!/^Effect\.[A-Za-z_][A-Za-z0-9_]*\.Start; At Caster$/.test(damageEvents[0].attrs.Terms??''))throw Error('PROJECTILE_ACTION_EVENTS_UNSUPPORTED');
 const sounds=[...new Set(action.fields.flatMap(f=>f.attrs.Sound?[f.attrs.Sound]:[]))];for(const sound of sounds)unique('Sound',sound);
 const launchSelector={domain:'Effect',id:args.id},actorSelector={domain:'Actor',id:actor};
 for(const [selector,ctype]of [[launchSelector,'CEffectLaunchMissile'],[actorSelector,'CActorAction']] as const){
  const existing=document.objects().find(o=>o.domain===selector.domain&&o.id===selector.id);
  if(existing&&!args.replace)throw Error('PROJECTILE_REPLACE_REQUIRED: '+selector.id);
  if(existing&&existing.ctype!==ctype)throw Error('PROJECTILE_TARGET_CLASS_UNSUPPORTED: '+selector.id);
 }
 const reset=(selector:typeof launchSelector,ctype:string,parent:string)=>{
  const existing=document.objects().find(o=>o.domain===selector.domain&&o.id===selector.id);
  if(existing){
   document.setParent(selector,parent);
   for(const key of Object.keys(existing.attrs))if(!['id','parent'].includes(key))document.removeObjectAttribute(selector,key);
   while(document.resolve(selector).childIds.length){const o=document.objects().find(o=>o.domain===selector.domain&&o.id===selector.id)!;if(!o.fields.length)throw Error('PROJECTILE_TARGET_CHILD_UNSUPPORTED');document.removeField(selector,o.fields.at(-1)!.path);}
  }else document.createObject(ctype,selector.id,{parent});
 };
 reset(launchSelector,'CEffectLaunchMissile',source.id!);
 document.addNative(launchSelector,undefined,{name:'ImpactEffect',value:args.impactEffect});
 reset(actorSelector,'CActorAction',action.parent!);
 for(const [key,value]of Object.entries(action.attrs))if(!['id','parent','default'].includes(key))document.setObjectAttribute(actorSelector,key,key==='effectLaunch'?args.id:key==='effectImpact'?args.impactEffect:value);
 for(const original of action.fields){const f=copy(original);if(f.name==='On')f.attrs={...f.attrs,Terms:'Effect.'+args.damageEffect+'.Start; At Caster'};document.addNative(actorSelector,undefined,f);}
 document.setField(actorSelector,'Missile','value',missile.id!);
 document.setField(actorSelector,'Beam','value','');
 document.setField(actorSelector,'LaunchAssets','Model','');
 document.setField(actorSelector,'LaunchAssets','Sound',action.fields.find(f=>f.name==='LaunchAssets')?.attrs.Sound??'');
 const impactSound=action.fields.find(f=>f.name==='ImpactMap'&&f.index==='None')?.attrs.Sound??'';
 for(const index of ['None','Shield']){
  document.setField(actorSelector,'ImpactMap['+index+']','Model',args.impactModel);
  document.setField(actorSelector,'ImpactMap['+index+']','Sound',action.fields.find(f=>f.name==='ImpactMap'&&f.index===index)?.attrs.Sound??impactSound);
  document.setField(actorSelector,'ImpactMap['+index+']','ModelReaction','');
  for(const name of ['Model','Sound','ModelReaction'])document.setField(actorSelector,'DamageMap['+index+']',name,'');
 }
 const preloads:CatalogPreload[]=[{tag:'Actor',id:actor},{tag:'Actor',id:missile.id!},{tag:'Unit',id:ammo},{tag:'Model',id:model},{tag:'Model',id:args.impactModel},...[args.id,args.impactEffect,args.damageEffect].map(id=>({tag:'Effect' as const,id})),...sounds.map(id=>({tag:'Sound' as const,id}))];
 return {target:document.objectKey(document.resolve(launchSelector)),actor,ammoUnit:ammo,missileActor:missile.id!,missileModel:model,impactModel:args.impactModel,preloads,nativePlayback:'not_checked' as const};
}
