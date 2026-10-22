import {DataDocument} from './document.js';

export interface AbilityChargesRecipe {
 id:string;max:number;start?:number;use?:number;regen?:number;location?:'Abil'|'Unit'|'Player'|'Global';link?:string;queue?:boolean;
}
/** Own only the direct level-zero charge subtree. Native Data remains the
 * authority for depletion, availability, shared scope and recharge. */
export function abilityChargesRecipe(document:DataDocument,args:AbilityChargesRecipe){
 const error=(reason:string)=>Error('ABILITY_CHARGES_'+reason);
 const max=args.max,start=args.start??max,use=args.use??(max?1:0),regen=args.regen??0,location=args.location??'Unit',link=args.link??args.id;
 if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(args.id)||!/^[A-Za-z_][A-Za-z0-9_/.:-]{0,127}$/.test(link))throw error('ID_OR_LINK');
 if(!Number.isInteger(max)||max<0||max>1000||!Number.isInteger(start)||start<0||start>max||!Number.isInteger(use)||use<0||use>max||max>0&&use===0)throw error('COUNTS');
 if(!Number.isFinite(regen)||regen<0||regen>=524288||max===0&&(start!==0||use!==0||regen!==0))throw error('REGEN');
 if(!['Abil','Unit','Player','Global'].includes(location))throw error('LOCATION');
 const abilities=document.objects().filter(o=>o.domain==='Abil'&&o.id===args.id);if(abilities.length!==1)throw error('UNIQUE_LOCAL_ABILITY_REQUIRED');
 const ability=abilities[0];if(!['CAbilEffectInstant','CAbilEffectTarget'].includes(ability.ctype))throw error('DIRECT_EXECUTION_ABILITY_REQUIRED');
 if(ability.fields.some(f=>f.name==='Cost'&&f.index===undefined))throw error('UNINDEXED_LOCAL_COST_UNVERIFIED');
 const cost=ability.fields.find(f=>f.name==='Cost'&&f.index==='0'),charges=cost?.children.filter(f=>f.name==='Charge')??[];
 if(charges.length>1)throw error('LOCAL_CHARGE_AMBIGUOUS');
 const selector={domain:'Abil',id:args.id};if(charges[0])document.removeField(selector,charges[0].path);
 if(!cost)document.addNative(selector,undefined,{name:'Cost',index:0});
 // Zero TimeStart immediately fills a partial initial stock. The native -1
 // initial-timer sentinel holds that stock while zero TimeUse keeps casts finite.
 const initialTime=regen===0&&start<max?-1:regen;
 document.addNative(selector,'Cost[0]',{name:'Charge',link,attrs:{CountMax:max,CountStart:start,CountUse:use,TimeUse:regen,TimeStart:initialTime,TimeDelay:0,Location:location,HideCount:max===0?1:0},children:[
  {name:'Flags',index:'EnableChargeTimeQueuing',value:max>0&&args.queue!==false?1:0},
  {name:'Flags',index:'IgnoreTimeDelay',value:0},{name:'Flags',index:'RestoreAllChargesOnCooldown',value:0}
 ]});
 return document.objectKey(document.resolve(selector));
}
