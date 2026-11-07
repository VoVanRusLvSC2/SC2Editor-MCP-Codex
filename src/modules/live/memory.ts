import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import * as z from "zod/v4";
import { withEditorLease } from "./editorLease.js";
import { documentDirty, documentMatches, type EditorWindow } from "./desktop.js";
import { WindowsMemoryDesktop, type MemoryDesktop } from "./memoryDesktop.js";

export const memoryFieldSchema = z.enum([
  "LifeMax",
  "LifeStart",
  "ShieldsMax",
  "ShieldsStart",
  "EnergyMax",
  "EnergyStart",
  "Speed",
  "LifeArmor",
]);
export const memoryValueSchema = z.number().finite().min(0).lt(524288);
export const memoryReadSchema = z
  .object({
    archive: z.string().min(1).max(4096),
    windowId: z.string().regex(/^\d+$/),
    unit: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,126}$/),
    field: memoryFieldSchema,
  })
  .strict();
type Target = z.infer<typeof memoryReadSchema>;
interface Context extends Target {
  window: EditorWindow;
  sha256: string;
}
interface Snapshot extends Context {
  value: number;
  expires: number;
}
const selectedSchema = z.object({
  selected: z.literal(true),
  source: z.string(),
  refreshRequired: z.boolean().optional(),
});
const editorSchema = z.object({
  editor: z.literal("inline"),
  unit: z.string(),
  field: z.string(),
  value: z.string(),
});
const objectSchema = z.record(z.string(), z.unknown());
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Bounded native scalar editing. Checkpoint publication and native tests stay separate. */
export class LiveMemory {
  private readonly snapshots = new Map<string, Snapshot>();
  busy = false;
  private closed = false;
  private current?: Promise<unknown>;

  constructor(
    private readonly root: string,
    private readonly desktop: MemoryDesktop = new WindowsMemoryDesktop(),
    private readonly blocked: () => boolean = () => false,
    private readonly pause: (ms: number) => Promise<void> = delay,
  ) {}

  capabilities() {
    return {
      backend: "native_data_controls",
      directInMemoryMutation: true,
      application: "in_memory",
      optIn: true,
      supported: {
        catalog: "Unit",
        fields: memoryFieldSchema.options,
        existingMapLocalObjectsOnly: true,
      },
      editorBuild: "5.0.17.98310",
      language: "English Data controls",
      startsEditor: false,
      reopensMap: false,
      savesMap: false,
      adapter:
        "Separate project DLL loaded only by an explicit live.memory.read/set request; resident until Editor exits",
      limitations: [
        "No live Terrain, placements, triggers, arbitrary XML or object creation",
        "Field inspection uses the native inline editor and may mark the document dirty even when cancelled",
        "No background continuous synchronization; each completed call applies one guarded field edit",
        "Native Undo remains Editor-owned; no global undo command is exposed",
      ],
      build: "npm run live:build && npm run live:memory:build",
    };
  }

  private async archive(file: string) {
    const absolute = path.resolve(this.root, file);
    if (!/\.(SC2Map|SC2Mod)$/i.test(absolute) || absolute.startsWith("\\\\"))
      throw Error("LIVE_MEMORY_LOCAL_ARCHIVE_REQUIRED");
    const stat = await fs.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 ** 3)
      throw Error("LIVE_MEMORY_ARCHIVE_INVALID");
    const real = await fs.realpath(absolute);
    const normalize = (s: string) => (process.platform === "win32" ? s.toLowerCase() : s);
    if (normalize(path.resolve(real)) !== normalize(absolute))
      throw Error("LIVE_MEMORY_ARCHIVE_ALIAS_REFUSED");
    return { archive: absolute, sha256: digest(await fs.readFile(absolute)) };
  }

  private async window(
    context: Pick<Context, "archive" | "windowId"> & { window?: EditorWindow },
    owned = false,
  ) {
    const windows = await this.desktop.windows();
    const window = windows.find((w) => w.windowId === context.windowId);
    if (
      !window ||
      !window.title.startsWith("Data - [") ||
      !documentMatches(window, context.archive)
    )
      throw Error("LIVE_MEMORY_EXACT_DATA_WINDOW_REQUIRED");
    if (
      context.window &&
      (window.processId !== context.window.processId ||
        window.processStart !== context.window.processStart)
    )
      throw Error("LIVE_MEMORY_EDITOR_CHANGED");
    if (!owned && !window.enabled) throw Error("LIVE_MEMORY_USER_DIALOG_PRESENT");
    return window;
  }

  private async command(
    context: Context,
    operation: number,
    args: Parameters<MemoryDesktop["command"]>[2] = {},
  ) {
    // The native helper revalidates HWND/PID/start/title on every request. Dirty
    // marker changes are allowed; changing the underlying document is refused.
    const result = objectSchema.parse(await this.desktop.command(context.window, operation, args));
    if (result.error || result.status === "unknown")
      throw Error(String(result.error ?? "LIVE_MEMORY_NATIVE_UNCERTAIN"));
    return result;
  }

  private async settled(context: Context) {
    // Inspection can be repeated; native edit/commit/cancel requests are never replayed.
    for (let i = 0; i < 12; i++) {
      await this.pause(80);
      try {
        const result = await this.command(context, 0);
        const controls = z
          .array(z.object({ id: z.number(), type: z.string() }))
          .parse(result.controls);
        if (!controls.some((c) => c.id === 65535 && c.type === "Edit")) return;
      } catch (error) {
        if (!String(error).includes("LIVE_MEMORY_EDIT_BUSY")) throw error;
      }
    }
    throw Error("LIVE_MEMORY_INLINE_CLOSE_UNCONFIRMED");
  }

  private async open(context: Context, token: string, expected = "", value = "0") {
    const prepared = await this.command(context, 1, context);
    if (prepared.refreshRequired !== false) await this.pause(650);
    let unitReady = false;
    for (let i = 0; i < 20; i++) {
      if ((await this.command(context, 0, context)).unitReady === true) {
        unitReady = true;
        break;
      }
      await this.pause(150);
    }
    if (!unitReady) throw Error("LIVE_MEMORY_UNIT_NOT_READY");
    const selection = selectedSchema.parse(await this.command(context, 2, context));
    if (selection.source !== path.basename(context.archive))
      throw Error("LIVE_MEMORY_MAP_LOCAL_OBJECT_REQUIRED");
    if (selection.refreshRequired !== false) await this.pause(650);
    let ready = false;
    for (let i = 0; i < 20; i++) {
      const state = await this.command(context, 0, context);
      if (state.fieldReady === true) {
        ready = true;
        break;
      }
      await this.pause(150);
    }
    if (!ready) throw Error("LIVE_MEMORY_FIELD_NOT_READY");
    const opened = await this.command(context, 3, { ...context, token, expected, value });
    if (opened.editOpened !== true && opened.status !== "pending")
      throw Error("LIVE_MEMORY_EDIT_NOT_OPENED");
    await this.pause(80);
    const editor = editorSchema.parse(await this.command(context, 4, { token }));
    if (
      editor.unit !== context.unit ||
      editor.field !== context.field ||
      !/^\d+(?:\.\d+)?$/.test(editor.value.trim())
    )
      throw Error("LIVE_MEMORY_COMPLETE_VALUE_REQUIRED");
    return memoryValueSchema.parse(Number(editor.value));
  }

  private async cancel(context: Context, token: string) {
    const result = await this.command(context, 6, { token });
    if (result.cancelRequested !== true) throw Error("LIVE_MEMORY_CANCEL_UNCONFIRMED");
    await this.settled(context);
  }

  private async inspectValue(context: Context) {
    const token = randomUUID();
    let cancelling = false;
    try {
      const value = await this.open(context, token);
      cancelling = true;
      await this.cancel(context, token);
      return value;
    } catch (error) {
      // Only a token-bound editor opened by this call may be cancelled.
      if (!cancelling) {
        try {
          await this.cancel(context, token);
        } catch {
          /* Preserve original failure; no second mutation attempt. */
        }
      }
      throw error;
    }
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed || this.busy || this.blocked()) throw Error("LIVE_MEMORY_WORKFLOW_BUSY");
    this.busy = true;
    const task = work();
    this.current = task;
    try {
      return await task;
    } finally {
      this.busy = false;
      this.current = undefined;
    }
  }

  private async lease<T>(context: Context, work: () => Promise<T>) {
    return withEditorLease(context.window, work);
  }

  async read(input: Target) {
    return this.exclusive(async () => {
      const target = memoryReadSchema.parse(input);
      const archive = await this.archive(target.archive);
      const context: Context = {
        ...target,
        ...archive,
        window: await this.window({ ...target, ...archive }),
      };
      return this.lease(context, async () => {
        const value = await this.inspectValue(context);
        if ((await this.archive(context.archive)).sha256 !== context.sha256)
          throw Error("LIVE_MEMORY_ARCHIVE_CHANGED");
        const snapshotId = randomUUID();
        for (const [id, snapshot] of this.snapshots)
          if (snapshot.expires < Date.now()) this.snapshots.delete(id);
        if (this.snapshots.size >= 64) this.snapshots.delete(this.snapshots.keys().next().value!);
        this.snapshots.set(snapshotId, { ...context, value, expires: Date.now() + 90000 });
        return {
          snapshotId,
          unit: context.unit,
          field: context.field,
          value,
          application: "in_memory",
          windowId: context.windowId,
          documentDirty: documentDirty(await this.window(context)),
          expiresInSeconds: 90,
          archiveUnchanged: true,
          savesMap: false,
        };
      });
    });
  }

  async set(snapshotId: string, value: number) {
    return this.exclusive(async () => {
      memoryValueSchema.parse(value);
      const snapshot = this.snapshots.get(snapshotId);
      if (!snapshot || snapshot.expires < Date.now()) throw Error("LIVE_MEMORY_SNAPSHOT_EXPIRED");
      this.snapshots.delete(snapshotId); // Single-use, including failed/uncertain commits.
      const archive = await this.archive(snapshot.archive);
      if (archive.sha256 !== snapshot.sha256) throw Error("LIVE_MEMORY_ARCHIVE_CHANGED");
      await this.window(snapshot);
      return this.lease(snapshot, async () => {
        const token = randomUUID();
        let attempted = false,
          cancelled = false;
        try {
          const current = await this.open(snapshot, token, String(snapshot.value), String(value));
          if (current !== snapshot.value) throw Error("LIVE_MEMORY_STALE_FIELD");
          if (current === value) {
            cancelled = true;
            await this.cancel(snapshot, token);
            return { status: "unchanged", value, application: "in_memory" };
          }
          if ((await this.archive(snapshot.archive)).sha256 !== snapshot.sha256)
            throw Error("LIVE_MEMORY_ARCHIVE_CHANGED");
          this.snapshots.clear();
          attempted = true;
          const result = await this.command(snapshot, 5, { token });
          if (result.commitRequested !== true) throw Error("LIVE_MEMORY_COMMIT_UNCERTAIN");
          await this.settled(snapshot);
          const after = await this.inspectValue(snapshot);
          return {
            status: after === value ? "applied" : "verification_failed",
            application: "in_memory",
            unit: snapshot.unit,
            field: snapshot.field,
            before: current,
            after,
            requested: value,
            windowId: snapshot.windowId,
            documentDirty: documentDirty(await this.window(snapshot)),
            archiveUnchanged: (await this.archive(snapshot.archive)).sha256 === snapshot.sha256,
            savesMap: false,
            reopensMap: false,
            retryMutation: false,
          };
        } catch (error) {
          if (!attempted && !cancelled) {
            try {
              await this.cancel(snapshot, token);
            } catch {
              /* No unrelated dialog handling. */
            }
          }
          if (attempted)
            return {
              status: "unknown",
              application: "in_memory",
              retryMutation: false,
              error: String(error),
              unit: snapshot.unit,
              field: snapshot.field,
              requested: value,
              recovery:
                "Read the field again before deciding on another edit; do not replay this snapshot",
            };
          throw error;
        }
      });
    });
  }

  async close() {
    this.closed = true;
    await this.current?.catch(() => {});
    this.snapshots.clear();
    await this.desktop.close?.();
  }
}
