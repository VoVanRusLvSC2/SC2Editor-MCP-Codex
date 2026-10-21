import {scanXml,decodeXmlValue} from '../../core/xmlScanner.js';
import {missionFolders} from './organization.js';
/** Explicit full-GUI import boundary; semantic equivalence still needs verification. */
export function inspectRevisedGui(xml:string){
 if(Buffer.byteLength(xml)>4*1024*1024)throw new Error('GUI_IMPORT_BYTE_LIMIT');
 const p=scanXml(xml);if(p.diagnostics.some(d=>d.severity==='error'))throw new Error('GUI_IMPORT_XML');
 if(p.nodes.some(n=>n.tag==='Library'))throw new Error('GUI_IMPORT_MAP_ROOT_ONLY');
 if(p.nodes.some(n=>['ScriptCode','ExpressionText','CustomScript'].includes(n.tag)||n.attrs.Type==='CustomScript'))throw new Error('GUI_IMPORT_SCRIPT_FALLBACK');
 const root=p.nodes.find(n=>n.tag==='Root'),elements=p.nodes.filter(n=>n.tag==='Element');
 if(!root)throw new Error('GUI_IMPORT_ROOT');
 const names=elements.filter(n=>n.attrs.Type==='Category').map(n=>{const c=n.childIds.map(i=>p.nodes[i]).find(c=>c.tag==='Identifier');return c?decodeXmlValue(xml.slice(c.startTagEnd,c.endTagStart)):'';});
 if(names.length!==5||new Set(names).size!==5||missionFolders.some(n=>!names.includes(n))||root.childIds.length!==5)throw new Error('GUI_IMPORT_FIVE_FLAT_FOLDERS');
 for(const n of elements.filter(n=>n.attrs.Type==='Category'))if(n.childIds.some(i=>p.nodes[i].tag==='Item'&&p.nodes[i].attrs.Type==='Category'))throw new Error('GUI_IMPORT_NESTED_FOLDER');
 const keys=new Set<string>();for(const n of elements){const k=n.attrs.Type+':'+n.attrs.Id;if(keys.has(k))throw new Error('GUI_IMPORT_DUPLICATE');keys.add(k);}
 for(const n of p.nodes)if(n.tag!=='Element'&&n.attrs.Type&&n.attrs.Id&&!n.attrs.Library&&n.attrs.Type!=='SubFuncType'&&!keys.has(n.attrs.Type+':'+n.attrs.Id))throw new Error('GUI_IMPORT_DANGLING: '+n.attrs.Type+':'+n.attrs.Id);
 const count=(type:string)=>elements.filter(n=>n.attrs.Type===type).length;
 return {folders:[...missionFolders],triggers:count('Trigger'),functions:count('FunctionDef'),variables:count('Variable'),calls:count('FunctionCall'),customScripts:0};
}
