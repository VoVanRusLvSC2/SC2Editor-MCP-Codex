import {scanXml,decodeXmlValue} from '../../core/xmlScanner.js';
import type {XmlNode} from '../../core/types.js';

/** Map-owned GUI scopes only. Dependency signatures are not executable source. */
export function runtimeGraph(xml:string){
 const parsed=scanXml(xml);if(parsed.diagnostics.some(d=>d.severity==='error'))throw Error('GUI_RUNTIME_XML');
 const containers=parsed.nodes.filter(n=>n.tag==='TriggerData'&&n.parentId===null),container=containers[0];
 if(containers.length!==1||parsed.nodes.some(n=>n.tag==='Standard'))throw Error('GUI_RUNTIME_DOCUMENT_SCOPE');
 const children=(n:XmlNode)=>n.childIds.map(i=>parsed.nodes[i]),child=(n:XmlNode|undefined,tag:string)=>n&&children(n).find(c=>c.tag===tag);
 const text=(n:XmlNode|undefined)=>n?decodeXmlValue(xml.slice(n.startTagEnd,n.endTagStart)).trim():'',identifier=(n:XmlNode)=>text(child(n,'Identifier'))||n.attrs.Id;
 const libraries=parsed.nodes.filter(n=>n.tag==='Library'),libraryIds=new Set<string>();
 for(const library of libraries){const id=library.attrs.Id;if(library.parentId!==container.id||!id||!/^\w+$/.test(id)||id==='Ntve'||libraryIds.has(id))throw Error('GUI_RUNTIME_LIBRARY_SCOPE');libraryIds.add(id);}
 const scopes=new Map<number,string>();
 const scope=(n:XmlNode):string=>{const cached=scopes.get(n.id);if(cached!==undefined)return cached;const value=n.tag==='Library'?n.attrs.Id:n.parentId===null?'':scope(parsed.nodes[n.parentId]);scopes.set(n.id,value);return value;};
 const key=(library:string,type:string,id:string)=>JSON.stringify([library,type,id]);
 const elementKey=(n:XmlNode)=>key(scope(n),n.attrs.Type,n.attrs.Id),referenceKey=(n:XmlNode)=>key(n.attrs.Library??scope(n),n.attrs.Type,n.attrs.Id);
 const elements=parsed.nodes.filter(n=>n.tag==='Element'),byKey=new Map<string,XmlNode>();
 for(const n of elements){if(!n.attrs.Type||!n.attrs.Id||![container.id,...libraries.map(l=>l.id)].includes(n.parentId!))throw Error('GUI_RUNTIME_ELEMENT_SCOPE');const k=elementKey(n);if(byKey.has(k))throw Error('GUI_RUNTIME_DUPLICATE_ELEMENT: '+k);byKey.set(k,n);}
 const find=(ref:XmlNode)=>byKey.get(referenceKey(ref));
 const lookup=(ref:XmlNode)=>{const found=find(ref);if(!found)throw Error('GUI_RUNTIME_REFERENCE: '+referenceKey(ref));return found;};
 const namespace=(library:string)=>library?'lib'+library+'_':'';
 const scriptName=(n:XmlNode,prefix:string)=>namespace(['lp_','lv_'].includes(prefix)?'':scope(n))+prefix+identifier(n).replace(/[^A-Za-z_0-9]/g,'_');
 const root=child(container,'Root');if(!root)throw Error('GUI_RUNTIME_ROOT');
 // GUI library order is explicit in Root; preserve it rather than sorting IDs.
 const ordered:string[]=[],seen=new Set<number>();
 const visit=(parent:XmlNode)=>{if(seen.has(parent.id))throw Error('GUI_RUNTIME_CATEGORY_CYCLE');seen.add(parent.id);for(const item of children(parent).filter(c=>c.tag==='Item')){
  if(item.attrs.Type==='Library'){if(!libraryIds.has(item.attrs.Id)||ordered.includes(item.attrs.Id))throw Error('GUI_RUNTIME_LIBRARY_ROOT');ordered.push(item.attrs.Id);}
  else if(item.attrs.Type==='Category')visit(lookup(item));
 }seen.delete(parent.id);};visit(root);
 if(ordered.length!==libraries.length)throw Error('GUI_RUNTIME_LIBRARY_ROOT');
 return {parsed,elements,libraries,libraryIds,libraryOrder:ordered,scope,key,elementKey,referenceKey,find,lookup,children,child,text,identifier,namespace,scriptName};
}
