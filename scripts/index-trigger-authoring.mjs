import process from "node:process";
import console from "node:console";
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd().replaceAll('\\','/')+'/';
import {scanXml} from '../dist/core/xmlScanner.js';
const input=process.argv[2];if(!input)throw new Error('Pass extracted NativeLib 97563 triggerlib file');
const source=fs.readFileSync(input,'utf8');
if(createHash('sha256').update(source).digest('hex')!=='cbb2302825dce57ff9bb8efd44f9b0ed5cb056eee00265e5b711b0824d872396')throw new Error('NATIVE97563_SOURCE_HASH_MISMATCH');
const parsed=scanXml(source),elements=parsed.nodes.filter(n=>n.tag==='Element');
const byKey=new Map(elements.map(n=>[n.attrs.Type+':'+n.attrs.Id,n]));
const child=(n,tag)=>n.childIds.map(id=>parsed.nodes[id]).find(n=>n.tag===tag);
const text=(n,tag)=>{const c=child(n,tag);return c?source.slice(c.startTagEnd,c.endTagStart):'';};
const wanted=new Map([['TriggerAddEventMapInit','00000120'],['Wait','00000242'],['AISetAPM','0406AF36'],['DialogDestroyAll','A87DDC9C'],['ActorTextureGroupApplyGlobal','68E7E107'],['TriggerAddEventTimePeriodic','6D565EB4'],['UnitCreate','6C39A0DF'],['CinematicMode','E92E544E'],['GlobalCinematicSetting','4A703103']]);
const definitions=[];
for(const n of elements.filter(n=>n.attrs.Type==='FunctionDef')) {
 const params=n.childIds.map(id=>parsed.nodes[id]).filter(n=>n.tag==='Parameter').map(ref=>{
  const d=byKey.get('ParamDef:'+ref.attrs.Id);if(!d)return {id:ref.attrs.Id,missing:true};
  const parameterType=child(d,'ParameterType'),type=parameterType?.childIds.map(id=>parsed.nodes[id])??[];
  const preset=type.find(n=>n.tag==='TypeElement'),p=preset?byKey.get('Preset:'+preset.attrs.Id):undefined;
  return {id:ref.attrs.Id,name:text(d,'Identifier'),type:type.find(n=>n.tag==='Type')?.attrs.Value,gameType:type.find(n=>n.tag==='GameType')?.attrs.Value,flags:d.childIds.map(id=>parsed.nodes[id].tag).filter(t=>t.startsWith('ParamFlag')),limits:child(d,'Limits')?.attrs.Value,presetId:preset?.attrs.Id,presets:p?.childIds.map(id=>parsed.nodes[id]).filter(n=>n.tag==='Item'&&n.attrs.Type==='PresetValue').map(n=>({id:n.attrs.Id,name:text(byKey.get('PresetValue:'+n.attrs.Id),'Identifier')})),defaultId:child(d,'Default')?.attrs.Id};
 });
 const returnNode=child(n,'ReturnType'),returnType=returnNode?.childIds.map(id=>parsed.nodes[id]).find(n=>n.tag==='Type')?.attrs.Value;
 const subFunctions=n.childIds.map(id=>parsed.nodes[id]).filter(x=>x.tag==='SubFunctionType').map(ref=>{const def=byKey.get('SubFuncType:'+ref.attrs.Id);return {id:ref.attrs.Id,name:def?text(def,'Identifier'):'',kind:def?.childIds.map(id=>parsed.nodes[id].tag).find(tag=>tag==='Condition'||tag==='Action')??'UNKNOWN'};});
 definitions.push({name:text(n,'Identifier'),id:n.attrs.Id,library:'Ntve',flags:n.childIds.map(id=>parsed.nodes[id].tag).filter(t=>t.startsWith('Flag')),returnType,parameters:params,subFunctions});
}
const functions=definitions.filter(n=>wanted.get(n.name)===n.id).map(n=>({...n,xml:source.slice(byKey.get('FunctionDef:'+n.id).start,byKey.get('FunctionDef:'+n.id).end)}));
if(functions.length!==wanted.size)throw new Error('NATIVE_FUNCTION_SET_INCOMPLETE');
const nativeExpressions=definitions.filter(n=>n.flags.includes('FlagCall')&&n.flags.includes('FlagNative')&&n.returnType&&n.parameters.length===0).map(n=>({name:n.name,id:n.id,type:n.returnType,library:n.library}));
if(!nativeExpressions.some(n=>n.name==='PlayerGroupAll'&&n.id==='00000192'&&n.type==='playergroup'))throw new Error('NATIVE_PLAYERGROUP_ALL_UNVERIFIED');
const coreRoot=path.dirname(path.dirname(path.dirname(input)));
const localeSources={},localeLabels={};
for(const [locale,folder] of [['enUS','enus'],['ruRU','ruru']]){
 const file=path.join(coreRoot,folder+'.sc2data','localizeddata','triggerstrings.txt');
 if(!fs.existsSync(file)){localeLabels[locale]=new Map();continue;}
 const bytes=fs.readFileSync(file),body=bytes.toString('utf8');
 localeSources[locale]={path:'mods/core.sc2mod/'+folder+'.sc2data/localizeddata/triggerstrings.txt',sha256:createHash('sha256').update(bytes).digest('hex')};
 localeLabels[locale]=new Map([...body.matchAll(/^Label\/Name\/lib_Ntve_([A-Fa-f0-9]{8})=(.*)$/gm)].map(m=>[m[1],m[2].replace(/\r$/,'')]));
}
const labels=elements.filter(n=>n.attrs.Type==='Label').map(n=>({library:'Ntve',type:'Label',id:n.attrs.Id,names:{enUS:localeLabels.enUS.get(n.attrs.Id)??null,ruRU:localeLabels.ruRU.get(n.attrs.Id)??null},icon:text(n,'Icon')||null,color:text(n,'Color')||null}));
if(labels.length!==67)throw new Error('NATIVE97563_LABEL_SET_INCOMPLETE');
fs.writeFileSync(root+'generated/trigger-authoring-registry.json.tmp',JSON.stringify({schemaVersion:1,build:97563,source:'mods/core.sc2mod/base.sc2data/triggerlibs/nativelib.triggerlib',sha256:createHash('sha256').update(source).digest('hex'),evidence:'CASC_XML_DECLARATIONS',localeSources,labels,nativeExpressions,definitions,functions},null,2)+'\n');

fs.renameSync(root+'generated/trigger-authoring-registry.json.tmp',root+'generated/trigger-authoring-registry.json');
console.log(JSON.stringify({functions:functions.length,definitions:definitions.length,nativeExpressions:nativeExpressions.length,sha256:createHash('sha256').update(source).digest('hex')}));
