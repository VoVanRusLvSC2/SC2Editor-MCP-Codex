import {serializeAstElement} from './ast/codec.js';
import {scanXml} from '../../core/xmlScanner.js';
import {encode,localRef,inspectGuiFunctions,withGuiFunctions,renderCalls,resolveFunction,type GuiFunction,type Registry,type GuiText,type GuiCall,type GuiType} from './authoring.js';
import {typeElementFragment} from './declarations.js';
import {resolveGuiType} from './typeSystem.js';
import {renderInitializer} from './authoring.js';
import {declareVariables,guiContainer,appendGui} from './variables.js';

export function declareFunctions(xml:string,declarations:GuiFunction[],library:string,nextId:()=>string,r?:Registry){
 const names:GuiText[]=[],functions:Array<{id:string;name:string;kind:GuiFunction['kind'];parameters:Array<{id:string;name:string;type:string}>;returnType?:GuiType}>=[];
 for(const f of declarations){
  if(inspectGuiFunctions(xml,library).some(existing=>existing.name===f.name))throw new Error('GUI_FUNCTION_NAME_EXISTS: '+f.name);
  if(new Set(f.parameters?.map(p=>p.name)).size!==(f.parameters?.length??0))throw new Error('GUI_PARAMETER_NAME_EXISTS');
  const valueFunction=f.kind==='Condition'||f.kind==='Function';
  const requestedReturn=f.kind==='Condition'?(f.returnType??{type:'bool'}):f.returnType,returnType=requestedReturn?resolveGuiType(requestedReturn,xml,library,r):undefined;
  if(f.flags?.includes('CreateThread')&&f.kind!=='Action')throw new Error('GUI_THREAD_ACTION_ONLY');
  if(f.kind==='Condition'&&returnType?.type!=='bool'||valueFunction&&(!returnType||!f.returns)||!valueFunction&&(f.returnType||f.returns))throw new Error('GUI_FUNCTION_RETURN_CONTRACT');
  if(f.kind==='Event'&&(!f.calls.length||f.variables?.length)||f.calls.some(c=>f.kind==='Event'?c.kind!=='Event':c.kind!=='Action'&&c.kind!=='Registration'))throw new Error('GUI_FUNCTION_BODY_ROLE');
  const id=nextId(),parameters=(f.parameters??[]).map(p=>({...p,...resolveGuiType(p,xml,library,r),id:nextId()}));
  const flag=f.kind==='Function'?'Call':f.kind;
  const fragment=parameters.map(p=>`<Element Type="ParamDef" Id="${p.id}"><Identifier>${encode(p.name)}</Identifier><ParameterType>${typeElementFragment(p,xml,library,r??{functions:[],schemaVersion:1,build:0,source:'map',sha256:''})}</ParameterType>${p.reference?'<ParamFlagReference/>':''}${p.multiple?'<ParamFlagMultiple/>':''}${p.variableOnly?'<ParamFlagVariableOnly/>':''}${p.preload?'<ParamFlagPreload/>':''}${p.matchConstant?'<ParamFlagMatchConst/>':''}${p.alternateDisplay?'<ParamFlagAltDisplay/>':''}${p.limits?`<Limits Value="${encode(p.limits)}"/>`:''}</Element>`).join('')+
   `<Element Type="FunctionDef" Id="${id}"><Identifier>${encode(f.name)}</Identifier><Flag${flag}/>${(f.flags??[]).map(flag=>`<Flag${flag}/>`).join('')}${f.kind==='Condition'?'<FlagCall/>':''}<ReturnType>${typeElementFragment(returnType??{type:'void'},xml,library,r??{functions:[],schemaVersion:1,build:0,source:'map',sha256:''})}</ReturnType>${parameters.map(p=>`<Parameter Type="ParamDef"${localRef(library)} Id="${p.id}"/>`).join('')}</Element>`;
  xml=appendGui(xml,guiContainer(xml,library),fragment);
  const parsed=scanXml(xml),container=guiContainer(xml,library),root=parsed.nodes.find(n=>n.tag==='Root'&&n.parentId===container.id),item=`<Item Type="FunctionDef"${localRef(library)} Id="${id}"/>`;
  xml=root?appendGui(xml,root,item):appendGui(xml,container,'<Root>'+item+'</Root>');
  names.push({key:'FunctionDef/Name/'+(library?'lib_'+library+'_':'')+id,value:f.name,translations:f.translations});
  if(f.grammar)names.push({key:'FunctionDef/Grammar/'+(library?'lib_'+library+'_':'')+id,value:f.grammar});if(f.hint)names.push({key:'FunctionDef/Hint/'+(library?'lib_'+library+'_':'')+id,value:f.hint});
  for(const p of parameters)names.push({key:'ParamDef/Name/'+(library?'lib_'+library+'_':'')+p.id,value:p.name,translations:p.translations});
  functions.push({id,name:f.name,kind:f.kind,parameters:parameters.map(p=>({id:p.id,name:p.name,type:p.type})),returnType});
 }
 return {xml,names,functions};
}
export function populateFunctions(xml:string,declarations:GuiFunction[],headers:ReturnType<typeof declareFunctions>['functions'],library:string,nextId:()=>string,r:Registry,onText:(text:GuiText)=>void){
 const names:GuiText[]=[];
 if(!declarations.length)return {xml,names};
 for(const [index,f] of declarations.entries()){
  const header=headers[index];
  for(const [i,p] of (f.parameters??[]).entries()){if(!p.default)continue;const paramId=nextId(),type=resolveGuiType(p,xml,library,r),rendered=renderInitializer(p.default,type,paramId,library,nextId,xml,withGuiFunctions(r,xml,library),{globalOnly:true,onText});xml=appendGui(xml,guiContainer(xml,library),rendered.elements+`<Element Type="Param" Id="${paramId}">${rendered.body}</Element>`);const tree=scanXml(xml),owner=tree.nodes.find(n=>n.tag==='Element'&&n.attrs.Type==='ParamDef'&&n.attrs.Id===header.parameters[i].id&&n.parentId===guiContainer(xml,library).id)!;xml=appendGui(xml,owner,`<Default Type="Param"${localRef(library)} Id="${paramId}"/>`);}
  const schema=withGuiFunctions(r,xml,library);
  const locals=declareVariables(xml,(f.variables??[]).map(v=>({...v,scope:'local'})),library,header.id,nextId,schema,onText);xml=locals.xml;names.push(...locals.names);
  const calls:GuiCall[]=[...f.calls];if(f.returns)calls.push({kind:'Action',function:'native:Return',args:{val:f.returns}});
  const rendered=renderCalls(calls,library,nextId,xml,withGuiFunctions(r,xml,library),{functionId:header.id,returnType:header.returnType,onText});
  xml=appendGui(xml,guiContainer(xml,library),rendered.elements);
  if(f.kind==='Event'){
   // Event callbacks receive an implicit `trigger t`. In a function body the
   // Editor does NOT prepend it to nested native event calls. Bind it explicitly
   // through a hidden native Action signature with its actual first parameter.
   for(const ref of rendered.references){
    const tree=scanXml(xml),container=guiContainer(xml,library),call=tree.nodes.find(n=>n.tag==='Element'&&n.attrs.Type==='FunctionCall'&&n.attrs.Id===ref.id&&n.parentId===container.id)!;
    const defRef=call.childIds.map(i=>tree.nodes[i]).find(n=>n.tag==='FunctionDef')!;
    const native=(r.definitions??r.functions).find(n=>n.id===defRef.attrs.Id&&n.library===(defRef.attrs.Library??library));
    if(!native?.flags.includes('FlagNative')||!native.flags.includes('FlagEvent'))throw new Error('GUI_EVENT_BODY_NATIVE_REGISTRATION_REQUIRED');
    const helperId=nextId(),triggerParam=nextId(),triggerValue=nextId(),parameterIds=new Map(native.parameters.map(p=>[p.id,nextId()]));
    const helperParams=`<Element Type="ParamDef" Id="${triggerParam}"><Identifier>mcpTrigger</Identifier><ParameterType><Type Value="trigger"/></ParameterType></Element>`+native.parameters.map(p=>`<Element Type="ParamDef" Id="${parameterIds.get(p.id)}"><Identifier>${encode(p.name)}</Identifier><ParameterType>${typeElementFragment(p,xml,library,r)}</ParameterType>${p.flags.map(flag=>`<${flag}/>`).join('')}</Element>`).join('');
    const signature=`<Element Type="FunctionDef" Id="${helperId}"><Identifier>${encode(native.name)}</Identifier><FlagNative/><FlagAction/><FlagHidden/><FlagNoScriptPrefix/><ReturnType><Type Value="void"/></ReturnType><Parameter Type="ParamDef"${localRef(library)} Id="${triggerParam}"/>${native.parameters.map(p=>`<Parameter Type="ParamDef"${localRef(library)} Id="${parameterIds.get(p.id)}"/>`).join('')}<Section>SC2MCPEventRegistration</Section></Element>`;
    const triggerExpression=serializeAstElement({type:'Param',id:triggerValue,library,customType:'trigger',scriptCode:'t',parameterDef:{type:'ParamDef',id:triggerParam,library}},library);
    const patches:Array<{start:number;end:number;text:string}>=[];
    patches.push({start:defRef.start,end:defRef.end,text:`<FunctionDef Type="FunctionDef"${localRef(library)} Id="${helperId}"/><Parameter Type="Param"${localRef(library)} Id="${triggerValue}"/>`});
    for(const pRef of call.childIds.map(i=>tree.nodes[i]).filter(n=>n.tag==='Parameter')){
     const parameter=tree.nodes.find(n=>n.tag==='Element'&&n.attrs.Type==='Param'&&n.attrs.Id===pRef.attrs.Id&&n.parentId===container.id)!;
     const formal=parameter.childIds.map(i=>tree.nodes[i]).find(n=>n.tag==='ParameterDef')!;
     const id=parameterIds.get(formal.attrs.Id);if(!id)throw new Error('GUI_EVENT_REGISTRATION_PARAMETER_BINDING');
     patches.push({start:formal.start,end:formal.end,text:`<ParameterDef Type="ParamDef"${localRef(library)} Id="${id}"/>`});
    }
    for(const patch of patches.sort((a,b)=>b.start-a.start))xml=xml.slice(0,patch.start)+patch.text+xml.slice(patch.end);
    xml=appendGui(xml,guiContainer(xml,library),helperParams+signature+triggerExpression);
   }
  }

  const parsed=scanXml(xml),container=guiContainer(xml,library),owner=parsed.nodes.find(n=>n.tag==='Element'&&n.attrs.Type==='FunctionDef'&&n.attrs.Id===header.id&&n.parentId===container.id)!;
  xml=appendGui(xml,owner,rendered.references.map(ref=>`<FunctionCall Type="FunctionCall"${localRef(library)} Id="${ref.id}"/>`).join(''));
 }
 // Bound registration expansion and runtime calls: accidental direct/mutual
 // recursion is rejected, including nested expressions, before a plan can apply.
 const local=inspectGuiFunctions(xml,library),byId=new Map(local.map(f=>[f.id,f])),edges=new Map<string,string[]>(),parsed=scanXml(xml),container=guiContainer(xml,library);
 const elements=parsed.nodes.filter(n=>n.tag==='Element'&&n.parentId===container.id),byElement=new Map(elements.map(n=>[n.attrs.Type+':'+n.attrs.Id,n]));
 for(const f of local){
  const refs=new Set<string>(),seen=new Set<string>();
  const walk=(kind:string,id:string)=>{const key=kind+':'+id;if(seen.has(key))return;seen.add(key);const n=byElement.get(key);if(!n)return;
   const children=(node:typeof n)=>{for(const i of node.childIds){const c=parsed.nodes[i];if(c.attrs.Type&&c.attrs.Id&&(c.attrs.Library??library)===library){if(c.tag==='FunctionDef'&&byId.has(c.attrs.Id))refs.add(c.attrs.Id);else if(['Param','FunctionCall','Variable'].includes(c.attrs.Type))walk(c.attrs.Type,c.attrs.Id);}children(c);}};children(n);
  };walk('FunctionDef',f.id);edges.set(f.id,[...refs]);
 }
 const done=new Set<string>(),active=new Set<string>();
 const visit=(id:string)=>{if(active.has(id))throw new Error('GUI_FUNCTION_RECURSION_UNSUPPORTED');if(done.has(id))return;active.add(id);for(const next of edges.get(id)??[])visit(next);active.delete(id);done.add(id);};
 for(const h of headers)visit(h.id);
 // Resolve every new header by its exact ID so malformed signatures never leak.
 const signatures=withGuiFunctions(r,xml,library);for(const h of headers)resolveFunction(h.id,signatures,h.kind==='Function'?'Expression':h.kind);
 return {xml,names};
}
