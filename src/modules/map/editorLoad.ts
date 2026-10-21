import {scanXml} from '../../core/xmlScanner.js';
import {PlacementDocument,componentListWithObjects} from '../placement/document.js';
import {readVersion,versionMarker} from '../document/codecs/metadata.js';

export const editorLoadFiles=['Objects','Preload.xml','Objects.version','MapInfo.version','t3Terrain.version','DocumentInfo.version','t3Terrain.xml','ComponentList.SC2Components'];
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');

/** Native Editor save of arena Fix1 added Objects.version and populated Preload.
 * Merge direct placement dependencies without erasing authored preload entries.
 * This is an observed load contract, not an engine-rendering certificate. */
export function prepareEditorLoad(input:ReadonlyMap<string,Buffer>) {
 const next=new Map(input),objects=input.get('Objects');
 if(!objects?.length)return {next,changed:[] as string[],objects:0,addedPreloads:0,rendering:'NOT_VERIFIED'};
 const doc=new PlacementDocument(objects.toString('utf8'));
 if(doc.validate().some(d=>d.severity==='error'))throw new Error('EDITOR_LOAD_OBJECTS_INVALID');
 const required=new Map<string,{tag:string;id:string;variations:Set<number>}>();
 const add=(tag:string,id:string,variation?:number)=>{const key=tag+'\0'+id;let row=required.get(key);if(!row){row={tag,id,variations:new Set()};required.set(key,row);}if(variation!==undefined)row.variations.add(variation);};
 add('Actor','SYSTEM_ActorConfig');
 for(const o of doc.list()){
  if(o.kind==='ObjectUnit'&&o.catalogId)add('Unit',o.catalogId);
  if(o.kind==='ObjectDoodad'&&o.catalogId)add('Actor',o.catalogId,Number(o.variation??0));
 }
 const terrain=input.get('t3Terrain.xml');
 if(terrain?.length){const p=scanXml(terrain.toString('utf8'));if(p.diagnostics.some(d=>d.severity==='error'))throw new Error('EDITOR_LOAD_TERRAIN_XML_INVALID');const set=p.nodes.find(n=>n.tag==='heightMap')?.attrs.tileSet;if(set)add('Terrain',set);}
 let preload=input.get('Preload.xml')?.toString('utf8')||'<?xml version="1.0" encoding="utf-8"?>\r\n<Preload/>\r\n';
 const parsed=scanXml(preload),root=parsed.rootIds.length===1?parsed.nodes[parsed.rootIds[0]]:undefined;
 if(parsed.diagnostics.some(d=>d.severity==='error')||root?.tag!=='Preload')throw new Error('EDITOR_LOAD_PRELOAD_XML_INVALID');
 const additions:string[]=[],edits:Array<{start:number;end:number;text:string}>=[];
 for(const row of required.values()){
  const existing=parsed.nodes.filter(n=>n.parentId===root.id&&n.tag===row.tag&&n.attrs.id===row.id);
  if(existing.length>1)throw new Error('EDITOR_LOAD_PRELOAD_DUPLICATE: '+row.id);
  if(!existing.length){additions.push(`    <${row.tag} id="${escape(row.id)}"${row.variations.size?' Variations="'+[...row.variations].sort((a,b)=>a-b).join(',')+'"':''}/>`);continue;}
  // No Variations attribute already means unrestricted preload; do not narrow it.
  const n=existing[0],span=n.attrSpans.find(a=>a.name==='Variations');
  if(span&&row.variations.size){const values=n.attrs.Variations.split(',').map(v=>Number(v.trim()));if(values.some(v=>!Number.isInteger(v)||v<0))throw new Error('EDITOR_LOAD_PRELOAD_VARIATIONS_UNSUPPORTED');const merged=[...new Set([...values,...row.variations])].sort((a,b)=>a-b).join(',');if(merged!==n.attrs.Variations)edits.push({start:span.valueStart,end:span.valueEnd,text:merged});}
 }
 if(additions.length){const nl=preload.includes('\r\n')?'\r\n':'\n';if(root.selfClosing){edits.push({start:root.start,end:root.end,text:preload.slice(root.start,root.startTagEnd).replace(/\/\s*>$/,'>')+nl+additions.join(nl)+nl+'</Preload>'});}else edits.push({start:root.endTagStart,end:root.endTagStart,text:additions.join(nl)+nl});}
 for(const e of edits.sort((a,b)=>b.start-a.start))preload=preload.slice(0,e.start)+e.text+preload.slice(e.end);
 next.set('Preload.xml',Buffer.from(preload));
 if(input.get('Objects.version')?.length){if(readVersion(input.get('Objects.version')!).tag!=='plob')throw new Error('EDITOR_LOAD_OBJECTS_VERSION_TAG');}
 else{
  const donor=['MapInfo.version','t3Terrain.version','DocumentInfo.version'].map(k=>input.get(k)).find(b=>b?.length);
  if(!donor)throw new Error('EDITOR_LOAD_VERSION_SOURCE_REQUIRED');
  const v=readVersion(donor);next.set('Objects.version',versionMarker('plob',v,v.timestamp,1));
 }
 next.set('ComponentList.SC2Components',Buffer.from(componentListWithObjects(input.get('ComponentList.SC2Components')?.toString('utf8')??'')));
 const changed=[...next].filter(([k,v])=>!v.equals(input.get(k)??Buffer.alloc(0))).map(([k])=>k);
 return {next,changed,objects:doc.list().length,addedPreloads:additions.length,rendering:'NOT_VERIFIED'};
}
