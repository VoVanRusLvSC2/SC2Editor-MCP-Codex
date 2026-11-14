import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import { documentTargetSchema, LiveDocument } from "./document.js";
import { currentDocumentMatches } from "./documentIdentity.js";
import { liveFileDigest } from "./identity.js";
import { withEditorLease } from "./editorLease.js";
import { WindowsMemoryDesktop, type MemoryDesktop } from "./memoryDesktop.js";

export const liveTerrainFlattenSchema = documentTargetSchema
  .extend({
    entireMap: z.literal(true),
    clearUndo: z.literal(true),
    height: z.number().min(0).max(16),
  })
  .strict();
const dialogSchema = z.object({
  title: z.literal("Modify Height Field"),
  fingerprint: z.string(),
  initial: z.string(),
  manualInput: z.boolean(),
});

/** Original whole-heightfield dialog; no disk-side map rewrite. */
export class LiveTerrain {
  busy = false;
  private closed = false;
  private pending?: Promise<unknown>;
  private readonly document: LiveDocument;
  constructor(
    root: string,
    private readonly desktop: MemoryDesktop = new WindowsMemoryDesktop(),
    private readonly blocked = () => false,
    private readonly pause = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {
    this.document = new LiveDocument(root, desktop);
  }
  async flatten(input: z.infer<typeof liveTerrainFlattenSchema>) {
    const args = liveTerrainFlattenSchema.parse(input);
    if (this.closed || this.busy || this.blocked()) throw Error("LIVE_TERRAIN_WORKFLOW_BUSY");
    this.busy = true;
    const task = this.flattenImpl(args);
    this.pending = task;
    try {
      return await task;
    } finally {
      this.pending = undefined;
      this.busy = false;
    }
  }
  private async flattenImpl(args: z.infer<typeof liveTerrainFlattenSchema>) {
    const target = { archive: args.archive, windowId: args.windowId };
    const before = await this.document.status(target);
    target.archive = before.archive;
    if (before.dialogPresent || before.pendingInput)
      throw Error("LIVE_TERRAIN_DIALOG_OR_INPUT_PRESENT");
    const w = this.desktop.window
      ? await this.desktop.window(target.windowId)
      : (await this.desktop.windows()).find((window) => window.windowId === target.windowId);
    if (
      !w ||
      !w.enabled ||
      !w.title.startsWith("Terrain - [") ||
      !(await currentDocumentMatches(this.desktop, w, target.archive))
    )
      throw Error("LIVE_TERRAIN_WINDOW_CHANGED");
    return withEditorLease(w, async () => {
      if ((await liveFileDigest(target.archive)) !== before.sha256)
        throw Error("LIVE_TERRAIN_ARCHIVE_CHANGED");
      const token = randomUUID();
      let commitAttempted = false;
      const command = async (
        op: number,
        extra: { unit?: string; field?: string; value?: string; expected?: string } = {},
      ) => {
        const value = await this.desktop.command(w, op, { ...extra, token });
        if (value && typeof value === "object" && "error" in value)
          throw Error(String(value.error));
        return value;
      };
      const read = async () => dialogSchema.parse(await command(52));
      try {
        const begin = z.object({ status: z.literal("pending") }).parse(
          await command(51, {
            unit: randomUUID(),
            field: "terrain.heightfield",
          }),
        );
        if (begin.status !== "pending") throw Error("LIVE_HEIGHTFIELD_DIALOG_UNCONFIRMED");
        let dialog: z.infer<typeof dialogSchema> | undefined;
        for (let i = 0; i < 100; i++) {
          try {
            dialog = await read();
            break;
          } catch (error) {
            if (!String(error).includes("DIALOG_NOT_READY")) throw error;
          }
          await this.pause(100);
        }
        if (!dialog || dialog.manualInput || dialog.fingerprint !== dialog.initial)
          throw Error("LIVE_HEIGHTFIELD_DIALOG_CHANGED");
        z.object({ optionsSet: z.literal(true) }).parse(
          await command(59, {
            expected: dialog.fingerprint,
            value: String(args.height),
          }),
        );
        dialog = await read();
        if (dialog.manualInput || dialog.fingerprint !== dialog.initial)
          throw Error("LIVE_HEIGHTFIELD_DIALOG_CHANGED");
        if ((await liveFileDigest(target.archive)) !== before.sha256)
          throw Error("LIVE_TERRAIN_ARCHIVE_CHANGED");
        commitAttempted = true;
        z.object({ submitted: z.literal(true) }).parse(
          await command(58, { expected: dialog.fingerprint, value: "clearUndo" }),
        );
        for (let i = 0; i < 100; i++) {
          const current = this.desktop.window
            ? await this.desktop.window(w.windowId)
            : (await this.desktop.windows()).find((window) => window.windowId === w.windowId);
          if (
            !current ||
            current.processId !== w.processId ||
            current.processStart !== w.processStart
          )
            throw Error("LIVE_HEIGHTFIELD_WINDOW_CHANGED_AFTER_SUBMIT");
          if (current.enabled)
            return {
              status: "submitted",
              entireMap: true,
              height: args.height,
              undoHistoryCleared: "unverified",
              archive: target.archive,
              copiesCreated: 0,
              reopensMap: false,
              saved: false,
              nativeDialogClosed: true,
              terrainReadbackVerified: false,
              retryMutation: false,
            };
          await this.pause(100);
        }
        throw Error("LIVE_HEIGHTFIELD_COMPLETION_UNKNOWN");
      } catch (error) {
        if (!commitAttempted) {
          try {
            const dialog = await read();
            if (!dialog.manualInput && dialog.fingerprint === dialog.initial)
              await command(54, { expected: dialog.fingerprint });
          } catch {
            /* Preserve an unrecognised or manually edited dialog. */
          }
        }
        return {
          status: commitAttempted ? "unknown" : "stopped",
          entireMap: true,
          error: String(error),
          retryMutation: false,
          saved: false,
          recovery:
            "Inspect the same editor and any open dialog before continuing; do not replay an uncertain submission.",
        };
      }
    });
  }
  async close() {
    this.closed = true;
    await this.pending?.catch(() => {});
    await this.desktop.close?.();
  }
}
