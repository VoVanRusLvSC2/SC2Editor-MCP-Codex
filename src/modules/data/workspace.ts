import { internalWorkspaceDirectory } from "../../core/discoveryPaths.js";
import {catalogActivation} from "./activation.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Workspace } from "../../core/workspace.js";
import { scanXml } from "../../core/xmlScanner.js";
import { DataDocument } from "./document.js";
import { DataSchemaRegistry } from "./schemaRegistry.js";
import { validateDataDocuments } from "./validator.js";
import type { DataNativeFieldSpec, DataObject, DataObjectSelector, DataOperation, DataReference, DataValidationReport } from "./types.js";

const SKIP = new Set(["node_modules", "dist", "release", ".git", ".svn"]);

interface CatalogRecord { file: string; absolute: string; layer: "workspace" | "dependency"; provenance: string[]; document: DataDocument; engineActive?:boolean; activationMode?:string;activationWarnings?:string[] }

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

  private async discoverRoot(base: string, layer: "workspace" | "dependency", overrides?: ReadonlyMap<string, string>): Promise<CatalogRecord[]> {
    const files: CatalogRecord[] = [];
    const candidates=new Set<string>();
    const isCandidate=(file:string)=>/(?:^|\/)GameData\/.*\.xml$/i.test(file)||/Data\.xml$/i.test(path.basename(file));
    const visit=async(directory:string):Promise<void>=>{
      let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch{return;}
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
        const stat=await fs.stat(absolute).catch(()=>undefined);if(stat&&stat.size>64*1024*1024)continue;
        const source=layer==="workspace"&&overrides?.has(workspaceRelative)?overrides.get(workspaceRelative)!:layer==="workspace"?(await this.workspace.readRaw(workspaceRelative)).text:await this.workspace.readDependency(absolute);
        if(Buffer.byteLength(source)>64*1024*1024)continue;
        const parsed=scanXml(source);if(parsed.rootIds.some(id=>parsed.nodes[id].tag==="Catalog"))files.push({file:workspaceRelative,absolute,layer,provenance:layer==="workspace"?provenance(absolute):[path.basename(base),...provenance(absolute)],document:this.cachedDocument(absolute,source,workspaceRelative)});
      }catch(error){if(error instanceof Error&&error.message.startsWith("STALE_"))throw error;}
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

  async catalog(overrides?: ReadonlyMap<string, string>): Promise<CatalogRecord[]> {
    const records = await this.discoverRoot(this.workspace.root, "workspace", overrides);
    for (const root of this.extraRoots) records.push(...await this.discoverRoot(root, "dependency"));
    return records;
  }

  private flattened(objects: DataObject[]) {
    const output: Array<{ path: string; value?: string; link?: string; attrs: Record<string, string> }> = [];
    const visit = (fields: DataObject["fields"]) => { for (const field of fields) { output.push({ path: field.path, value: field.value, link: field.link, attrs: field.attrs }); visit(field.children); } };
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
      const key = `${current.domain ?? current.ctype}\0${current.id ?? ""}`.toLowerCase();
      if (visited.has(key)){unresolvedParents.push({id:current.id??"",reason:"PARENT_CYCLE"});break;}
      visited.add(key); chain.unshift(current);
      const parent:string|undefined=current.parent;
      const next:(DataObject & {file:string;layer:string;engineActive?:boolean})|undefined=parent ? parentIndex ? parentIndex.get(`${current.domain ?? current.ctype}\0${parent}`.toLowerCase()) : all.find(candidate=>candidate.engineActive!==false&&(object.engineActive!==true||candidate.engineActive===true)&&candidate.id?.toLowerCase()===parent.toLowerCase()&&(candidate.domain??candidate.ctype)===(current!.domain??current!.ctype)) : undefined;
      if(parent&&!next)unresolvedParents.push({id:parent,reason:object.engineActive===true?"ACTIVE_PARENT_UNRESOLVED":"PARENT_UNRESOLVED"});
      current=next;
    }
    const fields = new Map<string, { path: string; value?: string; link?: string; attrs: Record<string, string>; declaredBy?: string; file?: string }>();
    for (const entry of chain) for (const field of this.flattened([entry])) fields.set(field.path, { ...field, declaredBy: entry.id, file: entry.file });
    return { semanticCoverage:"PARTIAL" as const,resolutionScope:"Available catalog parents; native defaults/layer merge not implemented",unresolvedParents, templateChain: chain.map((entry) => ({ id: entry.id, ctype: entry.ctype, file: entry.file, layer: entry.layer })), fields: Object.fromEntries([...fields].map(([name, value]) => [name, value])) };
  }

  async context(args: { file?: string; ids?: string[]; ctypes?: string[]; domains?: string[]; fields?: string[]; includeRaw?: boolean; includeInherited?: boolean; includeDependencies?: boolean; includeReferences?: boolean; activeOnly?:boolean; limit?: number } = {}) {
    const records = await this.catalog();
    const requested = args.file ? normalize(args.file) : undefined;
    if (requested && !records.some((record) => record.layer === "workspace" && record.file === requested)) {
      const opened = await this.open(requested);
      if (opened.exists || opened.staged) records.unshift({ file: opened.file, absolute: opened.absolute, layer: "workspace", provenance: provenance(opened.absolute), document: opened.document });
    }
    const all = records.flatMap((record) => record.document.objects(args.includeRaw ?? false).map((object) => ({ ...object, file: record.file, layer: record.layer, provenance: record.provenance, engineActive:record.engineActive,activationMode:record.activationMode,recordKey: `${record.layer}:${record.absolute}` })));
    const ids = new Set((args.ids ?? []).map((value) => value.toLowerCase()));
    const ctypes = new Set((args.ctypes ?? []).map((value) => value.toLowerCase()));
    const domains = new Set((args.domains ?? []).map((value) => value.toLowerCase()));
    const needles = (args.fields ?? []).map((value) => value.toLowerCase());
    const filtered = all.filter((object) =>
      (!args.activeOnly || object.engineActive===true) &&
      (!requested || object.file === requested) &&
      (args.includeDependencies !== false || object.layer === "workspace") &&
      (!ids.size || (object.id && ids.has(object.id.toLowerCase()))) &&
      (!ctypes.size || ctypes.has(object.ctype.toLowerCase())) &&
      (!domains.size || (object.domain && domains.has(object.domain.toLowerCase()))),
    ).slice(0, args.limit ?? 200);
    const parentIndex=new Map<string,typeof all[number]>(),verifiedParents=new Map<string,typeof all[number]>();
    for(const object of all){const key=`${object.domain ?? object.ctype}\0${object.id ?? ""}`.toLowerCase();if(object.engineActive!==false&&!parentIndex.has(key))parentIndex.set(key,object);if(object.engineActive===true&&!verifiedParents.has(key))verifiedParents.set(key,object);}
    const objects = filtered.map((object) => {
      const publicObject: Omit<typeof object, "recordKey"> & { recordKey?: string } = { ...object };
      delete publicObject.recordKey;
      const effective = args.includeInherited === false ? undefined : this.effective(object, all,object.engineActive===true?verifiedParents:parentIndex);
      return {
        ...publicObject,
        fields: this.projectedFields(object.fields, needles),
        effective: effective ? { ...effective, fields: needles.length ? Object.fromEntries(Object.entries(effective.fields).filter(([fieldPath]) => needles.some((needle) => fieldPath.toLowerCase().includes(needle)))) : effective.fields } : undefined,
      };
    });
    const selective = Boolean(requested || ids.size || ctypes.size || domains.size || needles.length);
    const selectedRecordKeys = new Set(filtered.map((object) => object.recordKey));
    const selectedIds = new Set(filtered.flatMap((object) => object.id ? [object.id.toLowerCase()] : []));
    const selectedObjects = new Set(filtered.map((object) => `${object.ctype}:${object.id ?? ""}`.toLowerCase()));
    const allReferences = args.includeReferences === false ? undefined : this.references(records);
    const references = allReferences?.filter((reference) => !selective || selectedIds.has(reference.value.toLowerCase()) || selectedObjects.has(reference.object.toLowerCase())).slice(0, args.limit ?? 200);
    const visibleRecords = selective ? records.filter((record) => selectedRecordKeys.has(`${record.layer}:${record.absolute}`)) : records;
    return {
      files: visibleRecords.filter((record) => args.includeDependencies !== false || record.layer === "workspace").map((record) => ({ file: record.file, layer: record.layer, provenance: record.provenance, objects: record.document.entries().length, sha256: record.document.sha256,engineActive:record.engineActive,activationMode:record.activationMode,activationWarnings:record.activationWarnings })),
      corpusSummary: { files: records.length, objects: all.length, objectTypes: new Set(all.map((entry) => entry.ctype)).size },
      objects, references,
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

  references(records: CatalogRecord[]): DataReference[] {
    const objects = records.flatMap((record) => record.document.objects().map((object) => ({ ...object, file: record.file })));
    const byId = new Map<string, typeof objects>();
    for (const object of objects) if (object.id) byId.set(object.id.toLowerCase(), [...(byId.get(object.id.toLowerCase()) ?? []), object]);
    return records.flatMap((record) => record.document.references().map((reference) => {
      const targets = byId.get(reference.value.toLowerCase()) ?? [];
      const target = targets.length === 1 ? targets[0] : undefined;
      return { file: record.file, ...reference, targetDomain: target?.domain, targetType: target?.ctype, evidence: target ? "NATIVE_TYPED_ATTRIBUTE" as const : "TARGET_TYPE_UNRESOLVED" as const };
    }));
  }

  async query(args: { text?: string; ids?: string[]; ctypes?: string[]; domains?: string[]; field?: string; link?: string; parent?: string; invalidOnly?: boolean; includeDependencies?: boolean; limit?: number }) {
    const context = await this.context({ ids: args.ids, ctypes: args.ctypes, domains: args.domains, fields: args.field ? [args.field] : undefined, includeDependencies: args.includeDependencies, includeReferences: true, includeInherited: false, limit: args.limit ?? 200 });
    const needle = args.text?.toLowerCase();
    const objects = context.objects.filter((object) =>
      (!needle || object.id?.toLowerCase().includes(needle) || object.ctype.toLowerCase().includes(needle)) &&
      (!args.parent || object.parent?.toLowerCase() === args.parent.toLowerCase()) &&
      (!args.link || this.flattened([object]).some((field) => field.link?.toLowerCase() === args.link!.toLowerCase())),
    );
    const diagnostics = args.invalidOnly ? (await this.validate()).diagnostics.filter((entry) => entry.severity !== "info") : undefined;
    return { objects, references: context.references?.filter((reference) => !args.link || reference.value.toLowerCase() === args.link.toLowerCase()), diagnostics };
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

  async apply(request: Parameters<DataWorkspace["applyTracked"]>[0]) { return this.workspace.withReadSet(() => this.applyTracked(request)); }
  private async applyTracked(request: { file?: string; componentListFile?: string; gameDataIndexFile?: string; referenceFiles?: string[]; operations: DataOperation[]; dryRun?: boolean; stage?: boolean; backup?: boolean; validate?: boolean; allowInvalid?: boolean; expectedSha256?: Record<string, string> }) {
    if (!request.operations.length) throw new Error("data.apply requires at least one operation");
    if (request.operations.length > 500) throw new Error("data.apply accepts at most 500 operations");
    const targetFile = normalize(request.file ?? "Base.SC2Data/GameData/UnitData.xml");
    const componentFile = normalize(request.componentListFile ?? "ComponentList.SC2Components");
    const indexFile = normalize(request.gameDataIndexFile ?? "Base.SC2Data/GameData.xml");
    const records = await this.catalog();
    const allReferences = this.references(records);
    const referenceFiles = new Set((request.referenceFiles ?? []).map(normalize));
    for (const operation of request.operations) {
      if (operation.op !== "object.rename" && operation.op !== "object.delete") continue;
      if (typeof operation.object === "string" && operation.object.startsWith("@")) continue;
      const opened = await this.open(targetFile);
      const node = opened.document.resolve(operation.object);
      const oldId = node.attrs.id;
      if (!oldId) continue;
      const incoming = allReferences.filter((reference) => reference.value === oldId && reference.file !== targetFile);
      if (incoming.length && operation.op === "object.rename" && !operation.updateReferences) throw new Error(`Data object '${oldId}' has ${incoming.length} incoming reference(s); set updateReferences=true`);
      if (incoming.length && operation.op === "object.delete" && !operation.force) throw new Error(`Data object '${oldId}' has ${incoming.length} incoming reference(s); delete is blocked unless force=true`);
      if (operation.op === "object.rename" && operation.updateReferences) for (const reference of incoming) if (records.some((record) => record.layer === "workspace" && record.file === reference.file)) referenceFiles.add(reference.file);
    }
    const files = [...new Set([targetFile, componentFile, indexFile, ...referenceFiles])];
    if (files.length > 64) throw new Error(`Atomic Data rename touches ${files.length} files; narrow referenceFiles to at most 61 catalog files`);
    let validation: DataValidationReport | undefined;
    let aliases: Record<string, string> = {};
    let applied: Array<{ index: number; op: string; target?: string }> = [];
    const transaction = await this.workspace.applyRawTransaction(files, async (sources) => {
      const next = new Map(sources);
      const document = sources.get(targetFile) ? new DataDocument(sources.get(targetFile)!, targetFile) : DataDocument.create(targetFile);
      const aliasMap = new Map<string, string>();
      applied = [];
      for (let index = 0; index < request.operations.length; index++) {
        const operation = request.operations[index];
        let target: string | undefined;
        switch (operation.op) {
          case "object.create": { const node = document.createObject(operation.ctype, operation.id, operation); target = document.objectKey(node); break; }
          case "object.clone": { const node = document.cloneObject(selectorAlias(operation.object, aliasMap), operation.id, operation.parent); target = document.objectKey(node); break; }
          case "object.rename": {
            const selector = selectorAlias(operation.object, aliasMap);
            const before = document.resolve(selector);
            const beforeId = before.attrs.id;
            if (!beforeId) throw new Error(`Cannot rename ${document.objectKey(before)} without id`);
            const internalIncoming = document.references().filter((reference) => reference.value === beforeId && reference.object !== document.objectKey(before));
            if (internalIncoming.length && !operation.updateReferences) throw new Error(`Data object '${beforeId}' has ${internalIncoming.length} incoming reference(s); set updateReferences=true`);
            const candidateDomains = new Set([
              ...records.flatMap((record) => record.document.objects()).filter((object) => object.id === beforeId).map((object) => object.domain ?? object.ctype),
              ...document.objects().filter((object) => object.id === beforeId).map((object) => object.domain ?? object.ctype),
            ]);
            const hasLinkReferences = internalIncoming.some((reference) => reference.carrier === "Link") || allReferences.some((reference) => reference.value === beforeId && reference.carrier === "Link");
            if (operation.updateReferences && hasLinkReferences && candidateDomains.size > 1) throw new Error(`Cannot safely rename ambiguous catalog id '${beforeId}': native Link references exist and the id occurs in ${candidateDomains.size} domains`);
            const result = document.renameObject(selector, operation.newId);
            if (operation.updateReferences) {
              document.patchReferences(result.oldId, operation.newId, result.domain);
              for (const file of referenceFiles) {
                if (file === targetFile) continue;
                const referenced = new DataDocument(next.get(file) ?? "", file);
                referenced.patchReferences(result.oldId, operation.newId, result.domain);
                next.set(file, referenced.source);
              }
            }
            target = `${result.ctype}:${operation.newId}`; break;
          }
          case "object.delete": {
            const selector = selectorAlias(operation.object, aliasMap); const node = document.resolve(selector); target = document.objectKey(node);
            const id = node.attrs.id; const incoming = id ? document.references().filter((reference) => reference.value === id && reference.object !== target) : [];
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
      if (request.validate ?? true) {
        const validationRecords = await this.catalog(next);
        if (!validationRecords.some((record) => record.layer === "workspace" && record.file === targetFile)) validationRecords.unshift({ file: targetFile, absolute: this.workspace.resolveUserPath(targetFile), layer: "workspace", provenance: ["workspace"], document });
        validation = validateDataDocuments(targetFile, validationRecords, this.schema);
        if (!validation.valid && !request.allowInvalid) throw new Error(`Data validation failed with ${validation.errors} error(s): ${validation.diagnostics.filter((entry) => entry.severity === "error").slice(0, 5).map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`);
      }
      aliases = Object.fromEntries([...aliasMap].map(([name, value]) => [`@${name}`, value]));
      return next;
    }, { dryRun: request.dryRun ?? true, stage: request.stage ?? true, backup: request.backup ?? true, expectedSha256: request.expectedSha256, summary: `Apply ${request.operations.length} Data operations atomically` });
    const nativeMutations = request.operations.reduce((total, operation) => total + (operation.op === "recipe.weaponBurn" ? 6 : operation.op === "recipe.unitTextureByVital" ? operation.textures.length * 2 + 2 : 1), 0);
    return { ...transaction, applied, aliases, validation, efficiency: { toolCalls: 1, operations: request.operations.length, nativeMutations, files: transaction.files.length, includesValidation: request.validate ?? true, includesDiff: true } };
  }

  async validate(file = "Base.SC2Data/GameData/UnitData.xml"): Promise<DataValidationReport> {
    const records = await this.catalog();
    if (!records.some((record) => record.layer === "workspace" && record.file === normalize(file))) {
      const opened = await this.open(file);
      records.unshift({ file: opened.file, absolute: opened.absolute, layer: "workspace", provenance: ["workspace"], document: opened.document });
    }
    return validateDataDocuments(normalize(file), records, this.schema);
  }
}
