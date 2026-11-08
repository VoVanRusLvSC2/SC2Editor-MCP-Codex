import { currentDocumentMatches } from "./documentIdentity.js";
import { liveFileDigest } from "./identity.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import * as z from "zod/v4";
import type { Workspace } from "../../core/workspace.js";
import { type EditorWindow } from "./desktop.js";
import { WindowsMemoryDesktop, type MemoryDesktop } from "./memoryDesktop.js";
import { withEditorLease } from "./editorLease.js";
import type { LiveRuntimeFactory } from "./runtime.js";
import { ComponentTransfer } from "./componentTransfer.js";
import { createTriggerLibrary, libraryLimit, triggerLibrarySignature } from "./triggerLibrary.js";
import { triggerPlanSchema } from "../trigger/schemas.js";
import { nativeGuiProfile } from "../trigger/nativeProfile.js";
import { directoryManifest } from "../../archive/archiveAdapter.js";

export const triggerTargetSchema = z
  .object({ archive: z.string().min(1).max(4096), windowId: z.string().regex(/^\d+$/) })
  .strict();
export const triggerPrepareSchema = triggerTargetSchema
  .extend({
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(
        (value) => Array.from(value).every((c) => c.charCodeAt(0) >= 32 && c !== "*"),
        "Control characters and asterisks are not permitted",
      ),
    planFile: z.string().min(1).max(4096),
  })
  .strict();
export const triggerVerifySchema = triggerTargetSchema
  .extend({ name: triggerPrepareSchema.shape.name, expectedFile: z.string().min(1).max(4096) })
  .strict();
const treeSchema = z.object({
  id: z.number(),
  count: z.number(),
  fingerprint: z.string(),
  truncated: z.boolean(),
  items: z.array(z.object({ handle: z.string(), text: z.string() })),
});
const rootsSchema = z.object({ trees: z.array(treeSchema) });
type Target = z.infer<typeof triggerTargetSchema>;
type Tree = z.infer<typeof treeSchema>;
interface PreparedLibrary {
  target: Target;
  window: EditorWindow;
  archiveSha256: string;
  roots: Tree;
  source: string;
  name: string;
  root: string;
  expires: number;
  nativeProfile: unknown;
}
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const label = (text: string) => text.replace(/\*$/, "");
function toolValue(raw: unknown) {
  const envelope = z
    .object({
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
      isError: z.boolean().optional(),
    })
    .parse(raw);
  const value = JSON.parse(envelope.content.find((c) => c.type === "text")?.text ?? "null");
  if (envelope.isError || !value || typeof value !== "object")
    throw Error("LIVE_TRIGGER_GENERATOR_FAILED");
  return value as Record<string, unknown>;
}

/** Add a self-contained GUI library through the current document's original importer.
 * Existing map graphs are never exported to another map or replaced offline.
 */
export class LiveTriggers {
  busy = false;
  private closed = false;
  private pending?: Promise<unknown>;
  private readonly plans = new Map<string, PreparedLibrary>();
  constructor(
    private readonly workspace: Workspace,
    private readonly factory: () => LiveRuntimeFactory | undefined,
    private readonly desktop: MemoryDesktop = new WindowsMemoryDesktop(),
    private readonly blocked = () => false,
  ) {}
  capabilities() {
    return {
      backend: "original_trigger_library_import",
      tools: [
        "live.trigger.inspect",
        "live.trigger.prepare",
        "live.trigger.apply",
        "live.trigger.verify",
        "live.trigger.release",
      ],
      scope:
        "Add one self-contained native GUI library with real folders, typed events/actions/variables/functions from an existing GUI plan file",
      copiesCreated: 0,
      reopensMap: false,
      savesMap: false,
      limits:
        "1 MiB; Core references only; English embedded names; 4 prepared libraries for 10 minutes",
      unsupported: [
        "Replacing or editing existing map-root/library graphs",
        "Custom Script",
        "Map-instance references",
        "Non-name localization and translated strings",
      ],
      evidence:
        "Original re-export verifies the new library separately from native compile, runtime and gameplay",
    };
  }
  private async run<T>(work: () => Promise<T>) {
    if (this.closed || this.busy || this.blocked()) throw Error("LIVE_TRIGGER_WORKFLOW_BUSY");
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
  private async archive(file: string) {
    const archive = path.resolve(this.workspace.root, file),
      stat = await fs.lstat(archive);
    if (
      !/\.(SC2Map|SC2Mod)$/i.test(archive) ||
      archive.startsWith("\\\\") ||
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 1024 ** 3 ||
      path.resolve(await fs.realpath(archive)).toLowerCase() !== archive.toLowerCase()
    )
      throw Error("LIVE_TRIGGER_LOCAL_ARCHIVE_REQUIRED");
    return { archive, sha256: await liveFileDigest(archive) };
  }
  private async window(target: Target, previous?: EditorWindow) {
    const w = this.desktop.window
      ? await this.desktop.window(target.windowId)
      : (await this.desktop.windows()).find((w) => w.windowId === target.windowId);
    if (
      !w ||
      !w.enabled ||
      !w.title.startsWith("Triggers - [") ||
      !(await currentDocumentMatches(this.desktop, w, target.archive)) ||
      (previous && (w.processId !== previous.processId || w.processStart !== previous.processStart))
    )
      throw Error("LIVE_TRIGGER_EXACT_WINDOW_REQUIRED");
    return w;
  }
  private async roots(w: EditorWindow) {
    const result = rootsSchema.parse(await this.desktop.command(w, 50, { field: "roots" }));
    const tree = result.trees.find((t) => t.id === 28);
    if (!tree || tree.truncated) throw Error("LIVE_TRIGGER_NATIVE_ROOTS_UNREADABLE");
    return tree;
  }
  async inspect(input: Target) {
    return this.run(async () => {
      const target = triggerTargetSchema.parse(input),
        archive = await this.archive(target.archive);
      target.archive = archive.archive;
      const w = await this.window(target);
      return withEditorLease(w, async () => ({
        roots: await this.roots(w),
        archiveSha256: archive.sha256,
        windowId: w.windowId,
        copiesCreated: 0,
        mapMutation: false,
      }));
    });
  }
  async prepare(input: z.infer<typeof triggerPrepareSchema>) {
    return this.run(async () => {
      for (const [id, plan] of this.plans) if (plan.expires <= Date.now()) this.plans.delete(id);
      if (this.plans.size >= 4) throw Error("LIVE_TRIGGER_PREPARED_LIMIT");
      const args = triggerPrepareSchema.parse(input),
        factory = this.factory();
      if (!factory) throw Error("LIVE_TRIGGER_GENERATOR_UNAVAILABLE");
      const archive = await this.archive(args.archive),
        target = { archive: archive.archive, windowId: args.windowId };
      const w = await this.window(target),
        roots = await withEditorLease(w, () => this.roots(w));
      if (roots.items.some((n) => label(n.text) === args.name))
        throw Error("LIVE_TRIGGER_NAME_EXISTS");
      const raw = await this.workspace.readRaw(args.planFile);
      if (!raw.exists || raw.staged || Buffer.byteLength(raw.text) > libraryLimit)
        throw Error("LIVE_TRIGGER_SAVED_PLAN_REQUIRED");
      const parsed: unknown = JSON.parse(raw.text),
        requests = z
          .array(triggerPlanSchema)
          .min(1)
          .max(100)
          .parse(Array.isArray(parsed) ? parsed : [parsed]);
      if (
        requests.some((r) => r.stringFiles?.length) ||
        /"translations"\s*:|"objectId"\s*:/.test(raw.text)
      )
        throw Error("LIVE_TRIGGER_EXTERNAL_CONTEXT_UNSUPPORTED");
      const id = randomUUID(),
        root = path.join(
          this.workspace.root,
          ".sc2mcp-output/editor-live/triggers",
          id,
          "Components",
        );
      await fs.mkdir(path.join(root, "enUS.SC2Data/LocalizedData"), { recursive: true });
      await fs.writeFile(path.join(root, "Triggers"), "<TriggerData><Root/></TriggerData>", {
        flag: "wx",
      });
      await fs.writeFile(
        path.join(root, "requests.json"),
        JSON.stringify(
          requests.map((r) => ({
            ...r,
            stringFiles: ["enUS.SC2Data/LocalizedData/TriggerStrings.txt"],
          })),
        ),
        { flag: "wx" },
      );
      const runtime = await factory(root);
      try {
        const plan = toolValue(await runtime.call("trigger.plan_file", { file: "requests.json" }));
        toolValue(await runtime.call("trigger.apply", { planId: plan.planId, dryRun: false }));
        toolValue(await runtime.call("trigger.save", { backup: false }));
        if (runtime.workspace.draftFiles().length || runtime.workspace.binary.draftFiles().length)
          throw Error("LIVE_TRIGGER_INCOMPLETE_GROUP");
        const manifest = await directoryManifest(root);
        if (
          manifest.some(
            (f) =>
              ![
                "Triggers",
                "requests.json",
                "enUS.SC2Data/LocalizedData/TriggerStrings.txt",
              ].includes(f.file),
          )
        )
          throw Error("LIVE_TRIGGER_EXTRA_COMPONENT");
        const xml = await fs.readFile(path.join(root, "Triggers"), "utf8");
        const strings = await fs
          .readFile(path.join(root, "enUS.SC2Data/LocalizedData/TriggerStrings.txt"), "utf8")
          .catch((e) => {
            if (e.code === "ENOENT") return "";
            throw e;
          });
        const source = createTriggerLibrary(xml, strings, args.name);
        const file = path.join(path.dirname(root), "Prepared.SC2Lib");
        await fs.writeFile(file, source, { flag: "wx" });
        const profile = nativeGuiProfile(xml);
        this.plans.set(id, {
          target,
          window: w,
          archiveSha256: archive.sha256,
          roots,
          source,
          name: args.name,
          root,
          expires: Date.now() + 600000,
          nativeProfile: profile,
        });
        return {
          status: "prepared",
          planId: id,
          name: args.name,
          file,
          bytes: Buffer.byteLength(source),
          sha256: digest(source),
          nativeProfile: profile,
          copiesCreated: 0,
          mapMutation: false,
          saved: false,
        };
      } finally {
        await runtime.close();
      }
    });
  }
  async apply(planId: string) {
    return this.run(async () => {
      const id = z.string().uuid().parse(planId),
        p = this.plans.get(id);
      if (!p || p.expires <= Date.now()) throw Error("LIVE_TRIGGER_PLAN_EXPIRED");
      const w = await this.window(p.target, p.window);
      return withEditorLease(w, async () => {
        if (
          (await this.archive(p.target.archive)).sha256 !== p.archiveSha256 ||
          (await this.roots(w)).fingerprint !== p.roots.fingerprint
        )
          throw Error("LIVE_TRIGGER_PLAN_STALE");
        this.plans.delete(id); // Consume before native submission. Never replay import.
        const receipt = {
          name: p.name,
          root: p.root,
          copiesCreated: 0,
          reopensMap: false,
          saved: false,
          retryMutation: false,
          nativeProfile: p.nativeProfile,
        };
        try {
          const transfer = new ComponentTransfer(this.desktop);
          await transfer.library(w, p.source);
          const fresh = await this.window(p.target, w),
            roots = await this.roots(fresh);
          const added = roots.items.filter((n) => label(n.text) === p.name);
          const oldLabels = p.roots.items.map((n) => label(n.text)).sort();
          const retained = roots.items
            .filter((n) => label(n.text) !== p.name)
            .map((n) => label(n.text))
            .sort();
          if (added.length !== 1 || JSON.stringify(oldLabels) !== JSON.stringify(retained))
            throw Error("LIVE_TRIGGER_ROOT_READBACK_FAILED");
          const selection = z.object({ selectionRequested: z.literal(true) }).parse(
            await this.desktop.command(fresh, 55, {
              unit: "28",
              field: added[0].handle,
              expected: roots.fingerprint,
              value: "roots",
            }),
          );
          if (!selection.selectionRequested) throw Error("LIVE_TRIGGER_SELECTION_UNKNOWN");
          const readback = await transfer.library(fresh);
          if (!readback.source) throw Error("LIVE_TRIGGER_REEXPORT_UNCONFIRMED");
          await fs.writeFile(path.join(path.dirname(p.root), "Native.SC2Lib"), readback.source, {
            flag: "wx",
          });
          const verified =
            triggerLibrarySignature(p.source) === triggerLibrarySignature(readback.source);
          const unchanged = (await this.archive(p.target.archive)).sha256 === p.archiveSha256;
          return {
            status: verified && unchanged ? "applied" : "verification_failed",
            ...receipt,
            nativeLibraryVerified: verified,
            existingRootLabelsVerified: true,
            archiveUnchanged: unchanged,
            nativeCompileVerified: false,
            visualVerified: false,
          };
        } catch (error) {
          return {
            status: "unknown",
            ...receipt,
            error: String(error),
            recovery:
              "Inspect this same document/library/dialog; do not repeat import, replace the archive or reopen the map",
          };
        }
      });
    });
  }
  async verify(input: z.infer<typeof triggerVerifySchema>) {
    return this.run(async () => {
      const args = triggerVerifySchema.parse(input),
        archive = await this.archive(args.archive);
      const target = { archive: archive.archive, windowId: args.windowId },
        w = await this.window(target);
      const expected = await this.workspace.readRaw(args.expectedFile);
      if (!expected.exists || expected.staged) throw Error("LIVE_TRIGGER_SAVED_LIBRARY_REQUIRED");
      const signature = triggerLibrarySignature(expected.text);
      return withEditorLease(w, async () => {
        const roots = await this.roots(w),
          candidates = roots.items.filter((n) => label(n.text) === args.name);
        if (candidates.length !== 1) throw Error("LIVE_TRIGGER_LIBRARY_AMBIGUOUS");
        z.object({ selectionRequested: z.literal(true) }).parse(
          await this.desktop.command(w, 55, {
            unit: "28",
            field: candidates[0].handle,
            expected: roots.fingerprint,
            value: "roots",
          }),
        );
        const exported = await new ComponentTransfer(this.desktop).library(w);
        if (!exported.source) throw Error("LIVE_TRIGGER_REEXPORT_UNCONFIRMED");
        const verified = triggerLibrarySignature(exported.source) === signature;
        return {
          status: verified ? "verified" : "verification_failed",
          nativeLibraryVerified: verified,
          file: exported.file,
          name: args.name,
          nativeCompileVerified: false,
          mapMutation: false,
          saved: false,
          copiesCreated: 0,
          retryMutation: false,
        };
      });
    });
  }
  release(id: string) {
    this.plans.delete(z.string().uuid().parse(id));
    return { released: true, mapMutation: false };
  }
  async close() {
    this.closed = true;
    await this.pending;
    this.plans.clear();
    await this.desktop.close?.();
  }
}
