import { internalWorkspaceDirectory } from "../../core/discoveryPaths.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { CutsceneDocument } from "./document.js";
import { semanticCutsceneDiff } from "./diff.js";
import { applyCutsceneOperations } from "./operations.js";
import { CutsceneSchemaRegistry } from "./schemaRegistry.js";
import type { CutsceneComposeSpec, CutsceneOperation, NativeNodeSpec } from "./types.js";
import { validateCutscene } from "./validator.js";
import { parseCutsceneTime } from "./time.js";
import { Workspace } from "../../core/workspace.js";
import { assertSnapshots, decodeUtf8, readSnapshot, type FileSnapshot } from "../../core/fileTransactions.js";
import { cutsceneComponentFile, cutsceneVersionFile, registerCutsceneComponent, requireNativeCutsceneVersion } from "./documentRegistration.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function composeNativeTime(value: string): string | undefined {
  const parsed = parseCutsceneTime(value);
  if (parsed.nativeValue === "0" || parsed.decimalSeconds === "0") return undefined;
  if (parsed.nativeValue !== undefined) return parsed.nativeValue;
  throw new Error(`Cannot serialize '${value}' until discovery determines this Editor build's native time base. Use exact native ticks.`);
}

export class CutsceneWorkspace {
  readonly root: string;
  readonly workspace: Workspace;
  constructor(root: string | Workspace, readonly schema: CutsceneSchemaRegistry) {
    this.workspace = typeof root === "string" ? new Workspace(root) : root;
    this.root = this.workspace.root;
  }
  resolve(file: string): string { return this.workspace.resolveUserPath(file); }

  private key(file: string): string {
    return path.relative(this.root, this.resolve(file)).replaceAll("\\", "/");
  }

  async listFiles(): Promise<string[]> {
    const files: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "release" || internalWorkspaceDirectory(entry.name)) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (/\.(?:SC2Cutscene|StormCutscene)$/i.test(entry.name)) files.push(path.relative(this.root, full).replaceAll("\\", "/"));
      }
    };
    await walk(this.root);
    for (const file of this.workspace.draftFiles()) if (/\.(?:SC2Cutscene|StormCutscene)$/i.test(file) && !files.includes(file)) files.push(file);
    return files.sort();
  }

  /** Explicit, atomic document registration; standalone authoring never pretends to be a document. */
  async registerDocument(options: { versionTemplate?: string; dryRun?: boolean; stage?: boolean; backup?: boolean } = {}) {
    const scenes = (await this.listFiles()).filter(file => /^Base\.SC2Data\/Cutscenes\/.+\.SC2Cutscene$/i.test(file));
    if (!scenes.length) throw new Error("CUTSCENE_DOCUMENT_SCENES_MISSING: stage scenes under Base.SC2Data/Cutscenes first");
    const pinned = new Map<string, FileSnapshot>();
    for (const file of scenes) {
      const raw = await this.workspace.readRaw(file);
      if (raw.staged) throw new Error(`CUTSCENE_DRAFT_PENDING: save ${file} before document registration`);
      const snapshot = await readSnapshot(this.resolve(file));
      if (!snapshot.exists || snapshot.bytes.toString("utf8") !== raw.text) throw new Error(`STALE_CUTSCENE: ${file}`);
      if (!validateCutscene(new CutsceneDocument(raw.text, file), this.schema).valid) throw new Error(`CUTSCENE_INVALID: ${file}`);
      pinned.set(file, snapshot);
    }
    let template: Buffer | undefined;
    const version = await this.workspace.binary.read(cutsceneVersionFile);
    if (!version.exists && !version.staged) {
      if (!options.versionTemplate) throw new Error("CUTSCENE_VERSION_TEMPLATE_REQUIRED: no synthetic native version metadata is generated");
      const key = this.key(options.versionTemplate);
      const snapshot = await readSnapshot(this.resolve(key));
      if (!snapshot.exists) throw new Error("CUTSCENE_VERSION_TEMPLATE_MISSING");
      requireNativeCutsceneVersion(snapshot.bytes); pinned.set(key, snapshot); template = snapshot.bytes;
    }
    const result = await this.workspace.binary.apply([cutsceneComponentFile, cutsceneVersionFile], sources => {
      const bytes = sources.get(cutsceneComponentFile)!;
      if (!bytes.length) throw new Error("CUTSCENE_COMPONENT_MANIFEST_MISSING");
      const registered = registerCutsceneComponent(decodeUtf8(bytes, cutsceneComponentFile));
      const currentVersion = sources.get(cutsceneVersionFile)!;
      const versionBytes = currentVersion.length ? currentVersion : template;
      if (!versionBytes) throw new Error("CUTSCENE_VERSION_TEMPLATE_REQUIRED");
      requireNativeCutsceneVersion(versionBytes);
      return new Map([[cutsceneComponentFile, Buffer.from(registered.source)], [cutsceneVersionFile, versionBytes]]);
    }, { ...options, verify: () => assertSnapshots(file => this.resolve(file), pinned) });
    return { ...result, scenes, component: "cuts", logicalRoot: "Cutscenes/Index", versionFile: cutsceneVersionFile,
      validationScope: "Known native component registration and preserved Editor version bytes; Editor opening and playback remain unverified",
      editorValidation: "NOT_EXECUTED", runtimeValidation: "NOT_EXECUTED" };
  }

  async open(file: string): Promise<{ file: string; source: string; document: CutsceneDocument; staged: boolean }> {
    const raw = await this.workspace.readRaw(file);
    if (!raw.exists && !raw.staged) throw new Error(`File not found: ${raw.file}`);
    return { file: raw.file, source: raw.text, document: new CutsceneDocument(raw.text, raw.file), staged: raw.staged };
  }

  async create(file: string, options: { name?: string; version?: string; dryRun?: boolean; stage?: boolean } = {}) {
    const key = this.key(file);
    if (!/\.SC2Cutscene$/i.test(key)) throw new Error("Cutscene files must end in .SC2Cutscene");
    const document = CutsceneDocument.create(options), validation = validateCutscene(document, this.schema);
    const result = await this.workspace.applyRawTransaction([key], () => new Map([[key, document.source]]), { ...options, requireMissing: true, accept: () => validation.valid });
    return { ...result.files[0]!, source: document.source, validation };
  }

  async apply(file: string, operations: CutsceneOperation[], options: { dryRun?: boolean; stage?: boolean; expectedSha256?: string; validate?: boolean; allowInvalid?: boolean } = {}) {
    if (!operations.length || operations.length > 250) throw new Error("cutscene.apply requires 1..250 operations");
    const key = this.key(file);
    let before!: CutsceneDocument, candidate!: CutsceneDocument, execution!: ReturnType<typeof applyCutsceneOperations>;
    let report: ReturnType<typeof validateCutscene> | undefined, accepted = true;
    const result = await this.workspace.applyRawTransaction([key], sources => {
      before = new CutsceneDocument(sources.get(key)!, key); candidate = new CutsceneDocument(before.source, key);
      execution = applyCutsceneOperations(candidate, this.schema, operations);
      report = options.validate === false ? undefined : validateCutscene(candidate, this.schema);
      accepted = !report || report.valid || Boolean(options.allowInvalid);
      return new Map([[key, candidate.source]]);
    }, { ...options, requireExisting: true, expectedSha256: options.expectedSha256 ? { [key]: options.expectedSha256 } : undefined, accept: () => accepted, backupSuffix: ".sc2editormcp.bak" });
    return { ...result.files[0]!, accepted, applied: execution.applied, aliases: execution.aliases, validation: report, diff: semanticCutsceneDiff(before, candidate), efficiency: { toolCalls: 1, operations: operations.length, includesValidation: options.validate !== false, includesDiff: true } };
  }

  async compose(spec: CutsceneComposeSpec, options: { dryRun?: boolean; stage?: boolean; allowInvalid?: boolean } = {}) {
    const key = this.key(spec.file);
    if (!/\.SC2Cutscene$/i.test(key)) throw new Error("Cutscene files must end in .SC2Cutscene");
    const document = CutsceneDocument.create({ name: spec.name, version: spec.version });
    if (spec.duration !== undefined) {
      if (!this.schema.getProperty("CutsceneState", "duration")) throw new Error("Root duration serialization is not confirmed by the current discovery schema. Run discovery against the installed Editor/corpus before composing a duration.");
      document.setAttribute({ nodeId: document.root().id }, "duration", spec.duration);
    }
    const nativeObjects: NativeNodeSpec[] = [...(spec.objects ?? [])];
    if (spec.director) nativeObjects.unshift(spec.director);
    else if (spec.bookmarks?.length) nativeObjects.unshift({
      nativeType: "CCutsceneNodeDirector",
      attrs: { name: "Director", sortIndex: 0, interactive: 1 },
      children: [{
        nativeType: "CCutsceneNodeBookmark",
        attrs: { name: "Bookmarks", sortIndex: 0 },
        children: spec.bookmarks.map((bookmark) => {
          const time = bookmark.time === undefined ? undefined : composeNativeTime(bookmark.time);
          return {
            nativeType: "CCutsceneElementBookmark",
            attrs: {
              bookmarkName: bookmark.name,
              ...(time === undefined ? {} : { start: time }),
              ...(bookmark.jumpToBookmarkWhenHit ? { jumpToBookmarkWhenHit: bookmark.jumpToBookmarkWhenHit } : {}),
            },
          };
        }),
      }],
    });
    nativeObjects.push(...(spec.filters ?? []));
    const operations: CutsceneOperation[] = [
      ...nativeObjects.map<CutsceneOperation>((object) => ({ op: "object.add", object })),
      ...(spec.entries ?? []).map<CutsceneOperation>((entry) => ({ op: "object.add", as: entry.as, parent: entry.parent, object: entry.node })),
      ...(spec.operations ?? []),
    ];
    applyCutsceneOperations(document, this.schema, operations);
    const validation = validateCutscene(document, this.schema);
    const accepted = validation.valid || Boolean(options.allowInvalid);
    const dryRun = options.dryRun ?? true;
    const stage = options.stage ?? true;
    await this.workspace.applyRawTransaction([key], () => new Map([[key, document.source]]), { ...options, requireMissing: true, accept: () => accepted, backupSuffix: ".sc2editormcp.bak" });
    return {
      file: key,
      accepted,
      changed: true,
      dryRun,
      staged: accepted && !dryRun && stage,
      saved: accepted && !dryRun && !stage,
      sha256: document.sha256,
      source: document.source,
      validation,
      efficiency: { toolCalls: 1, operations: operations.length, includesValidation: true, includesDiff: true },
    };
  }

  async diff(file: string) {
    const key = this.key(file), disk = await this.workspace.readRaw(key, false), draft = await this.workspace.readRaw(key);
    return { file: key, changed: disk.text !== draft.text, beforeSha256: sha256(disk.text), afterSha256: sha256(draft.text), ...semanticCutsceneDiff(new CutsceneDocument(disk.text, key), new CutsceneDocument(draft.text, key)) };
  }
  async validate(file: string) { return validateCutscene((await this.open(file)).document, this.schema); }
  async save(file: string, options: { expectedSha256?: string; backup?: boolean } = {}) {
    const key = this.key(file), previous = await this.workspace.readRaw(key, false);
    const result = await this.workspace.save(key, { ...options, backupSuffix: ".sc2editormcp.bak" });
    return { ...result, backup: result.saved && previous.exists && (options.backup ?? true) ? `${key}.sc2editormcp.bak` : undefined };
  }
  discard(file: string): boolean { return this.workspace.discard(this.key(file)); }
  async export(file: string, output: string, options: { backup?: boolean } = {}) {
    const source = await this.open(file), outputKey = this.key(output);
    if (!/\.SC2Cutscene$/i.test(outputKey)) throw new Error("Export target must end in .SC2Cutscene");
    const previous = await this.workspace.readRaw(outputKey, false);
    await this.workspace.applyRawTransaction([outputKey], () => new Map([[outputKey, source.source]]), { dryRun: false, stage: false, backup: options.backup, backupSuffix: ".sc2editormcp.bak", expectedSha256: { [outputKey]: sha256(previous.text) } });
    return { source: this.key(file), output: outputKey, sha256: sha256(source.source), backup: previous.exists && (options.backup ?? true) ? `${outputKey}.sc2editormcp.bak` : undefined };
  }
}
