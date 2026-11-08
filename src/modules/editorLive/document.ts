import { currentDocumentMatches } from "./documentIdentity.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { liveFileDigest } from "./identity.js";
import * as z from "zod/v4";
import { type EditorWindow } from "./desktop.js";
import { WindowsMemoryDesktop, type MemoryDesktop } from "./memoryDesktop.js";
import { withEditorLease } from "./editorLease.js";
import { acknowledgeSavedUiBuffers } from "./savedUiBuffer.js";
import { readDocumentState } from "./documentState.js";

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
interface UiBufferReceipt {
  savedUiBuffers?: Array<{ layout: string; status: string }>;
  savedUiBufferError?: string;
  recovery?: string;
}

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
    const sha256 = await liveFileDigest(archive),
      after = await fs.lstat(archive);
    if (
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      after.ino !== stat.ino ||
      after.dev !== stat.dev
    )
      throw Error("LIVE_FILE_CHANGED_DURING_HASH");
    return {
      archive,
      sha256,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }
  private async window(target: Target, previous?: EditorWindow) {
    const w = this.desktop.window
      ? await this.desktop.window(target.windowId)
      : (await this.desktop.windows()).find((w) => w.windowId === target.windowId);
    if (
      !w ||
      !w.title.startsWith("Terrain - [") ||
      !(await currentDocumentMatches(this.desktop, w, target.archive)) ||
      (previous && (previous.processId !== w.processId || previous.processStart !== w.processStart))
    )
      throw Error("LIVE_DOCUMENT_WINDOW_CHANGED");
    return w;
  }
  async status(input: Target) {
    const target = documentTargetSchema.parse(input);
    const archive = await this.archive(target.archive);
    const w = await this.window({ ...target, archive: archive.archive });
    const state = await readDocumentState(this.desktop, w, archive.archive);
    return {
      ...archive,
      windowId: w.windowId,
      processId: w.processId,
      processStart: w.processStart,
      documentDirty: state.needsSave,
      pendingXmlBuffers: state.pendingXmlBuffers,
      pendingInput: state.pendingInput,
      dirtinessScope: state.scope,
      dialogPresent: state.dialogPresent,
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
      let state = await readDocumentState(this.desktop, latest, target.archive);
      if (state.dialogPresent) throw Error("LIVE_DOCUMENT_USER_DIALOG_PRESENT");
      if (state.pendingInput) throw Error("LIVE_DOCUMENT_PENDING_INLINE_INPUT");
      const receipt = {
        archive: target.archive,
        windowId: window.windowId,
        application: "current_document",
        copiesCreated: 0,
        reopensMap: false,
        retryMutation: false,
      };
      let bufferReceipt: UiBufferReceipt = {};
      if (!state.documentDirty && state.pendingXmlBuffers > 0) {
        bufferReceipt = await this.savedBuffers(latest, target.archive, before.sha256);
        state = await readDocumentState(this.desktop, latest, target.archive);
        if (state.dialogPresent) throw Error("LIVE_DOCUMENT_USER_DIALOG_PRESENT");
        if (state.pendingInput) throw Error("LIVE_DOCUMENT_PENDING_INLINE_INPUT");
      }
      if (!state.needsSave)
        return {
          ...receipt,
          status: "already_clean",
          saved: false,
          sha256: before.sha256,
          documentDirty: false,
          dirtinessScope: state.scope,
          ...bufferReceipt,
        };
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
        let reconciledStamp: string | undefined;
        for (let i = 0; i < 100; i++) {
          await this.pause(300);
          const w = await this.window(target, window);
          if (!w.enabled) {
            stable = undefined;
            continue;
          }
          const after = await this.archive(target.archive);
          const diskChanged = after.sha256 !== before.sha256 || after.mtimeMs !== before.mtimeMs;
          const stamp = `${after.sha256}:${after.mtimeMs}:${after.size}`;
          if (diskChanged && stamp === stable) {
            if (reconciledStamp !== stamp) {
              bufferReceipt = await this.savedBuffers(w, target.archive, after.sha256);
              reconciledStamp = stamp;
            }
            const current = await readDocumentState(this.desktop, w, target.archive);
            if (!current.needsSave && !current.dialogPresent && !current.pendingInput)
              return {
                ...receipt,
                status: "saved",
                saved: true,
                documentDirty: false,
                sha256: after.sha256,
                verification: "related_native_modules_clean_and_stable_same_archive",
                dirtinessScope: current.scope,
                gameplayVerified: false,
                ...bufferReceipt,
              };
          }
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
  private async savedBuffers(
    window: EditorWindow,
    archive: string,
    sha256: string,
  ): Promise<UiBufferReceipt> {
    try {
      return {
        savedUiBuffers: await acknowledgeSavedUiBuffers(this.desktop, window, archive, sha256),
      };
    } catch (error) {
      return {
        savedUiBufferError: String(error),
        recovery:
          "Saved archive is retained; inspect this same UI buffer. Never replay Save or discard pending source.",
      };
    }
  }
}
