import {GalaxyDocument,decodeGalaxyString,type Token} from '../script/document.js';
import {scanXml} from '../../core/xmlScanner.js';
import type {DataReference} from './types.js';
export interface CrossReference extends DataReference {rewrite:'galaxyLiteral'|'xmlValue'|'readOnly';rawExpression:string}
export interface CrossIssue {file:string;targetDomain?:string;code:string;offset:number}
const calls:Record<string,{argument:number;domain:string}>= {UnitCreate:{argument:1,domain:'Unit'},ActorCreate:{argument:1,domain:'Actor'}};
export function galaxyReferences(file:string,source:string):{references:CrossReference[];issues:CrossIssue[]} {
 const doc=new GalaxyDocument(source),references:CrossReference[]=[],issues:CrossIssue[]=doc.diagnostics.filter(d=>d.severity==='error').map(d=>({file,code:'GALAXY_PARSE_COVERAGE_UNKNOWN',offset:d.offset}));
 const constants=new Map<string,string>();
 const evaluate=(tokens:Token[]):string|undefined=>{
  const parts:string[]=[];let expect=true;
  for(const token of tokens){if(expect){if(token.kind==='string')parts.push(decodeGalaxyString(token.value));else if(token.kind==='identifier'&&constants.has(token.value))parts.push(constants.get(token.value)!);else return undefined;}else if(token.value!=='+')return undefined;expect=!expect;}
  return expect?undefined:parts.join('');
 };
 for(const symbol of doc.symbols.filter(s=>s.kind==='global'&&/^const\s+string\b/.test(s.signature))){const tokens=doc.tokens.filter(t=>t.start>=symbol.start&&t.end<=symbol.end);const eq=tokens.findIndex(t=>t.value==='=');if(eq>=0){const value=evaluate(tokens.slice(eq+1,-1));if(value!==undefined)constants.set(symbol.name,value);}}
 const shadowsAt=(offset:number)=>{
  const shadows=new Set<string>();const fn=doc.symbols.find(s=>s.kind==='function'&&s.bodyStart!==undefined&&offset>s.bodyStart&&offset<s.end);
  if(!fn)return shadows;
  for(const parameter of fn.parameters??[]){const name=parameter.trim().split(/\s+/).at(-1);if(name)shadows.add(name);}
  const scopes:Array<{end:number;names:Set<string>}>=[];
  for(let i=0;i<doc.tokens.length&&doc.tokens[i].start<offset;i++){
   const token=doc.tokens[i];while(scopes.length&&token.start>=scopes.at(-1)!.end)scopes.pop();
   if(token.value==='{'){const close=doc.pairs.get(i);if(close!==undefined)scopes.push({end:doc.tokens[close].end,names:new Set<string>()});}
   if(token.start<=fn.bodyStart!)continue;
   if(scopes.length&&token.kind==='identifier'&&doc.tokens[i-1]?.kind==='identifier'&&['=',';',',','['].includes(doc.tokens[i+1]?.value??''))scopes.at(-1)!.names.add(token.value);
  }
  for(const scope of scopes)for(const name of scope.names)shadows.add(name);return shadows;
 };
 for(const call of doc.calls()){
  let spec=calls[call.name];const index=doc.tokens.findIndex(t=>t.start===call.offset),open=index+1,close=doc.pairs.get(open);if(close===undefined)continue;
  const args:Token[][]=[];let start=open+1;
  for(let i=start;i<=close;i++){if(i===close||doc.tokens[i].value===','){args.push(doc.tokens.slice(start,i));start=i+1;}else if(['(','[','{'].includes(doc.tokens[i].value)){const end=doc.pairs.get(i);if(end!==undefined)i=end;}}
  if(/^Catalog(FieldValue|FieldCount|Entry)/.test(call.name)){const domain=/^c_gameCatalog(.+)$/.exec(args[0]?.[0]?.value??'')?.[1];spec={argument:1,domain:domain??''};}
  if(!spec)continue;
  if(call.member||doc.symbols.some(s=>s.name===call.name&&s.kind==='function')){issues.push({file,targetDomain:spec.domain||undefined,code:'GALAXY_CATALOG_SIGNATURE_SHADOWED',offset:call.offset});continue;}
  const tokens=args[spec.argument]??[],shadowed=shadowsAt(call.offset),value=tokens.some(t=>t.kind==='identifier'&&shadowed.has(t.value))?undefined:evaluate(tokens);
  if(value===undefined||!spec.domain){issues.push({file,targetDomain:spec.domain||undefined,code:'GALAXY_DYNAMIC_CATALOG_REFERENCE',offset:call.offset});continue;}
  references.push({file,object:call.name,path:call.name+'@'+call.offset,carrier:'GalaxyArgument',value,targetDomain:spec.domain,evidence:'NATIVE_TYPED_ATTRIBUTE',sourceSpan:{start:tokens[0].start,end:tokens.at(-1)!.end},rewrite:tokens.length===1&&tokens[0].kind==='string'?'galaxyLiteral':'readOnly',rawExpression:source.slice(tokens[0].start,tokens.at(-1)!.end)});
 }
 return {references,issues};
}
export function guiReferences(file:string,source:string):{references:CrossReference[];issues:CrossIssue[]} {
 const parsed=scanXml(source),references:CrossReference[]=[],issues:CrossIssue[]=parsed.diagnostics.filter(d=>d.severity==='error').map(d=>({file,code:'GUI_XML_COVERAGE_UNKNOWN',offset:d.offset}));
 for(const node of parsed.nodes){
  if(node.tag==='ScriptCode'&&!node.selfClosing){const r=galaxyReferences(file,source.slice(node.startTagEnd,node.endTagStart));references.push(...r.references.map(r=>({...r,rewrite:'readOnly' as const,sourceSpan:undefined})));issues.push(...r.issues);}
  if(node.tag!=='Element'||node.attrs.Type!=='Param')continue;
  const children=node.childIds.map(id=>parsed.nodes[id]),type=children.find(n=>n.tag==='ValueType'),value=children.find(n=>n.tag==='Value');
  if(type?.attrs.Type==='gamelink'&&value){const raw=source.slice(value.startTagEnd,value.endTagStart);if(raw.includes('&')){issues.push({file,targetDomain:type.attrs.GameType,code:'GUI_ENCODED_GAMELINK',offset:value.start});continue;}references.push({file,object:'Param:'+node.attrs.Id,path:'Param:'+node.attrs.Id+'@Value',carrier:'GuiGameLink',value:raw,targetDomain:type.attrs.GameType,evidence:'NATIVE_TYPED_ATTRIBUTE',sourceSpan:{start:value.startTagEnd,end:value.endTagStart},rewrite:'xmlValue',rawExpression:raw});}
 }
 return {references,issues};
}

/** Placement version 27 carriers, shared with PlacementDocument's writer. */
export function objectReferences(file:string,source:string):{references:CrossReference[];issues:CrossIssue[]} {
 const parsed=scanXml(source),references:CrossReference[]=[],issues:CrossIssue[]=[];
 if(parsed.diagnostics.some(d=>d.severity==='error'))issues.push({file,code:'OBJECTS_XML_COVERAGE_UNKNOWN',offset:0});
 const root=parsed.nodes.find(n=>n.tag==='PlacedObjects');
 if(!root||root.attrs.Version!=='27'){issues.push({file,code:'OBJECTS_VERSION_UNSUPPORTED',offset:0});return {references,issues};}
 for(const node of parsed.nodes.filter(n=>n.parentId===root.id)){
  const spec=node.tag==='ObjectUnit'?{attribute:'UnitType',domain:'Unit'}:node.tag==='ObjectDoodad'?{attribute:'Type',domain:'Doodad'}:undefined;
  if(!spec){if(!['ObjectPoint','ObjectCamera','ObjectRegion'].includes(node.tag))issues.push({file,code:'OBJECTS_CARRIER_UNKNOWN',offset:node.start});continue;}
  const span=node.attrSpans.find(a=>a.name===spec.attribute);
  if(!span){issues.push({file,targetDomain:spec.domain,code:'OBJECTS_CARRIER_MISSING',offset:node.start});continue;}
  const value=node.attrs[spec.attribute];
  if(value.includes('##')){issues.push({file,targetDomain:spec.domain,code:'OBJECTS_DYNAMIC_REFERENCE',offset:span.valueStart});continue;}
  references.push({file,object:node.tag+':'+node.attrs.Id,path:node.tag+'@'+spec.attribute,carrier:'PlacementAttribute',value,targetDomain:spec.domain,evidence:'NATIVE_TYPED_ATTRIBUTE',sourceSpan:{start:span.valueStart,end:span.valueEnd},rewrite:'xmlValue',rawExpression:source.slice(span.valueStart,span.valueEnd)});
 }
 return {references,issues};
}
