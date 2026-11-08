import { promises as fs } from "node:fs";
import path from "node:path";
import { transferDirectory } from "./transferDirectory.js";
import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import type { Workspace } from "../../core/workspace.js";
import { directoryManifest } from "../../archive/archiveAdapter.js";
import { ComponentTransfer } from "./componentTransfer.js";
import { currentArchive, currentModuleWindow, liveDigest } from "./identity.js";
import { layoutXmlSignature, layoutXmlLimit } from "./layoutXml.js";
import { WindowsMemoryDesktop, type MemoryDesktop } from "./memoryDesktop.js";
import type { EditorWindow } from "./desktop.js";
import type { LiveRuntimeFactory } from "./runtime.js";
import { withEditorLease } from "./editorLease.js";

export const uiReadSchema = z
  .object({
    archive: z.string().min(1).max(4096),
    windowId: z.string().regex(/^\d+$/),
    layout: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,79}$/),
  })
  .strict();
export const uiAuthorSchema = z
  .object({
    snapshotId: z.string().uuid(),
    script: z.string().min(1).max(65536),
    apply: z.boolean().default(false),
  })
  .strict();
type Target = z.infer<typeof uiReadSchema>;
interface Snapshot {
  target: Target;
  window: EditorWindow;
  archiveSha256: string;
  source: string;
  fingerprint: string;
  expires: number;
}
const file = "Base.SC2Data/UI/Layout/LiveLayout.SC2Layout";
const treeSchema = z.object({
  id: z.number(),
  fingerprint: z.string(),
  truncated: z.boolean(),
  items: z.array(z.object({ handle: z.string(), text: z.string() })),
});
const record = z.record(z.string(), z.unknown());
const label = (s: string) => s.replace(/\*$/, "").replace(/\.SC2Layout$/i, "");

/** UI source edits through the current original editor, using the existing UI compiler. */
export class LiveUi {
  busy = false;
  private closed = false;
  private pending?: Promise<unknown>;
  private snapshots = new Map<string, Snapshot>();
  constructor(
    private readonly workspace: Workspace,
    private readonly factory: () => LiveRuntimeFactory | undefined,
    private readonly desktop: MemoryDesktop = new WindowsMemoryDesktop(),
    private readonly blocked = () => false,
    private readonly pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}
  capabilities() {
    return {
      backend: "original_ui_xml",
      tools: ["live.ui.create", "live.ui.read", "live.ui.author", "live.ui.release"],
      scope:
        "Create a local layout or edit one existing current map-local UI XML buffer with existing typed UI operations",
      copiesCreated: 0,
      reopensMap: false,
      savesMap: false,
      limits:
        "1 MiB; 4 snapshots for 10 minutes; one layout per batch; ASCII layout names up to 80 characters",
      unsupported: [
        "Additional localized Text/import/style files in the same batch",
        "Writes to dependency layouts",
        "Rendered/gameplay acceptance from XML alone",
      ],
      verification: "Native XML, native tree and same-file persistence remain distinct",
    };
  }
  private async run<T>(work: () => Promise<T>) {
    if (this.closed || this.busy || this.blocked()) throw Error("LIVE_UI_WORKFLOW_BUSY");
    this.busy = true;
    const task = work();
    this.pending = task;
    try {
      return await task;
    } finally {
      this.pending = undefined;
      this.busy = false;
    }
  }
  private async command(
    w: EditorWindow,
    op: number,
    args: Parameters<MemoryDesktop["command"]>[2] = {},
  ) {
    const value = record.parse(await this.desktop.command(w, op, args));
    if (value.error || value.status === "unknown")
      throw Error(String(value.error ?? "LIVE_UI_NATIVE_UNKNOWN"));
    return value;
  }
  private async window(target: Target, previous?: EditorWindow) {
    return currentModuleWindow(this.desktop, target, "UI", previous);
  }
  private async local(w: EditorWindow, target: Target) {
    await this.command(w, 61, { field: path.basename(target.archive) });
  }
  private async tree(w: EditorWindow) {
    const value = z
        .object({ trees: z.array(treeSchema) })
        .parse(await this.command(w, 50, { field: "roots" })),
      tree = value.trees.find((t) => t.id === 18);
    if (!tree || tree.truncated) throw Error("LIVE_UI_ROOTS_BOUND");
    return tree;
  }
  private async select(w: EditorWindow, target: Target) {
    await this.local(w, target);
    const tree = await this.tree(w),
      matches = tree.items.filter((n) => label(n.text) === target.layout);
    if (matches.length !== 1) throw Error("LIVE_UI_LAYOUT_AMBIGUOUS");
    z.object({ selectionRequested: z.literal(true) }).parse(
      await this.command(w, 55, {
        unit: "18",
        field: matches[0].handle,
        expected: tree.fingerprint,
        value: "roots",
      }),
    );
  }
  private async transfer(w: EditorWindow, id: string, candidate = false) {
    const directory = await transferDirectory(this.desktop, w, "ui");
    return path.join(directory, id + (candidate ? ".candidate.xml" : ".xml"));
  }
  private async capture(w: EditorWindow, target: Target) {
    const id = randomUUID(),
      value = await this.command(w, 60, {
        unit: target.layout,
        field: path.basename(target.archive),
        token: id,
      });
    if (value.snapshotExported !== true || typeof value.fingerprint !== "string")
      throw Error("LIVE_UI_SNAPSHOT_UNCONFIRMED");
    const location = await this.transfer(w, id),
      stat = await fs.lstat(location);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== value.bytes ||
      stat.size > layoutXmlLimit
    )
      throw Error("LIVE_UI_SNAPSHOT_INVALID");
    const source = await fs.readFile(location, "utf8");
    layoutXmlSignature(source);
    return { source, fingerprint: value.fingerprint, bufferModified: value.bufferModified };
  }
  async create(input: Target) {
    return this.run(async () => {
      const parsed = uiReadSchema.parse(input),
        archive = await currentArchive(this.workspace.root, parsed.archive),
        target = { ...parsed, archive: archive.archive },
        w = await this.window(target);
      return withEditorLease(w, async () => {
        await this.local(w, target);
        const before = await this.tree(w);
        if (before.items.some((n) => label(n.text) === target.layout))
          throw Error("LIVE_UI_LAYOUT_EXISTS");
        try {
          await new ComponentTransfer(this.desktop, this.pause).layout(w, target.layout);
          const fresh = await this.window(target, w);
          await this.local(fresh, target);
          const after = await this.tree(fresh),
            added = after.items.filter((n) => label(n.text) === target.layout),
            rest = after.items
              .filter((n) => label(n.text) !== target.layout)
              .map((n) => label(n.text))
              .sort();
          const verified =
            added.length === 1 &&
            JSON.stringify(rest) === JSON.stringify(before.items.map((n) => label(n.text)).sort());
          const unchanged =
            (await currentArchive(this.workspace.root, target.archive)).sha256 === archive.sha256;
          return {
            status: verified && unchanged ? "created" : "verification_failed",
            layout: target.layout,
            nativeRootVerified: verified,
            archiveUnchanged: unchanged,
            copiesCreated: 0,
            reopensMap: false,
            saved: false,
            retryMutation: false,
          };
        } catch (error) {
          return {
            status: "unknown",
            layout: target.layout,
            error: String(error),
            retryMutation: false,
            recovery:
              "Inspect the same current UI layout/dialog; never repeat creation or replace/reopen the map",
          };
        }
      });
    });
  }
  async read(input: Target) {
    return this.run(async () => {
      for (const [id, s] of this.snapshots) if (s.expires <= Date.now()) this.snapshots.delete(id);
      if (this.snapshots.size >= 4) throw Error("LIVE_UI_SNAPSHOT_LIMIT");
      const args = uiReadSchema.parse(input),
        archive = await currentArchive(this.workspace.root, args.archive),
        target = { ...args, archive: archive.archive },
        w = await this.window(target);
      return withEditorLease(w, async () => {
        await this.local(w, target);
        let captured: Awaited<ReturnType<LiveUi["capture"]>>;
        try {
          captured = await this.capture(w, target);
        } catch (error) {
          if (!String(error).includes("LIVE_UI_LOCAL_LAYOUT_REQUIRED")) throw error;
          await this.select(w, target);
          captured = await this.capture(w, target);
        }
        const id = randomUUID();
        this.snapshots.set(id, {
          target,
          window: w,
          archiveSha256: archive.sha256,
          ...captured,
          expires: Date.now() + 600000,
        });
        return {
          snapshotId: id,
          layout: target.layout,
          bytes: Buffer.byteLength(captured.source),
          sha256: liveDigest(captured.source),
          bufferModified: captured.bufferModified,
          copiesCreated: 0,
          mapMutation: false,
          saved: false,
        };
      });
    });
  }
  async author(input: z.infer<typeof uiAuthorSchema>) {
    return this.run(async () => {
      const args = uiAuthorSchema.parse(input),
        s = this.snapshots.get(args.snapshotId),
        factory = this.factory();
      if (!s || s.expires <= Date.now()) throw Error("LIVE_UI_SNAPSHOT_EXPIRED");
      if (!factory) throw Error("LIVE_UI_COMPILER_UNAVAILABLE");
      const id = randomUUID(),
        root = path.join(this.workspace.root, ".sc2mcp-output/editor-live/ui", id, "Components");
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), s.source, { flag: "wx" });
      const before = await directoryManifest(root),
        runtime = await factory(root);
      try {
        if (!runtime.authorUi) throw Error("LIVE_UI_COMPILER_UNAVAILABLE");
        const result = record.parse(await runtime.authorUi(args.script, file));
        if (result.ok !== true)
          return { status: "preparation_failed", result, nativeMutationAttempted: false, root };
        if (runtime.workspace.draftFiles().length || runtime.workspace.binary.draftFiles().length)
          throw Error("LIVE_UI_INCOMPLETE_GROUP");
        const after = await directoryManifest(root);
        if (
          JSON.stringify(before.filter((f) => f.file !== file)) !==
          JSON.stringify(after.filter((f) => f.file !== file))
        )
          throw Error("LIVE_UI_MULTI_COMPONENT_UNSUPPORTED");
        const candidate = await fs.readFile(path.join(root, file), "utf8"),
          signature = layoutXmlSignature(candidate);
        const receipt = {
          root,
          file,
          result,
          candidateSha256: liveDigest(candidate),
          copiesCreated: 0,
          reopensMap: false,
          saved: false,
        };
        if (!args.apply) return { status: "prepared", ...receipt, nativeMutationAttempted: false };
        this.snapshots.delete(args.snapshotId);
        const w = await this.window(s.target, s.window);
        return withEditorLease(w, async () => {
          if (
            (await currentArchive(this.workspace.root, s.target.archive)).sha256 !== s.archiveSha256
          )
            throw Error("LIVE_UI_ARCHIVE_CHANGED");
          const current = await this.capture(w, s.target);
          if (current.source !== s.source || current.fingerprint !== s.fingerprint)
            throw Error("LIVE_UI_STALE_BUFFER");
          const token = randomUUID();
          await fs.writeFile(await this.transfer(w, token, true), candidate, { flag: "wx" });
          try {
            const native = await this.command(w, 62, {
              unit: s.target.layout,
              field: path.basename(s.target.archive),
              expected: s.fingerprint,
              value: liveDigest(candidate),
              token,
            });
            await this.pause(400);
            const fresh = await this.window(s.target, w),
              readback = await this.capture(fresh, s.target);
            const verified = layoutXmlSignature(readback.source) === signature,
              unchanged =
                (await currentArchive(this.workspace.root, s.target.archive)).sha256 ===
                s.archiveSha256;
            const nativeTree = await this.command(fresh, 50, { field: "trees" });
            const nativeTreeFile = path.join(path.dirname(root), "NativeTree.json");
            await fs.writeFile(nativeTreeFile, JSON.stringify(nativeTree, null, 2) + "\n", {
              flag: "wx",
            });
            const nativeTrees = z
              .object({
                trees: z.array(
                  z.object({
                    id: z.number(),
                    count: z.number(),
                    truncated: z.boolean(),
                    fingerprint: z.string(),
                  }),
                ),
              })
              .parse(nativeTree);
            return {
              status: verified && unchanged ? "buffer_applied" : "verification_failed",
              ...receipt,
              native,
              nativeXmlVerified: verified,
              archiveUnchanged: unchanged,
              nativeTree: { ...nativeTrees, file: nativeTreeFile },
              nativeModelVerified: false,
              visualVerified: false,
              retryMutation: false,
            };
          } catch (error) {
            return {
              status: "unknown",
              ...receipt,
              error: String(error),
              retryMutation: false,
              recovery:
                "Inspect this same UI buffer/model; never repeat the write, replace the archive or reopen the map",
            };
          }
        });
      } finally {
        await runtime.close();
      }
    });
  }
  release(id: string) {
    this.snapshots.delete(z.string().uuid().parse(id));
    return { released: true, mapMutation: false };
  }
  async close() {
    this.closed = true;
    await this.pending;
    this.snapshots.clear();
    await this.desktop.close?.();
  }
}
