import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import type { Workspace } from "../../core/workspace.js";
import { inspectArchive, readArchiveEntry } from "../../archive/archiveAdapter.js";
import { currentArchive, currentModuleWindow, liveDigest } from "./identity.js";
import { documentDirty, type EditorWindow } from "./desktop.js";
import { WindowsMemoryDesktop, type MemoryDesktop } from "./memoryDesktop.js";
import { withEditorLease } from "./editorLease.js";
import { PendingComponent } from "./pendingComponent.js";
import { stageImport, ImportTransfer, type StagedImport } from "./importTransfer.js";
import { ComponentTransferError } from "./componentTransfer.js";
import { documentTargetSchema } from "./document.js";
import { forbiddenResourceName } from "./resourcePolicy.js";

const assetName = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
  .refine((n) => !n.includes("..") && !forbiddenResourceName(n), "Resource files only");
const fileSchema = z
  .object({
    name: assetName,
    size: z
      .number()
      .int()
      .positive()
      .max(1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const pendingSchema = documentTargetSchema
  .omit({ windowId: true })
  .extend({
    id: z.string().uuid(),
    processId: z.number().int().positive(),
    processStart: z.string().regex(/^\d+$/),
    archiveSha256: z.string().regex(/^[a-f0-9]{64}$/),
    prefix: z.string().max(96),
    files: z.array(fileSchema).min(1).max(16),
  })
  .strict();
export const importPrepareSchema = documentTargetSchema
  .extend({
    prefix: z
      .string()
      .min(8)
      .max(96)
      .regex(/^Assets\/(?:[A-Za-z0-9_-]+\/)+$/),
    files: z
      .array(z.object({ source: z.string().min(1).max(4096), name: assetName }).strict())
      .min(1)
      .max(16),
  })
  .strict();
export const importApplySchema = z.object({ snapshotId: z.string().uuid() }).strict();
export const importVerifySchema = documentTargetSchema
  .extend({ pendingId: z.string().uuid() })
  .strict();
const treeSchema = z.object({
  trees: z.array(
    z.object({
      id: z.number(),
      count: z.number(),
      fingerprint: z.string(),
      truncated: z.boolean(),
      items: z.array(z.object({ handle: z.string(), parent: z.string(), text: z.string() })),
    }),
  ),
});
interface Snapshot {
  target: z.infer<typeof importPrepareSchema>;
  window: EditorWindow;
  archiveSha256: string;
  treeHash: string;
  paths: string[];
  staged: StagedImport;
  expires: number;
}
export interface ImportArchiveReader {
  names(archive: string): Promise<string[]>;
  read(archive: string, entry: string): Promise<Buffer>;
}
const archiveReader: ImportArchiveReader = {
  names: async (archive) =>
    (await inspectArchive(archive)).entries.map((e) => e.name.replaceAll("\\", "/")),
  read: readArchiveEntry,
};

/** Add-only resource import through the visible original editor; archive access is read-only. */
export class LiveImports {
  busy = false;
  private closed = false;
  private active?: Promise<unknown>;
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly pending = new PendingComponent(
    "pending-imports",
    pendingSchema,
    "LIVE_IMPORT_PENDING",
  );
  constructor(
    private readonly workspace: Workspace,
    private readonly desktop: MemoryDesktop = new WindowsMemoryDesktop(),
    private readonly blocked = () => false,
    private readonly archives: ImportArchiveReader = archiveReader,
    private readonly pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}
  capabilities() {
    return {
      backend: "original_import_files",
      tools: [
        "live.import.prepare",
        "live.import.apply",
        "live.import.verify",
        "live.import.release",
      ],
      scope:
        "Add new resource files under Assets/<folder>/ through original folder selection and Import Files",
      limits:
        "16 flat files; 1 MiB per file/8 MiB total; 128 original tree nodes; four ten-minute snapshots",
      copiesCreated: 0,
      reopensMap: false,
      savesMap: false,
      unsupported: [
        "Overwrite/remove imports",
        "Reserved map components and executable/source distribution",
        "Atomic linked component application",
        "Files above 1 MiB",
      ],
      verification:
        "Native tree readback, then requested native Save and exact saved bytes; uncertain submissions never replay",
    };
  }
  private async run<T>(work: () => Promise<T>) {
    if (this.closed || this.busy || this.blocked()) throw Error("LIVE_IMPORT_WORKFLOW_BUSY");
    this.busy = true;
    const task = work();
    this.active = task;
    try {
      return await task;
    } finally {
      this.active = undefined;
      this.busy = false;
    }
  }
  private window(target: { archive: string; windowId: string }, before?: EditorWindow) {
    return currentModuleWindow(this.desktop, target, "Import", before);
  }
  private async tree(w: EditorWindow) {
    const parsed = treeSchema.parse(await this.desktop.command(w, 50, { field: "trees" })),
      tree = parsed.trees.find((t) => t.id === 15);
    if (!tree || tree.truncated || tree.count !== tree.items.length)
      throw Error("LIVE_IMPORT_TREE_BOUND");
    const paths = new Map<string, string>();
    for (const item of tree.items) {
      const parent = item.parent === "0" ? "" : paths.get(item.parent);
      if (parent === undefined || !item.text || /[\\/]/.test(item.text))
        throw Error("LIVE_IMPORT_TREE_UNSUPPORTED");
      paths.set(item.handle, parent ? parent + "/" + item.text : item.text);
    }
    return { hash: tree.fingerprint, paths: [...paths.values()] };
  }
  async prepare(input: z.infer<typeof importPrepareSchema>) {
    return this.run(async () => {
      for (const [id, s] of this.snapshots) if (s.expires <= Date.now()) this.snapshots.delete(id);
      if (this.snapshots.size >= 4) throw Error("LIVE_IMPORT_SNAPSHOT_LIMIT");
      const args = importPrepareSchema.parse(input),
        archive = await currentArchive(this.workspace.root, args.archive),
        target = { ...args, archive: archive.archive },
        w = await this.window(target);
      return withEditorLease(w, async () => {
        const pending = await this.pending.read(w, target.archive);
        if (pending) throw Error("LIVE_IMPORT_PENDING_SAVE_OR_VERIFY: " + pending.id);
        const tree = await this.tree(w),
          savedNames = await this.archives.names(target.archive),
          existing = new Set([...tree.paths, ...savedNames].map((n) => n.toLowerCase())),
          names = new Set<string>(),
          files = [];
        let total = 0;
        for (const file of args.files) {
          const name = file.name.toLowerCase(),
            destination = (args.prefix + name).toLowerCase();
          if (
            names.has(name) ||
            existing.has(destination) ||
            savedNames.some((e) => destination.startsWith(e.toLowerCase() + "/"))
          )
            throw Error("LIVE_IMPORT_DESTINATION_EXISTS");
          names.add(name);
          const source = this.workspace.resolveUserPath(file.source),
            stat = await fs.lstat(source);
          if (forbiddenResourceName(source)) throw Error("LIVE_IMPORT_SOURCE_INVALID");
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            !stat.size ||
            stat.size > 1024 * 1024 ||
            (await fs.realpath(source)).toLowerCase() !== path.resolve(source).toLowerCase()
          )
            throw Error("LIVE_IMPORT_SOURCE_INVALID");
          const bytes = await fs.readFile(source);
          if (bytes.length !== stat.size || (bytes[0] === 77 && bytes[1] === 90))
            throw Error("LIVE_IMPORT_SOURCE_INVALID");
          total += bytes.length;
          if (total > 8 * 1024 * 1024) throw Error("LIVE_IMPORT_BYTE_BOUND");
          files.push({ name: file.name, bytes });
        }
        const staged = await stageImport(files, this.desktop, w),
          snapshotId = randomUUID();
        if (
          (await currentArchive(this.workspace.root, target.archive)).sha256 !== archive.sha256 ||
          (await this.tree(await this.window(target, w))).hash !== tree.hash
        )
          throw Error("LIVE_IMPORT_PREPARATION_CONTEXT_CHANGED");
        this.snapshots.set(snapshotId, {
          target,
          window: w,
          archiveSha256: archive.sha256,
          treeHash: tree.hash,
          paths: tree.paths,
          staged,
          expires: Date.now() + 600000,
        });
        return {
          status: "prepared",
          snapshotId,
          files: staged.files.map((f) => ({ ...f, destination: args.prefix + f.name })),
          nativeMutationAttempted: false,
          copiesCreated: 0,
          reopensMap: false,
          saved: false,
        };
      });
    });
  }
  async apply(input: z.infer<typeof importApplySchema>) {
    return this.run(async () => {
      const args = importApplySchema.parse(input),
        s = this.snapshots.get(args.snapshotId);
      if (!s || s.expires <= Date.now()) throw Error("LIVE_IMPORT_SNAPSHOT_EXPIRED");
      const w = await this.window(s.target, s.window);
      return withEditorLease(w, async () => {
        const pending = await this.pending.read(w, s.target.archive);
        if (pending) throw Error("LIVE_IMPORT_PENDING_SAVE_OR_VERIFY: " + pending.id);
        if (
          (await currentArchive(this.workspace.root, s.target.archive)).sha256 !==
            s.archiveSha256 ||
          (await this.tree(w)).hash !== s.treeHash
        )
          throw Error("LIVE_IMPORT_STALE_COMPONENT");
        this.snapshots.delete(args.snapshotId);
        const pendingId = randomUUID();
        await this.pending.reserve(w, {
          id: pendingId,
          archive: s.target.archive,
          processId: w.processId,
          processStart: w.processStart,
          archiveSha256: s.archiveSha256,
          prefix: s.target.prefix,
          files: s.staged.files,
        });
        try {
          const native = await new ImportTransfer(this.desktop, this.pause).apply(
              w,
              s.staged,
              s.target.prefix,
            ),
            fresh = await this.window(s.target, w),
            actual = await this.tree(fresh),
            found = new Set(actual.paths.map((n) => n.toLowerCase())),
            nativeTreeVerified = s.staged.files.every((f) =>
              found.has((s.target.prefix + f.name).toLowerCase()),
            ),
            previousPathsPreserved = s.paths.every((p) => found.has(p.toLowerCase())),
            archiveUnchanged =
              (await currentArchive(this.workspace.root, s.target.archive)).sha256 ===
              s.archiveSha256;
          return {
            status:
              nativeTreeVerified && previousPathsPreserved && archiveUnchanged
                ? "import_submitted"
                : "verification_failed",
            pendingId,
            native,
            nativeTreeVerified,
            previousPathsPreserved,
            archiveUnchanged,
            documentDirty: documentDirty(fresh),
            nativeSaveRequired: true,
            saved: false,
            copiesCreated: 0,
            reopensMap: false,
            retryMutation: false,
            visualVerified: false,
          };
        } catch (error) {
          return {
            status: "unknown",
            pendingId,
            error: String(error),
            ...(error instanceof ComponentTransferError
              ? { recoveryContext: error.recoveryContext }
              : {}),
            retryMutation: false,
            saved: false,
            copiesCreated: 0,
          };
        }
      });
    });
  }
  async verify(input: z.infer<typeof importVerifySchema>) {
    return this.run(async () => {
      const args = importVerifySchema.parse(input),
        archive = await currentArchive(this.workspace.root, args.archive),
        target = { ...args, archive: archive.archive },
        w = await this.window(target);
      return withEditorLease(w, async () => {
        const pending = await this.pending.read(w, target.archive);
        if (!pending || pending.id !== args.pendingId)
          throw Error("LIVE_IMPORT_PENDING_ID_CHANGED");
        if (documentDirty(w) || pending.archiveSha256 === archive.sha256)
          return {
            status: "pending_save",
            pendingId: pending.id,
            saved: false,
            retryMutation: false,
          };
        const names = new Set(
            (await this.archives.names(target.archive)).map((n) => n.toLowerCase()),
          ),
          results = [];
        for (const file of pending.files) {
          const entry = pending.prefix + file.name;
          const bytes = names.has(entry.toLowerCase())
            ? await this.archives.read(target.archive, entry)
            : undefined;
          results.push({
            file: entry,
            verified: !!bytes && bytes.length === file.size && liveDigest(bytes) === file.sha256,
          });
        }
        const fresh = await this.window(target, w);
        if (
          documentDirty(fresh) ||
          (await currentArchive(this.workspace.root, target.archive)).sha256 !== archive.sha256
        )
          throw Error("LIVE_IMPORT_VERIFICATION_CONTEXT_CHANGED");
        await this.pending.release(w, target.archive, pending.id);
        return {
          status: results.every((f) => f.verified) ? "verified" : "verification_failed",
          pendingId: pending.id,
          files: results,
          saved: true,
          sha256: archive.sha256,
          copiesCreated: 0,
          reopensMap: false,
          retryMutation: false,
          visualVerified: false,
        };
      });
    });
  }
  release(id: string) {
    this.snapshots.delete(z.string().uuid().parse(id));
    return { released: true, mapMutation: false };
  }
  async close() {
    this.closed = true;
    await this.active;
    this.snapshots.clear();
    await this.desktop.close?.();
  }
}
