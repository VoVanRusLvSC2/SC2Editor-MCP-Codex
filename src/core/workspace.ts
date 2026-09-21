import { lstatSync, promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { BinaryTransactions } from "./binaryTransactions.js";
import { internalWorkspaceDirectory } from "./discoveryPaths.js";
import { recoverFileJournals } from "./recoveryJournal.js";
import { TransactionQueue, readSnapshot, decodeUtf8, assertSnapshots, commitFiles, type FileSnapshot } from "./fileTransactions.js";
import { LayoutDocument } from "./layoutDocument.js";
import { StyleDocument } from "./styleDocument.js";
import { CrossFileResolver } from "./resolver.js";
import { validateLayout } from "./validator.js";
import { applyLayoutOperations } from "./layoutOperations.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";
import type { ApplyTransactionResult, LayoutOperation, MutationResult, ValidationReport } from "./types.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function shortPreview(before: string, after: string, max = 5000): string {
  if (before === after) return "No changes";
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix++;
  const b = before.slice(Math.max(0, prefix - 250), before.length - suffix + 250);
  const a = after.slice(Math.max(0, prefix - 250), after.length - suffix + 250);
  const text = `--- before\n${b}\n+++ after\n${a}`;
  return text.length > max ? text.slice(0, max) + "\n… preview truncated …" : text;
}

async function readOptional(file: string): Promise<{ exists: boolean; text: string }> {
  const snapshot = await readSnapshot(file); return { exists: snapshot.exists, text: decodeUtf8(snapshot.bytes, file) };
}
export interface RawTransactionOptions {
  dryRun?: boolean; stage?: boolean; backup?: boolean; expectedSha256?: Record<string, string>; summary?: string;
  backupSuffix?: string; requireMissing?: boolean | string[]; requireExisting?: boolean; accept?: () => boolean;
}
type ReadSet = Map<string, FileSnapshot> & { effective: Map<string, string> };

export class Workspace {
  readonly root: string;
  readonly binary: BinaryTransactions;
  private readonly drafts = new Map<string, string>();
  private readonly draftCreates = new Set<string>();
  readonly transactions: TransactionQueue;
  private readonly draftBases = new Map<string, FileSnapshot>();
  private readonly draftGroups = new Map<string, Set<string>>();
  private readonly draftReadSets = new Map<string, Map<string, FileSnapshot>>();
  private readonly draftEffectiveReads = new Map<string, Map<string, string>>();
  private readonly reads = new AsyncLocalStorage<ReadSet>();
  withReadSet<T>(work: () => Promise<T>): Promise<T> { return this.reads.getStore() ? work() : this.reads.run(Object.assign(new Map<string, FileSnapshot>(), { effective: new Map<string, string>() }), work); }
  get trackingReads(): boolean { return this.reads.getStore() !== undefined; }
  private captureRead(absolute: string, snapshot: FileSnapshot) {
    const reads = this.reads.getStore(); if (!reads) return;
    const previous = reads.get(absolute);
    if (previous && (previous.exists !== snapshot.exists || !previous.bytes.equals(snapshot.bytes))) throw new Error(`STALE_DEPENDENCY: ${absolute}`);
    reads.set(absolute, snapshot);
  }
  private captureEffective(absolute: string, text: string) {
    const reads = this.reads.getStore(); if (!reads) return;
    const previous = reads.effective.get(absolute);
    if (previous !== undefined && previous !== text) throw new Error(`STALE_DEPENDENCY_DRAFT: ${absolute}`);
    reads.effective.set(absolute, text);
  }
  async readDependency(file: string, optional = false): Promise<string> {
    const absolute = path.resolve(file), snapshot = await readSnapshot(absolute);
    this.captureRead(absolute, snapshot);
    if (!snapshot.exists && !optional) throw new Error(`Dependency not found: ${absolute}`);
    return decodeUtf8(snapshot.bytes, absolute);
  }
  private draftRevision = 0;
  draftFiles(): string[] { return [...this.drafts.keys()]; }
  private clearDraft(file: string) { this.drafts.delete(file); this.draftCreates.delete(file); this.draftBases.delete(file); this.draftGroups.delete(file); this.draftReadSets.delete(file); this.draftEffectiveReads.delete(file); this.draftRevision++; }
  private assertCompleteGroup(keys: string[]) {
    for (const key of keys) if ([...(this.draftGroups.get(key) ?? [])].some(file => !keys.includes(file))) throw new Error("PARTIAL_TEXT_TRANSACTION: save/discard the full staged group first");
  }


  constructor(root: string, readonly schema?: SchemaRegistry) {
    this.root = path.resolve(root);
    this.transactions = new TransactionQueue(this.root,() => recoverFileJournals(this.root,file => this.resolveUserPath(file)));
    this.binary = new BinaryTransactions(this.root, file => this.resolveUserPath(file), file => this.drafts.get(file), file => { this.clearDraft(file); }, this.transactions, files => { this.assertCompleteGroup(files); for (const file of files) if (this.drafts.has(file)) throw new Error(`TEXT_TRANSACTION_STAGED: ${file}; save/discard before binary editing`); });
  }
  recover() { return this.transactions.run(async () => ({ checked:true })); }

  resolveUserPath(file: string): string {
    const candidate = path.resolve(this.root, file);
    const rel = path.relative(this.root, candidate);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error("Path escapes SC2_UI_ROOT");
    let ancestor = this.root;
    for (const part of rel.split(path.sep).filter(Boolean)) {
      ancestor = path.join(ancestor, part);
      try { if (lstatSync(ancestor).isSymbolicLink()) throw new Error("Workspace symlink paths are not editable"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
    }
    return candidate;
  }

  private fileKey(file: string): string {
    return path.relative(this.root, this.resolveUserPath(file)).replaceAll("\\", "/");
  }

  private async listMatchingFiles(pattern: RegExp): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && internalWorkspaceDirectory(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (pattern.test(entry.name)) out.push(path.relative(this.root, full).replaceAll("\\", "/"));
      }
    };
    await walk(this.root);
    for (const file of this.drafts.keys()) if (pattern.test(file) && !out.includes(file)) out.push(file);
    return out.sort();
  }

  async listLayoutFiles(): Promise<string[]> {
    return this.listMatchingFiles(/\.(SC2Layout|StormLayout)$/i);
  }

  async listStyleFiles(): Promise<string[]> {
    return this.listMatchingFiles(/\.SC2Style$/i);
  }

  async listStringFiles(): Promise<string[]> {
    return this.listMatchingFiles(/(?:GameStrings|ObjectStrings|TriggerStrings|EditorStrings)\.txt$/i);
  }

  async listFiles(): Promise<{ layouts: string[]; styles: string[] }> {
    const [layouts, styles] = await Promise.all([this.listLayoutFiles(), this.listStyleFiles()]);
    return { layouts, styles };
  }

  async read(file: string, includeDraft = true): Promise<{ absolute: string; text: string; doc: LayoutDocument }> {
    const absolute = this.resolveUserPath(file);
    const key = this.fileKey(file);
    const raw = await this.readRaw(key, includeDraft);
    if (!raw.exists && !raw.staged) throw new Error(`File not found: ${key}`);
    const text = raw.text;
    return { absolute, text, doc: new LayoutDocument(text) };
  }

  async createFile(file: string, kind: "layout" | "style", options: { dryRun?: boolean; stage?: boolean } = {}): Promise<MutationResult> {
    const key = this.fileKey(file);
    if (!(kind === "layout" ? /\.(?:SC2Layout|StormLayout)$/i : /\.SC2Style$/i).test(key)) throw new Error(`Invalid ${kind} extension`);
    const source = kind === "layout" ? `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<Desc>\n</Desc>\n` : `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<StyleFile>\n</StyleFile>\n`;
    return (await this.applyRawTransaction([key], () => new Map([[key, source]]), { ...options, requireMissing: true, summary: `Create ${kind} file ${key}` })).files[0]!;
  }

  async readStyle(file: string, includeDraft = true): Promise<{ absolute: string; text: string; doc: StyleDocument }> {
    const absolute = this.resolveUserPath(file);
    const key = this.fileKey(file);
    const raw = await this.readRaw(key, includeDraft);
    if (!raw.exists && !raw.staged) throw new Error(`File not found: ${key}`);
    const text = raw.text;
    return { absolute, text, doc: new StyleDocument(text) };
  }

  async createLayoutWithInclude(file: string, includeIn: string, options: { dryRun?: boolean; stage?: boolean } = {}) {
    const key = this.fileKey(file), includeKey = this.fileKey(includeIn);
    if (key === includeKey || !/\.(?:SC2Layout|StormLayout)$/i.test(key)) throw new Error("Invalid layout/Include target");
    const result = await this.applyRawTransaction([key, includeKey], async sources => {
      const target = await this.readRaw(key), index = await this.readRaw(includeKey);
      if (target.exists || target.staged) throw new Error(`File already exists: ${key}`);
      if (!index.exists && !index.staged) throw new Error(`Include file not found: ${includeKey}`);
      const document = new LayoutDocument(sources.get(includeKey)!); document.addInclude(key);
      return new Map([[key, `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<Desc>\n</Desc>\n`], [includeKey, document.source]]);
    }, { ...options, summary: "Create layout and register Include as one staged group" });
    return { created: result.files[0]!, include: result.files[1]!, saveFiles: [key, includeKey] };
  }

  async readRaw(file: string, includeDraft = true): Promise<{ absolute: string; file: string; text: string; exists: boolean; staged: boolean }> {
    const absolute = this.resolveUserPath(file);
    const key = this.fileKey(file);
    const snapshot = await readSnapshot(absolute); this.captureRead(absolute, snapshot);
    const disk = { exists: snapshot.exists, text: decodeUtf8(snapshot.bytes, key) };
    const byteText = includeDraft ? await this.binary.stagedText(key) : undefined;
    const staged = includeDraft && (this.drafts.has(key) || byteText !== undefined);
    const text = byteText ?? (staged ? this.drafts.get(key)! : disk.text);
    if (includeDraft) this.captureEffective(absolute, text);
    return { absolute, file: key, text, exists: disk.exists, staged };
  }

  async applyRawTransaction(
    files: string[],
    transform: (sources: ReadonlyMap<string, string>) => Map<string, string> | Promise<Map<string, string>>,
    options: RawTransactionOptions = {},
  ): Promise<{ accepted: true; files: MutationResult[]; efficiency: { toolCalls: 1; files: number } }> {
    if (!this.trackingReads) return this.withReadSet(() => this.applyRawTransaction(files, transform, options));
    return this.transactions.run(async () => {
      const keys = [...new Set(files.map(file => this.fileKey(file)))];
      if (!keys.length || keys.length > 64) throw new Error("A raw transaction requires 1..64 files");
      this.binary.assertNoDraft(keys); this.assertCompleteGroup(keys);
      const requireMissing = new Set(options.requireMissing === true ? keys : Array.isArray(options.requireMissing) ? options.requireMissing.map(file=>this.fileKey(file)) : []);
      if([...requireMissing].some(key=>!keys.includes(key)))throw new Error("Undeclared create target");
      const revision = this.draftRevision;
      const reads = this.reads.getStore()!;
      const absoluteKeys = new Set(keys.map(key => this.resolveUserPath(key)));
      const dependencyReads = () => {
        const collected = new Map<string, FileSnapshot>();
        for (const key of keys) for (const [file, snapshot] of this.draftReadSets.get(key) ?? []) collected.set(file, snapshot);
        for (const [file, snapshot] of reads) {
          const old = collected.get(file);
          if (old && (old.exists !== snapshot.exists || !old.bytes.equals(snapshot.bytes))) throw new Error(`STALE_DEPENDENCY: ${file}`);
          collected.set(file, snapshot);
        }
        for (const file of absoluteKeys) collected.delete(file);
        return collected;
      };
      const effectiveDependencies = () => {
        const effective = new Map<string, string>();
        for (const key of keys) for (const [file, text] of this.draftEffectiveReads.get(key) ?? []) effective.set(file, text);
        for (const [file, text] of reads.effective) {
          const previous = effective.get(file);
          if (previous !== undefined && previous !== text) throw new Error(`STALE_DEPENDENCY_DRAFT: ${file}`);
          effective.set(file, text);
        }
        for (const file of absoluteKeys) effective.delete(file);
        return effective;
      };
      const verify = async () => {
        await assertSnapshots(file => file, dependencyReads());
        for (const [file, text] of effectiveDependencies()) {
          if (decodeUtf8((await this.binary.read(file)).bytes, file) !== text) throw new Error(`STALE_DEPENDENCY_DRAFT: ${file}`);
        }
      };
      const guard = () => { this.binary.assertNoDraft(keys); if (revision !== this.draftRevision) throw new Error("STALE_TEXT_DRAFT: draft changed during transaction"); };
      const disk = new Map<string, FileSnapshot>(), current = new Map<string, string>();
      for (const key of keys) {
        const snapshot = await readSnapshot(this.resolveUserPath(key)), text = decodeUtf8(snapshot.bytes, key), base = this.draftBases.get(key);
        if (base && (base.exists !== snapshot.exists || !base.bytes.equals(snapshot.bytes))) throw new Error(`STALE_TEXT_DRAFT: ${key}; disk changed after staging`);
        if (requireMissing.has(key) && (snapshot.exists || this.hasDraft(key))) throw new Error(`File already exists: ${key}`);
        if (options.requireExisting && !snapshot.exists && !this.hasDraft(key)) throw new Error(`File not found: ${key}`);
        if (options.expectedSha256?.[key] && sha256(text) !== options.expectedSha256[key]) throw new Error(`File changed since it was read: ${key}`);
        disk.set(key, snapshot); current.set(key, this.drafts.get(key) ?? text);
        this.captureRead(this.resolveUserPath(key), snapshot);
        this.captureEffective(this.resolveUserPath(key), current.get(key)!);
      }
      await verify(); guard();
      const transformed = await transform(new Map(current));
      for (const [key, value] of transformed) if (!current.has(key) || typeof value !== "string") throw new Error(`Invalid or undeclared transformer output: ${key}`);
      const next = new Map(keys.map(key => [key, transformed.get(key) ?? current.get(key)!]));
      const dryRun = options.dryRun ?? true, stage = options.stage ?? true, accepted = options.accept?.() ?? true;
      const changed = keys.filter(key => next.get(key) !== (stage ? current.get(key) : decodeUtf8(disk.get(key)!.bytes, key)) || ((requireMissing.has(key) || (!stage && this.draftCreates.has(key))) && !disk.get(key)!.exists));
      await assertSnapshots(file => this.resolveUserPath(file), disk); await verify(); guard();
      if (!dryRun && accepted && (changed.length || (!stage && keys.some(key => this.drafts.has(key))))) {
        if (stage) {
          const group = new Set(keys);
          const dependencies = dependencyReads(), effective = effectiveDependencies();
          for (const key of changed) if(!disk.get(key)!.exists)this.draftCreates.add(key);
          for (const key of keys) { this.drafts.set(key, next.get(key)!); this.draftBases.set(key, disk.get(key)!); this.draftGroups.set(key, group); }
          for (const key of keys) this.draftReadSets.set(key, dependencies);
          for (const key of keys) this.draftEffectiveReads.set(key, effective);
          this.draftRevision++;
        } else {
          await commitFiles(file => this.resolveUserPath(file), disk, new Map(changed.map(key => [key, Buffer.from(next.get(key)!)])), { backup: options.backup, backupSuffix: options.backupSuffix, guard, verify,journalRoot:this.root });
          for (const key of keys) this.clearDraft(key);
        }
      }
      return { accepted: true, files: keys.map(key => ({
        changed: changed.includes(key), beforeSha256: sha256(decodeUtf8(disk.get(key)!.bytes, key)), afterSha256: sha256(next.get(key)!), file: key, dryRun,
        staged: !dryRun && accepted && stage && changed.length > 0,
        saved: !dryRun && accepted && !stage && changed.includes(key),
        summary: options.summary ?? `Apply atomic raw transaction to ${keys.length} file(s)`, preview: !disk.get(key)!.exists&&(requireMissing.has(key)||this.draftCreates.has(key))&&next.get(key)===""?"Create empty file":shortPreview(current.get(key)!, next.get(key)!),
      })), efficiency: { toolCalls: 1, files: keys.length } };
    });
  }

  async mutate(file: string, options: { dryRun?: boolean; stage?: boolean; expectedSha256?: string; backup?: boolean; summary: string }, fn: (doc: LayoutDocument) => void): Promise<MutationResult> {
    const key = this.fileKey(file);
    return (await this.applyRawTransaction([key], sources => {
      const doc = new LayoutDocument(sources.get(key)!); fn(doc); return new Map([[key, doc.source]]);
    }, { ...options, stage: options.stage ?? false, expectedSha256: options.expectedSha256 ? { [key]: options.expectedSha256 } : undefined })).files[0]!;
  }

  async apply(
    file: string,
    operations: LayoutOperation[],
    options: {
      dryRun?: boolean;
      stage?: boolean;
      expectedSha256?: string;
      backup?: boolean;
      validate?: boolean;
      allowInvalid?: boolean;
      summary?: string;
    } = {},
  ): Promise<ApplyTransactionResult> {
    if (!this.schema) throw new Error("Schema registry is not configured");
    if (!operations.length) throw new Error("ui.apply requires at least one operation");
    if (operations.length > 100) throw new Error("ui.apply accepts at most 100 operations");

    const key = this.fileKey(file);
    let execution!: ReturnType<typeof applyLayoutOperations>;
    let validation: ValidationReport | undefined;
    let accepted = true;
    const shouldValidate = options.validate ?? true;
    const transaction = await this.applyRawTransaction([key], async sources => {
      const doc = new LayoutDocument(sources.get(key)!);
      execution = applyLayoutOperations(doc, this.schema!, operations);
      validation = shouldValidate ? validateLayout(key, doc, this.schema!, await this.resolver(new Map([[key, doc.source]]))) : undefined;
      accepted = !validation || validation.valid || Boolean(options.allowInvalid);
      return new Map([[key, doc.source]]);
    }, { ...options, requireExisting: true, expectedSha256: options.expectedSha256 ? { [key]: options.expectedSha256 } : undefined, accept: () => accepted });
    return { mutation: transaction.files[0]!, accepted, applied: execution.applied, aliases: execution.aliases, validation, efficiency: { toolCalls: 1, operations: operations.length, includesValidation: shouldValidate, includesDiff: true } };
  }

  async mutateStyle(file: string, options: { dryRun?: boolean; stage?: boolean; expectedSha256?: string; summary: string }, fn: (doc: StyleDocument) => void): Promise<MutationResult> {
    const key = this.fileKey(file);
    return (await this.applyRawTransaction([key], sources => {
      const doc = new StyleDocument(sources.get(key)!); fn(doc); return new Map([[key, doc.source]]);
    }, { ...options, expectedSha256: options.expectedSha256 ? { [key]: options.expectedSha256 } : undefined })).files[0]!;
  }

  async diff(file: string): Promise<{ file: string; changed: boolean; beforeSha256: string; afterSha256: string; preview: string }> {
    const key = this.fileKey(file);
    const disk = await readOptional(this.resolveUserPath(file));
    const draft = (await this.readRaw(key)).text;
    return {
      file: key,
      changed: disk.text !== draft,
      beforeSha256: sha256(disk.text),
      afterSha256: sha256(draft),
      preview: shortPreview(disk.text, draft),
    };
  }

  hasDraft(file: string): boolean {
    return this.drafts.has(this.fileKey(file)) || this.binary.hasDraft(file);
  }

  async save(file: string, options: { expectedSha256?: string; backup?: boolean; backupSuffix?: string } = {}): Promise<MutationResult & { savedFiles: string[] }> {
    const key = this.fileKey(file), keys = [...(this.draftGroups.get(key) ?? [key])];
    const result = await this.applyRawTransaction(keys, sources => new Map(sources), { ...options, dryRun: false, stage: false, expectedSha256: options.expectedSha256 ? { [key]: options.expectedSha256 } : undefined, summary: "Save the complete staged text transaction" });
    return { ...result.files.find(f => f.file === key)!, savedFiles: result.files.filter(f => f.saved).map(f => f.file) };
  }

  discard(file: string): boolean {
    const key = this.fileKey(file), keys = [...(this.draftGroups.get(key) ?? [key])];
    const binary = this.binary.discard(file, false).discarded;
    const existed = keys.some(f => this.drafts.has(f));
    for (const f of keys) this.clearDraft(f);
    return existed || binary;
  }

  async resolver(overrides = new Map<string, string>()): Promise<CrossFileResolver> {
    const files = await this.listFiles();
    return CrossFileResolver.build(files.layouts, files.styles, async (file) => {
      const key = this.fileKey(file);
      if (overrides.has(key)) return overrides.get(key)!;
      return (await this.readRaw(key)).text;
    });
  }

  async validate(file: string): Promise<ValidationReport> {
    if (!this.schema) throw new Error("Schema registry is not configured");
    const [{ doc }, resolver] = await Promise.all([this.read(file), this.resolver()]);
    return validateLayout(this.fileKey(file), doc, this.schema, resolver);
  }
}
