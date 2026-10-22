import {DataDocument} from './document.js';
import type {DataObject,DataNativeFieldSpec} from './types.js';
export interface VeterancyLevel {xp:number;lifeDelta?:number;damageDelta?:number}
export interface VeterancyRecipe {id:string;unit:string;levelEffect:string;levels:VeterancyLevel[];xpFraction?:number;replace?:boolean}

/** One solo kill-XP behavior with cumulative per-level stat deltas. Native Data
 * awards experience and applies levels; no parallel trigger progression state. */
export function veterancyRecipe(document:DataDocument,available:readonly DataObject[],args:VeterancyRecipe){
 const error=(reason:string)=>Error('VETERANCY_RECIPE_'+reason);
 if(args.levels.length<1||args.levels.length>100||args.levels[0].xp!==0)throw error('LEVEL_TABLE');
 let previous=-1,life=0,damage=0;
 for(const level of args.levels){
  if(!Number.isFinite(level.xp)||level.xp<0||level.xp>=524288||level.xp<=previous)throw error('XP_THRESHOLDS');previous=level.xp;
  for(const value of [level.lifeDelta??0,level.damageDelta??0])if(!Number.isFinite(value)||value<0||value>=524288)throw error('STAT_DELTA');
  life+=level.lifeDelta??0;damage+=level.damageDelta??0;
  if(Math.max(life,damage)>=524288)throw error('CUMULATIVE_STAT_RANGE');
 }
 if(!Number.isFinite(args.xpFraction??1)||(args.xpFraction??1)<0||(args.xpFraction??1)>10)throw error('XP_FRACTION');
 const unit=document.objects().find(o=>o.domain==='Unit'&&o.id===args.unit);if(!unit)throw error('LOCAL_UNIT_REQUIRED');
 const selector={domain:'Behavior',id:args.id},existing=document.objects().find(o=>o.domain==='Behavior'&&o.id===args.id);
 if(existing&&!args.replace)throw error('REPLACE_REQUIRED');
 if(existing&&existing.ctype!=='CBehaviorVeterancy')throw error('TARGET_CLASS');
 if(!available.some(o=>o.domain==='Effect'&&o.id===args.levelEffect))throw error('LEVEL_EFFECT_REQUIRED');
 const vets=new Set(available.filter(o=>o.ctype==='CBehaviorVeterancy'&&o.id&&o.id!==args.id).map(o=>o.id!));
 let current:DataObject|undefined=unit;const visited=new Set<string>();
 while(current){
  if(!current.id||visited.has(current.id))throw error('UNIT_PARENT_CYCLE');visited.add(current.id);
  if(current.fields.some(f=>f.name==='BehaviorArray'&&f.link&&vets.has(f.link)))throw error('EXISTING_VETERANCY');
  if(!current.parent)break;
  const parents=available.filter(o=>o.domain==='Unit'&&o.id===current!.parent);
  if(parents.length!==1)throw error('UNIT_PARENT_UNRESOLVED_OR_LAYERED');current=parents[0];
 }
 if(existing){
  document.setParent(selector,undefined);
  while(document.objects().find(o=>o.domain==='Behavior'&&o.id===args.id)!.fields.length)document.removeField(selector,document.objects().find(o=>o.domain==='Behavior'&&o.id===args.id)!.fields.at(-1)!.path);
 }else document.createObject('CBehaviorVeterancy',args.id);
 const fields:DataNativeFieldSpec[]=[
  {name:'Flags',index:'CombineNumericModifications',value:1},{name:'Flags',index:'CombineXP',value:1},
  {name:'XPFraction',index:'Kills',value:args.xpFraction??1},{name:'SharedXPFraction',index:'Kills',value:0},
  {name:'SharedXPRadius',index:'Kills',value:0},{name:'TargetFilters',index:'Kills',value:'-;Player,Ally,Neutral,Hallucination'},
  // Core defaults include every same-player recipient. A zero shared fraction
  // does not remove those recipients from the native XP divisor.
  {name:'ShareFilters',index:'Kills',value:'Self;Ally,Neutral,Enemy,Hallucination'},
  // Native entries count levels from one and consume XP at each transition.
  // An extra zero entry starts at level2; cumulative thresholds must become costs.
  ...args.levels.map((level,index):DataNativeFieldSpec=>({name:'VeterancyLevelArray',index,attrs:{MinVeterancyXP:level.xp-(args.levels[index-1]?.xp??0)},children:[
   {name:'Modification',children:[{name:'VitalMaxArray',index:'Life',value:level.lifeDelta??0},...['Melee','Ranged','Splash','Spell'].map(kind=>({name:'DamageDealtUnscaled',index:kind,value:level.damageDelta??0}))]},
   {name:'LevelGainEffect',value:args.levelEffect}
  ]}))
 ];
 for(const field of fields)document.addNative(selector,undefined,field);
 const target={domain:'Unit',id:args.unit};
 if(!unit.fields.some(f=>f.name==='BehaviorArray'&&f.link===args.id))document.addNative(target,undefined,{name:'BehaviorArray',link:args.id});
 document.setField(target,'FlagArray[Hero]','value',1);
 return document.objectKey(document.resolve(selector));
}
