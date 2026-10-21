import * as z from 'zod/v4';
import {createHash} from 'node:crypto';
import {scanXml,decodeXmlValue} from '../../core/xmlScanner.js';
import type {XmlNode} from '../../core/types.js';
import {GalaxyDocument} from '../script/document.js';
import {organizationSchema,folderPath,organizeTriggerXml} from './organization.js';
import {normalizeCustomScriptLayout} from './scriptLayout.js';

export const customScriptsSchema=z.object({
 genre:organizationSchema.shape.genre,
 items:z.array(z.object({kind:z.enum(['declaration','action']),identifier:z.string().regex(/^[A-Za-z_][A-Za-z_0-9]*$/).max(128),folder:folderPath,triggerId:z.string().max(128).optional(),code:z.string().max(65536),remove:z.boolean().optional()}).strict()).min(1).max(100),
 dryRun:z.boolean().default(true),stage:z.boolean().default(true),
}).strict();
export type CustomScriptsArgs=z.input<typeof customScriptsSchema>;
const enc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

/** Explicit, visible native Custom Script blocks; no Galaxy-to-GUI conversion. */
export function upsertCustomScripts(source:string,input:CustomScriptsArgs,names:ReadonlyMap<string,string>=new Map()){
 const args=customScriptsSchema.parse(input);
 if(Buffer.byteLength(JSON.stringify(args))>1024*1024)throw new Error('GUI_CUSTOM_SCRIPT_BYTE_LIMIT');
 let xml=source||'<TriggerData><Root/></TriggerData>';
 const parse=()=>{const p=scanXml(xml);if(p.diagnostics.some(d=>d.severity==='error'))throw new Error('TRIGGER_XML_INVALID');if(p.nodes.some(n=>n.tag==='Library'))throw new Error('GUI_CUSTOM_SCRIPT_MAP_ROOT_ONLY');const root=p.nodes.find(n=>n.tag==='TriggerData'&&n.parentId===null);if(!root)throw new Error('GUI_CUSTOM_SCRIPT_ROOT_MISSING');return {p,root,elements:root.childIds.map(i=>p.nodes[i]).filter(n=>n.tag==='Element')};};
 const append=(node:XmlNode,text:string)=>{xml=node.selfClosing?xml.slice(0,node.start)+xml.slice(node.start,node.startTagEnd).replace(/\/\s*>$/,'>')+text+`</${node.tag}>`+xml.slice(node.end):xml.slice(0,node.endTagStart)+text+xml.slice(node.endTagStart);};
 const assignments:Array<{type:'CustomScript'|'Trigger';id:string;folder:string}>=[],labels:Array<{key:string;value:string}>=[],items:Array<{id:string;kind:string;identifier:string}>=[],seen=new Set<string>();
 for(const item of args.items){
  const identity=item.kind+':'+(item.triggerId??'')+':'+item.identifier;
  if(seen.has(identity))throw new Error('GUI_CUSTOM_SCRIPT_DUPLICATE');seen.add(identity);
  if((item.kind==='action')!==!!item.triggerId)throw new Error('GUI_CUSTOM_SCRIPT_TRIGGER_REQUIRED');
  const code=new GalaxyDocument(item.kind==='action'?'void __CustomScriptAction () {\n'+item.code+'\n}':item.code);
  if(code.diagnostics.some(d=>d.severity==='error'))throw new Error('GUI_CUSTOM_SCRIPT_SYNTAX: '+JSON.stringify(code.diagnostics));
  let {p,root,elements}=parse();
  const matches=elements.filter(n=>n.attrs.Type==='CustomScript'&&n.childIds.some(i=>p.nodes[i].tag==='Identifier'&&decodeXmlValue(xml.slice(p.nodes[i].startTagEnd,p.nodes[i].endTagStart))===item.identifier));
  if(matches.length>1)throw new Error('GUI_CUSTOM_SCRIPT_AMBIGUOUS');
  if(item.remove){
   if(item.kind!=='declaration'||item.triggerId||item.code.trim())throw new Error('GUI_CUSTOM_SCRIPT_REMOVE_DECLARATION_ONLY');
   const target=matches[0];
   if(!target)throw new Error('GUI_CUSTOM_SCRIPT_REMOVE_MISSING');
   const refs=p.nodes.filter(n=>n!==target&&n.attrs.Type==='CustomScript'&&n.attrs.Id===target.attrs.Id);
   if(refs.some(n=>n.tag!=='Item'||n.attrs.Library))throw new Error('GUI_CUSTOM_SCRIPT_REMOVE_REFERENCED');
   for(const node of [target,...refs].sort((a,b)=>b.start-a.start))xml=xml.slice(0,node.start)+xml.slice(node.end);
   items.push({id:target.attrs.Id,kind:'removed',identifier:item.identifier});
   continue;
  }
  const id=item.kind==='declaration'&&matches[0]?matches[0].attrs.Id:createHash('sha256').update('MCP.CustomScript:'+identity).digest('hex').slice(0,8).toUpperCase();
  const old=elements.find(n=>n.attrs.Id===id);
  if(old && (old.attrs.Type!==(item.kind==='declaration'?'CustomScript':'FunctionCall') || (item.kind==='action'&&!old.childIds.some(i=>p.nodes[i].tag==='FunctionDef'&&p.nodes[i].attrs.Library==='Ntve'&&p.nodes[i].attrs.Id==='00000123'))))throw new Error('GUI_CUSTOM_SCRIPT_ID_COLLISION');
  const payload=`<Element Type="${item.kind==='declaration'?'CustomScript':'FunctionCall'}" Id="${id}">${item.kind==='declaration'?`<Identifier>${enc(item.identifier)}</Identifier>`:'<FunctionDef Type="FunctionDef" Library="Ntve" Id="00000123"/>'}<ScriptCode>\n${enc(item.code)}\n</ScriptCode></Element>`;
  if(old)xml=xml.slice(0,old.start)+payload+xml.slice(old.end);else append(root,payload);
  ({p,root,elements}=parse());
  if(item.kind==='declaration'){
   let tree=p.nodes.find(n=>n.tag==='Root'&&n.parentId===root.id);
   if(!tree){append(root,'<Root/>');({p,root}=parse());tree=p.nodes.find(n=>n.tag==='Root'&&n.parentId===root.id)!;}
   if(!old)append(tree,`<Item Type="CustomScript" Id="${id}"/>`);
   assignments.push({type:'CustomScript',id,folder:item.folder});labels.push({key:'CustomScript/Name/'+id,value:item.identifier});
  }else{
   const target=elements.find(n=>n.attrs.Type==='Trigger'&&n.attrs.Id===item.triggerId);
   if(!target)throw new Error('GUI_CUSTOM_SCRIPT_TRIGGER_MISSING');
   const owners=elements.filter(n=>n.childIds.some(i=>p.nodes[i].tag==='Action'&&p.nodes[i].attrs.Id===id));
   if(owners.some(n=>n!==target))throw new Error('GUI_CUSTOM_SCRIPT_ACTION_OWNER');
   if(!owners.length)append(target,`<Action Type="FunctionCall" Id="${id}"/>`);
   assignments.push({type:'Trigger',id:item.triggerId!,folder:item.folder});
  }
  items.push({id,kind:item.kind,identifier:item.identifier});
 }
 const organized=organizeTriggerXml(xml,{genre:args.genre,assignments},names);
 return {...organized,xml:normalizeCustomScriptLayout(organized.xml).xml,items,labels};
}
