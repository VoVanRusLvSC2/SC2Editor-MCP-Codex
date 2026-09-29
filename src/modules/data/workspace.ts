import {createHash} from "node:crypto";
import {galaxyReferences,guiReferences,objectReferences,type CrossReference,type CrossIssue} from "./crossReferences.js";
import { dataDomainFromType } from "./domains.js";
import { internalWorkspaceDirectory } from "../../core/discoveryPaths.js";
import {catalogActivation} from "./activation.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Workspace } from "../../core/workspace.js";
import { scanXml } from "../../core/xmlScanner.js";
import { DataDocument,referenceSchema } from "./document.js";
import { DataSchemaRegistry } from "./schemaRegistry.js";
import { validateDataDocuments } from "./validator.js";
import { validateDataAuthoring, DataAuthoringError, type DataAuthoringVerdict } from "./authoringValidation.js";
import type { DataNativeFieldSpec, DataObject, DataObjectSelector, DataOperation, DataReference, DataValidationReport } from "./types.js";

const SKIP = new Set(["node_modules", "dist", "release", ".git", ".svn"]);

interface CatalogCoverageIssue {file:string;code:string;reason:string}
type CatalogRecords=CatalogRecord[] & {issues:CatalogCoverageIssue[]};
interface CatalogRecord { file: string; absolute: string; layer: "workspace" | "dependency"; provenance: string[]; document: DataDocument; engineActive?:boolean; activationMode?:string;activationWarnings?:string[];dependencyAvailability?:string;declarationOrder?:number }

function normalize(value: string): string { return value.replaceAll("\\", "/"); }
function provenance(file: string): string[] {
  const values = normalize(file).split("/").filter((entry) => /\.SC2(?:Map|Mod|Data)$/i.test(entry));
  return values.length ? values : ["workspace"];
}

function selectorAlias(selector: DataObjectSelector, aliases: Map<string, string>): DataObjectSelector {
  if (typeof selector === "string" && selector.startsWith("@")) {
    const value = aliases.get(selector.slice(1));
    if (!value) throw new Error(`Unknown Data operation alias '${selector}'`);
    return value;
  }
  return selector;
}

function recipeFields(...fields: DataNativeFieldSpec[]): DataNativeFieldSpec[] { return fields; }

export function componentListWithGameData(source: string): string {
  const initial = source || `<?xml version="1.0" encoding="utf-8"?>\r\n<Components>\r\n</Components>`;
  const parsed = scanXml(initial);
  const root = parsed.rootIds.map((id) => parsed.nodes[id]).find((node) => node.tag === "Components");
  if (!root) throw new Error("ComponentList.SC2Components must have a <Components> root");
  if (root.childIds.map((id) => parsed.nodes[id]).some((node) => node.tag === "DataComponent" && node.attrs.Type?.toLowerCase() === "gada")) return initial;
  const newline = initial.includes("\r\n") ? "\r\n" : "\n";
  const rendered = `    <DataComponent Type="gada">GameData</DataComponent>`;
  if (root.selfClosing) {
    const opening = initial.slice(root.start, root.startTagEnd).replace(/\/\s*>$/, ">");
    return initial.slice(0, root.start) + `${opening}${newline}${rendered}${newline}</Components>` + initial.slice(root.end);
  }
  return initial.slice(0, root.endTagStart) + `${newline}${rendered}${newline}` + initial.slice(root.endTagStart);
}

export function gameDataIndexWithCatalog(source: string, catalogPath: string): string {
  const initial = source || `<?xml version="1.0" encoding="utf-8"?>\r\n<Includes>\r\n</Includes>`;
  const parsed = scanXml(initial);
  const root = parsed.rootIds.map((id) => parsed.nodes[id]).find((node) => node.tag === "Includes");
  if (!root) throw new Error("Base.SC2Data/GameData.xml must have an <Includes> root");
  const canonical = normalize(catalogPath).replace(/^Base\.SC2Data\//i, "");
  if (root.childIds.map((id) => parsed.nodes[id]).some((node) => node.tag === "Catalog" && normalize(node.attrs.path ?? "").toLowerCase() === canonical.toLowerCase())) return initial;
  const newline = initial.includes("\r\n") ? "\r\n" : "\n";
  const rendered = `    <Catalog path="${canonical.replaceAll("&", "&amp;").replaceAll("\"", "&quot;")}"/>`;
  if (root.selfClosing) {
    const opening = initial.slice(root.start, root.startTagEnd).replace(/\/\s*>$/, ">");
    return initial.slice(0, root.start) + `${opening}${newline}${rendered}${newline}</Includes>` + initial.slice(root.end);
  }
  return initial.slice(0, root.endTagStart) + `${newline}${rendered}${newline}` + initial.slice(root.endTagStart);
}

export class DataWorkspace {
  readonly extraRoots: string[];
  private plans=new Map<string,{request:Parameters<DataWorkspace["applyTracked"]>[0];fingerprint:string;schemaSources:Array<{file:string;sha256:string}>}>();
  private parsedCatalogs=new Map<string,DataDocument>();
  private parsedBytes=0;
  private cachedDocument(absolute:string,source:string,file:string) {
    const existing=this.parsedCatalogs.get(absolute);
    if(existing?.source===source)return existing;
    if(existing)this.parsedBytes-=Buffer.byteLength(existing.source);
    const doc=new DataDocument(source,file);this.parsedCatalogs.delete(absolute);this.parsedCatalogs.set(absolute,doc);this.parsedBytes+=Buffer.byteLength(source);
    while(this.parsedCatalogs.size>128 || this.parsedBytes>32*1024*1024){const key=this.parsedCatalogs.keys().next().value!;this.parsedBytes-=Buffer.byteLength(this.parsedCatalogs.get(key)!.source);this.parsedCatalogs.delete(key);}
    return doc;
  }

  constructor(readonly workspace: Workspace, readonly schema = new DataSchemaRegistry(), extraRoots = (process.env.SC2_ASSET_ROOTS ?? "").split(path.delimiter).filter(Boolean)) {
    this.extraRoots = extraRoots.map((entry) => path.resolve(entry));
  }

  async open(file = "Base.SC2Data/GameData/UnitData.xml") {
    const raw = await this.workspace.readRaw(file);
    return { ...raw, document: raw.exists || raw.staged ? new DataDocument(raw.text, raw.file) : DataDocument.create(raw.file) };
  }

  private async discoverRoot(base: string, layer: "workspace" | "dependency", overrides?: ReadonlyMap<string, string>): Promise<CatalogRecords> {
    const files:CatalogRecords=Object.assign([],{issues:[] as CatalogCoverageIssue[]});
    const candidates=new Set<string>();
    const isCandidate=(file:string)=>/(?:^|\/)GameData\/.*\.xml$/i.test(file)||/Data\.xml$/i.test(path.basename(file));
    const visit=async(directory:string):Promise<void>=>{
      let entries;try{entries=await this.workspace.readDirectory(directory,'data-catalog',entry=>entry.isDirectory()?!(SKIP.has(entry.name)||internalWorkspaceDirectory(entry.name)):isCandidate(normalize(path.relative(base,path.join(directory,entry.name)))));}catch(error){files.issues.push({file:directory,code:"CATALOG_DIRECTORY_UNREADABLE",reason:String(error)});return;}
      for(const entry of entries){if(entry.isDirectory()&&(SKIP.has(entry.name)||internalWorkspaceDirectory(entry.name)))continue;const absolute=path.join(directory,entry.name);if(entry.isDirectory())await visit(absolute);else if(entry.isFile()&&isCandidate(normalize(path.relative(base,absolute))))candidates.add(absolute);}
    };
    await visit(base);
    if(layer==="workspace")for(const file of [...this.workspace.draftFiles(),...this.workspace.binary.draftFiles(),...overrides?.keys()??[]]){
      const absolute=this.workspace.resolveUserPath(file),relative=normalize(path.relative(base,absolute));
      if(!relative.startsWith("../")&&!path.isAbsolute(relative)&&isCandidate(relative))candidates.add(absolute);
    }
    for(const absolute of [...candidates].sort()){
      const relative=normalize(path.relative(base,absolute));
      const workspaceRelative=layer==="workspace"?normalize(path.relative(this.workspace.root,absolute)):relative;
      try{
        const stat=await fs.stat(absolute).catch(()=>undefined);if(stat&&stat.size>64*1024*1024){files.issues.push({file:absolute,code:"CATALOG_BYTE_LIMIT",reason:"Catalog exceeds 64 MiB"});continue;}
        const source=layer==="workspace"&&overrides?.has(workspaceRelative)?overrides.get(workspaceRelative)!:layer==="workspace"?(await this.workspace.readRaw(workspaceRelative)).text:await this.workspace.readDependency(absolute);
        if(Buffer.byteLength(source)>64*1024*1024){files.issues.push({file:absolute,code:"CATALOG_BYTE_LIMIT",reason:"Staged catalog exceeds 64 MiB"});continue;}
        const parsed=scanXml(source);if(parsed.diagnostics.some(d=>d.severity==="error"))files.issues.push({file:absolute,code:"CATALOG_XML_INVALID",reason:"XML references cannot be completely indexed"});if(parsed.rootIds.some(id=>parsed.nodes[id].tag==="Catalog"))files.push({file:workspaceRelative,absolute,layer,provenance:layer==="workspace"?provenance(absolute):[path.basename(base),...provenance(absolute)],document:this.cachedDocument(absolute,source,workspaceRelative)});
      }catch(error){if(error instanceof Error&&error.message.startsWith("STALE_"))throw error;files.issues.push({file:absolute,code:"CATALOG_READ_FAILED",reason:String(error)});}
    }
    const lookup=new Map(files.map(r=>[normalize(path.relative(base,r.absolute)).toLowerCase(),r.absolute]));
    const activationSources=new Map<string,{absolute:string;source:string}>();
    const activation=await catalogActivation(async file=>{
      const absolute=lookup.get(file.toLowerCase()) ?? path.join(base,file);
      if(layer === "workspace") {const key=normalize(path.relative(this.workspace.root,absolute));if(overrides?.has(key)){const source=overrides.get(key)!;activationSources.set(file.toLowerCase(),{absolute,source});return source;}const raw=await this.workspace.readRaw(key);if(raw.exists || (raw.staged && (raw.text.length>0||this.workspace.draftFiles().includes(key)))){activationSources.set(file.toLowerCase(),{absolute,source:raw.text});return raw.text;}return undefined;}
      const text=await this.workspace.readDependency(absolute,true);if(text)activationSources.set(file.toLowerCase(),{absolute,source:text});return text||undefined;
    });
    for(const key of activation.files){const loaded=activationSources.get(key);if(!loaded||files.some(r=>r.absolute===loaded.absolute))continue;const file=normalize(path.relative(layer==="workspace"?this.workspace.root:base,loaded.absolute));files.push({file,absolute:loaded.absolute,layer,provenance:layer==="workspace"?provenance(loaded.absolute):[path.basename(base),...provenance(loaded.absolute)],document:this.cachedDocument(loaded.absolute,loaded.source,file)});}
    for(const record of files){record.activationWarnings=activation.warnings;record.activationMode=activation.mode;record.engineActive=activation.mode === "EXPLICIT_INCLUDES" ? activation.files.has(normalize(path.relative(base,record.absolute)).toLowerCase()) : undefined;}
    return files;
  }

  async catalog(overrides?: ReadonlyMap<string, string>): Promise<CatalogRecords> {
    referenceSchema.refresh();
    const records = await this.discoverRoot(this.workspace.root, "workspace", overrides);
    const source=(await this.workspace.readRaw('DocumentInfo')).text;
    const declared=source.length>0,ordered:string[]=[],visiting=new Set<string>(),visited=new Set<string>();
    const dependencyName=(root:string)=>normalize(root).split('/').filter(n=>/\.SC2(?:Mod|Map)$/i.test(n)).at(-1)?.toLowerCase()??path.basename(root).toLowerCase();
    const visit=async(root:string,text:string)=>{
      if(visiting.has(root)){records.issues.push({file:root,code:'DEPENDENCY_CYCLE',reason:'Declared dependency graph contains a cycle'});return;}
      if(visited.has(root))return;visiting.add(root);
      const parsed=scanXml(text);if(parsed.diagnostics.some(d=>d.severity==='error'))records.issues.push({file:root,code:'DEPENDENCY_DOCUMENT_INVALID',reason:'Cannot establish declared dependency graph'});
      for(const node of parsed.nodes.filter(n=>n.tag==='Dependencies'))for(const childId of node.childIds){const child=parsed.nodes[childId],content=text.slice(child.startTagEnd,child.endTagStart).trim();const file=content.match(/(?:^|,)file:([^,]+)/i)?.[1];
        if(!file){if(content)records.issues.push({file:root,code:'DEPENDENCY_REMOTE_UNRESOLVED',reason:content});continue;}
        const name=normalize(file).split('/').at(-1)!.toLowerCase(),matches=this.extraRoots.filter(r=>dependencyName(r)===name);
        if(matches.length!==1){records.issues.push({file,code:matches.length?'DEPENDENCY_AMBIGUOUS':'DEPENDENCY_MISSING',reason:'Declared dependency cannot be uniquely loaded'});continue;}
        const target=matches[0];await visit(target,await this.workspace.readDependency(path.join(target,'DocumentInfo'),true));
      }
      visiting.delete(root);visited.add(root);if(root!==this.workspace.root)ordered.push(root);
    };
    if(declared)await visit(this.workspace.root,source);
    for(const record of records){record.dependencyAvailability='WORKSPACE';record.declarationOrder=ordered.length;}
    for(const root of [...ordered,...this.extraRoots.filter(r=>!ordered.includes(r))]){const dependency=await this.discoverRoot(root,'dependency');const active=ordered.includes(root);
      for(const record of dependency){record.dependencyAvailability=active?'DECLARED_AVAILABLE':declared?'INSTALLED_NOT_DECLARED':'DECLARATIONS_UNVERIFIED';record.declarationOrder=active?ordered.indexOf(root):undefined;if(declared&&!active)record.engineActive=false;}
      records.push(...dependency);records.issues.push(...dependency.issues);
    }
    return records;
  }

  private flattened(objects: DataObject[]) {
    const output: Array<{ path: string; ordinal?:number; value?: string; link?: string; attrs: Record<string, string> }> = [];
    const visit = (fields: DataObject["fields"]) => { for (const field of fields) { output.push({ path: field.path,ordinal:field.ordinal, value: field.value, link: field.link, attrs: field.attrs }); visit(field.children); } };
    for (const object of objects) visit(object.fields);
    return output;
  }

  private projectedFields(fields: DataObject["fields"], needles: string[]): DataObject["fields"] {
    if (!needles.length) return fields;
    const visit = (entries: DataObject["fields"]): DataObject["fields"] => entries.flatMap((field) => {
      const children = visit(field.children);
      const ownMatch = needles.some((needle) => field.path.toLowerCase().includes(needle));
      return ownMatch || children.length ? [{ ...field, children }] : [];
    });
    return visit(fields);
  }

  private effective(object: DataObject & {engineActive?:boolean}, all: Array<DataObject & { file: string; layer: string;engineActive?:boolean }>,parentIndex?:Map<string,DataObject & {file:string;layer:string;engineActive?:boolean}>) {
    const chain: Array<DataObject & { file: string; layer: string }> = [];
    const visited = new Set<string>();
    const unresolvedParents:Array<{id:string;reason:string}>=[];
    let current: (DataObject & { file: string; layer: string }) | undefined = object as DataObject & { file: string; layer: string };
    while (current) {
      const key = `${current.domain ?? current.ctype}\0${current.id ?? ""}`;
      if (visited.has(key)){unresolvedParents.push({id:current.id??"",reason:"PARENT_CYCLE"});break;}
      visited.add(key); chain.unshift(current);
      const parent:string|undefined=current.parent;
      const next:(DataObject & {file:string;layer:string;engineActive?:boolean})|undefined=parent ? parentIndex ? parentIndex.get(`${current.domain ?? current.ctype}\0${parent}`) : all.find(candidate=>candidate.engineActive!==false&&(object.engineActive!==true||candidate.engineActive===true)&&candidate.id===parent&&(candidate.domain??candidate.ctype)===(current!.domain??current!.ctype)) : undefined;
      if(parent&&!next)unresolvedParents.push({id:parent,reason:object.engineActive===true?"ACTIVE_PARENT_UNRESOLVED":"PARENT_UNRESOLVED"});
      current=next;
    }
    const defaults = all.filter(entry=>entry.ctype===object.ctype && entry.isDefault && !entry.id && entry.engineActive!==false);
    if(defaults.length===1)chain.unshift(defaults[0]);
    const layerConflicts=new Set<string>(),layerTokenConflicts=new Set<string>();
    const expanded:typeof chain=[];
    for(const entry of chain){const layers=entry.id?all.filter(o=>o.id===entry.id&&o.domain===entry.domain&&o.engineActive!==false):[];
      for(const layer of layers.filter(o=>o!==entry)){if(!expanded.some(e=>e.declarationKey?.file===layer.declarationKey?.file&&e.declarationKey?.start===layer.declarationKey?.start&&e.id===layer.id))expanded.push(layer);}
      expanded.push(entry);
    }
    for(const entry of expanded){const layers=expanded.filter(o=>o.id===entry.id&&o.domain===entry.domain);if(layers.length>1){const declarations=new Map<string,Set<string>>();for(const layer of layers)for(const field of this.flattened([layer])){const values=declarations.get(field.path)??new Set<string>();values.add(JSON.stringify([field.value,field.link,field.attrs.removed,field.attrs.reset]));declarations.set(field.path,values);}for(const [field,values]of declarations)if(values.size>1)layerConflicts.add(field);}}
    for(const entry of expanded){const layers=expanded.filter(o=>o.id===entry.id&&o.domain===entry.domain);if(layers.length>1){const declarations=new Map<string,Set<string>>();for(const layer of layers)for(const [id,raw]of Object.entries(layer.tokens??{})){const values=declarations.get(id)??new Set<string>();values.add(layer.attrs[id]??raw);declarations.set(id,values);}for(const [id,values]of declarations)if(values.size>1)layerTokenConflicts.add(id);}}
    chain.splice(0,chain.length,...expanded);
    const tokens:Record<string,string>={};
    for(const entry of chain){Object.assign(tokens,entry.tokens ?? {});for(const id of Object.keys(tokens))if(entry.attrs[id]!==undefined)tokens[id]=entry.attrs[id];}
    type Value = {path:string;value?:string;link?:string;attrs:Record<string,string>;declaredBy?:string;file?:string;declarationKey?:DataObject["declarationKey"];status:"resolved"|"unknown"|"removed";reason?:string;rawValue?:string};
    const fields = new Map<string,Value>();
    const issues:Array<{path:string;reason:string}>=[];
    const substitute=(raw:string|undefined):{value?:string;unknown:boolean}=>{
      if(raw===undefined)return {unknown:false};
      let value=raw,unknown=false;
      for(let iteration=0;iteration<16&&value.includes("##");iteration++){
        const next=value.replace(/##([^#]+)##/g,(whole,id:string)=>{if(tokens[id]===undefined){unknown=true;return whole;}return tokens[id];});
        if(next===value)break;value=next;
      }
      if(value.includes("##"))unknown=true;
      return {value:unknown?undefined:value,unknown};
    };
    for(const entry of chain){
      const flat=this.flattened([entry]),counts=new Map<string,number>(),ordinals=new Map<string,number>();
      for(const field of flat)counts.set(field.path,(counts.get(field.path)??0)+1);
      for(const field of flat){
        const ordinal=ordinals.get(field.path)??0;ordinals.set(field.path,ordinal+1);
        const repeated=field.ordinal!==undefined || (counts.get(field.path)??0)>1;
        const path=field.ordinal!==undefined?field.path:repeated ? field.path+"[#"+ordinal+"]" : field.path;
        const value=substitute(field.value),link=substitute(field.link);
        const removed=field.attrs.removed==="1";
        const reason=[...(field.value??field.link??"").matchAll(/##([^#]+)##/g)].some(match=>layerTokenConflicts.has(match[1]))?"RUNTIME_LAYER_TOKEN_OVERRIDE_UNVERIFIED":layerConflicts.has(field.path)?"RUNTIME_LAYER_OVERRIDE_UNVERIFIED":repeated ? "UNINDEXED_ARRAY_MERGE_UNKNOWN" : field.attrs.reset!==undefined ? "RESET_RULE_UNKNOWN" : value.unknown||link.unknown ? "TOKEN_UNRESOLVED" : undefined;
        if(reason)issues.push({path,reason});
        fields.set(path,{...field,path,value:removed||reason?undefined:value.value,link:removed||reason?undefined:link.value,rawValue:field.value,declaredBy:entry.id,file:entry.file,declarationKey:entry.declarationKey,status:reason?"unknown":removed?"removed":"resolved",reason});
      }
    }
    if(defaults.length>1)issues.push({path:"<defaults>",reason:"DEFAULT_LAYER_ORDER_UNKNOWN"});
    return {unindexedArrayDeclarations:chain.flatMap(entry=>this.flattened([entry]).filter(field=>field.ordinal!==undefined).map(field=>({...field,declaredBy:entry.id,file:entry.file,status:"unknown",reason:"UNINDEXED_ARRAY_MERGE_UNKNOWN"}))),semanticCoverage:"PARTIAL" as const,resolutionScope:"Available parent chain, one unambiguous class default and object token substitution; runtime layer/array rules remain explicit",issues,unresolvedParents,templateChain:chain.map(entry=>({id:entry.id,ctype:entry.ctype,file:entry.file,layer:entry.layer})),fields:Object.fromEntries(fields)};
  }

  private boundedFields(fields:DataObject['fields'],max:number){let total=0,remaining=max;const visit=(entries:DataObject['fields']):DataObject['fields']=>entries.flatMap(field=>{total++;const keep=remaining-->0;const children=visit(field.children);return keep?[{...field,children}]:[];});const selected=visit(fields);return {selected,total,truncated:total>max};}

  async context(args: { text?:string;parent?:string;link?:string;file?: string; ids?: string[]; ctypes?: string[]; domains?: string[]; fields?: string[]; includeRaw?: boolean; includeInherited?: boolean; includeDependencies?: boolean; includeReferences?: boolean; activeOnly?:boolean; offset?:number; limit?: number } = {}) {
    const records = await this.catalog();
    const requested = args.file ? normalize(args.file) : undefined;
    if (requested && !records.some((record) => record.layer === "workspace" && record.file === requested)) {
      const opened = await this.open(requested);
      if (opened.exists || opened.staged) records.unshift({ file: opened.file, absolute: opened.absolute, layer: "workspace", provenance: provenance(opened.absolute), document: opened.document });
    }
    const all = records.flatMap((record) => record.document.objects(args.includeRaw ?? false).map((object) => ({ ...object,declarationKey:{file:record.absolute,start:object.declarationKey?.start??0}, file: record.file, layer: record.layer, provenance: record.provenance, engineActive:record.engineActive,activationMode:record.activationMode,dependencyAvailability:record.dependencyAvailability,declarationOrder:record.declarationOrder,recordKey: `${record.layer}:${record.absolute}` })));
    const ids = new Set((args.ids ?? []).map((value) => value.toLowerCase()));
    const ctypes = new Set((args.ctypes ?? []).map((value) => value.toLowerCase()));
    const domains = new Set((args.domains ?? []).map((value) => value.toLowerCase()));
    const needles = (args.fields ?? []).map((value) => value.toLowerCase());
    const linkReferences=args.link?this.references(records):[];
    const matchingObjects = all.filter((object) =>
      (!args.text||object.id?.toLowerCase().includes(args.text.toLowerCase())||object.ctype.toLowerCase().includes(args.text.toLowerCase())) &&
      (!args.parent||object.parent?.toLowerCase()===args.parent.toLowerCase()) &&
      (!args.link||this.flattened([object]).some(f=>f.link===args.link)||linkReferences.some(r=>r.file===object.file&&r.object===`${object.ctype}:${object.id}`&&r.value===args.link)) &&
      (!args.activeOnly || object.engineActive===true) &&
      (!requested || object.file === requested) &&
      (args.includeDependencies !== false || object.layer === "workspace") &&
      (!ids.size || (object.id && ids.has(object.id.toLowerCase()))) &&
      (!ctypes.size || ctypes.has(object.ctype.toLowerCase())) &&
      (!domains.size || (object.domain && domains.has(object.domain.toLowerCase()))),
    );
    const offset=args.offset??0,limit=args.limit??200;
    const filtered=matchingObjects.slice(offset,offset+limit);
    const parentIndex=new Map<string,typeof all[number]>(),verifiedParents=new Map<string,typeof all[number]>();
    for(const object of all){const key=`${object.domain ?? object.ctype}\0${object.id ?? ""}`;if(object.engineActive!==false&&!parentIndex.has(key))parentIndex.set(key,object);if(object.engineActive===true&&!verifiedParents.has(key))verifiedParents.set(key,object);}
    const objects = filtered.map((object) => {
      const publicObject: Omit<typeof object, "recordKey"> & { recordKey?: string } = { ...object };
      delete publicObject.recordKey;
      const effective = args.includeInherited === false ? undefined : this.effective(object, all,object.engineActive===true?verifiedParents:parentIndex);
      const fieldSummary=this.boundedFields(this.projectedFields(object.fields,needles),args.includeRaw?Number.MAX_SAFE_INTEGER:200);
      const effectiveEntries=effective?Object.entries(effective.fields).filter(([fieldPath])=>!needles.length||needles.some(needle=>fieldPath.toLowerCase().includes(needle))):[];
      return {
        ...publicObject,
        fields:fieldSummary.selected,fieldPagination:{total:fieldSummary.total,truncated:fieldSummary.truncated,details:'Select fields in data.context/data.resolve or explicitly includeRaw'},
        effective: effective ? { ...effective, fields:Object.fromEntries(effectiveEntries.slice(0,args.includeRaw?Number.MAX_SAFE_INTEGER:200)),fieldPagination:{total:effectiveEntries.length,truncated:!args.includeRaw&&effectiveEntries.length>200,details:"Select fields in data.resolve"} } : undefined,
      };
    });
    const selective = Boolean(requested || ids.size || ctypes.size || domains.size || needles.length || args.text || args.parent || args.link);
    const selectedRecordKeys = new Set(filtered.map((object) => object.recordKey));
    const selectedIds = new Set(filtered.flatMap((object) => object.id ? [object.id.toLowerCase()] : []));
    const selectedObjects = new Set(filtered.map((object) => `${object.ctype}:${object.id ?? ""}`.toLowerCase()));
    const cross=args.includeReferences===false?undefined:await this.crossReferences();if(cross)cross.issues.push(...this.actorIssues(records));
    const allReferences = args.includeReferences === false ? undefined : [...this.references(records),...(cross?.references??[])];
    const matchingReferences = allReferences?.filter((reference) => !selective || selectedIds.has(reference.value.toLowerCase())&&(!domains.size||!reference.targetDomain||domains.has(reference.targetDomain.toLowerCase())) || selectedObjects.has(reference.object.toLowerCase()));
    const references=matchingReferences?.slice(0,args.limit??200);
    const visibleRecords = selective ? records.filter((record) => selectedRecordKeys.has(`${record.layer}:${record.absolute}`)) : records;
    return {
      files: visibleRecords.filter((record) => args.includeDependencies !== false || record.layer === "workspace").map((record) => ({ file: record.file, layer: record.layer, provenance: record.provenance, objects: record.document.entries().length, sha256: record.document.sha256,engineActive:record.engineActive,activationMode:record.activationMode,activationWarnings:record.activationWarnings,dependencyAvailability:record.dependencyAvailability,declarationOrder:record.declarationOrder })),
      corpusSummary: { files: records.length, objects: all.length, objectTypes: new Set(all.map((entry) => entry.ctype)).size },
      objects, references, pagination:{total:matchingObjects.length,offset,truncated:offset+limit<matchingObjects.length,next:offset+limit<matchingObjects.length?offset+limit:null},referencePagination:{total:matchingReferences?.length??0,truncated:(matchingReferences?.length??0)>(references?.length??0),scope:"Loaded GameData XML; use data.references for complete paginated cross-domain queries"},
      coverageIssues:[...records.issues,...cross?.issues??[]].slice(0,200),coveragePagination:{total:records.issues.length+(cross?.issues.length??0),truncated:records.issues.length+(cross?.issues.length??0)>200,details:"data.references issueOffset/issueLimit"},
      diagnostics: requested ? (await this.validate(requested)).diagnostics.slice(0, args.limit ?? 200) : [],
      schema: { mode: "observed-bundled-plus-dynamic", activeObjectTypes: new Set(all.filter(entry=>entry.engineActive===true).map((entry) => entry.ctype)).size, activeFieldPaths: new Set(all.filter(entry=>entry.engineActive===true).flatMap((entry) => this.flattened([entry]).map((field) => `${entry.ctype}.${field.path}`))).size, coverage: this.schema.coverage() },
      operations: ["object.create", "object.clone", "object.rename", "object.delete", "object.setParent", "object.setAttribute", "object.removeAttribute", "field.set", "field.setLink", "field.setAttribute", "field.removeAttribute", "field.remove", "array.append", "native.add", "recipe.weaponBurn", "recipe.unitTextureByVital"],
      recipes: {
        "recipe.weaponBurn": { creates: ["CEffectDamage", "CBehaviorBuff", "CEffectApplyBehavior", "CEffectSet", "CActorModel"], patches: "carrierEffect.carrierPath", defaults: { carrierCtype: "CEffectCreatePersistent", carrierPath: "PeriodicEffectArray[0]", attachSite: "SOpAttachHead" } },
        "recipe.unitTextureByVital": { creates: ["2x CTexture per slot", "CValidatorUnitCompareVital", "CActorStateMonitor"], semantics: "fractional Life threshold with reversible healthy/damaged TextureSelectById states", defaults: { pollInterval: 0.5 }, requires: "healthy and damaged DDS paths for every declared model material slot" },
      },
      recommendedWorkflow: "one data.context + one data.apply; data.apply includes validation, minimal diff, backup and atomic commit",
    };
  }

  private referenceTokens(objects:DataObject[],ctype:string,id?:string):Record<string,string> {
    const domain=dataDomainFromType(ctype),chain:DataObject[]=[],seen=new Set<string>();
    let candidates=objects.filter(o=>o.ctype===ctype&&o.id===id);
    while(candidates.length===1){const object=candidates[0];if(seen.has(object.id??""))break;seen.add(object.id??"");chain.unshift(object);if(!object.parent)break;candidates=objects.filter(o=>o.domain===domain&&o.id===object.parent);}
    const defaults=objects.filter(o=>o.ctype===ctype&&o.isDefault&&!o.id);if(defaults.length===1)chain.unshift(defaults[0]);
    const tokens:Record<string,string>={};for(const object of chain){Object.assign(tokens,object.tokens??{});for(const id of Object.keys(tokens))if(object.attrs[id]!==undefined)tokens[id]=object.attrs[id];}return tokens;
  }

  private actorIssues(records:CatalogRecord[]){const objects=records.flatMap(r=>r.document.objects());return records.flatMap(r=>r.document.actorCoverageIssues(entry=>this.referenceTokens(objects,entry.tag,entry.attrs.id)));}

  references(records: CatalogRecord[]): DataReference[] {
    const objects = records.flatMap((record) => record.document.objects().map((object) => ({ ...object, file: record.file })));
    const byId = new Map<string, typeof objects>();
    for (const object of objects) if (object.id) byId.set(object.id, [...(byId.get(object.id) ?? []), object]);
    const own:DataReference[]=records.flatMap((record) => record.document.references(entry=>this.referenceTokens(objects,entry.tag,entry.attrs.id)).map((reference) => {
      const targets = (byId.get(reference.value) ?? []).filter(o=>!reference.targetDomain || o.domain === reference.targetDomain);
      const target = targets.length === 1 ? targets[0] : undefined;
      return { file: record.file, ...reference, targetDomain: reference.targetDomain ?? target?.domain, targetType: target?.ctype, evidence: reference.evidence };
    }));
    const inherited:DataReference[]=[];
    for(const child of objects.filter(o=>o.id&&o.parent)){
      const tokens=this.referenceTokens(objects,child.ctype,child.id),seen=new Set<string>();let parent=child.parent;
      const childKey=child.ctype+':'+child.id,ownPaths=new Set(own.filter(r=>r.file===child.file&&r.object===childKey).map(r=>r.path.slice(childKey.length)));
      while(parent&&!seen.has(parent)){seen.add(parent);const matches=objects.filter(o=>o.id===parent&&o.domain===child.domain);if(matches.length!==1)break;const ancestor=matches[0],ancestorKey=ancestor.ctype+':'+ancestor.id;
        for(const reference of own.filter(r=>r.file===ancestor.file&&r.object===ancestorKey&&r.rawExpression?.includes('##')&&r.carrier!=='parent'&&!ownPaths.has(r.path.slice(ancestorKey.length)))){
          let value=reference.rawExpression!;for(let i=0;i<16&&value.includes('##');i++){const next=value.replace(/##([^#]+)##/g,(whole,id:string)=>tokens[id]??whole);if(next===value)break;value=next;}
          reference.rewritePolicy='readOnly';
          inherited.push({...reference,object:childKey,path:childKey+reference.path.slice(ancestorKey.length),value,resolution:value.includes('##')?'unknown':'resolved',rewritePolicy:'readOnly',inheritedFrom:{object:ancestorKey,file:ancestor.file}});
        }
        parent=ancestor.parent;
      }
    }
    return [...own,...inherited];
  }

  private async crossReferences() {
    const references:CrossReference[]=[],issues:CrossIssue[]=[],consumerFiles:Array<{file:string;sha256:string}>=[];
    let bytes=0,files=0;
    const walk=async(dir:string)=>{for(const e of await this.workspace.readDirectory(dir,'data-consumers',entry=>entry.isDirectory()?!(SKIP.has(entry.name)||entry.name.startsWith('.')||entry.name==='dist-runtime'):/\.galaxy$/i.test(entry.name)||['Triggers','Objects'].includes(entry.name))){
      if(SKIP.has(e.name)||e.name.startsWith(".")||e.name==="dist-runtime")continue;
      const full=path.join(dir,e.name);
      if(e.isDirectory())await walk(full);
      else if(e.isFile()&&(/\.galaxy$/i.test(e.name)||["Triggers","Objects"].includes(e.name))){
        if(++files>4096)throw new Error("REFERENCE_FILE_LIMIT");
        const file=normalize(path.relative(this.workspace.root,full)),source=(await this.workspace.readRaw(file)).text;
        if((bytes+=Buffer.byteLength(source))>64*1024*1024)throw new Error("REFERENCE_BYTE_LIMIT");
        consumerFiles.push({file,sha256:createHash("sha256").update(source).digest("hex")});
        const result=e.name==="Triggers"?guiReferences(file,source):e.name==="Objects"?objectReferences(file,source):galaxyReferences(file,source);
        references.push(...result.references);issues.push(...result.issues);
      }
    }};
    await walk(this.workspace.root);
    for(const file of ["Triggers","Objects"]){const raw=await this.workspace.readRaw(file);if(!raw.exists&&!raw.staged)continue;if(references.some(r=>r.file===file)||issues.some(r=>r.file===file))continue;consumerFiles.push({file,sha256:createHash("sha256").update(raw.text).digest("hex")});
      const result=file==="Triggers"?guiReferences(file,raw.text):objectReferences(file,raw.text);references.push(...result.references);issues.push(...result.issues);}
    for(const file of this.workspace.draftFiles().filter(file=>/\.galaxy$/i.test(file)||['Triggers','Objects'].includes(file))){
      if(references.some(ref=>ref.file===file)||issues.some(issue=>issue.file===file))continue;
      const source=(await this.workspace.readRaw(file)).text;
      consumerFiles.push({file,sha256:createHash('sha256').update(source).digest('hex')});
      const result=file==='Triggers'?guiReferences(file,source):file==='Objects'?objectReferences(file,source):galaxyReferences(file,source);
      references.push(...result.references);issues.push(...result.issues);
    }
    return {references,issues,files:[...new Map(consumerFiles.map(x=>[x.file,x])).values()].sort((a,b)=>a.file.localeCompare(b.file))};
  }

  async referenceQuery(args: {id?:string;domain?:string;direction?:"incoming"|"outgoing"|"both";offset?:number;limit?:number;issueOffset?:number;issueLimit?:number} = {}) {
    const records = await this.catalog();
    const cross = await this.crossReferences();cross.issues.push(...this.actorIssues(records));
    const all = [...this.references(records),...cross.references].filter(r=>{
      const incoming = (!args.id || r.value === args.id) && (!args.domain || !r.targetDomain || r.targetDomain === args.domain);
      const [ctype,...parts] = r.object.split(":");
      const outgoing = (!args.id || parts.join(":") === args.id) && (!args.domain || dataDomainFromType(ctype) === args.domain);
      return args.direction === "incoming" ? incoming : args.direction === "outgoing" ? outgoing : incoming || outgoing;
    });
    const offset=args.offset ?? 0, limit=args.limit ?? 100;
    const coverageIssues=[...records.issues,...cross.issues,{code:"EXTERNAL_CONSUMERS_NOT_INDEXED",scope:"Unknown catalog calls and unconfigured external consumers"}],issueOffset=args.issueOffset??0,issueLimit=args.issueLimit??100;
    return {schema:referenceSchema.manifest()?.source,scope:"Loaded GameData XML, supported Galaxy catalog calls, GUI gamelinks and Objects v27",coverage:"PARTIAL",issues:coverageIssues.slice(issueOffset,issueOffset+issueLimit),issuePagination:{total:coverageIssues.length,offset:issueOffset,truncated:issueOffset+issueLimit<coverageIssues.length,next:issueOffset+issueLimit<coverageIssues.length?issueOffset+issueLimit:null},total:all.length,items:all.slice(offset,offset+limit),truncated:offset+limit<all.length,next:offset+limit<all.length?offset+limit:null};
  }

  async resolveFields(args: {id:string;domain:string;fields?:string[]}) {
    const context = await this.context({ids:[args.id],domains:[args.domain],fields:args.fields,includeReferences:false});
    return {objects:context.objects.filter(o=>o.id===args.id&&o.domain===args.domain).map(o=>({id:o.id,domain:o.domain,file:o.file,layer:o.layer,declarationKey:o.declarationKey,effective:o.effective})),coverage:"PARTIAL",scope:"Loaded declarations and available parents; unresolved runtime layer rules remain explicit"};
  }

  async query(args: { text?: string; ids?: string[]; ctypes?: string[]; domains?: string[]; field?: string; link?: string; parent?: string; invalidOnly?: boolean; includeDependencies?: boolean; offset?:number;limit?: number }) {
    const context = await this.context({ text:args.text,parent:args.parent,link:args.link,offset:args.offset,ids: args.ids, ctypes: args.ctypes, domains: args.domains, fields: args.field ? [args.field] : undefined, includeDependencies: args.includeDependencies, includeReferences: true, includeInherited: false, limit: args.limit ?? 200 });
    const needle = args.text?.toLowerCase();
    const objects = context.objects.filter((object) =>
      (!needle || object.id?.toLowerCase().includes(needle) || object.ctype.toLowerCase().includes(needle)) &&
      (!args.parent || object.parent?.toLowerCase() === args.parent.toLowerCase()) &&
      (!args.link || this.flattened([object]).some((field) => field.link === args.link) || context.references?.some(reference=>reference.file===object.file&&reference.object===`${object.ctype}:${object.id}`&&reference.value===args.link)),
    );
    const diagnostics = args.invalidOnly ? (await this.validate()).diagnostics.filter((entry) => entry.severity !== "info") : undefined;
    return { objects,pagination:context.pagination,referencePagination:context.referencePagination,coverageIssues:context.coverageIssues, references: context.references?.filter((reference) => !args.link || reference.value.toLowerCase() === args.link.toLowerCase()), diagnostics };
  }

  async describeType(ctype?: string) {
    const records = await this.catalog();
    const objects = records.flatMap((record) => record.document.objects().map((object) => ({ ...object, layer: record.layer, provenance: record.provenance })));
    return this.schema.describe(ctype, objects);
  }

  async unitMetrics(id: string): Promise<{ minerals?: number; vespene?: number; supply?: number; provenance: string[] } | undefined> {
    const records = await this.catalog();
    const all = records.flatMap((record) => record.document.objects().map((object) => ({ ...object, file: record.file, layer: record.layer, provenance: record.provenance,engineActive:record.engineActive })));
    const unit = all.find((object) => object.domain === "Unit" && object.id?.toLowerCase() === id.toLowerCase());
    if (!unit) return undefined;
    const effective = this.effective(unit, all);
    const numberAt = (...paths: string[]) => {
      for (const fieldPath of paths) {
        const value = effective.fields[fieldPath]?.value;
        if (value !== undefined && Number.isFinite(Number(value))) return Number(value);
      }
      return undefined;
    };
    return {
      minerals: numberAt("CostResource[Minerals]", "Cost[Minerals]", "Minerals"),
      vespene: numberAt("CostResource[Vespene]", "CostResource[Gas]", "Cost[Vespene]", "Vespene"),
      supply: numberAt("Food", "Supply"),
      provenance: unit.provenance,
    };
  }

  async batch(request:{changes:Array<{file:string;operations:DataOperation[]}>;componentListFile?:string;gameDataIndexFile?:string;dryRun?:boolean;stage?:boolean;backup?:boolean;expectedSha256?:Record<string,string>}){
    return this.workspace.withReadSet(async()=>{
      if(!request.changes.length||request.changes.length>48)throw new Error('DATA_BATCH_FILE_LIMIT');
      if(request.changes.reduce((n,c)=>n+c.operations.length,0)>500)throw new Error('DATA_BATCH_OPERATION_LIMIT');
      const targets=request.changes.map(c=>normalize(c.file));
      if(new Set(targets).size!==targets.length)throw new Error('DATA_BATCH_DUPLICATE_FILE');
      for(const target of targets)if(!/(?:^|\/)GameData\/[^/]+\.xml$/i.test(target))throw new Error('DATA_BATCH_CATALOG_PATH_REQUIRED: '+target);
      const component=normalize(request.componentListFile??'ComponentList.SC2Components'),index=normalize(request.gameDataIndexFile??'Base.SC2Data/GameData.xml');
      const files=this.workspace.coupledDraftFiles([...targets,component,index]);
      if(files.length>64)throw new Error('DATA_BATCH_FILE_LIMIT');
      const aliases=new Map<string,{file:string;key:string;id:string}>(),applied:Array<{file:string;op:string;target:string}>=[];
      const futureAliases=new Map<string,string>();
      for(const group of request.changes)for(const op of group.operations)if('as' in op&&op.as){
        if(futureAliases.has(op.as))throw new Error('DATA_BATCH_ALIAS_DUPLICATE: '+op.as);
        if(op.op==='object.create'||op.op==='object.clone')futureAliases.set(op.as,op.id);
      }
      let verdicts:Array<{file:string;authoring:DataAuthoringVerdict}>=[],validation:DataValidationReport|undefined;
      const transaction=await this.workspace.applyRawTransaction(files,async sources=>{
        const next=new Map(sources),original=new Map(targets.map(file=>[file,sources.get(file)?new DataDocument(sources.get(file)!,file):DataDocument.create(file)])),docs=new Map(targets.map(file=>[file,sources.get(file)?new DataDocument(sources.get(file)!,file):DataDocument.create(file)]));
        const resolveAlias=(value:string)=>value.startsWith('@')?(aliases.get(value.slice(1))?.id??futureAliases.get(value.slice(1))??(()=>{throw new Error('DATA_BATCH_ALIAS_UNKNOWN: '+value)})()):value;
        const resolveFields=(fields:DataNativeFieldSpec[]):DataNativeFieldSpec[]=>fields.map(f=>({...f,value:typeof f.value==='string'?resolveAlias(f.value):f.value,link:f.link?resolveAlias(f.link):undefined,children:f.children?resolveFields(f.children):undefined}));
        for(let i=0;i<request.changes.length;i++){
          const file=targets[i],doc=docs.get(file)!;
          for(const operation of request.changes[i].operations){
            const selector='object' in operation?selectorAlias(operation.object,new Map([...aliases].filter(([,v])=>v.file===file).map(([name,v])=>[name,v.key]))):undefined;
            let target:string;
            switch(operation.op){
              case 'object.create': {const node=doc.createObject(operation.ctype,operation.id,{...operation,fields:operation.fields?resolveFields(operation.fields):undefined});target=doc.objectKey(node);break;}
              case 'object.clone': {const node=doc.cloneObject(selector!,operation.id,operation.parent);target=doc.objectKey(node);break;}
              case 'object.setParent': doc.setParent(selector!,operation.parent?resolveAlias(operation.parent):undefined);target=doc.objectKey(doc.resolve(selector!));break;
              case 'object.setAttribute': doc.setObjectAttribute(selector!,operation.attribute,operation.value);target=doc.objectKey(doc.resolve(selector!));break;
              case 'object.removeAttribute': doc.removeObjectAttribute(selector!,operation.attribute);target=doc.objectKey(doc.resolve(selector!));break;
              case 'field.set': doc.setField(selector!,operation.path,'value',typeof operation.value==='string'?resolveAlias(operation.value):operation.value);target=doc.objectKey(doc.resolve(selector!));break;
              case 'field.setLink': doc.setField(selector!,operation.path,'Link',resolveAlias(operation.link));target=doc.objectKey(doc.resolve(selector!));break;
              case 'field.setAttribute': doc.setField(selector!,operation.path,operation.attribute,typeof operation.value==='string'?resolveAlias(operation.value):operation.value);target=doc.objectKey(doc.resolve(selector!));break;
              case 'field.removeAttribute': doc.removeFieldAttribute(selector!,operation.path,operation.attribute);target=doc.objectKey(doc.resolve(selector!));break;
              case 'field.remove': doc.removeField(selector!,operation.path);target=doc.objectKey(doc.resolve(selector!));break;
              case 'array.append': doc.appendArray(selector!,operation.path,{...operation,value:typeof operation.value==='string'?resolveAlias(operation.value):operation.value,link:operation.link?resolveAlias(operation.link):undefined});target=doc.objectKey(doc.resolve(selector!));break;
              case 'native.add': doc.addNative(selector!,operation.parentPath,resolveFields([operation.field])[0]);target=doc.objectKey(doc.resolve(selector!));break;
              default:throw new Error('DATA_BATCH_OPERATION_UNSUPPORTED: '+operation.op);
            }
            if('as' in operation&&operation.as){if(aliases.has(operation.as))throw new Error('DATA_BATCH_ALIAS_DUPLICATE: '+operation.as);const object=doc.resolve(target);aliases.set(operation.as,{file,key:target,id:object.attrs.id});}
            applied.push({file,op:operation.op,target});
          }
          next.set(file,doc.source);
        }
        next.set(component,componentListWithGameData(next.get(component)??''));
        let include=next.get(index)??'';
        for(const file of targets)include=gameDataIndexWithCatalog(include,file);
        next.set(index,include);
        const records=await this.catalog(next);
        for(const file of targets)if(!records.some(r=>r.layer==='workspace'&&r.file===file))records.push({file,absolute:this.workspace.resolveUserPath(file),layer:'workspace',provenance:['workspace'],document:docs.get(file)!});
        validation=validateDataDocuments(targets[0],records,this.schema,this.references(records));
        verdicts=targets.map(file=>({file,authoring:validateDataAuthoring(file,original.get(file)!,docs.get(file)!,records,records.issues)}));
        const rejected=verdicts.find(v=>!v.authoring.accepted);
        if(rejected)throw new DataAuthoringError(rejected.authoring);
        if(!validation.valid)throw new Error('DATA_BATCH_VALIDATION_FAILED: '+validation.diagnostics.filter(d=>d.severity==='error').slice(0,5).map(d=>d.code+' '+d.path).join('; '));
        for(const [file,text] of next)if(targets.includes(file)||file===component||file===index)if(scanXml(text).diagnostics.some(d=>d.severity==='error'))throw new Error('DATA_BATCH_XML_INVALID: '+file);
        return next;
      },{dryRun:request.dryRun??true,stage:request.stage??true,backup:request.backup??true,expectedSha256:request.expectedSha256,summary:'Strict multi-catalog Data batch'});
      return {...transaction,aliases:Object.fromEntries([...aliases].map(([name,v])=>['@'+name,v])),applied,validation,authoring:verdicts,editor:'NOT_RUN',runtime:'NOT_RUN'};
    });
  }

  private async planFingerprint() {
    const records=await this.catalog(),cross=await this.crossReferences();
    const info=(await this.workspace.readRaw('DocumentInfo')).text;
    const material={roots:this.extraRoots,info,records:records.map(r=>[r.file,r.layer,r.engineActive,r.dependencyAvailability,createHash('sha256').update(r.document.source).digest('hex')]),issues:records.issues,cross:cross.references.map(r=>[r.file,r.path,r.value,r.targetDomain,r.resolution]),consumerFiles:cross.files,crossIssues:cross.issues,schema:referenceSchema.manifest()?.source};
    return createHash('sha256').update(JSON.stringify(material)).digest('hex');
  }

  async plan(request:Parameters<DataWorkspace["applyTracked"]>[0]) {
    const before=await this.planFingerprint();
    const preview=await this.apply({...request,dryRun:true,authoringPolicy:'strict',validate:true,allowInvalid:false});
    const after=await this.planFingerprint();
    if(before!==after)throw new Error('STALE_DATA_PLAN_DURING_PREVIEW');
    const normalized={...request,authoringPolicy:'strict' as const,validate:true,allowInvalid:false};
    const planId=createHash('sha256').update(JSON.stringify({request:normalized,fingerprint:after,preview:preview.files})).digest('hex');
    this.plans.set(planId,{request:normalized,fingerprint:after,schemaSources:referenceSchema.sources()});
    while(this.plans.size>64)this.plans.delete(this.plans.keys().next().value!);
    return {planId,fingerprint:after,files:preview.files,applied:preview.applied,aliases:preview.aliases,validation:preview.validation,authoring:preview.authoring,readyToApply:preview.authoring.accepted,policy:'strict',editor:'NOT_RUN',runtime:'NOT_RUN'};
  }

  async applyPlan(planId:string,dryRun=true,stage=true){
    const plan=this.plans.get(planId);if(!plan)throw new Error('DATA_PLAN_NOT_FOUND');
    if(await this.planFingerprint()!==plan.fingerprint)throw new Error('STALE_DATA_PLAN');
    for(const schema of plan.schemaSources){const source=await this.workspace.readDependency(schema.file);if(createHash('sha256').update(source).digest('hex')!==schema.sha256)throw new Error('STALE_DATA_PLAN_SCHEMA');}
    const result=await this.apply({...plan.request,dryRun,stage});
    if(!dryRun)this.plans.delete(planId);
    return {...result,planId};
  }

  async apply(request: Parameters<DataWorkspace["applyTracked"]>[0]) { return this.workspace.withReadSet(() => this.applyTracked(request)); }
  private async applyTracked(request: { file?: string; componentListFile?: string; gameDataIndexFile?: string; referenceFiles?: string[]; operations: DataOperation[]; dryRun?: boolean; stage?: boolean; backup?: boolean; validate?: boolean; allowInvalid?: boolean; expectedSha256?: Record<string, string>; authoringPolicy?: "strict" | "compatibility" }) {
    if (!request.operations.length) throw new Error("data.apply requires at least one operation");
    if (request.operations.length > 500) throw new Error("data.apply accepts at most 500 operations");
    const targetFile = normalize(request.file ?? "Base.SC2Data/GameData/UnitData.xml");
    const componentFile = normalize(request.componentListFile ?? "ComponentList.SC2Components");
    const indexFile = normalize(request.gameDataIndexFile ?? "Base.SC2Data/GameData.xml");
    const records = await this.catalog();
    const cross = await this.crossReferences();cross.issues.push(...this.actorIssues(records));
    const allReferences = [...this.references(records),...cross.references];
    for(const schema of referenceSchema.sources()){const source=await this.workspace.readDependency(schema.file);if(createHash('sha256').update(source).digest('hex')!==schema.sha256)throw new Error('STALE_DATA_SCHEMA_TRANSACTION');}
    const referenceFiles = new Set((request.referenceFiles ?? []).map(normalize));
    for (const operation of request.operations) {
      if (operation.op !== "object.rename" && operation.op !== "object.delete") continue;
      if (typeof operation.object === "string" && operation.object.startsWith("@")) continue;
      const opened = await this.open(targetFile);
      const node = opened.document.resolve(operation.object);
      const oldId = node.attrs.id;
      if (!oldId) continue;
      const domain=dataDomainFromType(node.tag);
      if(!referenceSchema.manifest())throw new Error("DATA_SCHEMA_UNAVAILABLE");
      if(allReferences.some(ref=>ref.resolution==="unknown"&&(!ref.targetDomain||ref.targetDomain===domain)))throw new Error("DATA_REFERENCE_COVERAGE_UNKNOWN: unresolved token reference in affected domain");
      if(records.issues.length)throw new Error("DATA_REFERENCE_COVERAGE_UNKNOWN: unreadable or malformed catalog: "+records.issues[0].file);
      if(cross.issues.some(issue=>!issue.targetDomain||issue.targetDomain===domain))throw new Error("DATA_REFERENCE_COVERAGE_UNKNOWN: dynamic consumer in affected domain");
      if(operation.op==='object.rename'&&allReferences.some(ref=>ref.value===oldId&&(!ref.targetDomain||ref.targetDomain===domain)&&ref.rewritePolicy==='readOnly'))throw new Error('DATA_REFERENCE_REWRITE_UNSUPPORTED: inherited token context requires local field materialization');
      if(cross.references.some(ref=>ref.value===oldId&&ref.targetDomain===domain&&ref.rewrite==="readOnly")&&operation.op==="object.rename")throw new Error("DATA_REFERENCE_REWRITE_UNSUPPORTED: computed or embedded script consumer");
      const incoming = allReferences.filter((reference) => reference.value === oldId && (!reference.targetDomain || reference.targetDomain === dataDomainFromType(node.tag)) && reference.file !== targetFile);
      if (incoming.length && operation.op === "object.rename" && !operation.updateReferences) throw new Error(`Data object '${oldId}' has ${incoming.length} incoming reference(s); set updateReferences=true`);
      if (incoming.length && operation.op === "object.delete" && !operation.force) throw new Error(`Data object '${oldId}' has ${incoming.length} incoming reference(s); delete is blocked unless force=true`);
      if (operation.op === "object.rename" && operation.updateReferences) for (const reference of incoming) if (records.some((record) => record.layer === "workspace" && record.file === reference.file) || cross.references.some(ref=>ref.file===reference.file)) referenceFiles.add(reference.file);
    }
    const files = this.workspace.coupledDraftFiles([targetFile, componentFile, indexFile, ...referenceFiles]);
    if (files.length > 64) throw new Error(`Atomic Data rename touches ${files.length} files; narrow referenceFiles to at most 61 catalog files`);
    let validation: DataValidationReport | undefined;
    let authoring: DataAuthoringVerdict | undefined;
    let aliases: Record<string, string> = {};
    let applied: Array<{ index: number; op: string; target?: string }> = [];
    const transaction = await this.workspace.applyRawTransaction(files, async (sources) => {
      const next = new Map(sources);
      const originalDocument = sources.get(targetFile) ? new DataDocument(sources.get(targetFile)!, targetFile) : DataDocument.create(targetFile);
      const document = sources.get(targetFile) ? new DataDocument(sources.get(targetFile)!, targetFile) : DataDocument.create(targetFile);
      const liveGraph=()=>{const live=records.map(record=>record.layer==='workspace'?{...record,document:record.file===targetFile?document:next.has(record.file)?new DataDocument(next.get(record.file)!,record.file):record.document}:record);if(!live.some(r=>r.layer==='workspace'&&r.file===targetFile))live.push({file:targetFile,absolute:this.workspace.resolveUserPath(targetFile),layer:'workspace',provenance:['workspace'],document});const refs=[...this.references(live),...cross.references.filter(r=>!next.has(r.file))];for(const [file,text]of next){const result=/\.galaxy$/i.test(file)?galaxyReferences(file,text):file==='Triggers'?guiReferences(file,text):file==='Objects'?objectReferences(file,text):undefined;if(result)refs.push(...result.references);}return {references:refs,issues:this.actorIssues(live)};};
      const aliasMap = new Map<string, string>();
      applied = [];
      for (let index = 0; index < request.operations.length; index++) {
        const operation = request.operations[index];
        let target: string | undefined;
        switch (operation.op) {
          case "object.create": { const node = document.createObject(operation.ctype, operation.id, operation); target = document.objectKey(node); break; }
          case "object.clone": { const node = document.cloneObject(selectorAlias(operation.object, aliasMap), operation.id, operation.parent); target = document.objectKey(node); break; }
          case "object.rename": {
            const live=liveGraph(),currentReferences=live.references;
            const selector = selectorAlias(operation.object, aliasMap);
            const before = document.resolve(selector);
            const beforeId = before.attrs.id;
            if (!beforeId) throw new Error(`Cannot rename ${document.objectKey(before)} without id`);
            if(records.issues.length||currentReferences.some(ref=>ref.resolution==='unknown'&&(!ref.targetDomain||ref.targetDomain===dataDomainFromType(before.tag))))throw new Error('DATA_REFERENCE_COVERAGE_UNKNOWN');
            if([...cross.issues,...live.issues].some(issue=>!issue.targetDomain||issue.targetDomain===dataDomainFromType(before.tag)))throw new Error("DATA_REFERENCE_COVERAGE_UNKNOWN");
            if(currentReferences.some(ref=>ref.value===beforeId&&(!ref.targetDomain||ref.targetDomain===dataDomainFromType(before.tag))&&ref.rewritePolicy==='readOnly'))throw new Error('DATA_REFERENCE_REWRITE_UNSUPPORTED: inherited token context');
            const externalIncoming=currentReferences.filter(ref=>ref.file!==targetFile&&ref.value===beforeId&&(!ref.targetDomain||ref.targetDomain===dataDomainFromType(before.tag)));
            if(externalIncoming.length&&!operation.updateReferences)throw new Error("Data object has incoming reference(s); set updateReferences=true");
            if(externalIncoming.some(ref=>!referenceFiles.has(ref.file)))throw new Error("DATA_REFERENCE_BATCH_SCOPE_UNRESOLVED");
            if(cross.references.some(ref=>ref.value===beforeId&&ref.targetDomain===dataDomainFromType(before.tag)&&ref.rewrite==="readOnly"))throw new Error("DATA_REFERENCE_REWRITE_UNSUPPORTED");
            const internalIncoming = currentReferences.filter(r=>r.file===targetFile).filter((reference) => reference.value === beforeId && (!reference.targetDomain || reference.targetDomain === dataDomainFromType(before.tag)) && reference.object !== document.objectKey(before));
            if (internalIncoming.length && !operation.updateReferences) throw new Error(`Data object '${beforeId}' has ${internalIncoming.length} incoming reference(s); set updateReferences=true`);
            const candidateDomains = new Set([
              ...records.flatMap((record) => record.document.objects()).filter((object) => object.id === beforeId).map((object) => object.domain ?? object.ctype),
              ...document.objects().filter((object) => object.id === beforeId).map((object) => object.domain ?? object.ctype),
            ]);
            const hasLinkReferences = internalIncoming.some((reference) => reference.carrier === "Link") || currentReferences.some((reference) => reference.value === beforeId && reference.carrier === "Link");
            if (operation.updateReferences && hasLinkReferences && candidateDomains.size > 1) throw new Error(`Cannot safely rename ambiguous catalog id '${beforeId}': native Link references exist and the id occurs in ${candidateDomains.size} domains`);
            const result = document.renameObject(selector, operation.newId);
            if (operation.updateReferences) {
              document.patchReferences(result.oldId, operation.newId, result.domain,true,entry=>this.referenceTokens([...records.filter(r=>r.file!==targetFile).flatMap(r=>r.document.objects()),...document.objects()],entry.tag,entry.attrs.id));
              for (const file of referenceFiles) {
                if (file === targetFile) continue;
                const currentExternal=/\.galaxy$/i.test(file)?galaxyReferences(file,next.get(file)!).references:file==="Triggers"?guiReferences(file,next.get(file)!).references:file==="Objects"?objectReferences(file,next.get(file)!).references:[];
                const external=currentExternal.filter(ref=>ref.value===result.oldId&&ref.targetDomain===result.domain);
                if(external.length){let text=next.get(file)!;for(const ref of external.sort((a,b)=>b.sourceSpan!.start-a.sourceSpan!.start)){const span=ref.sourceSpan!;const replacement=ref.rewrite==="galaxyLiteral"?JSON.stringify(operation.newId):operation.newId.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");text=text.slice(0,span.start)+replacement+text.slice(span.end);}next.set(file,text);continue;}
                const referenced = new DataDocument(next.get(file) ?? "", file);
                referenced.patchReferences(result.oldId, operation.newId, result.domain,true,entry=>this.referenceTokens([...records.filter(r=>r.file!==file).flatMap(r=>r.document.objects()),...referenced.objects()],entry.tag,entry.attrs.id));
                next.set(file, referenced.source);
              }
            }
            target = `${result.ctype}:${operation.newId}`;for(const [alias,value]of aliasMap)if(value===`${result.ctype}:${result.oldId}`)aliasMap.set(alias,target); break;
          }
          case "object.delete": {
            const live=liveGraph(),currentReferences=live.references;
            const selector = selectorAlias(operation.object, aliasMap); const node = document.resolve(selector); target = document.objectKey(node);
            if(records.issues.length||currentReferences.some(ref=>ref.resolution==='unknown'&&(!ref.targetDomain||ref.targetDomain===dataDomainFromType(node.tag))))throw new Error('DATA_REFERENCE_COVERAGE_UNKNOWN');
            if([...cross.issues,...live.issues].some(issue=>!issue.targetDomain||issue.targetDomain===dataDomainFromType(node.tag)))throw new Error("DATA_REFERENCE_COVERAGE_UNKNOWN");
            const externalIncoming=currentReferences.filter(ref=>ref.file!==targetFile&&ref.value===node.attrs.id&&(!ref.targetDomain||ref.targetDomain===dataDomainFromType(node.tag)));
            if(externalIncoming.length&&!operation.force)throw new Error("Data object has incoming reference(s); delete blocked");
            const id = node.attrs.id; const incoming = id ? currentReferences.filter(r=>r.file===targetFile).filter((reference) => reference.value === id && (!reference.targetDomain || reference.targetDomain === dataDomainFromType(node.tag)) && reference.object !== target) : [];
            if (incoming.length && !operation.force) throw new Error(`Data object '${id}' has ${incoming.length} incoming reference(s); delete is blocked unless force=true`);
            document.removeObject(selector); break;
          }
          case "object.setParent": { const selector = selectorAlias(operation.object, aliasMap); document.setParent(selector, operation.parent); target = document.objectKey(document.resolve(selector)); break; }
          case "object.setAttribute": { const selector = selectorAlias(operation.object, aliasMap); document.setObjectAttribute(selector, operation.attribute, operation.value); target = `${document.objectKey(document.resolve(selector))}@${operation.attribute}`; break; }
          case "object.removeAttribute": { const selector = selectorAlias(operation.object, aliasMap); document.removeObjectAttribute(selector, operation.attribute); target = `${document.objectKey(document.resolve(selector))}@${operation.attribute}`; break; }
          case "field.set": { const selector = selectorAlias(operation.object, aliasMap); document.setField(selector, operation.path, "value", operation.value); target = `${document.objectKey(document.resolve(selector))}.${operation.path}`; break; }
          case "field.setLink": { const selector = selectorAlias(operation.object, aliasMap); document.setField(selector, operation.path, "Link", operation.link); target = `${document.objectKey(document.resolve(selector))}.${operation.path}`; break; }
          case "field.setAttribute": { const selector = selectorAlias(operation.object, aliasMap); document.setField(selector, operation.path, operation.attribute, operation.value); target = `${document.objectKey(document.resolve(selector))}.${operation.path}@${operation.attribute}`; break; }
          case "field.removeAttribute": { const selector = selectorAlias(operation.object, aliasMap); document.removeFieldAttribute(selector, operation.path, operation.attribute); target = `${document.objectKey(document.resolve(selector))}.${operation.path}@${operation.attribute}`; break; }
          case "field.remove": { const selector = selectorAlias(operation.object, aliasMap); document.removeField(selector, operation.path); target = `${document.objectKey(document.resolve(selector))}.${operation.path}`; break; }
          case "array.append": { const selector = selectorAlias(operation.object, aliasMap); const added = document.appendArray(selector, operation.path, operation); target = `${document.objectKey(document.resolve(selector))}.${added}`; break; }
          case "native.add": { const selector = selectorAlias(operation.object, aliasMap); document.addNative(selector, operation.parentPath, operation.field); target = `${document.objectKey(document.resolve(selector))}.${operation.field.name}`; break; }
          case "recipe.weaponBurn": {
            const damageId = `${operation.id}PeriodicDamage`;
            const applyId = `${operation.id}Apply`;
            const setId = `${operation.id}HitSet`;
            const visualId = `${operation.id}Visual`;
            document.createObject("CEffectDamage", damageId, { fields: recipeFields(
              ...(operation.editorCategories ? [{ name: "EditorCategories", value: operation.editorCategories }] : []),
              ...(operation.damageKind ? [{ name: "Kind", value: operation.damageKind }] : []),
              { name: "Amount", value: operation.periodicDamage },
            ) });
            document.createObject("CBehaviorBuff", operation.id, { fields: recipeFields(
              ...(operation.alignment ? [{ name: "Alignment", value: operation.alignment }] : []),
              { name: "Duration", value: operation.duration },
              { name: "Period", value: operation.period },
              { name: "PeriodicEffect", value: damageId },
              { name: "BuffFlags", index: "RefreshStack", value: true },
              { name: "MaxStackCount", value: 1 },
            ) });
            document.createObject("CEffectApplyBehavior", applyId, { fields: recipeFields({ name: "Behavior", value: operation.id }) });
            document.createObject("CEffectSet", setId, { fields: recipeFields(
              { name: "EffectArray", index: 0, value: operation.impactEffect },
              { name: "EffectArray", index: 1, value: applyId },
            ) });
            document.createObject("CActorModel", visualId, { parent: "ModelAnimationStyleOneShot", fields: recipeFields(
              { name: "Model", value: operation.visualModel },
              { name: "Host", attrs: { Subject: "_Unit" } },
              { name: "HostSiteOps", attrs: { Ops: operation.attachSite ?? "SOpAttachHead" } },
              { name: "On", attrs: { Terms: `Effect.${damageId}.Start; At Target`, Send: "Create" } },
            ) });
            const carrierSelector = { id: operation.carrierEffect, ctype: operation.carrierCtype ?? "CEffectCreatePersistent" };
            try { document.resolve(carrierSelector); }
            catch { document.createObject(carrierSelector.ctype, carrierSelector.id); }
            document.setField(carrierSelector, operation.carrierPath ?? "PeriodicEffectArray[0]", "value", setId);
            target = `CBehaviorBuff:${operation.id}`;
            break;
          }
          case "recipe.unitTextureByVital": {
            const validatorId = `${operation.id}LifeBelow`;
            const monitorId = `${operation.id}Monitor`;
            const healthyIds: string[] = [];
            const damagedIds: string[] = [];
            operation.textures.forEach((texture, textureIndex) => {
              const healthyId = `${operation.id}HealthyTexture${textureIndex}`;
              const damagedId = `${operation.id}DamagedTexture${textureIndex}`;
              healthyIds.push(healthyId); damagedIds.push(damagedId);
              document.createObject("CTexture", healthyId, { fields: recipeFields(
                { name: "File", value: texture.healthyFile }, { name: "Slot", value: texture.slot },
              ) });
              document.createObject("CTexture", damagedId, { fields: recipeFields(
                { name: "File", value: texture.damagedFile }, { name: "Slot", value: texture.slot },
              ) });
            });
            document.createObject("CValidatorUnitCompareVital", validatorId, { parent: "CasterLifePercent", fields: recipeFields(
              { name: "Compare", value: "LT" }, { name: "Value", value: operation.threshold },
            ) });
            const events = recipeFields(
              { name: "On", attrs: { Terms: `UnitCreation.${operation.unit}`, Send: "Create" } },
              ...healthyIds.map((textureId) => ({ name: "On", attrs: { Terms: "StateChange; StateValid Healthy", Target: "_Unit", Send: `TextureSelectById ${textureId}` } })),
              ...damagedIds.map((textureId) => ({ name: "On", attrs: { Terms: "StateChange; StateValid Damaged", Target: "_Unit", Send: `TextureSelectById ${textureId}` } })),
              { name: "StateThinkInterval", value: operation.pollInterval ?? 0.5 },
              { name: "StateArray", attrs: { Name: "Healthy", Terms: `!ValidateUnit ${validatorId}` } },
              { name: "StateArray", attrs: { Name: "Damaged", Terms: `ValidateUnit ${validatorId}` } },
            );
            document.createObject("CActorStateMonitor", monitorId, { fields: events });
            target = `CActorStateMonitor:${monitorId}`;
            break;
          }
        }
        if ("as" in operation && operation.as) {
          if (!target) throw new Error(`Operation ${index} did not produce an alias target`);
          const objectTarget = target.split(".", 1)[0]; aliasMap.set(operation.as, objectTarget);
        }
        applied.push({ index, op: operation.op, target });
      }
      next.set(targetFile, document.source);
      next.set(componentFile, componentListWithGameData(next.get(componentFile) ?? ""));
      next.set(indexFile, gameDataIndexWithCatalog(next.get(indexFile) ?? "", targetFile));
      if ((request.validate ?? true) || request.authoringPolicy !== "compatibility") {
        const validationRecords = await this.catalog(next);
        if (!validationRecords.some((record) => record.layer === "workspace" && record.file === targetFile)) validationRecords.unshift({ file: targetFile, absolute: this.workspace.resolveUserPath(targetFile), layer: "workspace", provenance: ["workspace"], document });
        validation = validateDataDocuments(targetFile, validationRecords, this.schema,this.references(validationRecords));
        authoring = validateDataAuthoring(targetFile, originalDocument, document, validationRecords, validationRecords.issues);
        if (request.authoringPolicy !== "compatibility" && !authoring.accepted) throw new DataAuthoringError(authoring);
        if (!validation.valid && !request.allowInvalid) throw new Error(`Data validation failed with ${validation.errors} error(s): ${validation.diagnostics.filter((entry) => entry.severity === "error").slice(0, 5).map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`);
      }
      for(const [file,text] of next)if(file===targetFile||file===componentFile||file===indexFile||/\.xml$/i.test(file)||file==='Triggers'||file==='Objects')if(scanXml(text).diagnostics.some(d=>d.severity==='error'))throw new Error('DATA_XML_INVALID: '+file);
      for(const schema of referenceSchema.sources()){const source=await this.workspace.readDependency(schema.file);if(createHash('sha256').update(source).digest('hex')!==schema.sha256)throw new Error('STALE_DATA_SCHEMA_TRANSACTION');}
      aliases = Object.fromEntries([...aliasMap].map(([name, value]) => [`@${name}`, value]));
      return next;
    }, { dryRun: request.dryRun ?? true, stage: request.stage ?? true, backup: request.backup ?? true, expectedSha256: request.expectedSha256, summary: `Apply ${request.operations.length} Data operations atomically` });
    const nativeMutations = request.operations.reduce((total, operation) => total + (operation.op === "recipe.weaponBurn" ? 6 : operation.op === "recipe.unitTextureByVital" ? operation.textures.length * 2 + 2 : 1), 0);
    return { ...transaction, applied, aliases, validation, authoring: authoring ? {...authoring,executionPolicy:request.authoringPolicy === "compatibility"?"COMPATIBILITY":"STRICT"} : {status:"INCOMPLETE",accepted:false,parse:"PASS",completeness:"INCOMPLETE",executionPolicy:"COMPATIBILITY",staticValidation:"INCOMPLETE",editor:"NOT_RUN",runtime:"NOT_RUN",diagnostics:[],scope:"Authoring validation disabled"}, authoringPolicy: request.authoringPolicy ?? "strict",referenceCoverage:"PARTIAL",referenceScope:"Declared XSD XML carriers, supported actor selectors/messages, GUI gamelinks, Objects v27 and supported native Galaxy arguments within configured roots",excludedScope:["Unknown free-text/custom carriers","Unconfigured external consumers"], efficiency: { toolCalls: 1, operations: request.operations.length, nativeMutations, files: transaction.files.length, includesValidation: request.validate ?? true, includesDiff: true } };
  }

  async validate(file = "Base.SC2Data/GameData/UnitData.xml"): Promise<DataValidationReport> {
    const records = await this.catalog();
    if (!records.some((record) => record.layer === "workspace" && record.file === normalize(file))) {
      const opened = await this.open(file);
      records.unshift({ file: opened.file, absolute: opened.absolute, layer: "workspace", provenance: ["workspace"], document: opened.document });
    }
    return validateDataDocuments(normalize(file), records, this.schema,this.references(records));
  }
}
