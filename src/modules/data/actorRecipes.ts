import {DataDocument} from './document.js';
import type {DataField,DataNativeFieldSpec,DataObject} from './types.js';
import {scanXml} from '../../core/xmlScanner.js';

/** Copy a concrete unit actor's authored presentation, not its executable identity.
 * Generic templates own UnitBirth/Revive. Inheriting a concrete actor and adding
 * another Create can register two primary actors for one unit. */
export function unitActorRecipe(document:DataDocument,source:DataObject,args:{id:string;unit:string;model:string;replace?:boolean;scale?:number}) {
 if(!['CActorUnit','CActorMissile'].includes(source.ctype)||!source.parent?.startsWith('GenericUnit')||!source.attrs.unitName)throw new Error('UNIT_ACTOR_SOURCE_TEMPLATE_UNSUPPORTED');
 const selector={domain:'Actor',id:args.id},existing=document.objects().find(o=>o.domain==='Actor'&&o.id===args.id);
 if(existing&&!args.replace)throw new Error('UNIT_ACTOR_REPLACE_REQUIRED');
 if(existing&&!['CActorUnit','CActorMissile'].includes(existing.ctype))throw new Error('UNIT_ACTOR_TARGET_CLASS_UNSUPPORTED');
 if(existing){document.setType(selector,source.ctype);document.setParent(selector,source.parent);while(document.objects().find(o=>o.domain==='Actor'&&o.id===args.id)!.fields.length)document.removeField(selector,document.objects().find(o=>o.domain==='Actor'&&o.id===args.id)!.fields.at(-1)!.path);}
 else document.createObject(source.ctype,args.id,{parent:source.parent});
 document.setObjectAttribute(selector,'unitName',args.unit);
 const originalUnit=source.attrs.unitName;
 const copy=(field:DataField):DataNativeFieldSpec=>{
  const attrs=Object.fromEntries(Object.entries(field.attrs).filter(([k])=>!['index','Index','value','Link'].includes(k)).map(([k,v])=>[k,v.replaceAll('##unitName##',originalUnit)]));
  if(field.name==='On'&&typeof attrs.Terms==='string')attrs.Terms=attrs.Terms.replace(/\b(UnitBirth|UnitDeath|UnitRevive|UnitConstruction|UnitMorph|UnitMovementUpdate|UnitHeightUpdate)\.([A-Za-z_][A-Za-z0-9_]*)/g,(match,event,id)=>id===originalUnit?event+'.'+args.unit:match);
  return {name:field.name,index:field.index,value:field.value?.replaceAll('##unitName##',originalUnit),link:field.link?.replaceAll('##unitName##',originalUnit),attrs,children:field.children.map(copy)};
 };
 for(const field of source.fields)document.addNative(selector,undefined,copy(field));
 for(const name of ['Model','BuildModel','PlacementModel'])document.setField(selector,name,'value',args.model);
 if(args.scale!==undefined)document.setField(selector,'Scale','value',[args.scale,args.scale,args.scale].join(','));
 return document.objectKey(document.resolve(selector));
}

/** Native effect event + one-shot model bracket. Explicit replace owns this actor. */
export function effectModelRecipe(document:DataDocument,args:{id:string;effect:string;model:string;at?:'Caster'|'Target'|'Effect'|'Source';event?:'Start'|'Stop';stopEffect?:string;stopEvent?:'Start'|'Stop';orphanPolicy?:'keep'|'stop';host?:'_Selectable';inheritScale?:boolean;scale?:number;siteOp?:string;replace?:boolean}) {
 const selector={domain:'Actor',id:args.id},existing=document.objects().find(o=>o.domain==='Actor'&&o.id===args.id);
 const parent=args.orphanPolicy==='stop'?'ModelAnimationStyleOneShot':'ModelAnimationStyleOneShotNoOrphan';
 if(existing&&!args.replace)throw new Error('EFFECT_MODEL_REPLACE_REQUIRED');
 if(existing&&existing.ctype!=='CActorModel')throw new Error('EFFECT_MODEL_TARGET_CLASS_UNSUPPORTED');
 if(existing){document.setParent(selector,parent);while(document.objects().find(o=>o.domain==='Actor'&&o.id===args.id)!.fields.length)document.removeField(selector,document.objects().find(o=>o.domain==='Actor'&&o.id===args.id)!.fields.at(-1)!.path);}
 else document.createObject('CActorModel',args.id,{parent});
 document.addNative(selector,undefined,{name:'Model',value:args.model});
 document.addNative(selector,undefined,{name:'On',attrs:{Terms:'Effect.'+args.effect+'.'+(args.event??'Start')+(args.at?'; At '+args.at:''),Send:'Create'}});
 if(args.stopEffect)document.addNative(selector,undefined,{name:'On',attrs:{Terms:'Effect.'+args.stopEffect+'.'+(args.stopEvent??'Start'),Send:'AnimBracketStop BSD'}});
 if(args.host)document.addNative(selector,undefined,{name:'Host',attrs:{Subject:args.host}});
 if(args.inheritScale){document.addNative(selector,undefined,{name:'InheritType',value:'OneShot'});for(const index of ['BaseModelScale','Scale'])document.addNative(selector,undefined,{name:'Inherits',index,value:1});}
 if(args.scale!==undefined)document.addNative(selector,undefined,{name:'Scale',value:[args.scale,args.scale,args.scale].join(',')});
 if(args.siteOp)document.addNative(selector,undefined,{name:'HostSiteOps',attrs:{Ops:args.siteOp}});
 return document.objectKey(document.resolve(selector));
}

/** Short-lived visuals must be ready before their effect event, not only after
 * a model is first requested. Preserve all existing native preload entries. */
export function visualRecipePreloads(source:string,document:DataDocument,recipes:Array<{id:string;effect:string;model:string;stopEffect?:string}>){
 if(!recipes.length)return source;
 const xml=source||'<?xml version="1.0" encoding="utf-8"?>\r\n<Preload/>\r\n',p=scanXml(xml),root=p.rootIds.length===1?p.nodes[p.rootIds[0]]:undefined;
 if(p.diagnostics.some(d=>d.severity==='error')||root?.tag!=='Preload')throw new Error('VISUAL_PRELOAD_XML_INVALID');
 const entries=new Map<string,{tag:string;id:string}>(),add=(tag:string,id:string)=>entries.set(tag+'\0'+id,{tag,id});
 for(const r of recipes){add('Actor',r.id);add('Model',r.model);add('Effect',r.effect);if(r.stopEffect)add('Effect',r.stopEffect);}
 const effects=new Set(recipes.flatMap(r=>[r.effect,...r.stopEffect?[r.stopEffect]:[]]));
 for(const actor of document.objects().filter(o=>o.ctype==='CActorSound'&&o.id))if(actor.fields.some(f=>f.name==='On'&&effects.has(/^Effect\.([A-Za-z_][A-Za-z0-9_]*)\./.exec(f.attrs.Terms??'')?.[1]??''))){add('Actor',actor.id!);for(const f of actor.fields)if(f.name==='Sound'&&f.value)add('Sound',f.value);}
 const missing=[...entries.values()].filter(e=>!p.nodes.some(n=>n.parentId===root.id&&n.tag===e.tag&&n.attrs.id===e.id));
 if(!missing.length)return xml;
 const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),nl=xml.includes('\r\n')?'\r\n':'\n';
 const body=missing.map(e=>`    <${e.tag} id="${escape(e.id)}"/>`).join(nl)+nl;
 return root.selfClosing?xml.slice(0,root.start)+xml.slice(root.start,root.startTagEnd).replace(/\/\s*>$/,'>')+nl+body+'</Preload>'+xml.slice(root.end):xml.slice(0,root.endTagStart)+body+xml.slice(root.endTagStart);
}
