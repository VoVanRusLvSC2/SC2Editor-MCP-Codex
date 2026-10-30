import {scanXml,decodeXmlValue} from '../../core/xmlScanner.js';
import {organizeTriggerXml} from './organization.js';
/** Explicit full-GUI import boundary; semantic equivalence still needs verification. */
export function inspectRevisedGui(xml:string,options:{nativeLibraries?:boolean;localLibraries?:boolean;existingSource?:string}={}){
 // Recovered production maps can legitimately contain much larger GUI graphs.
 // Larger imports require the original compiler, rather than widening the
 // supported offline emitter's resource/semantic boundary.
 const byteLimit=(options.nativeLibraries?64:4)*1024*1024;
 if(Buffer.byteLength(xml)>byteLimit)throw new Error('GUI_IMPORT_BYTE_LIMIT');
 const p=scanXml(xml);if(p.diagnostics.some(d=>d.severity==='error'))throw new Error('GUI_IMPORT_XML');
 const libraries=p.nodes.filter(n=>n.tag==='Library');
 if(libraries.length&&!options.nativeLibraries&&!options.localLibraries)throw new Error('GUI_IMPORT_NATIVE_LIBRARY_COMPILER_REQUIRED');
 // An Editor-compiled declaration may splice typed Action children without
 // containing executable Galaxy. Never infer this from converter receipts.
 const scopeOf=(node:typeof p.nodes[number])=>{let n:typeof node|undefined=node;while(n){if(n.tag==='Library')return n.attrs.Id;n=n.parentId===null?undefined:p.nodes[n.parentId];}return '';};
 const children=(node:typeof p.nodes[number])=>node.childIds.map(i=>p.nodes[i]);
 const scripts=p.nodes.filter(n=>n.tag==='ScriptCode');
 const declarative=(node:typeof p.nodes[number])=>{
  if(!options.nativeLibraries||node.parentId===null)return false;
  const owner=p.nodes[node.parentId],parts=children(owner),code=decodeXmlValue(xml.slice(node.startTagEnd,node.endTagStart)).trim();
  if(owner.tag!=='Element'||owner.attrs.Type!=='FunctionDef'||code!=='#SUBFUNCS(actions)')return false;
  const allowed=new Set(['Identifier','FlagEvent','FlagOperator','FlagSubFunctions','ReturnType','SubFunctionType','ScriptCode']);
  if(parts.some(n=>!allowed.has(n.tag))||['FlagEvent','FlagOperator','FlagSubFunctions'].some(tag=>parts.filter(n=>n.tag===tag).length!==1))return false;
  const returns=parts.filter(n=>n.tag==='ReturnType'),refs=parts.filter(n=>n.tag==='SubFunctionType');
  if(returns.length!==1||children(returns[0]).length!==1||children(returns[0])[0].tag!=='Type'||children(returns[0])[0].attrs.Value!=='void'||refs.length!==1||parts.filter(n=>n.tag==='ScriptCode').length!==1)return false;
  const ref=refs[0],library=ref.attrs.Library??scopeOf(owner),matches=p.nodes.filter(n=>n.tag==='Element'&&n.attrs.Type==='SubFuncType'&&n.attrs.Id===ref.attrs.Id&&scopeOf(n)===library);
  if(matches.length!==1||ref.attrs.Type!=='SubFuncType')return false;
  const sub=children(matches[0]),identifier=sub.find(n=>n.tag==='Identifier');
  return sub.length===2&&sub.filter(n=>n.tag==='Action'&&n.selfClosing).length===1&&!!identifier&&decodeXmlValue(xml.slice(identifier.startTagEnd,identifier.endTagStart))==='actions';
 };
 const fallback=(n:typeof p.nodes[number])=>['ExpressionText','CustomScript'].includes(n.tag)||n.tag==='Element'&&n.attrs.Type==='CustomScript'||n.tag==='ScriptCode'&&!declarative(n);
 const inherited=new Set<number>();
 if(options.existingSource!==undefined){
  if(!options.nativeLibraries)throw Error('GUI_IMPORT_PRESERVE_REQUIRES_NATIVE');
  if(Buffer.byteLength(options.existingSource)>64*1024*1024)throw Error('GUI_IMPORT_BYTE_LIMIT');
  const previous=scanXml(options.existingSource);
  if(previous.diagnostics.some(d=>d.severity==='error'))throw Error('GUI_IMPORT_EXISTING_XML');
  const owners=(parsed:typeof p,source:string)=>{
   const result=new Map<string,{signature:string;nodes:number[]}>();
   const canonical=(n:typeof p.nodes[number]):unknown=>[n.tag,Object.entries(n.attrs).sort(([a],[b])=>a.localeCompare(b)),n.childIds.length?n.childIds.map(id=>canonical(parsed.nodes[id])):decodeXmlValue(source.slice(n.startTagEnd,n.endTagStart)).replace(/\r\n/g,'\n')];
   for(const n of parsed.nodes){
    if(!['ScriptCode','ExpressionText','CustomScript'].includes(n.tag)&&!(n.tag==='Element'&&n.attrs.Type==='CustomScript'))continue;
    let owner:typeof n|undefined=n;while(owner&&owner.tag!=='Element')owner=owner.parentId===null?undefined:parsed.nodes[owner.parentId];
    if(!owner)throw Error('GUI_IMPORT_SCRIPT_OWNER');
    let library='',parent:typeof n|undefined=owner;while(parent){if(parent.tag==='Library'){library=parent.attrs.Id;break;}parent=parent.parentId===null?undefined:parsed.nodes[parent.parentId];}
    const key=JSON.stringify([library,owner.attrs.Type,owner.attrs.Id]);
    const entry=result.get(key)??{signature:JSON.stringify(canonical(owner)),nodes:[]};entry.nodes.push(n.id);result.set(key,entry);
   }
   return result;
  };
  const before=owners(previous,options.existingSource),after=owners(p,xml);
  for(const [key,old]of before){const current=after.get(key);if(!current||current.signature!==old.signature)throw Error('GUI_IMPORT_EXISTING_SCRIPT_CHANGED: '+key);for(const id of current.nodes)inherited.add(id);}
 }
 if(p.nodes.some(n=>fallback(n)&&!inherited.has(n.id)))throw new Error('GUI_IMPORT_SCRIPT_FALLBACK');
 const container=p.nodes.find(n=>n.tag==='TriggerData'&&n.parentId===null),root=p.nodes.find(n=>n.tag==='Root'&&n.parentId===container?.id),elements=p.nodes.filter(n=>n.tag==='Element');
 if(!root)throw new Error('GUI_IMPORT_ROOT');
 const ids=new Set<string>();for(const l of libraries){if(!l.attrs.Id||ids.has(l.attrs.Id)||l.parentId!==container?.id)throw Error('GUI_IMPORT_LIBRARY_SCOPE');ids.add(l.attrs.Id);}
 const scope=(n:typeof p.nodes[number]):string=>{let current:typeof n|undefined=n;while(current){if(current.tag==='Library')return current.attrs.Id;current=current.parentId===null?undefined:p.nodes[current.parentId];}return '';};
 const key=(library:string,type:string,id:string)=>JSON.stringify([library,type,id]);
 const keys=new Set<string>();for(const n of elements){if(!n.attrs.Type||!n.attrs.Id)throw Error('GUI_IMPORT_ELEMENT_ID');const k=key(scope(n),n.attrs.Type,n.attrs.Id);if(keys.has(k))throw new Error('GUI_IMPORT_DUPLICATE');keys.add(k);}
 const external=new Set<string>();
 for(const n of p.nodes)if(n.tag!=='Element'&&n.attrs.Type&&n.attrs.Id&&n.attrs.Type!=='SubFuncType'){
  const library=n.attrs.Library??scope(n);
  if(n.attrs.Type==='Library'){if(!ids.has(n.attrs.Id))external.add(n.attrs.Id);continue;}
  if(library&&!ids.has(library)){external.add(library);continue;}
  if(!keys.has(key(library,n.attrs.Type,n.attrs.Id)))throw new Error('GUI_IMPORT_DANGLING: '+library+':'+n.attrs.Type+':'+n.attrs.Id);
 }
 // Reuse hierarchy validation without applying organization or rewriting the import.
 const folders=organizeTriggerXml(xml,{}).folders.filter(f=>elements.some(n=>scope(n)===''&&n.attrs.Type==='Category'&&n.attrs.Id===f.id)).map(f=>f.path);
 const libraryFolders=libraries.map(l=>({library:l.attrs.Id,folders:organizeTriggerXml(xml,{library:l.attrs.Id}).folders.filter(f=>elements.some(n=>scope(n)===l.attrs.Id&&n.attrs.Type==='Category'&&n.attrs.Id===f.id)).map(f=>f.path)}));
 const count=(type:string)=>elements.filter(n=>n.attrs.Type===type).length;
 return {folders,libraries:libraryFolders,externalLibraries:[...external].sort(),triggers:count('Trigger'),functions:count('FunctionDef'),variables:count('Variable'),calls:count('FunctionCall'),customScripts:0,preservedScriptNodes:inherited.size,declarativeMacros:scripts.filter(declarative).length};
}
