import {DataDocument} from './document.js';

export interface XPSearchRecipe {radius:number;replace?:boolean}

/** Explicit map-wide native kill-XP recipient search. Per-behavior sharing is
 * separate; a hero recipe must not silently change every hero on the map. */
export function xpSearchRecipe(document:DataDocument,args:XPSearchRecipe){
 const fail=(reason:string)=>Error('XP_SEARCH_RECIPE_'+reason);
 if(!Number.isFinite(args.radius)||args.radius<0||args.radius>=524288)throw fail('RADIUS');
 const local=document.objects().filter(o=>o.domain==='Game'&&o.id==='Dflt');
 if(local.length>1||local.some(o=>o.ctype!=='CGame'))throw fail('GAME_RECORD');
 const object=local[0],fields=object?.fields.filter(f=>f.name==='VeterancySearchRadius')??[];
 if(fields.length>1||fields.some(f=>f.index!==undefined||f.children.length||f.attrs.removed!==undefined))throw fail('FIELD_SHAPE');
 if(fields.length&&Number(fields[0].value)!==args.radius&&!args.replace)throw fail('REPLACE_REQUIRED');
 const target={domain:'Game',id:'Dflt'};
 if(!object)document.createObject('CGame','Dflt');
 document.setField(target,'VeterancySearchRadius','value',args.radius);
 return document.objectKey(document.resolve(target));
}
