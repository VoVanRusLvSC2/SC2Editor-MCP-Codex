import {promises as fs} from 'node:fs';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {scanXml} from '../../core/xmlScanner.js';
import type {Workspace} from '../../core/workspace.js';
import type {DataWorkspace} from '../data/workspace.js';
import type {CascWorkspace} from '../casc/workspace.js';
import {safeCascPath} from '../casc/workspace.js';
import {digest,registryDigest,type Registry} from './authoring.js';
import {indexTriggerSources,type TriggerSource} from './libraryIndex.js';
export interface LibraryContext {registry:Registry;revision:string;sources:Array<{file:string;sha256:string}>;libraries:string[];cacheHit:boolean;build?:string}
/** Only declared dependencies and their LibraryList entries enter GUI authoring. */
export class TriggerLibraries {
 private readonly preparedContexts = new Map<
    string,
    {
      roots: string;
      memo: import("../../core/workspace.js").WorkspaceReadMemo;
      value: LibraryContext;
    }
  >();
 private readonly contextKeys = new Map<string, object>();
 private cached?:LibraryContext;
 private mounted=new Set<string>();
 private coreBuild?:string;
 constructor(private readonly workspace:Workspace,private readonly data:DataWorkspace,private readonly casc?:CascWorkspace){}
 private async locate(root: string, relative: string) {
    const parts = relative.replaceAll("\\", "/").split("/");
    if (
      parts.some((p) => !p || p === ".." || p === ".") ||
      path.isAbsolute(relative) ||
      relative.includes(":")
    )
      throw new Error("GUI_LIBRARY_PATH_UNSAFE");
    let current = root;
    for (const part of parts) {
      const entries = await this.workspace
          .readDirectory(
            current,
            "gui-library-locate:" + part.toLowerCase(),
            (entry) => entry.name.toLowerCase() === part.toLowerCase(),
          )
          .catch((error) => {
            if (error.code === "ENOENT") return [];
            throw error;
          }),
        matches = entries.filter((e) => e.name.toLowerCase() === part.toLowerCase());
      if (matches.length !== 1) return undefined;
      current = path.join(current, matches[0].name);
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("GUI_LIBRARY_PATH_SYMLINK");
    }
    return current;
  }
 async context(base: Registry, needCatalogs = false): Promise<LibraryContext> {
    const revision = registryDigest(base) + ":" + needCatalogs;
    let key = this.contextKeys.get(revision);
    if (!key) {
      key = {};
      this.contextKeys.set(revision, key);
      while (this.contextKeys.size > 8)
        this.contextKeys.delete(this.contextKeys.keys().next().value!);
    }
    return this.workspace.withReadSet(() =>
      this.workspace.prepareReadScope(key!, () =>
        this.prepareContext(revision, base, needCatalogs),
      ),
    );
  }
 private async prepareContext(revision: string, base: Registry, needCatalogs: boolean) {
    const previous = this.preparedContexts.get(revision);
    if (
      previous &&
      previous.roots === JSON.stringify(this.data.extraRoots) &&
      (await this.workspace.reuseReads(previous.memo))
    )
      return { ...previous.value, cacheHit: true };
    const captured = await this.workspace.memoizeReads(() =>
      this.contextTracked(base, needCatalogs),
    );
    this.preparedContexts.set(revision, {
      roots: JSON.stringify(this.data.extraRoots),
      memo: captured.memo,
      value: captured.value,
    });
    while (this.preparedContexts.size > 4)
      this.preparedContexts.delete(this.preparedContexts.keys().next().value!);
    return captured.value;
  }
 private async contextTracked(base: Registry, needCatalogs = false): Promise<LibraryContext> {
    let build: string | undefined;
    if (this.casc) {
      await this.workspace.readDependency(path.join(this.casc.install, ".build.info"), true);
      try {
        const current = await this.casc.refreshBuild();
        build = current.build.buildKey;
        if (this.coreBuild !== build) {
          const native = await this.casc.read(base.source);
          if (native.metadata.sha256 !== base.sha256) throw new Error("GUI_CORE_PROFILE_MISMATCH");
          this.coreBuild = build;
          this.mounted.clear();
        }
      } catch (error) {
        if (!(error instanceof Error && error.message === "CASC_INSTALL_BUILD_INFO_UNAVAILABLE"))
          throw error;
      }
    }
    const views = new Map<string, string>();
    const sources: TriggerSource[] = [],
      guards: Array<{ file: string; sha256: string }> = [],
      active = new Set<string>(),
      done = new Set<string>(),
      roots: string[] = [];
    const rawInfo = (await this.workspace.readRaw("DocumentInfo")).text;
    guards.push({ file: "DocumentInfo", sha256: digest(rawInfo) });
    const read = async (file: string, optional = false) => {
      const text = await this.workspace.readDependency(file, optional);
      const view = [...views].find(([root]) => file.startsWith(root + path.sep));
      if (view && this.casc && text) {
        const original = await this.casc.read(
          safeCascPath(view[1] + "/" + path.relative(view[0], file).replaceAll("\\", "/")),
        );
        if (original.metadata.sha256 !== digest(text))
          throw new Error("GUI_LIBRARY_VIEW_CORRUPTED");
      }
      if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error("GUI_LIBRARY_BYTE_LIMIT");
      guards.push({ file, sha256: digest(text) });
      return text;
    };
    const walk = async (root: string, info: string) => {
      if (active.has(root)) throw new Error("GUI_LIBRARY_DEPENDENCY_CYCLE");
      if (done.has(root)) return;
      active.add(root);
      const parsed = scanXml(info);
      if (parsed.diagnostics.some((d) => d.severity === "error"))
        throw new Error("GUI_LIBRARY_DEPENDENCY_XML");
      for (const dep of parsed.nodes.filter((n) => n.tag === "Dependencies"))
        for (const id of dep.childIds) {
          const node = parsed.nodes[id],
            value = info.slice(node.startTagEnd, node.endTagStart).trim();
          if (!value) continue;
          const locator = value.match(/(?:^|,)file:([^,]+)/i)?.[1];
          if (!locator) throw new Error("GUI_LIBRARY_DEPENDENCY_REMOTE");
          const basename = path.posix.basename(locator.replaceAll("\\", "/")).toLowerCase(),
            matches = this.data.extraRoots.filter(
              (r) => path.basename(r).toLowerCase() === basename,
            );
          let target: string | undefined;
          if (matches.length > 1) throw new Error("GUI_LIBRARY_DEPENDENCY_AMBIGUOUS");
          target = matches[0];
          const token = (needCatalogs ? "catalogs:" : "triggers:") + locator.toLowerCase();
          if (this.casc && build && (!target || !this.mounted.has(token))) {
            const pkg = safeCascPath(locator),
              mounted = await this.casc.ensurePackage(
                pkg,
                needCatalogs ? ["triggers", "strings", "catalogs"] : ["triggers", "strings"],
                ["enUS", "ruRU"],
              );
            target = mounted.root;
            this.data.addDependencyRoot(target);
            this.mounted.add(token);
          }
          if (!target) throw new Error("GUI_LIBRARY_DEPENDENCY_UNAVAILABLE: " + locator);
          if (
            this.casc &&
            build &&
            target.startsWith(path.join(this.casc.cacheRoot, build, "views") + path.sep)
          )
            views.set(target, safeCascPath(locator));
          await walk(target, await read(path.join(target, "DocumentInfo"), true));
        }
      active.delete(root);
      done.add(root);
      if (root !== this.workspace.root) roots.push(root);
    };
    await walk(this.workspace.root, rawInfo);
    // Core is implicit for SC2 GUI even if a map omitted it from DocumentInfo.
    if (needCatalogs && this.casc && build && !this.mounted.has("implicit-core-catalogs")) {
      const mounted = await this.casc.ensurePackage("mods/core.sc2mod", ["catalogs"], []);
      this.data.addDependencyRoot(mounted.root);
      this.mounted.add("implicit-core-catalogs");
    }
    for (const root of roots) {
      const strings = new Map<string, string>();
      for (const locale of ["enUS", "ruRU"]) {
        const file = await this.locate(root, locale + ".SC2Data/LocalizedData/TriggerStrings.txt");
        if (file) {
          const text = await read(file);
          for (const line of text.split(/\r?\n/)) {
            const equals = line.indexOf("=");
            if (equals > 0 && !strings.has(line.slice(0, equals)))
              strings.set(line.slice(0, equals), line.slice(equals + 1));
          }
        }
      }
      const candidates = new Set<string>(),
        list = await this.locate(root, "Base.SC2Data/TriggerLibs/LibraryList.xml");
      if (list) {
        const xml = await read(list),
          p = scanXml(xml);
        if (p.diagnostics.some((d) => d.severity === "error"))
          throw new Error("GUI_LIBRARY_LIST_XML");
        for (const entry of p.nodes.filter(
          (n) => n.tag.toLowerCase() === "library" && n.attrs.external,
        )) {
          const external = entry.attrs.external,
            file =
              (await this.locate(root, "Base.SC2Data/" + external + ".SC2Lib")) ??
              (await this.locate(root, "Base.SC2Data/" + external + ".triggerlib"));
          if (!file) throw new Error("GUI_LIBRARY_LIST_SOURCE_MISSING: " + external);
          candidates.add(file);
        }
      } else {
        const dir = await this.locate(root, "Base.SC2Data/TriggerLibs");
        if (dir)
          for (const { name: file } of await this.workspace.readDirectory(
            dir,
            "gui-library-fallback",
            (entry) => /\.(sc2lib|triggerlib)$/i.test(entry.name),
          ))
            if (/\.(sc2lib|triggerlib)$/i.test(file)) candidates.add(path.join(dir, file));
      }
      const trigger = await this.locate(root, "Triggers");
      if (trigger) candidates.add(trigger);
      for (const file of candidates) {
        const xml = await read(file),
          p = scanXml(xml);
        if (!p.nodes.some((n) => n.tag === "Library" || n.tag === "Standard")) {
          if (p.nodes.some((n) => n.tag === "Element" && n.attrs.Type === "FunctionDef"))
            throw new Error("GUI_LIBRARY_IMPLICIT_DEPENDENCY_SCOPE");
          continue;
        }
        sources.push({ file, xml, sha256: digest(xml), strings });
      }
    }
    if (
      sources.length > 128 ||
      sources.reduce((n, s) => n + Buffer.byteLength(s.xml), 0) > 128 * 1024 * 1024
    )
      throw new Error("GUI_LIBRARY_TOTAL_BUDGET");
    const revision = digest(
      JSON.stringify({ version: 3, base: registryDigest(base), build, guards }),
    );
    if (this.cached?.revision === revision) return { ...this.cached, cacheHit: true };
    const cacheRoot = this.casc
        ? path.join(this.casc.cacheRoot, build ?? "reference-only", "trigger-index-v3")
        : path.join(this.workspace.root, ".sc2mcp-trigger-cache"),
      cacheFile = path.join(cacheRoot, revision + ".json.gz");
    let parsed: Registry | undefined;
    try {
      const cached = JSON.parse(
        gunzipSync(await fs.readFile(cacheFile), { maxOutputLength: 64 * 1024 * 1024 }).toString(
          "utf8",
        ),
      );
      if (cached.revision === revision) parsed = cached.registry;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "EACCES" ||
        (error as NodeJS.ErrnoException).code === "EPERM"
      )
        throw error;
    }
    const cacheHit = !!parsed;
    if (!parsed) {
      if (sources.length) {
        const extra = indexTriggerSources(sources),
          existing = new Map(
            (base.definitions ?? base.functions).map((f) => [f.library + ":" + f.id, f]),
          );
        for (const f of extra.definitions ?? []) {
          const key = f.library + ":" + f.id;
          if (
            existing.has(key) &&
            JSON.stringify({ ...existing.get(key), xml: undefined }) !==
              JSON.stringify({ ...f, xml: undefined })
          )
            throw new Error("GUI_LIBRARY_PROFILE_CONFLICT: " + key);
          existing.set(key, f);
        }
        const combine = (field: keyof NonNullable<Registry["typeDefinitions"]>): any[] => [
          ...(base.typeDefinitions?.[field] ?? []),
          ...(extra.typeDefinitions?.[field] ?? []),
        ];
        parsed = {
          ...base,
          definitions: [...existing.values()],
          typeDefinitions: {
            presets: combine("presets"),
            presetValues: combine("presetValues"),
            structures: combine("structures"),
            variables: combine("variables"),
          },
          externalVariables: [
            ...new Map(
              [...(base.externalVariables ?? []), ...(extra.externalVariables ?? [])].map((v) => [
                v.library + ":" + v.id,
                v,
              ]),
            ).values(),
          ],
        };
      } else parsed = base;
      await fs.mkdir(cacheRoot, { recursive: true });
      await fs.writeFile(
        cacheFile,
        gzipSync(JSON.stringify({ revision, registry: parsed }), { level: 4 }),
      );
    }
    const libraries = [...new Set((parsed.definitions ?? parsed.functions).map((f) => f.library))];
    this.cached = { registry: parsed, revision, sources: guards, libraries, cacheHit, build };
    return this.cached;
  }
}
