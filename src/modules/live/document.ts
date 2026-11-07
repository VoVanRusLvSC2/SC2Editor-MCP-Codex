import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import * as z from "zod/v4";
import { documentDirty, documentMatches, type EditorWindow } from "./desktop.js";
import { WindowsMemoryDesktop, type MemoryDesktop } from "./memoryDesktop.js";
import { withEditorLease } from "./editorLease.js";

export const documentTargetSchema = z
  .object({
    archive: z.string().min(1).max(4096),
    windowId: z.string().regex(/^\d+$/),
  })
  .strict();
export const documentSaveSchema = documentTargetSchema
  .extend({
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type Target = z.infer<typeof documentTargetSchema>;

/** Save the selected current document through native File > Save, never Save As. */
export class LiveDocument {
  busy = false;
  private closed = false;
  private current?: Promise<unknown>;
  constructor(
    private readonly root: string,
    private readonly desktop: MemoryDesktop = new WindowsMemoryDesktop(),
    private readonly blocked: () => boolean = () => false,
    private readonly pause = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {}
  private async archive(file: string) {
    const archive = path.resolve(this.root, file);
    if (!/\.(SC2Map|SC2Mod)$/i.test(archive) || archive.startsWith("\\\\"))
      throw Error("LIVE_DOCUMENT_LOCAL_ARCHIVE_REQUIRED");
    const stat = await fs.lstat(archive);
    const real = await fs.realpath(archive);
    const normalize = (s: string) => (process.platform === "win32" ? s.toLowerCase() : s);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 1024 ** 3 ||
      normalize(path.resolve(real)) !== normalize(archive)
    )
      throw Error("LIVE_DOCUMENT_ARCHIVE_INVALID");
    return {
      archive,
      sha256: createHash("sha256")
        .update(await fs.readFile(archive))
        .digest("hex"),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }
  private async window(target: Target, previous?: EditorWindow) {
    const w = (await this.desktop.windows()).find((w) => w.windowId === target.windowId);
    if (
      !w ||
      !w.title.startsWith("Terrain - [") ||
      !documentMatches(w, target.archive) ||
      (previous && (previous.processId !== w.processId || previous.processStart !== w.processStart))
    )
      throw Error("LIVE_DOCUMENT_WINDOW_CHANGED");
    return w;
  }
  async status(input: Target) {
    const target = documentTargetSchema.parse(input);
    const archive = await this.archive(target.archive);
    const w = await this.window({ ...target, archive: archive.archive });
    return {
      ...archive,
      windowId: w.windowId,
      processId: w.processId,
      processStart: w.processStart,
      documentDirty: documentDirty(w),
      dialogPresent: !w.enabled,
      workflow: "current_document",
      copiesCreated: 0,
      mutation: false,
    };
  }
  async save(input: z.infer<typeof documentSaveSchema>) {
    const parsed = documentSaveSchema.parse(input);
    if (this.closed || this.busy || this.blocked()) throw Error("LIVE_DOCUMENT_WORKFLOW_BUSY");
    this.busy = true;
    const task = this.saveImpl(parsed);
    this.current = task;
    try {
      return await task;
    } finally {
      this.current = undefined;
      this.busy = false;
    }
  }
  private async saveImpl(input: z.infer<typeof documentSaveSchema>) {
    const before = await this.archive(input.archive);
    if (before.sha256 !== input.expectedSha256) throw Error("LIVE_DOCUMENT_ARCHIVE_CHANGED");
    const target = { ...input, archive: before.archive };
    const window = await this.window(target);
    if (!window.enabled) throw Error("LIVE_DOCUMENT_USER_DIALOG_PRESENT");
    return withEditorLease(window, async () => {
      if ((await this.archive(target.archive)).sha256 !== before.sha256)
        throw Error("LIVE_DOCUMENT_ARCHIVE_CHANGED");
      const latest = await this.window(target, window);
      if (!latest.enabled) throw Error("LIVE_DOCUMENT_USER_DIALOG_PRESENT");
      const receipt = {
        archive: target.archive,
        windowId: window.windowId,
        application: "current_document",
        copiesCreated: 0,
        reopensMap: false,
        retryMutation: false,
      };
      if (!documentDirty(latest))
        return { ...receipt, status: "already_clean", saved: false, sha256: before.sha256 };
      // From this point a lost reply must never replay File > Save automatically.
      let requested: unknown;
      try {
        requested = await this.desktop.command(latest, 24);
        const ack = z
          .object({ saveRequested: z.literal(true) })
          .passthrough()
          .safeParse(requested);
        if (!ack.success) throw Error("LIVE_DOCUMENT_SAVE_ACK_UNCERTAIN");
        let stable: string | undefined;
        for (let i = 0; i < 100; i++) {
          await this.pause(300);
          const w = await this.window(target, window);
          if (!w.enabled) {
            stable = undefined;
            continue;
          }
          if (documentDirty(w)) {
            stable = undefined;
            continue;
          }
          const after = await this.archive(target.archive);
          const diskChanged = after.sha256 !== before.sha256 || after.mtimeMs !== before.mtimeMs;
          const stamp = `${after.sha256}:${after.mtimeMs}:${after.size}`;
          if (diskChanged && stamp === stable)
            return {
              ...receipt,
              status: "saved",
              saved: true,
              documentDirty: false,
              sha256: after.sha256,
              verification: "native_clean_title_and_stable_same_archive",
              gameplayVerified: false,
            };
          stable = stamp;
        }
        throw Error("LIVE_DOCUMENT_SAVE_NOT_CONFIRMED");
      } catch (error) {
        return {
          ...receipt,
          status: "unknown",
          saved: false,
          error: String(error),
          recovery:
            "Inspect live.document.status and native dialogs; do not automatically repeat Save",
        };
      }
    });
  }
  async close() {
    this.closed = true;
    await this.current?.catch(() => {});
    await this.desktop.close?.();
  }
}
