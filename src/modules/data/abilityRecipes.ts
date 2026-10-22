import {DataDocument} from './document.js';
import type {DataObject} from './types.js';

export interface InstantAbilityRecipe {
 id:string;sourceAbility?:string;effect:string;button:string;energy?:number;cooldown?:number;castIntroTime?:number;castOutroTime?:number;finishTime?:number;
 clearRequirements?:boolean;replace?:boolean;unit?:string;
 card?:{page:number;slot:number;row:number;column:number;conflictReason?:string};
}
export interface TargetAbilityRecipe extends Omit<InstantAbilityRecipe,'sourceAbility'> {
 sourceAbility:string;range?:number;
}

/** Use an actual same-class native execution template; do not recreate unknown
 * class defaults from an empty CAbilEffectInstant. Presentation is a separate
 * effect-model/sound recipe and still needs engine review. */
export function instantAbilityRecipe(document:DataDocument,source:DataObject,args:InstantAbilityRecipe){
 return executionAbilityRecipe(document,source,args,'CAbilEffectInstant','INSTANT');
}
/** Retain the source template's native target/filter/cursor semantics. The caller
 * chooses a same-class target template explicitly; this does not infer unit vs
 * point targeting from a custom effect or simulate effect validators. */
export function targetAbilityRecipe(document:DataDocument,source:DataObject,args:TargetAbilityRecipe){
 if(args.range!==undefined&&(!Number.isFinite(args.range)||args.range<0||args.range>=524288))throw Error('TARGET_ABILITY_RANGE_BOUNDS');
 const key=executionAbilityRecipe(document,source,args,'CAbilEffectTarget','TARGET');
 if(args.range!==undefined)document.addNative({domain:'Abil',id:args.id},undefined,{name:'Range',index:0,value:args.range});
 return key;
}
function executionAbilityRecipe(document:DataDocument,source:DataObject,args:InstantAbilityRecipe,ctype:'CAbilEffectInstant'|'CAbilEffectTarget',kind:'INSTANT'|'TARGET'){
 const prefix=kind+'_ABILITY_';
 if(source.ctype!==ctype||!source.id||source.id===args.id)throw Error(prefix+'SOURCE_UNSUPPORTED');
 if((args.unit===undefined)!==(args.card===undefined))throw Error(prefix+'UNIT_AND_CARD_REQUIRED_TOGETHER');
 const card=args.card;
 if(card&&(!Number.isInteger(card.page)||card.page<0||card.page>7||!Number.isInteger(card.slot)||card.slot<0||card.slot>199||!Number.isInteger(card.row)||card.row<0||card.row>2||!Number.isInteger(card.column)||card.column<0||card.column>4))throw Error(prefix+'CARD_BOUNDS');
 for(const n of [args.energy??0,args.cooldown??0])if(!Number.isFinite(n)||n<0||n>=524288)throw Error(prefix+'COST_BOUNDS');
 const timings=[['castIntroTime','CastIntroTime','CAST_INTRO_BOUNDS'],['castOutroTime','CastOutroTime','CAST_OUTRO_BOUNDS'],['finishTime','FinishTime','FINISH_TIME_BOUNDS']] as const;
 for(const [key,,error]of timings){const value=args[key];if(value!==undefined&&(!Number.isFinite(value)||value<0||value>=524288))throw Error(prefix+error);}
 const selector={domain:'Abil',id:args.id},existing=document.objects().find(o=>o.domain==='Abil'&&o.id===args.id);
 if(existing&&!args.replace)throw Error(prefix+'REPLACE_REQUIRED');
 if(existing&&existing.ctype!==ctype)throw Error(prefix+'TARGET_CLASS_UNSUPPORTED');
 let unit:DataObject|undefined;
 if(args.unit){
  unit=document.objects().find(o=>o.domain==='Unit'&&o.id===args.unit);
  if(!unit)throw Error(prefix+'LOCAL_UNIT_REQUIRED');
  if(unit.fields.some(f=>f.name==='CardLayouts'&&f.index===undefined))throw Error(prefix+'UNINDEXED_LOCAL_CARD_UNVERIFIED');
  const slot=unit.fields.find(f=>f.name==='CardLayouts'&&f.index===String(card!.page))?.children.find(f=>f.name==='LayoutButtons'&&f.index===String(card!.slot));
  if(slot&&slot.attrs.AbilCmd!==args.id+',Execute')throw Error(prefix+'CARD_SLOT_OCCUPIED');
 }
 if(existing){
  document.setParent(selector,source.id);
  while(document.objects().find(o=>o.domain==='Abil'&&o.id===args.id)!.fields.length)document.removeField(selector,document.objects().find(o=>o.domain==='Abil'&&o.id===args.id)!.fields.at(-1)!.path);
 }else document.createObject(ctype,args.id,{parent:source.id});
 // A source may explicitly share a native order identity. A newly named
 // execution ability must not resolve its orders back to that source.
 document.addNative(selector,undefined,{name:'AbilSetId',value:args.id});
 document.addNative(selector,undefined,{name:'Effect',index:0,value:args.effect});
 for(const [key,name]of timings)if(args[key]!==undefined)document.addNative(selector,undefined,{name,index:0,value:args[key]});
 document.addNative(selector,undefined,{name:'Cost',index:0,children:[
  ...['Life','Shields','Energy'].flatMap(index=>[{name:'Vital',index,value:index==='Energy'?args.energy??0:0},{name:'VitalFraction',index,value:0}]),
  ...['Minerals','Vespene'].map(index=>({name:'Resource',index,value:0})),
  {name:'Cooldown',link:args.id,attrs:{Location:'Unit',TimeUse:args.cooldown??0}}
 ]});
 document.addNative(selector,undefined,{name:'CmdButtonArray',index:'Execute',attrs:{DefaultButtonFace:args.button,...args.clearRequirements!==false?{Requirements:''}:{}}});
 if(unit&&card){
  const target={domain:'Unit',id:unit.id!};
  if(!unit.fields.some(f=>f.name==='AbilArray'&&f.link===args.id))document.addNative(target,undefined,{name:'AbilArray',link:args.id});
  const path=`CardLayouts[${card.page}].LayoutButtons[${card.slot}]`;
  for(const [attr,value]of Object.entries({Face:args.button,Type:'AbilCmd',AbilCmd:args.id+',Execute',Row:card.row,Column:card.column}))document.setField(target,path,attr,value);
 }
 return document.objectKey(document.resolve(selector));
}
