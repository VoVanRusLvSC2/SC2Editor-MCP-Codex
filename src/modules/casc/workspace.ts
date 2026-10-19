import { promises as fs, existsSync, lstatSync } from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { GalaxyDocument } from "../script/document.js";
import { createHash, randomUUID } from "node:crypto";
import { NativeCascBackend, bundledCascHelper, type CascBackend, type CascEntry } from "./backend.js";
export interface CascBuild { version: string; buildKey: string; cdnKey: string; buildInfoSha256: string }
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export function parseCascBuildInfo(source: string): CascBuild {
  const rows = source.replace(/^\uFEFF/, "").trim().split(/\r?\n/), names = rows[0]?.split("|").map(name => name.split("!")[0]);
  if (!names || !names.includes("Build Key") || !names.includes("Active")) throw new Error("CASC_BUILD_INFO_HEADER_INVALID");
  const active = rows.slice(1).filter(Boolean).map(row => Object.fromEntries(row.split("|").map((value, index) => [names[index], value]))).filter(row => row.Active === "1");
  if (active.length !== 1) throw new Error("CASC_ACTIVE_BUILD_AMBIGUOUS");
  const row = active[0];
  if (!/^[a-f0-9]{32}$/i.test(row["Build Key"] ?? "")) throw new Error("CASC_BUILD_KEY_INVALID");
  return { version: row.Version ?? "unknown", buildKey: row["Build Key"].toLowerCase(), cdnKey: row["CDN Key"] ?? "", buildInfoSha256: sha(source) };
}
export function safeCascPath(value: string, allowEmpty = false): string {
  if (allowEmpty && !value) return "";
  const normalized = value.replaceAll("\\", "/").toLowerCase();
  if (!normalized || normalized.length > 1024 || path.posix.isAbsolute(normalized) || [...normalized].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || /[:*?"<>|]/.test(normalized)) throw new Error("CASC_PATH_UNSAFE");
  if (normalized.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error("CASC_PATH_UNSAFE");
  return normalized;
}
interface CacheMetadata extends CascBuild { schemaVersion: 1; path: string; sha256: string; contentKey: string; encodingKey: string; size: number }
interface MountRecord { kinds?:CascKind[];locales?:string[];package: string; root: string; build: CascBuild; files: Array<{ logicalPath: string; file: string; sha256: string }> }
export type CascKind = "catalogs" | "triggers" | "strings" | "schemas" | "layouts";
export interface CascOptions { install?: string; cacheRoot?: string; backendName?:string;backendFactory?: (install: string) => CascBackend; onMount?: (root: string) => void; onUnmount?: (root: string) => void }

/** Read-only game source, build-scoped verified byte cache, and explicit dependency views. */
export class CascWorkspace {
  readonly install: string;
  readonly cacheRoot: string;
  private backend?: CascBackend;
  private backendRevision?: string;
  private mountBuild?: string;
  private registeredViews = new Set<string>();
  private inFlight = new Map<string, Promise<{ bytes: Buffer; metadata: CacheMetadata; cacheHit: boolean }>>();
  readonly stats = { hits: 0, misses: 0, invalidCacheEntries: 0, nativeBytesRead: 0 };
  constructor(readonly root: string, readonly options: CascOptions = {}) {
    this.install = path.resolve(options.install ?? process.env.SC2_CASC_ROOT ?? "C:/Program Files (x86)/StarCraft II");
    this.cacheRoot = path.resolve(options.cacheRoot ?? process.env.SC2_CASC_CACHE ?? path.join(root, ".sc2mcp-casc-cache"));
    const installRelative = path.relative(this.install, this.cacheRoot);
    if (!installRelative || (!installRelative.startsWith("..") && !path.isAbsolute(installRelative))) throw new Error("CASC_CACHE_INSIDE_INSTALL_REFUSED");
  }
  configuration() { return { install: this.install, cacheRoot: this.cacheRoot, backend:this.options.backendName??'native CascLib',helperAvailable: existsSync(bundledCascHelper()), localOnly: true, gameWrites: false, initialized: !!this.backend }; }
  private async source() {
    const raw = await fs.readFile(path.join(this.install, ".build.info"), "utf8").catch(error => { throw new Error("CASC_INSTALL_BUILD_INFO_UNAVAILABLE", { cause: error }); });
    return parseCascBuildInfo(raw);
  }
  private syncBuild(build: CascBuild) {
    if (this.mountBuild && this.mountBuild !== build.buildKey) {
      for (const root of this.registeredViews) this.options.onUnmount?.(root);
      this.registeredViews.clear();
    }
    this.mountBuild = build.buildKey;
  }
  private registerView(root: string) {
    if (this.registeredViews.has(root)) return;
    this.options.onMount?.(root); this.registeredViews.add(root);
  }
  async refreshBuild() { const build = await this.source(); this.syncBuild(build); return { build, mountedCount: this.registeredViews.size }; }
  private async ready() {
    const build = await this.source(); this.syncBuild(build);
    if (this.backendRevision !== build.buildInfoSha256) {
      this.backend?.close(); this.backend = this.options.backendFactory?.(this.install) ?? new NativeCascBackend(this.install);
      this.backendRevision = build.buildInfoSha256;
    }
    return { build, backend: this.backend! };
  }
  private cachePath(relative: string) {
    const absolute = path.resolve(this.cacheRoot, relative), rel = path.relative(this.cacheRoot, absolute);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("CASC_CACHE_PATH_ESCAPE");
    let current = path.parse(absolute).root;
    for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      try { if (lstatSync(current).isSymbolicLink()) throw new Error("CASC_CACHE_SYMLINK_REFUSED"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
    }
    return absolute;
  }
  private async atomic(file: string, bytes: Buffer | string) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, bytes, { flag: "wx" }); await fs.rename(temporary, file); }
    finally { await fs.unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
  }
  async status() { const { build, backend } = await this.ready(); return { ...this.configuration(), build, native: await backend.info(), cache: { ...this.stats }, mounted: await this.restoreMounts(), engineValidated: false }; }
  async search(prefix = "", query = "", offset = 0, limit = 20) {
    prefix = safeCascPath(prefix.replace(/[\\/]+$/, ""), true);
    if (query.length > 128 || /[\r\n\t]/.test(query) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("CASC_QUERY_BUDGET");
    const { build, backend } = await this.ready(); return { build, ...await backend.list(prefix, query, offset, limit) };
  }
  async inspect(file: string) { file = safeCascPath(file); const { build, backend } = await this.ready(); return { build, ...await backend.inspect(file) }; }
  private async fetch(file: string, maxBytes = 16 * 1024 * 1024) {
    const { build, backend } = await this.ready(), entry = await backend.inspect(file);
    if (entry.size > maxBytes || !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error("CASC_FULL_FILE_BYTE_BUDGET");
    const cached = this.cachePath(`${build.buildKey}/files/${file}`), metadataFile = this.cachePath(`${build.buildKey}/metadata/${file}.json`);
    const metadata = await fs.readFile(metadataFile, "utf8").then(text => JSON.parse(text) as CacheMetadata).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined; throw error; });
    if (metadata) {
      const bytes = await fs.readFile(cached).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; });
      if (bytes && metadata.schemaVersion === 1 && metadata.path === file && metadata.buildKey === build.buildKey && metadata.contentKey === entry.contentKey && metadata.size === bytes.length && metadata.sha256 === sha(bytes)) {
        this.stats.hits++; return { bytes, metadata, cacheHit: true };
      }
      this.stats.invalidCacheEntries++;
    }
    const chunks:Buffer[]=[];for(let offset=0;offset<entry.size;offset+=4*1024*1024){const length=Math.min(4*1024*1024,entry.size-offset),part=await backend.read(file,offset,length),bytes=Buffer.from(part.base64,"base64");if(part.path!==file||part.offset!==offset||part.size!==entry.size||bytes.length!==length||part.contentKey!==entry.contentKey)throw new Error("CASC_NATIVE_READ_IDENTITY_MISMATCH");chunks.push(bytes);}const bytes=Buffer.concat(chunks,entry.size),result={contentKey:entry.contentKey,encodingKey:entry.encodingKey};
    if (entry.contentKey !== "0".repeat(32) && createHash("md5").update(bytes).digest("hex") !== entry.contentKey) throw new Error("CASC_CONTENT_KEY_MISMATCH");
    if ((await this.source()).buildInfoSha256 !== build.buildInfoSha256) throw new Error("CASC_BUILD_CHANGED_DURING_READ");
    const next: CacheMetadata = { schemaVersion: 1, ...build, path: file, sha256: sha(bytes), contentKey: result.contentKey, encodingKey: result.encodingKey, size: bytes.length };
    await this.atomic(cached, bytes); await this.atomic(metadataFile, JSON.stringify(next, null, 2) + "\n");
    this.stats.misses++; this.stats.nativeBytesRead += bytes.length;
    return { bytes, metadata: next, cacheHit: false };
  }
  async readLimited(file:string,maxBytes:number){if(!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024)throw new Error('CASC_RENDERER_BYTE_BUDGET');file=safeCascPath(file);const key=`${(await this.source()).buildKey}:${file}:${maxBytes}`,existing=this.inFlight.get(key);if(existing)return existing;const promise=this.fetch(file,maxBytes);this.inFlight.set(key,promise);try{return await promise;}finally{this.inFlight.delete(key);}}
  async read(file: string) {
    file = safeCascPath(file);
    const key = `${(await this.source()).buildKey}:${file}`, existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = this.fetch(file); this.inFlight.set(key, promise);
    try { return await promise; } finally { this.inFlight.delete(key); }
  }
  async text(file: string, offset = 0, maxChars = 8000) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 24000) throw new Error("CASC_TEXT_BUDGET");
    const read = await this.read(file), text = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes);
    return { ...read.metadata, cacheHit: read.cacheHit, text: text.slice(offset, offset + maxChars), offset, totalChars: text.length, truncated: offset + maxChars < text.length, nextOffset: offset + maxChars < text.length ? offset + maxChars : null };
  }
  async bytes(file: string, offset: number, length: number) {
    file = safeCascPath(file);
    if (![offset, length].every(Number.isSafeInteger) || offset < 0 || length < 0 || length > 4096) throw new Error("CASC_BYTE_RANGE_BUDGET");
    const { build, backend } = await this.ready(), result = await backend.read(file, offset, length), bytes = Buffer.from(result.base64, "base64");
    if (result.path !== file || result.offset !== offset || bytes.length !== length) throw new Error("CASC_NATIVE_READ_IDENTITY_MISMATCH");
    if ((await this.source()).buildInfoSha256 !== build.buildInfoSha256) throw new Error("CASC_BUILD_CHANGED_DURING_READ");
    return { ...build, path: file, size: result.size, contentKey: result.contentKey, encodingKey: result.encodingKey, offset, length, hex: bytes.toString("hex"), cacheHit: false };
  }
  private selected(file: string, kinds: CascKind[], locales: string[]) {
    if (/(?:^|\/)documentinfo$/.test(file)) return true;
    if (kinds.includes("catalogs") && /\/base\.sc2data\/(?:gamedata\.xml|gamedata\/.*\.xml)$/.test(file)) return true;
    if (kinds.includes("triggers") && (/\/triggerlibs\/.*\.(?:galaxy|triggerlib|sc2lib|xml)$/.test(file) || /\/triggers$/.test(file))) return true;
    if (kinds.includes("strings") && locales.some(locale => file.includes(`/${locale.toLowerCase()}.sc2data/`)) && /\/localizeddata\/[^/]*strings\.txt$/.test(file)) return true;
    if (kinds.includes("schemas") && /\.xsd$/.test(file)) return true;
    return kinds.includes("layouts") && /\.(?:sc2layout|stormlayout|sc2style|stormstyle)$/.test(file);
  }
  private viewFile(relative: string) {
    return relative.split("/").map((part, index) => {
      if (part === "base.sc2data") return "Base.SC2Data";
      if (index === 0 && /^[a-z]{4}\.sc2data$/.test(part)) return part.slice(0, 2) + part.slice(2, 4).toUpperCase() + ".SC2Data";
      const names: Record<string, string> = { documentinfo: "DocumentInfo", "gamedata.xml": "GameData.xml", gamedata: "GameData", localizeddata: "LocalizedData", triggerlibs: "TriggerLibs", triggers: "Triggers" };
      return names[part] ?? part;
    }).join("/");
  }
  async mount(packages: string[], kinds: CascKind[], locales: string[], maxFiles = 1000) {
    if (!packages.length || packages.length > 16 || maxFiles < 1 || maxFiles > 2000) throw new Error("CASC_MOUNT_BUDGET");
    const build = await this.source(), reports: Array<Record<string, unknown>> = [];
    let selectedCount = 0, totalBytes = 0;
    for (let pkg of packages) {
      pkg = safeCascPath(pkg);
      if (!/\.sc2(?:mod|campaign)$/.test(pkg)) throw new Error("CASC_PACKAGE_PATH_REQUIRED");
      const selected: CascEntry[] = [];
      // Package-owned scopes only. Embedded campaign maps are separate documents.
      const scopes:Array<{prefix:string;query:string}>=[{prefix:pkg,query:'/documentinfo'}];
      if(kinds.includes('catalogs'))scopes.push({prefix:pkg+'/base.sc2data/gamedata',query:''},{prefix:pkg,query:'/base.sc2data/gamedata.xml'});
      if(kinds.includes('triggers'))scopes.push({prefix:pkg+'/base.sc2data/triggerlibs',query:''},{prefix:pkg,query:'/triggers'});
      if(kinds.includes('strings'))for(const locale of locales)scopes.push({prefix:pkg+'/'+locale.toLowerCase()+'.sc2data/localizeddata',query:'strings.txt'});
      if(kinds.includes('layouts'))scopes.push({prefix:pkg+'/base.sc2data/ui',query:''});
      if(kinds.includes('schemas'))scopes.push({prefix:pkg+'/base.sc2data',query:'.xsd'});
      for(const scope of scopes){let offset = 0, more = true;
      do {
        const page = await this.search(scope.prefix, scope.query, offset, 100);
        selected.push(...page.items.filter(entry => !entry.path.slice(pkg.length+1).split("/").some(p=>/\.sc2(?:map|mod|campaign)$/.test(p)) && this.selected(entry.path, kinds, locales)));
        if (page.nextOffset === null) more = false;
        else { if (page.nextOffset <= offset) throw new Error("CASC_INDEX_PAGINATION_INVALID"); offset = page.nextOffset; }
      } while (more);}
      const unique=[...new Map(selected.map(e=>[e.path,e])).values()];selected.splice(0,selected.length,...unique);
      if (!selected.length) { reports.push({ package: pkg, status: "NO_SELECTED_FILES" }); continue; }
      selectedCount += selected.length;
      if (selectedCount > maxFiles) throw new Error("CASC_MOUNT_FILE_COUNT_BUDGET");
      const viewRoot = this.cachePath(`${build.buildKey}/views/${pkg}`), files: MountRecord["files"] = [], errors: Array<{ path: string; error: string }> = [];
      for (const entry of selected) {
        try {
          if (totalBytes + entry.size > 128 * 1024 * 1024) throw new Error("CASC_MOUNT_BYTE_BUDGET");
          const read = await this.read(entry.path); totalBytes += read.bytes.length;
          const relative = this.viewFile(entry.path.slice(pkg.length + 1)), file = this.cachePath(`${build.buildKey}/views/${pkg}/${relative}`);
          const existing = await fs.readFile(file).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; });
          if (!existing || sha(existing) !== read.metadata.sha256) await this.atomic(file, read.bytes);
          files.push({ logicalPath: entry.path, file: relative, sha256: read.metadata.sha256 });
        } catch (error) { errors.push({ path: entry.path, error: String(error) }); }
      }
      if ((await this.source()).buildInfoSha256 !== build.buildInfoSha256) throw new Error("CASC_BUILD_CHANGED_DURING_MOUNT");
      this.syncBuild(build);
      const record: MountRecord = { kinds,locales,package: pkg, root: viewRoot, build, files };
      // Failed partial mounts stay inspectable but are not registered as available dependency roots.
      if (!errors.length) {
        await this.atomic(this.cachePath(`${build.buildKey}/mounts/${sha(pkg)}.json`), JSON.stringify(record, null, 2) + "\n");
        this.registerView(viewRoot);
      }
      reports.push({ package: pkg, root: viewRoot, files: files.length, errors, status: errors.length ? "PARTIAL_NOT_MOUNTED" : "MOUNTED", implicitEngineActivation: false });
    }
    return { build, selectedCount, totalBytes, reports, dependencyOrder: "Existing Data/Browse DocumentInfo resolver; unlisted implicit dependencies remain unknown" };
  }
  async ensurePackage(pkg:string,kinds:CascKind[],locales:string[]){
    pkg=safeCascPath(pkg);const build=await this.source(),file=this.cachePath(`${build.buildKey}/mounts/${sha(pkg)}.json`);
    let record:MountRecord|undefined;try{record=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
    if(record&&record.build.buildKey===build.buildKey&&record.root===this.cachePath(`${build.buildKey}/views/${pkg}`)&&kinds.every(k=>record!.kinds?.includes(k))&&(!kinds.includes('strings')||locales.every(l=>record!.locales?.includes(l)))){
      if(record.files.length>2000)throw new Error('CASC_MOUNT_MANIFEST_INVALID');for(const item of record.files){safeCascPath(item.file);const bytes=await fs.readFile(this.cachePath(`${build.buildKey}/views/${pkg}/${item.file}`));if(sha(bytes)!==item.sha256)throw new Error('CASC_MOUNT_VIEW_CORRUPTED');}
      this.syncBuild(build);this.registerView(record.root);return {root:record.root,cacheHit:true,build};
    }
    const requestedKinds=[...new Set([...(record?.kinds??[]),...kinds])],requestedLocales=[...new Set([...(record?.locales??[]),...locales])];const mounted=await this.mount([pkg],requestedKinds,requestedLocales,2000),report=mounted.reports[0];if(report?.status!=='MOUNTED')throw new Error('CASC_PACKAGE_NOT_MOUNTED: '+pkg);return {root:String(report.root),cacheHit:false,build};
  }
  async restoreMounts() {
    const build = await this.source(); this.syncBuild(build);
    const directory = this.cachePath(`${build.buildKey}/mounts`), mounted: string[] = [];
    const names = await fs.readdir(directory).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; });
    if (names.length > 16) throw new Error("CASC_MOUNT_MANIFEST_BUDGET");
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const record = JSON.parse(await fs.readFile(this.cachePath(`${build.buildKey}/mounts/${name}`), "utf8")) as MountRecord;
      const pkg = safeCascPath(record.package), expectedRoot = this.cachePath(`${build.buildKey}/views/${pkg}`);
      if (record.build.buildKey !== build.buildKey || record.root !== expectedRoot || record.files.length > 2000) throw new Error("CASC_MOUNT_MANIFEST_INVALID");
      for (const item of record.files) {
        safeCascPath(item.file);
        const file = this.cachePath(`${build.buildKey}/views/${pkg}/${item.file}`), bytes = await fs.readFile(file);
        if (sha(bytes) !== item.sha256) throw new Error("CASC_MOUNT_VIEW_CORRUPTED");
      }
      this.registerView(expectedRoot); mounted.push(expectedRoot);
    }
    return mounted;
  }
  async symbols(file: string, query = "", offset = 0, limit = 30) {
    file = safeCascPath(file);
    if (!file.endsWith(".galaxy")) throw new Error("CASC_GALAXY_FILE_REQUIRED");
    if (query.length > 128 || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("CASC_SYMBOL_PAGE_BUDGET");
    const read = await this.read(file), location = this.cachePath(`${read.metadata.buildKey}/summaries/${sha(file)}.json.gz`);
    type Summary = { version: number; file: string; sourceSha256: string; symbols: GalaxyDocument["symbols"]; includes: GalaxyDocument["includes"]; diagnostics: GalaxyDocument["diagnostics"] };
    let summary: Summary | undefined;
    try { summary = JSON.parse(gunzipSync(await fs.readFile(location), { maxOutputLength: 16 * 1024 * 1024 }).toString("utf8")); }
    catch (error) { if (["EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
    const summaryCacheHit = !!summary && summary.version === 1 && summary.file === file && summary.sourceSha256 === read.metadata.sha256 && Array.isArray(summary.symbols) && Array.isArray(summary.includes) && Array.isArray(summary.diagnostics);
    if (!summaryCacheHit) {
      const document = new GalaxyDocument(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes));
      summary = { version: 1, file, sourceSha256: read.metadata.sha256, symbols: document.symbols, includes: document.includes, diagnostics: document.diagnostics };
      await this.atomic(location, gzipSync(JSON.stringify(summary), { level: 4 }));
    }
    const symbols = summary!.symbols.filter(symbol => !query || symbol.name.toLowerCase().includes(query.toLowerCase()));
    return { ...read.metadata, byteCacheHit: read.cacheHit, summaryCacheHit, total: symbols.length, items: symbols.slice(offset, offset + limit),
      nextOffset: offset + limit < symbols.length ? offset + limit : null, includes: summary!.includes, diagnostics: summary!.diagnostics,
      scope: "top-level lexical declarations; not native semantic binding or compiler proof" };
  }
  async references() {
    const directory = this.cachePath("references"), names = await fs.readdir(directory).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; });
    const references: unknown[] = [];
    for (const name of names.filter(name => /^[a-z0-9_-]+$/.test(name)).slice(0, 16)) {
      const file = this.cachePath(`references/${name}/manifest.json`);
      try { references.push(JSON.parse(await fs.readFile(file, "utf8"))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return { references, note: "Imported metadata is reference-only until every source hash matches the current CASC build" };
  }
  async verifyReference(id: string) {
    if (!/^[a-z0-9_-]+$/.test(id)) throw new Error("CASC_REFERENCE_ID_UNSAFE");
    const location = this.cachePath(`references/${id}/galaxy-script-api.v1.json.gz`);
    const raw = gunzipSync(await fs.readFile(location), { maxOutputLength: 16 * 1024 * 1024 }), reference = JSON.parse(raw.toString("utf8"));
    const sources: Array<{ path: string; expectedSha256: string; currentSha256?: string; matches: boolean; error?: string }> = [];
    for (const file of reference.source.files) {
      const logical = safeCascPath(`mods/core.sc2mod/${file.path}`);
      try { const read = await this.read(logical); sources.push({ path: logical, expectedSha256: file.sha256, currentSha256: read.metadata.sha256, matches: read.metadata.sha256 === file.sha256 }); }
      catch (error) { sources.push({ path: logical, expectedSha256: file.sha256, matches: false, error: String(error) }); }
    }
    const result = { id, build: await this.source(), functionCount: reference.functions.length, sources,
      status: sources.length && sources.every(file => file.matches) ? "SOURCE_HASHES_MATCH_CURRENT_BUILD" : "REFERENCE_SOURCE_MISMATCH",
      authoringCompatibilityProven: false };
    await this.atomic(this.cachePath(`references/${id}/verification.json`), JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  close() { this.backend?.close(); }
}
