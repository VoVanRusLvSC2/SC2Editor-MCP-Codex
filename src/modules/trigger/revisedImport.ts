import {scanXml,decodeXmlValue} from '../../core/xmlScanner.js';
import {organizeTriggerXml} from './organization.js';
/** Explicit full-GUI import boundary; semantic equivalence still needs verification. */
export function inspectRevisedGui(xml:string,options:{nativeLibraries?:boolean;localLibraries?:boolean}={}){
 if(Buffer.byteLength(xml)>4*1024*1024)throw new Error('GUI_IMPORT_BYTE_LIMIT');
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
 if(p.nodes.some(n=>['ExpressionText','CustomScript'].includes(n.tag)||n.attrs.Type==='CustomScript')||scripts.some(n=>!declarative(n)))throw new Error('GUI_IMPORT_SCRIPT_FALLBACK');
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
 return {folders,libraries:libraryFolders,externalLibraries:[...external].sort(),triggers:count('Trigger'),functions:count('FunctionDef'),variables:count('Variable'),calls:count('FunctionCall'),customScripts:0,declarativeMacros:scripts.length};
}
