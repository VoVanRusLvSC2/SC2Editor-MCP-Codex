import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {projectPath} from '../../app/paths.js';
import {scanXml} from '../../core/xmlScanner.js';

export type GuiValue = {kind:'literal';type:'int'|'fixed'|'bool'|'string';value:string|number|boolean}|{kind:'variable';library?:string;id:string}|{kind:'preset';id:string}|{kind:'gamelink';domain:string;id:string}|{kind:'nativeCall';function:string}|{kind:'call';function:string;args:Record<string,GuiValue>}|{kind:'block'|'customScript';source:string};
export interface GuiCall {kind:'Event'|'Action'|'Condition';function:string;args:Record<string,GuiValue>;children?:Array<{role:string;call:GuiCall}>}
export interface GuiRequest {targetTrigger?:string;create?:{library:string;identifier:string;category?:string};calls:GuiCall[];stringFiles?:string[]}
export interface Parameter {id:string;name:string;type:string;gameType?:string;flags:string[];limits?:string;presetId?:string;presets?:Array<{id:string;name:string}>}
export interface FunctionDef {name:string;id:string;library:string;flags:string[];returnType?:string;parameters:Parameter[];subFunctions?:Array<{id:string;name:string;kind:string}>;xml?:string}
export interface Registry {schemaVersion:number;build:number;source:string;sha256:string;functions:FunctionDef[];nativeExpressions?:Array<{name:string;id:string;type:string;library:string;xml?:string}>;definitions?:FunctionDef[];labels?:Array<{library:string;type:'Label';id:string;names:{enUS:string|null;ruRU:string|null};icon:string|null;color:string|null}>;localeSources?:Record<string,{path:string;sha256:string}>}
let cached:Registry|undefined;
let revision:string|undefined;
let cachedFile:string|undefined;
export const registry=(file=projectPath('generated/trigger-authoring-registry.json'))=>{const stat=statSync(file),next=stat.size+':'+stat.mtimeMs;if(revision!==next||cachedFile!==file){cachedFile=file;revision=next;cached=JSON.parse(readFileSync(file,'utf8')) as Registry;}return cached!;};
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export const encode=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function describeFunction(name:string,r=registry()){const f=r.functions.find(f=>f.name===name||f.id===name);if(!f)throw new Error('GUI_FUNCTION_UNSUPPORTED: '+name);return {...f,build:r.build,provenance:{source:r.source,sha256:r.sha256},supportedValues:['literal','variable','preset','gamelink','nativeCall:zeroArgReturn'],unsupportedValues:['call','block','customScript'],compiler:'NOT_EXECUTED'};}
function uniqueDefinition(name:string,r:Registry):FunctionDef|undefined {
 const supported=r.functions.find(f=>f.id===name)??r.functions.find(f=>f.name===name);
 if(supported)return supported;
 const id=r.definitions?.find(f=>f.id===name);
 if(id)return id;
 const found=(r.definitions??r.functions).filter(f=>f.name===name);
 if(found.length>1)throw new Error('GUI_FUNCTION_AMBIGUOUS: '+name);
 return found[0];
}
export function renderCall(call:GuiCall,library:string,nextId:()=>string,xml:string,r=registry(),depth=0) {
 if(depth>16)throw new Error('GUI_BLOCK_DEPTH_LIMIT');
 const f=uniqueDefinition(call.function,r);
 if(!f||(!r.functions.some(x=>x.id===f.id)&&!f.flags.includes('FlagSubFunctions')&&depth===0))throw new Error('GUI_FUNCTION_UNSUPPORTED: '+call.function);
 if(!f.flags.includes('Flag'+call.kind)||f.flags.some(flag=>!['FlagNative','FlagAction','FlagEvent','FlagCondition','FlagSubFunctions','FlagAllowBreak','FlagOperator'].includes(flag)))throw new Error('GUI_FLAGS_UNSUPPORTED');
 if(call.children?.length&&!f.flags.includes('FlagSubFunctions'))throw new Error('GUI_CHILDREN_UNSUPPORTED');
 if(Object.keys(call.args).some(id=>!f.parameters.some(p=>p.id===id)))throw new Error('GUI_ARGUMENT_UNKNOWN');
 const id=nextId(),elements:string[]=[],refs:string[]=[];
 const nestedValue=(v:GuiValue,p:Parameter,depth:number):string=>{
  if(depth>16)throw new Error('GUI_EXPRESSION_DEPTH_LIMIT');
  if(v.kind==='call'){
   const f=uniqueDefinition(v.function,r);
   if(!f||!f.flags.includes('FlagCall')||!f.flags.includes('FlagNative')||!f.returnType||f.returnType!==p.type)throw new Error('GUI_NESTED_CALL_UNSUPPORTED: '+v.function);
   if(Object.keys(v.args).some(id=>!f.parameters.some(p=>p.id===id)))throw new Error('GUI_ARGUMENT_UNKNOWN');
   const expressionId=nextId(),references:string[]=[];
   for(const parameter of f.parameters){
    const arg=v.args[parameter.id];if(!arg)throw new Error('GUI_ARGUMENT_MISSING: '+parameter.id);
    if(parameter.flags.some(flag=>flag!=='ParamFlagPreload'))throw new Error('GUI_PARAM_FLAGS_UNSUPPORTED: '+parameter.id);
    const paramId=nextId(),body=nestedValue(arg,parameter,depth+1);
    elements.push(`<Element Type="Param" Id="${paramId}"><ParameterDef Type="ParamDef" Library="Ntve" Id="${parameter.id}"/>${body}</Element>`);
    references.push(`<Parameter Type="Param" Library="${encode(library)}" Id="${paramId}"/>`);
   }
   elements.push(`<Element Type="FunctionCall" Id="${expressionId}"><FunctionDef Type="FunctionDef" Library="Ntve" Id="${f.id}"/>${references.join('')}</Element>`);
   return `<FunctionCall Type="FunctionCall" Library="${encode(library)}" Id="${expressionId}"/>`;
  }
  if(v.kind==='nativeCall'){
   const f=r.nativeExpressions?.find(x=>x.name===v.function&&x.type===p.type&&x.library==='Ntve');
   if(!f)throw new Error('GUI_NATIVE_EXPRESSION_UNSUPPORTED: '+v.function);
   const expressionId=nextId();elements.push(`<Element Type="FunctionCall" Id="${expressionId}"><FunctionDef Type="FunctionDef" Library="Ntve" Id="${f.id}"/></Element>`);
   return `<FunctionCall Type="FunctionCall" Library="${encode(library)}" Id="${expressionId}"/>`;
  }
  if(v.kind==='literal'){
   if(v.type!==p.type&&!(p.type==='anynumber'&&['int','fixed'].includes(v.type)))throw new Error('GUI_TYPE_MISMATCH: '+p.id);
   const value=String(v.value);if(v.type==='int'&&!/^-?\d+$/.test(value)||v.type==='fixed'&&!/^-?\d+(\.\d+)?$/.test(value)||v.type==='bool'&&typeof v.value!=='boolean')throw new Error('GUI_LITERAL_INVALID');
   return `<ValueType Type="${encode(v.type)}"/><Value>${encode(value)}</Value>`;
  }
  if(v.kind==='preset'){
   if(p.type!=='preset'||!p.presets?.some(x=>x.id===v.id))throw new Error('GUI_PRESET_MISMATCH');
   return `<Preset Type="PresetValue" Library="Ntve" Id="${encode(v.id)}"/>`;
  }
  if(v.kind==='gamelink'){
   if(p.type!=='gamelink'||p.gameType!==v.domain)throw new Error('GUI_GAMELINK_MISMATCH');
   return `<ValueType Type="gamelink" GameType="${encode(v.domain)}"/><Value>${encode(v.id)}</Value>`;
  }
  throw new Error('GUI_EXPRESSION_UNSUPPORTED: '+v.kind);
 };

 for(const p of f.parameters){
  const v=call.args[p.id];if(!v)throw new Error('GUI_ARGUMENT_MISSING: '+p.id);
  if(p.flags.some(flag=>flag!=='ParamFlagPreload'))throw new Error('GUI_PARAM_FLAGS_UNSUPPORTED: '+p.id);
  const paramId=nextId();let valueXml:string;
  if(v.kind==='literal'){
   if(v.type!==p.type&&!(p.type==='anynumber'&&['int','fixed'].includes(v.type)))throw new Error('GUI_TYPE_MISMATCH: '+p.id);
   const value=String(v.value);
   if(v.type==='int'&&!/^-?\d+$/.test(value))throw new Error('GUI_LITERAL_INVALID');
   if(v.type==='fixed'&&!/^-?\d+(\.\d+)?$/.test(value))throw new Error('GUI_LITERAL_INVALID');
   if(v.type==='bool'&&typeof v.value!=='boolean')throw new Error('GUI_LITERAL_INVALID');
   if(p.limits){const [min,max]=p.limits.split(',');if(Number.isFinite(Number(min))&&Number(value)<Number(min)||Number.isFinite(Number(max))&&Number(value)>Number(max))throw new Error('GUI_LIMIT_VIOLATION');}
   valueXml=`<ValueType Type="${encode(v.type)}"/><Value>${encode(value)}</Value>`;
  }else if(v.kind==='preset'){
   if(p.type!=='preset'||!p.presets?.some(x=>x.id===v.id))throw new Error('GUI_PRESET_MISMATCH');
   valueXml=`<Preset Type="PresetValue" Library="Ntve" Id="${encode(v.id)}"/>`;
  }else if(v.kind==='gamelink'){
   if(p.type!=='gamelink'||p.gameType!==v.domain)throw new Error('GUI_GAMELINK_MISMATCH');
   valueXml=`<ValueType Type="gamelink" GameType="${encode(v.domain)}"/><Value>${encode(v.id)}</Value>`;
  }else if(v.kind==='call'){
   valueXml=nestedValue(v,p,0);
  }else if(v.kind==='nativeCall'){
   const expression=r.nativeExpressions?.find(x=>x.name===v.function&&x.type===p.type&&x.library==='Ntve');
   if(!expression)throw new Error('GUI_NATIVE_EXPRESSION_UNSUPPORTED: '+p.id);
   const expressionId=nextId();
   elements.push(`<Element Type="FunctionCall" Id="${expressionId}"><FunctionDef Type="FunctionDef" Library="Ntve" Id="${expression.id}"/></Element>`);
   valueXml=`<FunctionCall Type="FunctionCall" Library="${encode(library)}" Id="${expressionId}"/>`;
  }else if(v.kind==='variable'){
   const nodes=scanXml(xml).nodes;const matches=nodes.filter(n=>{if(n.tag!=='Element'||n.attrs.Type!=='Variable'||n.attrs.Id!==v.id)return false;let current=n;while(current.parentId!==null){current=nodes[current.parentId];if(current.tag==='Library')return current.attrs.Id===library;}return library==='';});
   if(matches.length!==1)throw new Error('GUI_VARIABLE_UNRESOLVED');
   const variable=matches[0],type=nodes.find(n=>n.tag==='Type'&&n.start>variable.start&&n.end<variable.end);
   if(type?.attrs.Value!==p.type)throw new Error('GUI_VARIABLE_TYPE_MISMATCH');
   if(v.library&&v.library!==library)throw new Error('GUI_VARIABLE_EXTERNAL_UNSUPPORTED');
   valueXml=`<Variable Type="Variable" Library="${encode(library)}" Id="${encode(v.id)}"/>`;
  }else throw new Error('GUI_EXPRESSION_UNSUPPORTED: '+v.kind);
  elements.push(`<Element Type="Param" Id="${paramId}"><ParameterDef Type="ParamDef" Library="Ntve" Id="${p.id}"/>${valueXml}</Element>`);
  refs.push(`<Parameter Type="Param" Library="${encode(library)}" Id="${paramId}"/>`);
 }
 if(f.subFunctions?.some(x=>x.kind==='Condition')&&!call.children?.some(c=>f.subFunctions?.some(x=>x.kind==='Condition'&&(x.id===c.role||x.name===c.role))))throw new Error('GUI_CONDITION_REQUIRED');
 const childRefs:string[]=[];
 for(const child of call.children??[]){
  const role=f.subFunctions?.find(x=>x.id===child.role||x.name===child.role);
  if(!role||role.kind!==child.call.kind)throw new Error('GUI_SUBFUNCTION_ROLE_MISMATCH: '+child.role);
  const rendered=renderCall(child.call,library,nextId,xml,r,depth+1);
  childRefs.push(`<FunctionCall Type="FunctionCall" Library="${encode(library)}" Id="${rendered.id}"/>`);
  const roleXml=`<SubFunctionType Type="SubFuncType" Library="Ntve" Id="${role.id}"/>`;
  elements.push(rendered.elements.replace(/(<FunctionDef\b[^>]*\/>)/, '$1'+roleXml));
 }
 elements.unshift(`<Element Type="FunctionCall" Id="${id}"><FunctionDef Type="FunctionDef" Library="Ntve" Id="${f.id}"/>${refs.join('')}${childRefs.join('')}</Element>`);
 return {id,elements:elements.join('\n'),kind:call.kind};
}
