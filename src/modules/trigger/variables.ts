import {scanXml} from '../../core/xmlScanner.js';
import {localRef,inspectGuiVariables,renderInitializer,type GuiVariable,type Registry,type GuiText} from './authoring.js';
import {serializeAstElement} from './ast/codec.js';
import {resolveGuiType,guiTypeXml,type GuiArraySize} from './typeSystem.js';
import type {XmlNode} from '../../core/types.js';
export function guiContainer(xml:string,library:string){const p=scanXml(xml),nodes=library?p.nodes.filter(n=>n.tag==='Library'&&n.attrs.Id===library):p.rootIds.map(id=>p.nodes[id]).filter(n=>n.tag==='TriggerData');if(nodes.length!==1)throw new Error(library?'GUI_LIBRARY_NOT_UNIQUE':'GUI_ROOT_NOT_UNIQUE');return nodes[0];}
export function appendGui(xml:string,node:XmlNode,fragment:string){return node.selfClosing?xml.slice(0,node.start)+xml.slice(node.start,node.startTagEnd).replace(/\/\s*>$/,'>')+fragment+`</${node.tag}>`+xml.slice(node.end):xml.slice(0,node.endTagStart)+fragment+xml.slice(node.endTagStart);}
export function declareVariables(xml:string,declarations:GuiVariable[],library:string,triggerId:string|undefined,nextId:()=>string,r:Registry,onText:(text:GuiText)=>void){
 const output:Array<{id:string;name:string;scope:'global'|'local';type:string;gameType?:string;constant?:boolean;arraySizes?:GuiArraySize[]}>=[],names:GuiText[]=[];
 // Globals initialize before trigger locals. Within each scope, initializers may
 // refer to earlier declarations; self/forward references are rejected.
 for(const declaration of [...declarations.filter(d=>d.scope!=='local'),...declarations.filter(d=>d.scope==='local')]){
  const scope=declaration.scope??'global';if(scope==='local'&&!triggerId)throw new Error('GUI_LOCAL_VARIABLE_TRIGGER_REQUIRED');
  const duplicate=inspectGuiVariables(xml,library).some(v=>v.name===declaration.name&&(scope==='global'?v.scope==='global':v.ownerIds.includes(triggerId!)));
  if(duplicate)throw new Error('GUI_VARIABLE_NAME_EXISTS: '+declaration.name);
  const id=nextId(),type=resolveGuiType(declaration,xml,library,r);
  if(declaration.constant&&(!declaration.initial||declaration.arraySizes?.length||!['int','byte','fixed','bool','string','preset'].includes(declaration.type)))throw new Error('GUI_CONSTANT_DECLARATION');
  if(declaration.constant&&declaration.initial&&!['literal','preset','variable'].includes(declaration.initial.kind))throw new Error('GUI_CONSTANT_INITIALIZER');
  const available=[...new Map([...(r.externalVariables??[]),...inspectGuiVariables(xml,library)].map(v=>[JSON.stringify([v.library,v.id]),v])).values()];
  if(declaration.constant&&declaration.initial?.kind==='variable'&&!available.some(v=>(declaration.initial?.kind==='variable'&&(declaration.initial.id?v.id===declaration.initial.id:v.name===declaration.initial.name)&&v.library===(declaration.initial.library??library))&&v.constant))throw new Error('GUI_CONSTANT_INITIALIZER');
  const sizes=(declaration.arraySizes??[]).map((size,dim)=>{if(typeof size==='number'){if(!Number.isInteger(size)||size<0||size>2147483647)throw new Error('GUI_ARRAY_SIZE');return {dim,value:String(size)};}const target=available.filter(v=>(v.id===size.variable||v.name===size.variable)&&v.library===(size.library??library)&&v.constant&&v.type==='int'&&!v.array&&v.scope==='global');if(target.length!==1||target[0].initialScalar!==undefined&&(!Number.isInteger(Number(target[0].initialScalar))||Number(target[0].initialScalar)<0))throw new Error('GUI_ARRAY_BOUND_CONSTANT');return {dim,variable:{id:target[0].id,type:'Variable',library:target[0].library}};});
  const fragment=serializeAstElement({id,type:'Variable',library,identifier:declaration.name,variableType:guiTypeXml(type),isConstant:declaration.constant,arraySizes:sizes},library);
  xml=appendGui(xml,guiContainer(xml,library),fragment);
  const ref=`<${scope==='global'?'Item':'Variable'} Type="Variable"${localRef(library)} Id="${id}"/>`;
  if(scope==='global'){
   const p=scanXml(xml),parent=guiContainer(xml,library),root=p.nodes.find(n=>n.tag==='Root'&&n.parentId===parent.id);
   if(root)xml=appendGui(xml,root,ref);else xml=appendGui(xml,parent,'<Root>'+ref+'</Root>');
  }else{
   const parent=scanXml(xml).nodes.find(n=>n.tag==='Element'&&['Trigger','FunctionDef','Structure'].includes(n.attrs.Type)&&n.attrs.Id===triggerId&&n.parentId===guiContainer(xml,library).id);if(!parent)throw new Error('GUI_LOCAL_VARIABLE_TRIGGER_REQUIRED');
   xml=appendGui(xml,parent,ref);
  }
  if(declaration.initial){
   const paramId=nextId(),rendered=renderInitializer(declaration.initial,type,paramId,library,nextId,xml,r,{triggerId,functionId:scanXml(xml).nodes.some(n=>n.tag==='Element'&&n.attrs.Type==='FunctionDef'&&n.attrs.Id===triggerId)?triggerId:undefined,initializing:id,globalOnly:scope==='global',onText});
   xml=appendGui(xml,guiContainer(xml,library),rendered.elements+`<Element Type="Param" Id="${paramId}">${rendered.body}</Element>`);
   const variable=scanXml(xml).nodes.find(n=>n.tag==='Element'&&n.attrs.Type==='Variable'&&n.attrs.Id===id&&n.parentId===guiContainer(xml,library).id)!;
   xml=appendGui(xml,variable,`<Value Type="Param"${localRef(library)} Id="${paramId}"/>`);
  }
  names.push({key:'Variable/Name/'+(library?'lib_'+library+'_':'')+id,value:declaration.name,translations:declaration.translations});
  output.push({id,name:declaration.name,scope,...type,constant:declaration.constant,arraySizes:declaration.arraySizes});
 }
 return {xml,variables:output,names};
}
