import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import type { Workspace } from "../../core/workspace.js";
import { directoryManifest } from "../../archive/archiveAdapter.js";
import { ComponentTransfer, ComponentTransferError } from "./componentTransfer.js";
import { currentArchive, currentModuleWindow, liveDigest } from "./identity.js";
import { WindowsMemoryDesktop, type MemoryDesktop } from "./memoryDesktop.js";
import type { EditorWindow } from "./desktop.js";
import { documentDirty } from "./desktop.js";
import { PendingText } from "./pendingText.js";
import type { LiveRuntimeFactory } from "./runtime.js";
import { withEditorLease } from "./editorLease.js";
import {
  parseNativeLocale,
  nativeLocaleSignature,
  localeComponents,
  encodeNativeLocale,
} from "./nativeLocale.js";

export const textReadSchema = z
  .object({
    archive: z.string().min(1).max(4096),
    windowId: z.string().regex(/^\d+$/),
    locale: z.string().regex(/^[a-z]{2}[A-Z]{2}$/),
    keys: z.array(z.string().min(1).max(512)).max(50).default([]),
  })
  .strict();
export const textAuthorSchema = z
  .object({
    snapshotId: z.string().uuid(),
    script: z.string().min(1).max(65536),
    apply: z.boolean().default(false),
  })
  .strict();
export const textVerifySchema = textReadSchema
  .omit({ keys: true })
  .extend({ pendingId: z.string().uuid() })
  .strict();
type Target = z.infer<typeof textReadSchema>;
interface Snapshot {
  target: Target;
  window: EditorWindow;
  archiveSha256: string;
  source: string;
  signature: string;
  expires: number;
}

/** Existing Text generator + original locale export/import of the current open document. */
export class LiveText {
  busy = false;
  private closed = false;
  private pending?: Promise<unknown>;
  private snapshots = new Map<string, Snapshot>();
  private readonly imports = new PendingText();
  constructor(
    private readonly workspace: Workspace,
    private readonly factory: () => LiveRuntimeFactory | undefined,
    private readonly desktop: MemoryDesktop = new WindowsMemoryDesktop(),
    private readonly blocked = () => false,
    private readonly pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}
  capabilities() {
    return {
      backend: "original_locale_transfer",
      tools: ["live.text.read", "live.text.author", "live.text.verify", "live.text.release"],
      scope:
        "One existing locale's exportable local text tables, including GUI names and hotkeys; existing Text generator and original import",
      copiesCreated: 0,
      reopensMap: false,
      savesMap: false,
      limits: "1 MiB/10000 entries; four snapshots for ten minutes; one locale per batch",
      unsupported: [
        "Deleting keys through a merge import",
        "Font/style/assets and other locales in the same batch",
        "Unreferenced strings absent from original export",
        "Rendered acceptance from text readback alone",
      ],
      verification:
        "Native locale exports stay stale until Save: retain shared pending guard, then live.text.verify; no import replay",
    };
  }
  private async run<T>(work: () => Promise<T>) {
    if (this.closed || this.busy || this.blocked()) throw Error("LIVE_TEXT_WORKFLOW_BUSY");
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
  private window(target: Pick<Target, "archive" | "windowId">, previous?: EditorWindow) {
    return currentModuleWindow(this.desktop, target, "Text", previous);
  }
  private async capture(window: EditorWindow, locale: string) {
    const result = await new ComponentTransfer(this.desktop, this.pause).locale(window, locale);
    if (result.source === undefined) throw Error("LIVE_TEXT_EXPORT_UNCONFIRMED");
    return { source: result.source, signature: nativeLocaleSignature(result.source) };
  }
  async read(input: Target) {
    return this.run(async () => {
      for (const [id, s] of this.snapshots) if (s.expires <= Date.now()) this.snapshots.delete(id);
      if (this.snapshots.size >= 4) throw Error("LIVE_TEXT_SNAPSHOT_LIMIT");
      const args = textReadSchema.parse(input),
        archive = await currentArchive(this.workspace.root, args.archive),
        target = { ...args, archive: archive.archive },
        w = await this.window(target);
      return withEditorLease(w, async () => {
        const pending = await this.imports.read(w, target.archive);
        if (pending) throw Error("LIVE_TEXT_PENDING_SAVE_OR_VERIFY: " + pending.id);
        const captured = await this.capture(w, target.locale),
          snapshotId = randomUUID(),
          entries = parseNativeLocale(captured.source);
        this.snapshots.set(snapshotId, {
          target,
          window: w,
          archiveSha256: archive.sha256,
          ...captured,
          expires: Date.now() + 600000,
        });
        return {
          snapshotId,
          locale: target.locale,
          entries: entries.length,
          sha256: captured.signature,
          values: entries.filter((e) => target.keys.includes(e.key)),
          copiesCreated: 0,
          mapMutation: false,
          saved: false,
        };
      });
    });
  }
  async author(input: z.infer<typeof textAuthorSchema>) {
    return this.run(async () => {
      const args = textAuthorSchema.parse(input),
        s = this.snapshots.get(args.snapshotId),
        factory = this.factory();
      if (!s || s.expires <= Date.now()) throw Error("LIVE_TEXT_SNAPSHOT_EXPIRED");
      if (!factory) throw Error("LIVE_TEXT_COMPILER_UNAVAILABLE");
      const root = path.join(
          this.workspace.root,
          ".sc2mcp-output/editor-live/text",
          randomUUID(),
          "Components",
        ),
        files = localeComponents(s.source, s.target.locale),
        defaultFile = `${s.target.locale}.SC2Data/LocalizedData/GameStrings.txt`;
      if (!files.has(defaultFile)) files.set(defaultFile, "");
      for (const [file, source] of files) {
        await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await fs.writeFile(path.join(root, file), source, { flag: "wx" });
      }
      const runtime = await factory(root);
      try {
        if (!runtime.authorText) throw Error("LIVE_TEXT_COMPILER_UNAVAILABLE");
        const result = z
          .record(z.string(), z.unknown())
          .parse(await runtime.authorText(args.script, s.target.locale));
        if (result.ok !== true)
          return { status: "preparation_failed", result, root, nativeMutationAttempted: false };
        if (runtime.workspace.draftFiles().length || runtime.workspace.binary.draftFiles().length)
          throw Error("LIVE_TEXT_INCOMPLETE_GROUP");
        const prefix = s.target.locale + ".SC2Data/",
          generated = new Map<string, string>();
        for (const { file } of await directoryManifest(root)) {
          if (
            !file.startsWith(prefix) ||
            !/^LocalizedData\/[A-Za-z][A-Za-z0-9_]*\.txt$/.test(file.slice(prefix.length))
          )
            throw Error("LIVE_TEXT_MULTI_COMPONENT_UNSUPPORTED");
          generated.set(file, await fs.readFile(path.join(root, file), "utf8"));
        }
        const candidate = encodeNativeLocale(generated, s.target.locale),
          signature = nativeLocaleSignature(candidate),
          proposed = parseNativeLocale(candidate),
          originals = parseNativeLocale(s.source),
          identity = (e: { file: string; key: string }) => e.file + "\0" + e.key,
          next = new Map(proposed.map((e) => [identity(e), e.value]));
        if (originals.some((e) => !next.has(identity(e))))
          throw Error("LIVE_TEXT_KEY_REMOVAL_UNSUPPORTED");
        const before = new Map(originals.map((e) => [identity(e), e.value])),
          changed = proposed.filter((e) => before.get(identity(e)) !== e.value);
        const receipt = {
          root,
          result,
          locale: s.target.locale,
          changed: changed.length,
          candidateSha256: liveDigest(candidate),
          copiesCreated: 0,
          reopensMap: false,
          saved: false,
        };
        if (!args.apply) return { status: "prepared", ...receipt, nativeMutationAttempted: false };
        if (!changed.length)
          return { status: "unchanged", ...receipt, nativeMutationAttempted: false };
        const w = await this.window(s.target, s.window);
        return withEditorLease(w, async () => {
          const pending = await this.imports.read(w, s.target.archive);
          if (pending) throw Error("LIVE_TEXT_PENDING_SAVE_OR_VERIFY: " + pending.id);
          if (
            (await currentArchive(this.workspace.root, s.target.archive)).sha256 !== s.archiveSha256
          )
            throw Error("LIVE_TEXT_ARCHIVE_CHANGED");
          const current = await this.capture(w, s.target.locale);
          if (current.signature !== s.signature) throw Error("LIVE_TEXT_STALE_COMPONENT");
          this.snapshots.delete(args.snapshotId);
          const pendingId = randomUUID(),
            expectedFile = path.join(path.dirname(root), "ExpectedLocale.txt");
          await fs.writeFile(expectedFile, candidate, { flag: "wx" });
          await this.imports.reserve(w, {
            id: pendingId,
            archive: s.target.archive,
            locale: s.target.locale,
            processId: w.processId,
            processStart: w.processStart,
            archiveSha256: s.archiveSha256,
            expectedFile,
            expectedSha256: liveDigest(candidate),
            signature,
          });
          try {
            const native = await new ComponentTransfer(this.desktop, this.pause).locale(
                w,
                s.target.locale,
                candidate,
              ),
              fresh = await this.window(s.target, w),
              archiveUnchanged =
                (await currentArchive(this.workspace.root, s.target.archive)).sha256 ===
                s.archiveSha256;
            return {
              status: archiveUnchanged ? "import_submitted" : "verification_failed",
              ...receipt,
              pendingId,
              native,
              nativeTextVerified: false,
              nativeSaveRequired: true,
              documentDirty: documentDirty(fresh),
              archiveUnchanged,
              visualVerified: false,
              retryMutation: false,
            };
          } catch (error) {
            return {
              status: "unknown",
              ...receipt,
              pendingId,
              error: String(error),
              ...(error instanceof ComponentTransferError
                ? { recoveryContext: error.recoveryContext }
                : {}),
              retryMutation: false,
              recovery:
                "Inspect the same Text/dialog. The pending record blocks stale exports. After native same-file Save call live.text.verify; never replay import or replace/reopen the map",
            };
          }
        });
      } finally {
        await runtime.close();
      }
    });
  }
  async verify(input: z.infer<typeof textVerifySchema>) {
    return this.run(async () => {
      const args = textVerifySchema.parse(input),
        archive = await currentArchive(this.workspace.root, args.archive),
        target = { ...args, archive: archive.archive },
        w = await this.window(target);
      return withEditorLease(w, async () => {
        const pending = await this.imports.read(w, target.archive);
        if (!pending || pending.id !== args.pendingId || pending.locale !== args.locale)
          throw Error("LIVE_TEXT_PENDING_ID_CHANGED");
        if (documentDirty(w) || archive.sha256 === pending.archiveSha256)
          return {
            status: "pending_save",
            pendingId: pending.id,
            nativeTextVerified: false,
            saved: false,
            retryMutation: false,
          };
        const stat = await fs.lstat(pending.expectedFile);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.size > 1024 * 1024 ||
          (await fs.realpath(pending.expectedFile)).toLowerCase() !==
            path.resolve(pending.expectedFile).toLowerCase()
        )
          throw Error("LIVE_TEXT_EXPECTED_COMPONENT_INVALID");
        const expected = await fs.readFile(pending.expectedFile, "utf8");
        if (
          liveDigest(expected) !== pending.expectedSha256 ||
          nativeLocaleSignature(expected) !== pending.signature
        )
          throw Error("LIVE_TEXT_EXPECTED_COMPONENT_CHANGED");
        const current = await this.capture(w, args.locale),
          fresh = await this.window(target, w),
          after = await currentArchive(this.workspace.root, target.archive);
        if (documentDirty(fresh) || after.sha256 !== archive.sha256)
          throw Error("LIVE_TEXT_VERIFICATION_CONTEXT_CHANGED");
        const verified = current.signature === pending.signature;
        // A clean changed archive and fresh original export resolve the pending
        // import, including a conflicting manual result. Never replay it.
        await this.imports.release(w, target.archive, pending.id);
        return {
          status: verified ? "verified" : "verification_failed",
          pendingId: pending.id,
          nativeTextVerified: verified,
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
    await this.pending;
    this.snapshots.clear();
    await this.desktop.close?.();
  }
}
