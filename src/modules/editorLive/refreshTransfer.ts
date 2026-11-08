import { promises as fs } from "node:fs";
import path from "node:path";
import * as z from "zod/v4";
import type { MemoryDesktop } from "./memoryDesktop.js";
import { documentDirty, type EditorWindow } from "./desktop.js";
import { currentDocumentMatches } from "./documentIdentity.js";
import { currentArchive } from "./identity.js";

export interface RefreshDesktop extends MemoryDesktop {
  present(window: EditorWindow, archive: string): Promise<unknown>;
}
export const refreshNativeState = z.object({
  refreshReady: z.boolean(),
  refreshFingerprint: z.string(),
  dialogs: z.array(z.unknown()),
  openDocuments: z.number().int().nonnegative().optional(),
});
export function refreshReadinessError(
  window: EditorWindow,
  state: z.infer<typeof refreshNativeState>,
) {
  if (state.openDocuments !== undefined && state.openDocuments !== 1)
    return "LIVE_REFRESH_SINGLE_DOCUMENT_REQUIRED";
  if (state.dialogs.length) return "LIVE_REFRESH_NATIVE_DIALOG_PRESENT";
  if (documentDirty(window) || !state.refreshReady)
    return "LIVE_REFRESH_SAVE_PENDING_BUFFERS_FIRST";
  return undefined;
}
export interface RefreshRecord {
  id: string;
  archive: string;
  processId: number;
  processStart: string;
  windowId: string;
  sourceSha256: string;
  candidateSha256: string;
  directory: string;
  candidate: string;
  rollback: string;
  opening: string;
}

/** Native release/open state machine. An uncertain close/open is never replayed. */
export class RefreshTransfer {
  constructor(
    private readonly desktop: RefreshDesktop,
    private readonly pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}
  async window(record: Pick<RefreshRecord, "windowId" | "processId" | "processStart">) {
    const w = this.desktop.window
      ? await this.desktop.window(record.windowId)
      : (await this.desktop.windows()).find((w) => w.windowId === record.windowId);
    if (!w || w.processId !== record.processId || w.processStart !== record.processStart)
      throw Error("LIVE_REFRESH_PROCESS_OR_FRAME_CHANGED");
    return w;
  }
  private empty(w: EditorWindow) {
    return w.enabled && w.acceptsFiles && w.title === "Terrain - StarCraft II Editor";
  }
  async inspect(w: EditorWindow) {
    return refreshNativeState.parse(await this.desktop.command(w, 25));
  }
  async release(w: EditorWindow, fingerprint: string, record: RefreshRecord) {
    const result = z
      .object({ closeRequested: z.literal(true) })
      .parse(await this.desktop.command(w, 26, { expected: fingerprint, token: record.id }));
    for (let i = 0; i < 80; i++) {
      const now = await this.window(record);
      if (this.empty(now)) {
        try {
          const handle = await fs.open(record.archive, "r+");
          await handle.close();
          return result;
        } catch (error) {
          if (!["EBUSY", "EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? ""))
            throw error;
        }
      } else if (now.enabled && !(await currentDocumentMatches(this.desktop, now, record.archive)))
        throw Error("LIVE_REFRESH_OTHER_DOCUMENT_ACTIVE");
      await this.pause(100);
    }
    throw Error("LIVE_REFRESH_SOURCE_RELEASE_UNKNOWN");
  }
  async publish(record: RefreshRecord) {
    const w = await this.window(record);
    if (
      !this.empty(w) ||
      (await currentArchive(path.dirname(record.archive), record.archive)).sha256 !==
        record.sourceSha256 ||
      (await currentArchive(path.dirname(record.candidate), record.candidate)).sha256 !==
        record.candidateSha256
    )
      throw Error("LIVE_REFRESH_PUBLICATION_CONTEXT_CHANGED");
    // Destination and candidate are on the same filesystem. No open archive is replaced.
    await fs.rename(record.candidate, record.archive);
    if (
      (await currentArchive(path.dirname(record.archive), record.archive)).sha256 !==
      record.candidateSha256
    )
      throw Error("LIVE_REFRESH_PUBLISHED_HASH_UNKNOWN");
  }
  async publication(record: RefreshRecord) {
    const current = await currentArchive(path.dirname(record.archive), record.archive),
      publication =
        current.sha256 === record.candidateSha256
          ? "candidate"
          : current.sha256 === record.sourceSha256
            ? "original"
            : "conflict";
    return {
      archiveSha256: current.sha256,
      publication,
      sourcePublished: publication === "conflict" ? null : publication === "candidate",
    };
  }
  private async outcome(
    record: RefreshRecord,
    window: EditorWindow,
    status: string,
    observedSha256: string,
  ) {
    const current = await this.publication(record);
    return {
      ...current,
      status: current.archiveSha256 === observedSha256 ? status : "conflict",
      window,
      retryMutation: false,
    };
  }
  private async loaded(record: RefreshRecord, w: EditorWindow, sha256: string, published: boolean) {
    const native = await this.inspect(w);
    return this.outcome(
      record,
      w,
      native.refreshReady ? (published ? "refreshed" : "not_published") : "pending_native",
      sha256,
    );
  }
  async recover(record: RefreshRecord) {
    const current = await this.publication(record),
      published = current.publication === "candidate";
    if (current.publication === "conflict")
      return { ...current, status: "conflict", retryMutation: false };
    let w = await this.window(record);
    const loaded = async () =>
      w.enabled &&
      !documentDirty(w) &&
      (await currentDocumentMatches(this.desktop, w, record.archive));
    if (await loaded()) return this.loaded(record, w, current.archiveSha256, published);
    if (!this.empty(w)) return this.outcome(record, w, "pending_native", current.archiveSha256);
    let opening = false;
    try {
      const file = await fs.open(record.opening, "wx");
      try {
        await file.writeFile(JSON.stringify({ window: w, sha256: current.archiveSha256 }) + "\n");
      } finally {
        await file.close();
      }
      opening = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (opening) await this.desktop.present(w, record.archive);
    for (let i = 0; i < 240; i++) {
      w = await this.window(record);
      if (await loaded()) return this.loaded(record, w, current.archiveSha256, published);
      if (w.enabled && !this.empty(w))
        return this.outcome(record, w, "context_changed", current.archiveSha256);
      await this.pause(200);
    }
    return this.outcome(record, w, "pending_open", current.archiveSha256);
  }
}
