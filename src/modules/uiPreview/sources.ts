import {promises as fs} from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {scanXml} from '../../core/xmlScanner.js';import {Workspace} from '../../core/workspace.js';import {CascWorkspace,safeCascPath} from '../casc/workspace.js';import {TextSchemaRegistry} from '../text/schemaRegistry.js';import {decodeDds} from '../assets/dds.js';import { UiPreviewPreparation } from "./preparation.js";import type {XmlAttrs} from '../../core/types.js';
export interface Definition {runtimeGeometry?:{x?:number;y?:number;width?:number;height?:number};name:string;type:string;attrs:XmlAttrs;properties:Array<{tag:string;attrs:XmlAttrs}>;children:Definition[];source:string}
export interface PreviewIssue {code:string;frame?:string;detail:string}
export function definitions(xml: string, source: string, preparation?: UiPreviewPreparation) {
  const p = preparation?.xml(xml) ?? scanXml(xml);
  if (p.diagnostics.some((d) => d.severity === "error"))
    throw new Error("UI_PREVIEW_XML_INVALID: " + source);
  const build = (id: number): Definition => {
    const n = p.nodes[id];
    return {
      name: n.attrs.name ?? "",
      type: n.attrs.type ?? "Frame",
      attrs: { ...n.attrs },
      source,
      properties: n.childIds
        .map((i) => p.nodes[i])
        .filter((n) => n.tag !== "Frame")
        .map((n) => ({ tag: n.tag, attrs: { ...n.attrs } })),
      children: n.childIds
        .map((i) => p.nodes[i])
        .filter((n) => n.tag === "Frame")
        .map((n) => build(n.id)),
    };
  };
  return {
    frames: p.nodes
      .filter(
        (n) => n.tag === "Frame" && (n.parentId === null || p.nodes[n.parentId].tag === "Desc"),
      )
      .map((n) => build(n.id)),
    constants: p.nodes
      .filter((n) => n.tag === "Constant" && n.attrs.name)
      .map((n) => [n.attrs.name, n.attrs.val] as const),
  };
}
export function mergeDefinition(base:Definition,own:Definition):Definition{const allAnchor=own.properties.some(p=>p.tag==='Anchor'&&!p.attrs.side),key=(p:Definition['properties'][number])=>p.tag+':'+(p.tag==='Anchor'?p.attrs.side??'All':p.attrs.layer??'0'),properties=new Map(base.properties.filter(p=>!(allAnchor&&p.tag==='Anchor')).map(p=>[key(p),p]));for(const p of own.properties)properties.set(key(p),p);const children=base.children.map(c=>own.children.some(o=>o.name===c.name)?mergeDefinition(c,own.children.find(o=>o.name===c.name)!):c);children.push(...own.children.filter(o=>!base.children.some(c=>c.name===o.name)));return {...own,attrs:{...base.attrs,...own.attrs},type:own.attrs.type??base.type,properties:[...properties.values()],children};}
export class PreviewSources{
 readonly issues:PreviewIssue[]=[];readonly references:Array<{file:string;sha256:string;size:number}>=[];readonly constants=new Map<string,string>();readonly aliases=new Map<string,string>();readonly styles=new Map<string,XmlAttrs>();readonly textures=new Map<string,ReturnType<typeof decodeDds>>();private templates=new Map<string,Definition>();private build?:string;private templateReads=0;
 constructor(
    readonly workspace: Workspace,
    readonly casc: CascWorkspace,
    readonly textSchema: TextSchemaRegistry,
    readonly race: "Terr" | "Prot" | "Zerg",
    readonly packages: string[],
    readonly preparation = new UiPreviewPreparation(),
  ) {}
 private remember(file:string,bytes:Buffer){this.references.push({file,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length});if(this.references.length>100)throw new Error('UI_PREVIEW_SOURCE_BUDGET');}
 async localText(file:string,optional=false){this.workspace.resolveUserPath(file);const r=await this.workspace.readRaw(file);if(!r.exists){if(optional)return '';throw new Error('UI_PREVIEW_FILE_MISSING: '+file);}if(Buffer.byteLength(r.text)>2*1024*1024)throw new Error('UI_PREVIEW_XML_BUDGET');this.remember(file,Buffer.from(r.text));return r.text;}
 async game(file:string){const r=await this.casc.read(file);if(this.build&&r.metadata.buildKey!==this.build)throw new Error('UI_PREVIEW_CASC_BUILD_CHANGED');this.build=r.metadata.buildKey;this.remember(file,r.bytes);return r.bytes;}
 async initialize(styleFile: string) {
    for (const c of this.textSchema.constants.values()) this.constants.set(c.name, c.value);
    for (const s of this.textSchema.styles.values())
      this.styles.set(s.name, { ...s.attrs, ...(s.template ? { template: s.template } : {}) });
    const local = await this.localText(styleFile, true);
    if (local)
      for (const n of this.preparation
        .xml(local)
        .nodes.filter((n) => n.tag === "Style" && n.attrs.name))
        this.styles.set(n.attrs.name, { ...n.attrs });
    for (const pack of this.packages) {
      try {
        this.addAliases(
          (await this.game(pack + "/base.sc2data/gamedata/assets.txt")).toString("utf8"),
        );
      } catch (e) {
        this.issues.push({
          code: "ASSET_ALIAS_PACKAGE_UNAVAILABLE",
          detail: pack + ": " + String(e),
        });
      }
    }
    for (const name of ["Base.SC2Data/GameData/Assets.txt", "Base.SC2Data/GameData/Asset.txt"]) {
      const local = await this.localText(name, true);
      if (local) this.addAliases(local);
    }
  }
 private addAliases(text:string){for(const line of text.split(/\r?\n/)){const at=line.indexOf('=');if(at>0&&!line.startsWith('//'))this.aliases.set(line.slice(0,at).trim(),line.slice(at+1).trim());}}
 value(raw:string|undefined):string|undefined{if(!raw)return raw;if(raw.startsWith('#')){const v=this.constants.get(raw.slice(1));if(v===undefined){this.issues.push({code:'CONSTANT_UNRESOLVED',detail:raw});return undefined;}return v;}return raw;}
 style(name:string,seen=new Set<string>()):XmlAttrs{if(seen.has(name)){this.issues.push({code:'STYLE_CYCLE',detail:name});return {};}seen.add(name);const s=this.styles.get(name.replace(/^@+/,''));if(!s){this.issues.push({code:'STYLE_UNRESOLVED',detail:name});return {};}return {...(s.template?this.style(s.template,seen):{}),...s};}
 async template(
    reference: string,
    own: Definition,
    seen = new Set<string>(),
  ): Promise<Definition> {
    if (seen.has(reference) || seen.size > 12) throw new Error("UI_PREVIEW_TEMPLATE_CYCLE");
    seen.add(reference);
    let base = this.templates.get(reference);
    if (!base) {
      if (++this.templateReads > 12) throw new Error("UI_PREVIEW_TEMPLATE_BUDGET");
      const parts = reference.split("/"),
        file = parts.shift()!,
        root = parts.shift()!;
      if (!file || !root) throw new Error("UI_PREVIEW_TEMPLATE_REFERENCE");
      const local = "Base.SC2Data/UI/Layout/" + file + ".SC2Layout";
      let xml = await this.localText(local, true),
        source = local;
      if (!xml) {
        const page = await this.casc.search(
            "mods/core.sc2mod/base.sc2data/ui/layout",
            file.toLowerCase() + ".sc2layout",
            0,
            20,
          ),
          matches = page.items.filter(
            (i) => path.posix.basename(i.path) === file.toLowerCase() + ".sc2layout",
          );
        if (matches.length !== 1) throw new Error("UI_PREVIEW_TEMPLATE_NOT_UNIQUE: " + reference);
        source = matches[0].path;
        xml = (await this.game(source)).toString("utf8");
      }
      const parsed = definitions(xml, source, this.preparation);
      for (const [k, v] of parsed.constants) this.constants.set(k, v);
      for (const f of parsed.frames) this.templates.set(file + "/" + f.name, f);
      base = this.templates.get(file + "/" + root);
      for (const child of parts) base = base?.children.find((c) => c.name === child);
      if (!base) throw new Error("UI_PREVIEW_TEMPLATE_MISSING: " + reference);
    }
    if (base.attrs.template) base = await this.template(base.attrs.template, base, new Set(seen));
    return mergeDefinition(base, own);
  }
 async texture(raw: string) {
    let asset = this.value(raw) ?? raw;
    if (asset.startsWith("@")) {
      const raceSpecific = asset.startsWith("@@@"),
        key = asset.replace(/^@+/, "");
      asset =
        (raceSpecific ? this.aliases.get(key + "_" + this.race) : undefined) ??
        this.aliases.get(key) ??
        "";
      if (!asset) throw new Error("UI_PREVIEW_ASSET_ALIAS_MISSING: " + raw);
    }
    asset = safeCascPath(asset);
    const cached = this.textures.get(asset);
    if (cached) return cached;
    if (this.textures.size >= 32) throw new Error("UI_PREVIEW_TEXTURE_BUDGET");
    let bytes: Buffer | undefined;
    for (const file of ["Base.SC2Assets/" + asset, asset]) {
      const full = this.workspace.resolveUserPath(file);
      try {
        const stat = await fs.stat(full);
        if (stat.size > 16 * 1024 * 1024) throw new Error("UI_PREVIEW_TEXTURE_BYTE_BUDGET");
        bytes = await fs.readFile(full);
        this.remember(file, bytes);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    if (!bytes)
      for (const pack of [...this.packages].reverse()) {
        try {
          bytes = await this.game(pack + "/base.sc2assets/" + asset);
          break;
        } catch (e) {
          if (String(e).includes("BUILD_CHANGED")) throw e;
        }
      }
    if (!bytes) throw new Error("UI_PREVIEW_TEXTURE_MISSING: " + asset);
    const decoded = this.preparation.texture(bytes);
    this.textures.set(asset, decoded);
    return decoded;
  }
 async finish(){if(this.build&&(await this.casc.refreshBuild()).build.buildKey!==this.build)throw new Error('UI_PREVIEW_CASC_BUILD_CHANGED');return this.build;}
}
