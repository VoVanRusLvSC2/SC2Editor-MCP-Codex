import {createHash} from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { projectPath } from "../../app/paths.js";

export interface DataXsdField {
  kind: "element" | "attribute";
  inlineType?: DataXsdType;
  namespace?: string;
  typeNamespace?: string;
  particle?: Array<{kind:string;minOccurs?:string;maxOccurs?:string}>;
  name?: string;
  ref?: string;
  refNamespace?:string;
  schemaSpan?:{start:number;end:number};
  type?: string;
  minOccurs?: string;
  maxOccurs?: string;
  use?: string;
  default?: string;
  fixed?: string;
}

export interface DataXsdType {
  name: string;
  namespace?:string;
  schemaSpan?:{start:number;end:number};
  kind: "complex" | "simple";
  base?: string;
  derivation?: "extension" | "restriction";
  baseNamespace?:string;
  issues?:Array<{construct:string;offset:number}>;
  abstract?: boolean;
  mixed?: boolean;
  fields: DataXsdField[];
  enumValues: string[];
  facets: Array<{ kind: string; value: string }>;
}

export interface DataXsdManifest {
  schemaVersion: "1" | "2";
  targetNamespace?:string;
  issues?:Array<{construct:string;offset:number}>;
  source: { file: string; bytes: number; sha256: string };
  statistics: { complexTypes: number; simpleTypes: number; fields: number; enumValues: number };
  types: Array<{ name: string; kind: "complex" | "simple"; base?: string; fields: number; enumValues: number; shard: string }>;
}

/** Small manifest plus one-file-per-type access to the large declared SC2 Data XSD. */
export class DataXsdRegistry {
  private revision?:string;
  private manifestHash?:string;
  private readonly consumedSources=new Map<string,{file:string;sha256:string}>();
  private readonly shardHashes=new Map<string,{file:string;sha256:string}>();
  private manifestValue?: DataXsdManifest | null;
  private readonly typeCache = new Map<string, DataXsdType | undefined>();

  constructor(private readonly manifestFile = projectPath("generated/data-xsd-index/manifest.json")) {}

  manifest(): DataXsdManifest | undefined {
    let revision:string;
    try{const stat=statSync(this.manifestFile);revision=stat.size+":"+stat.mtimeMs;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;revision="missing";}
    if(this.revision!==revision){this.revision=revision;this.manifestValue=undefined;this.typeCache.clear();this.shardHashes.clear();this.consumedSources.clear();}
    if (this.manifestValue !== undefined) return this.manifestValue ?? undefined;
    try {const text=readFileSync(this.manifestFile,"utf8");this.manifestHash=createHash("sha256").update(text).digest("hex");this.manifestValue = JSON.parse(text) as DataXsdManifest; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") this.manifestValue = null;
      else throw error;
    }
    return this.manifestValue ?? undefined;
  }

  describe(name: string): DataXsdType | undefined {
    this.manifest();
    const key = name;
    const descriptors=this.manifest()?.types ?? [];
    const fallback=descriptors.filter(entry=>entry.name.toLowerCase()===key.toLowerCase());
    const descriptor=descriptors.find(entry=>entry.name===key) ?? (fallback.length===1?fallback[0]:undefined);
    if (!descriptor) return undefined;
    const file = path.resolve(path.dirname(this.manifestFile), descriptor.shard);
    if(!file.startsWith(path.dirname(this.manifestFile)+path.sep))throw new Error('XSD_SHARD_PATH_ESCAPE');
    const source=readFileSync(file,'utf8'),sha256=createHash('sha256').update(source).digest('hex');
    this.consumedSources.set(file,{file,sha256});
    if(this.shardHashes.get(key)?.sha256===sha256)return this.typeCache.get(key);
    const value = JSON.parse(source) as DataXsdType;
    this.shardHashes.set(key,{file,sha256});
    this.typeCache.set(key, value);
    while(this.typeCache.size>512){const first=this.typeCache.keys().next().value!;this.typeCache.delete(first);this.shardHashes.delete(first);}
    return value;
  }

  refresh(){try{const raw=readFileSync(this.manifestFile,'utf8'),hash=createHash('sha256').update(raw).digest('hex');if(this.manifestHash!==hash){this.manifestValue=undefined;this.typeCache.clear();this.shardHashes.clear();this.consumedSources.clear();}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;this.manifestValue=undefined;this.manifestHash=undefined;this.typeCache.clear();this.shardHashes.clear();this.consumedSources.clear();}return this.manifest();}

  sources(){this.manifest();return [...this.manifestHash?[{file:this.manifestFile,sha256:this.manifestHash}]:[],...this.consumedSources.values()];}

  members(type: string | DataXsdType, seen = new Set<string>()): DataXsdField[] {
    const value = typeof type === "string" ? this.describe(type.replace(/^.*:/, "")) : type;
    if (!value || seen.has(value.name)) return [];
    seen.add(value.name);
    const inherited = value.base && this.localNamespace(value.baseNamespace) && !value.base.startsWith("xs:") ? this.members(value.base, seen) : [];
    return [...inherited.filter(f => !(value.derivation==="restriction"&&value.kind==="complex"&&f.kind==="element")&&!value.fields.some(g => g.kind === f.kind && g.name === f.name)), ...value.fields].filter(f=>f.use!=="prohibited");
  }

  fieldType(owner: string | DataXsdType, names: string[]): string | DataXsdType | undefined {
    let current: string | DataXsdType | undefined = owner;
    for (const name of names) {
      if (!current) return undefined;
      const field: DataXsdField | undefined = this.members(current).find(f => f.kind === "element" && f.name === name);
      current = field?.inlineType ?? (this.localNamespace(field?.typeNamespace)?field?.type:undefined);
    }
    return current;
  }

  private localNamespace(namespace?:string) {return namespace===undefined||namespace===(this.manifest()?.targetNamespace??'');}

  linkDomain(type: string | DataXsdType | undefined, seen = new Set<string>(), namespace?:string): string | undefined {
    if (!type||!this.localNamespace(namespace)||(typeof type==="string"&&type.startsWith("xs:"))) return undefined;
    const name = (typeof type === "string" ? type : type.name).replace(/^.*:/, "");
    if (seen.has(name)) return undefined;
    seen.add(name);
    const value = typeof type === "string" ? this.describe(name) : type;
    if(!value)return undefined;
    const link = /^(?:simple_)?C(.+)Link$/.exec(name);
    if (link&&this.localNamespace(value.namespace)) return link[1];
    return value?.base ? this.linkDomain(value.base, seen,value.baseNamespace) : undefined;
  }

  search(query: string, limit = 50) {
    const needle = query.toLowerCase();
    return (this.manifest()?.types ?? []).filter((entry) => entry.name.toLowerCase().includes(needle)).slice(0, limit);
  }
}
