import {scanXml,decodeXmlValue} from '../../core/xmlScanner.js';
import type {XmlNode} from '../../core/types.js';
import type {GuiType,Registry} from './authoring.js';
import type {PresetJson,PresetValueJson,StructureJson,VariableJson,ElementRefJson} from './ast/types.js';
export const GUI_TYPE_CODES=["void", "abilcmd", "actor", "actorscope", "aifilter", "animlengthquery", "bank", "bitmask", "bool", "byte", "camerainfo", "cinematic", "color", "control", "conversation", "datatable", "dialog", "difficulty", "doodad", "effecthistory", "fixed", "generichandle", "int", "marker", "objective", "order", "path", "ping", "planet", "playercolor", "playergroup", "point", "portrait", "region", "reply", "revealer", "sound", "soundlink", "string", "targetfilter", "text", "timer", "transmission", "transmissionsource", "trigger", "unit", "unitfilter", "unitgroup", "wave", "waveinfo", "wavetarget", "anytype", "anycompare", "anynumber", "anygamelink", "anyvariable", "anypreset", "sameas", "sameasparent", "return", "preset", "struct", "gamelink", "filepath", "modelanim", "modelcamera", "timeofday", "datetime", "water", "convstateindex", "convcharacter", "convline", "actormsg", "attributegame", "attributeplayer", "attributevalue", "userfield", "userinstance", "fontstyle", "aidef", "aidefwave", "reference", "catalogscope", "catalogfieldname", "catalogfieldpath", "catalogentry", "layoutframe", "layoutframerel", "charge", "cooldown", "conversationtag", "gameoption", "gameoptionvalue"] as const;
export const GUI_VARIABLE_TYPES=["abilcmd", "actor", "actorscope", "aifilter", "animlengthquery", "bank", "bitmask", "bool", "byte", "camerainfo", "cinematic", "color", "control", "conversation", "datatable", "dialog", "difficulty", "doodad", "effecthistory", "fixed", "generichandle", "int", "marker", "objective", "order", "path", "ping", "planet", "playercolor", "playergroup", "point", "portrait", "region", "reply", "revealer", "sound", "soundlink", "string", "targetfilter", "text", "timer", "transmission", "transmissionsource", "trigger", "unit", "unitfilter", "unitgroup", "wave", "waveinfo", "wavetarget", "preset", "struct", "gamelink", "filepath", "modelanim", "modelcamera", "timeofday", "datetime", "water", "convstateindex", "convcharacter", "convline", "actormsg", "attributegame", "attributeplayer", "attributevalue", "userfield", "userinstance", "fontstyle", "aidef", "aidefwave", "reference", "catalogscope", "catalogfieldname", "catalogfieldpath", "catalogentry", "layoutframe", "layoutframerel", "charge", "cooldown", "conversationtag", "gameoption", "gameoptionvalue"] as const;

export type GuiTypeRef={library?:string;type?:'Preset'|'Structure';id?:string;name?:string};
export type GuiArraySize=number|{variable:string;library?:string};
export interface GuiMemberAccess {field:string;indices?:import('./authoring.js').GuiValue[]}
export interface GuiDefinitions {presets:PresetJson[];presetValues:PresetValueJson[];structures:StructureJson[];variables:VariableJson[]}
export const emptyDefinitions=():GuiDefinitions=>({presets:[],presetValues:[],structures:[],variables:[]});
const xmlCache=new Map<string,GuiDefinitions>();
export function parseGuiDefinitions(xml:string,library=''):GuiDefinitions{
 const cacheKey=library+'\0'+xml,old=xmlCache.get(cacheKey);if(old)return old;
 const p=scanXml(xml),defs=emptyDefinitions();
 const children=(n:XmlNode)=>n.childIds.map(i=>p.nodes[i]);
 const libOf=(n:XmlNode)=>{let c=n;while(c.parentId!==null){c=p.nodes[c.parentId];if(c.tag==='Library')return c.attrs.Id??'';}return p.nodes.find(n=>n.tag==='Standard')?.attrs.Id??'';};
 const text=(n:XmlNode,tag:string)=>{const c=children(n).find(c=>c.tag===tag);return c?decodeXmlValue(xml.slice(c.startTagEnd,c.endTagStart)):undefined;};
 const ref=(n:XmlNode):ElementRefJson=>({id:n.attrs.Id,type:n.attrs.Type,library:n.attrs.Library??libOf(n)});
 for(const n of p.nodes.filter(n=>n.tag==='Element'&&libOf(n)===library)){
  const cs=children(n),base={id:n.attrs.Id,library,name:text(n,'Identifier'),identifier:text(n,'Identifier')};
  if(n.attrs.Type==='Preset')defs.presets.push({...base,type:'Preset',baseType:cs.find(c=>c.tag==='BaseType')?.attrs.Value,asBits:cs.some(c=>c.tag==='PresetAsBits'),integer:cs.some(c=>c.tag==='PresetInteger'),generateConstants:cs.some(c=>c.tag==='PresetGenConstVar'),values:cs.filter(c=>c.tag==='Item'&&c.attrs.Type==='PresetValue').map(ref)});
  if(n.attrs.Type==='PresetValue')defs.presetValues.push({...base,type:'PresetValue',value:text(n,'Value'),definesDefault:cs.some(c=>c.tag==='DefinesDefault')});
  if(n.attrs.Type==='Structure')defs.structures.push({...base,type:'Structure',variables:cs.filter(c=>c.tag==='Variable').map(ref)});
  if(n.attrs.Type==='Variable'){
   const t=cs.find(c=>c.tag==='VariableType'),ts=t?children(t):[],te=ts.find(c=>c.tag==='TypeElement'),value=cs.find(c=>c.tag==='Value'&&c.attrs.Type==='Param');
   defs.variables.push({...base,type:'Variable',variableType:{type:ts.find(c=>c.tag==='Type')?.attrs.Value??'',gameType:ts.find(c=>c.tag==='GameType')?.attrs.Value,typeElement:te?ref(te):undefined},isConstant:ts.some(c=>c.tag==='Constant'),arraySizes:ts.filter(c=>c.tag==='ArraySize').map(c=>({dim:Number(c.attrs.Dim),value:c.attrs.Value,variable:c.attrs.Id?ref(c):undefined})),initialValue:value?ref(value):undefined});
  }
 }
 xmlCache.set(cacheKey,defs);while(xmlCache.size>3)xmlCache.delete(xmlCache.keys().next().value!);return defs;
}
export function definitionsFor(xml:string,library:string,r?:Registry):GuiDefinitions{
 const scopes=[...new Set([library,'',...scanXml(xml).nodes.filter(n=>n.tag==='Library').map(n=>n.attrs.Id)])],local=emptyDefinitions(),external=r?.typeDefinitions??emptyDefinitions();
 for(const scope of scopes){const definitions=parseGuiDefinitions(xml,scope);for(const field of ['presets','presetValues','structures','variables'] as const)(local[field] as unknown[]).push(...definitions[field]);}
 const combine=<T extends {id:string;library?:string}>(a:T[],b:T[])=>{const map=new Map(b.map(v=>[(v.library??'')+':'+v.id,v]));for(const v of a)map.set((v.library??'')+':'+v.id,v);return [...map.values()];};
 return {presets:combine(local.presets,external.presets),presetValues:combine(local.presetValues,external.presetValues),structures:combine(local.structures,external.structures),variables:combine(local.variables,external.variables)};
}
export function resolveGuiType(input:GuiType,xml:string,library:string,r?:Registry):GuiType{
 const type:GuiType={type:input.type,gameType:input.gameType,typeElement:input.typeElement,presetId:input.presetId,structureId:input.structureId,typeLibrary:input.typeLibrary,arrayRank:input.arrayRank};
 if(!GUI_VARIABLE_TYPES.includes(type.type as typeof GUI_VARIABLE_TYPES[number])&&!['void','anynumber','anycompare','anyvariable','anytype','anygamelink','anypreset','sameas','sameasparent','return'].includes(type.type))throw new Error('GUI_TYPE_UNKNOWN: '+type.type);
 if(['preset','struct'].includes(type.type)){
  const definitions=definitionsFor(xml,library,r),kind=type.type==='preset'?'Preset':'Structure',lookup=type.typeElement??{id:type.type==='preset'?type.presetId:type.structureId,library:type.typeLibrary};
  if(!lookup.id&&!lookup.name)throw new Error('GUI_USER_TYPE_REQUIRED: '+type.type);
  if(lookup.type&&lookup.type!==kind)throw new Error('GUI_USER_TYPE_KIND');
  const owner=lookup.library??library,all=type.type==='preset'?definitions.presets:definitions.structures;
  const found=all.filter(d=>(d.library??'')===owner&&(lookup.id?d.id===lookup.id:d.name===lookup.name));
  if(found.length!==1)throw new Error('GUI_USER_TYPE_UNRESOLVED: '+(lookup.name??lookup.id));
  return {...type,typeLibrary:owner,typeElement:{library:owner,type:kind,id:found[0].id},presetId:kind==='Preset'?found[0].id:undefined,structureId:kind==='Structure'?found[0].id:undefined};
 }
 if(type.typeElement)throw new Error('GUI_USER_TYPE_ON_SCALAR');return type;
}
export function guiTypeXml(type:GuiType){return {type:type.type,gameType:type.gameType,typeElement:type.typeElement?.id?{id:type.typeElement.id,type:type.typeElement.type,library:type.typeElement.library}:undefined};}
export function sameGuiType(a:GuiType,b:GuiType){return a.type===b.type&&(a.arrayRank??0)===(b.arrayRank??0)&&(a.type!=='gamelink'||a.gameType===b.gameType)&&(!['preset','struct'].includes(a.type)||((a.typeElement?.id??a.presetId??a.structureId)===(b.typeElement?.id??b.presetId??b.structureId)&&(a.typeElement?.library??a.typeLibrary??'')===(b.typeElement?.library??b.typeLibrary??'')));}
