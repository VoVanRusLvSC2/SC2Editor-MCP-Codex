import { currentDocumentMatches } from "./documentIdentity.js";
import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import { LiveDocument, documentTargetSchema } from "./document.js";
import { documentDirty, type EditorWindow } from "./desktop.js";
import { withEditorLease } from "./editorLease.js";
import { WindowsMemoryDesktop, type MemoryDesktop } from "./memoryDesktop.js";
import { placementObjectSchema as objectSchema, placementSceneSchema as sceneSchema, readPlacementScenePages } from "./placementScene.js";

const propertiesSchema = z.object({
  fingerprint: z.string(),
  initial: z.string(),
  matches: z.boolean(),
  manualInput: z.boolean(),
  x: z.string().refine((v) => v.trim() !== "" && Number.isFinite(Number(v))),
  y: z.string().refine((v) => v.trim() !== "" && Number.isFinite(Number(v))),
  name: z.string(),
  owner: z.string().optional(),
});
type Scene = z.infer<typeof sceneSchema>;
type Item = z.infer<typeof objectSchema>;
type Target = z.infer<typeof documentTargetSchema>;
interface Snapshot {
  target: Target;
  window: EditorWindow;
  sha256: string;
  scene: Scene;
  expires: number;
}
export const placementNameSchema = z.string().max(80).refine(
  (name) => [...name].every((c) => c.charCodeAt(0) >= 32),
  "Name must not contain control characters",
);
export const placementWriteSchema = z
  .object({
    snapshotId: z.string().uuid(),
    objectKey: z.string().regex(/^\d+$/),
    x: z.number().min(0).max(4096).multipleOf(0.5),
    y: z.number().min(0).max(4096).multipleOf(0.5),
    name: placementNameSchema.optional(),
  })
  .strict();
export const placementInspectSchema = documentTargetSchema
  .extend({ details: z.boolean().default(false), offset: z.number().int().min(0).max(8192).default(0),
    limit: z.number().int().min(1).max(256).default(128),
    expectedSceneHash: z.string().regex(/^\d+$/).optional() })
  .strict();
export const placementDeleteSchema = placementWriteSchema
  .pick({ snapshotId: true, objectKey: true })
  .strict();
export const placementPrepareSchema = documentTargetSchema
  .extend({ layer: z.enum(["Doodads", "Units"]).default("Doodads") })
  .strict();
export const placementCatalogSchema = z
  .object({
    snapshotId: z.string().uuid(),
    query: z.string().max(80).default(""),
    offset: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const placementCreateSchema = placementWriteSchema
  .omit({ objectKey: true })
  .extend({
    catalogRow: z.number().int().min(0).max(9999),
    catalogHash: z.string().regex(/^\d+$/),
    type: z.string().min(1).max(120),
    owner: z.number().int().min(0).max(15).optional(),
    expectedId: z.string().min(1).max(120).optional(),
  })
  .strict();
const catalogSchema = z.object({
  layer: z.enum(["Doodads", "Units"]),
  catalogHash: z.string().regex(/^\d+$/),
  brush: z.string(),
  total: z.number().int().min(0).max(10000),
  matches: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  owners: z
    .array(z.object({ id: z.number().int().min(0).max(16), label: z.string() }))
    .max(32)
    .optional(),
  rows: z.array(z.object({ row: z.number().int().nonnegative(), type: z.string() })).max(16),
});
type Write = z.infer<typeof placementWriteSchema>;

/** Original visible objects copy/place/properties, never a map archive writer. */
// Full native-property comparison is bounded to limit editor work per mutation.
const templateGroupLimit = 64;

export class LivePlacement {
  busy = false;
  private closed = false;
  private current?: Promise<unknown>;
  private snapshots = new Map<string, Snapshot>();
  private document: LiveDocument;
  constructor(
    root: string,
    private readonly desktop: MemoryDesktop = new WindowsMemoryDesktop(),
    private readonly blocked: () => boolean = () => false,
    private readonly pause = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {
    this.document = new LiveDocument(root, desktop);
  }

  capabilities() {
    return {
      backend: "original_terrain_controls",
      scope:
        "Create Doodads/Units from the original palette; duplicate or move existing instances in the open document",
      tools: [
        "live.placement.prepare",
        "live.placement.inspect",
        "live.placement.inspect_object",
        "live.placement.catalog",
        "live.placement.create",
        "live.placement.create_group",
        "live.placement.job_start",
        "live.placement.job_status",
        "live.placement.job_cancel",
        "live.placement.duplicate",
        "live.placement.move",
        "live.placement.delete",
      ],
      copiesCreated: 0,
      reopensMap: false,
      requiresConnect: false,
      requires:
        "Editor 5.0.17.98310 x64; English Terrain controls; Doodads or Units layer; at most 8192 listed objects and 64 matching instances including a new duplicate; half-unit coordinates",
      unsupported: [
        "Types absent from the current filtered palette",
        "Deletion in layers with more than 32 objects",
        "Terrain",
        "GUI triggers",
      ],
      evidence:
        "Native instance/count/coordinate readback; rendered appearance and pathing need separate review",
      deletionReferenceSafety:
        "not_checked: list-view keys are not persistent component IDs; unsaved GUI, Galaxy and other references are not examined",
      save: "live.document.status then live.document.save",
    };
  }
  async prepare(input: z.input<typeof placementPrepareSchema>) {
    return this.run(async () => {
      const { layer, ...target } = placementPrepareSchema.parse(input),
        status = await this.document.status(target);
      target.archive = status.archive;
      const window = await this.window(target);
      if (!window.enabled) throw Error("LIVE_PLACEMENT_USER_DIALOG_PRESENT");
      return withEditorLease(window, async () => {
        await this.desktop.command(window, 31, { unit: layer });
        return {
          layerRequested: layer,
          archive: target.archive,
          windowId: window.windowId,
          copiesCreated: 0,
          mapMutation: false,
        };
      });
    });
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
      throw Error("LIVE_PLACEMENT_WINDOW_CHANGED");
    return w;
  }
  private async guard(s: Snapshot, allowDialog = false) {
    const status = await this.document.status(s.target);
    const w = await this.window(s.target, s.window);
    if (status.sha256 !== s.sha256) throw Error("LIVE_PLACEMENT_ARCHIVE_CHANGED");
    if (!allowDialog && !w.enabled) throw Error("LIVE_PLACEMENT_USER_DIALOG_PRESENT");
    return w;
  }
  private async command(
    s: Snapshot,
    op: number,
    args: Parameters<MemoryDesktop["command"]>[2] = {},
    allowDialog = false,
  ) {
    // The helper checks exact HWND/PID/start/document on every call. Archive guards
    // bracket the workflow and precede actual writes; inventory is not polled per read.
    const write =
      op === 36 || op === 39 || op === 45 || (op === 34 && args?.field === "commitPreview");
    const result = await this.desktop.command(
      write ? await this.guard(s, allowDialog) : s.window,
      op,
      args,
    );
    const status = result as { status?: string; error?: string };
    if (status?.error || status?.status === "unknown")
      throw Error(status.error ?? "LIVE_PLACEMENT_NATIVE_UNKNOWN");
    return result;
  }
  private async scene(s: Snapshot) {
    let scene: Scene;
    try { scene = sceneSchema.parse(await this.command(s, 37)); }
    catch (error) {
      if (!String(error).includes("LIVE_PLACEMENT_OBJECT_SCENE_BOUND") &&
          !String(error).includes("LIVE_MEMORY_RESULT_BOUND")) throw error;
      scene = await readPlacementScenePages((offset, expected) =>
        this.command(s, 37, { field: "page", value: String(offset), expected }));
    }
    if (s.scene && scene.layer !== s.scene.layer) throw Error("LIVE_PLACEMENT_LAYER_CHANGED");
    if (
      scene.count !== scene.objects.length ||
      new Set(scene.objects.map((o) => o.key)).size !== scene.count
    )
      throw Error("LIVE_PLACEMENT_INSTANCE_IDENTITIES_INVALID");
    return scene;
  }
  private async run<T>(task: () => Promise<T>) {
    if (this.closed || this.busy || this.blocked()) throw Error("LIVE_PLACEMENT_WORKFLOW_BUSY");
    this.busy = true;
    const pending = task();
    this.current = pending;
    try {
      return await pending;
    } finally {
      this.busy = false;
      this.current = undefined;
    }
  }
  async inspect(input: z.input<typeof placementInspectSchema>) {
    return this.run(async () => {
      const parsed = placementInspectSchema.parse(input),
        target = { archive: parsed.archive, windowId: parsed.windowId },
        status = await this.document.status(target);
      target.archive = status.archive;
      const window = await this.window(target);
      if (!window.enabled) throw Error("LIVE_PLACEMENT_USER_DIALOG_PRESENT");
      const s: Snapshot = {
        target,
        window,
        sha256: status.sha256,
        scene: undefined as unknown as Scene,
        expires: Date.now() + 90000,
      };
      return withEditorLease(window, async () => {
        s.scene = await this.scene(s);
        if (parsed.expectedSceneHash && parsed.expectedSceneHash !== s.scene.sceneHash)
          throw Error("LIVE_PLACEMENT_SCENE_CHANGED");
        if (parsed.offset > s.scene.count) throw Error("LIVE_PLACEMENT_PAGE_INVALID");
        const details: Record<string, unknown> = {};
        if (parsed.details) {
          if (s.scene.count > 32) throw Error("LIVE_PLACEMENT_DETAILS_BOUND");
          for (const item of s.scene.objects)
            details[item.key] = await this.readProperties(s, item);
          if ((await this.scene(s)).sceneHash !== s.scene.sceneHash)
            throw Error("LIVE_PLACEMENT_SCENE_CHANGED");
        }
        for (const [key, snapshot] of this.snapshots)
          if (snapshot.expires <= Date.now()) this.snapshots.delete(key);
        if (this.snapshots.size >= 32) this.snapshots.delete(this.snapshots.keys().next().value!);
        s.expires = Date.now() + 90000;
        const snapshotId = randomUUID();
        this.snapshots.set(snapshotId, s);
        return {
          snapshotId,
          expiresInSeconds: 90,
          ...s.scene,
          objects: s.scene.objects.slice(parsed.offset, parsed.offset + parsed.limit),
          offset: parsed.offset,
          nextOffset: parsed.offset + parsed.limit < s.scene.count ? parsed.offset + parsed.limit : null,
          ...(parsed.details ? { details } : {}),
          windowId: window.windowId,
          archive: target.archive,
          documentDirty: documentDirty(window),
          copiesCreated: 0,
          mutation: false,
          keyScope: "Current scene snapshot rows; not persistent map instance IDs",
        };
      });
    });
  }
  private consume(input: Pick<Write, "snapshotId" | "objectKey">) {
    const s = this.snapshots.get(input.snapshotId);
    this.snapshots.delete(input.snapshotId);
    if (!s || s.expires <= Date.now()) throw Error("LIVE_PLACEMENT_SNAPSHOT_EXPIRED_OR_CONSUMED");
    const object = s.scene.objects.find((o) => o.key === input.objectKey);
    if (!object) throw Error("LIVE_PLACEMENT_SOURCE_NOT_IN_SNAPSHOT");
    return { s, object };
  }
  private async select(s: Snapshot, item: Item) {
    const token = randomUUID();
    await this.command(s, 32, {
      unit: String(item.row),
      field: item.key,
      expected: item.type,
      token,
    });
    await this.pause(100);
    return (await this.window(s.target, s.window)).enabled ? undefined : token;
  }
  private async properties(s: Snapshot, item: Item) {
    let token = await this.select(s, item);
    if (!token) {
      token = randomUUID();
      await this.command(s, 35, { unit: item.key, expected: item.type, value: item.name, token });
    }
    return this.openedProperties(s, token);
  }
  private async openedProperties(s: Snapshot, token: string) {
    for (let i = 0; i < 30; i++) {
      try {
        const reply = (await this.command(s, 30, { token }, true)) as { properties?: unknown };
        const p = propertiesSchema.parse(reply.properties);
        if (p.manualInput || p.fingerprint !== p.initial)
          throw Error("LIVE_PLACEMENT_MANUAL_PROPERTIES_CHANGED");
        if (!p.matches) {
          await this.command(s, 38, { token, expected: p.fingerprint }, true);
          await this.waitEnabled(s);
          throw Error("LIVE_PLACEMENT_SELECTED_OBJECT_MISMATCH");
        }
        return { token, ...p };
      } catch (error) {
        if (!String(error).includes("LIVE_PLACEMENT_PROPERTIES_NOT_READY")) throw error;
      }
      await this.pause(50);
    }
    throw Error("LIVE_PLACEMENT_PROPERTIES_UNCONFIRMED");
  }
  private async waitEnabled(s: Snapshot) {
    // Large maps can spend several seconds refreshing the native Terrain view
    // after a properties dialog closes. Observe the original window once; never
    // replay the submitted edit while the editor is still processing it.
    for (let i = 0; i < 200; i++) {
      if ((await this.window(s.target, s.window)).enabled) return;
      await this.pause(100);
    }
    throw Error("LIVE_PLACEMENT_DIALOG_OUTCOME_UNKNOWN");
  }
  private async readProperties(s: Snapshot, item: Item) {
    const p = await this.properties(s, item);
    await this.command(s, 38, { token: p.token, expected: p.fingerprint }, true);
    await this.waitEnabled(s);
    const owner = p.owner?.match(/^\((\d+)\)/)?.[1];
    return {
      fingerprint: p.fingerprint,
      x: Number(p.x),
      y: Number(p.y),
      name: p.name,
      ...(owner !== undefined ? { owner: Number(owner) } : {}),
    };
  }
  private async captureType(s: Snapshot, scene: Scene, type: string) {
    const objects = scene.objects.filter((o) => o.type === type);
    if (objects.length > templateGroupLimit) throw Error("LIVE_PLACEMENT_TEMPLATE_GROUP_BOUND");
    const records = [];
    for (const object of objects)
      records.push({ object, ...(await this.readProperties(s, object)) });
    if ((await this.scene(s)).sceneHash !== scene.sceneHash)
      throw Error("LIVE_PLACEMENT_SCENE_CHANGED");
    return records;
  }
  private async waitForCountChange(s: Snapshot, beforeCount: number) {
    for (let i = 0; i < 100; i++) {
      const current = z.object({ layer: z.enum(["Doodads", "Units"]), count: z.number().int().min(0).max(8192) })
        .parse(await this.command(s, 37, { field: "count" }));
      if (current.layer !== s.scene.layer) throw Error("LIVE_PLACEMENT_LAYER_CHANGED");
      if (current.count !== beforeCount) break;
      await this.pause(100);
    }
    // A changed count is only a signal: reconstruct and verify the complete
    // guarded scene once before identifying or editing the new instance.
    return this.scene(s);
  }
  private async position(s: Snapshot, object: Item, input: Write) {
    const before = await this.properties(s, object);
    await this.command(
      s,
      36,
      {
        token: before.token,
        expected: before.fingerprint,
        unit: String(input.x),
        field: String(input.y),
        value: input.name === "" ? "\u001f" : (input.name ?? ""),
      },
      true,
    );
    await this.waitEnabled(s);
    let scene = await this.scene(s),
      stable = "";
    for (let i = 0; i < 30; i++) {
      const named =
        !input.name ||
        scene.objects.filter((o) => o.name === input.name && o.type === object.type).length === 1;
      const cleared =
        input.name !== "" || !before.name || !scene.objects.some((o) => o.name === before.name);
      if (named && cleared && stable === scene.sceneHash) break;
      stable = scene.sceneHash;
      await this.pause(50);
      scene = await this.scene(s);
    }
    const matches = scene.objects.filter((o) => o.name === input.name && o.type === object.type);
    let current: Item | undefined,
      after: Awaited<ReturnType<LivePlacement["readProperties"]>> | undefined;
    if (input.name && matches.length === 1) {
      current = matches[0];
      after = await this.readProperties(s, current);
    } else {
      const details = await this.captureType(s, scene, object.type);
      const candidates = details.filter(
        (d) => d.x === input.x && d.y === input.y && d.name === input.name,
      );
      if (candidates.length === 1) {
        current = candidates[0].object;
        after = candidates[0];
      }
    }
    if (!current || !after) throw Error("LIVE_PLACEMENT_COMMITTED_OBJECT_AMBIGUOUS");
    const verified =
      Number(after.x) === input.x && Number(after.y) === input.y && after.name === input.name;
    return {
      verified,
      before: { x: Number(before.x), y: Number(before.y), name: before.name },
      after: {
        x: Number(after.x),
        y: Number(after.y),
        name: after.name,
        ...(after.owner !== undefined ? { owner: after.owner } : {}),
      },
      objectKey: current.key,
      scene: { layer: scene.layer, count: scene.count, selectedKey: scene.selectedKey, sceneHash: scene.sceneHash },
    };
  }
  async move(input: Write) {
    return this.write(placementWriteSchema.parse(input), false);
  }
  async duplicate(input: Write) {
    return this.write(placementWriteSchema.parse(input), true);
  }
  async delete(input: z.infer<typeof placementDeleteSchema>) {
    return this.run(async () => {
      const args = placementDeleteSchema.parse(input),
        { s, object } = this.consume(args);
      return withEditorLease(await this.guard(s), async () => {
        const before = await this.scene(s);
        if (before.sceneHash !== s.scene.sceneHash) throw Error("LIVE_PLACEMENT_SCENE_CHANGED");
        if (before.preview) throw Error("LIVE_PLACEMENT_EXISTING_PASTE_PREVIEW");
        if (before.count > 32)
          throw Error(
            "LIVE_PLACEMENT_DELETE_SCENE_BOUND: direct verification is limited to 32 objects. If same-file refresh is accepted, identify exact Objects component IDs and use objects remove ids=... in a refresh session. A live objectKey is not an Objects ID; trigger references are not rewritten.",
          );
        const originals: Array<
          { object: Item } & Awaited<ReturnType<LivePlacement["readProperties"]>>
        > = [];
        for (const item of before.objects)
          originals.push({ object: item, ...(await this.readProperties(s, item)) });
        if ((await this.scene(s)).sceneHash !== before.sceneHash)
          throw Error("LIVE_PLACEMENT_SCENE_CHANGED");
        const target = originals.find((o) => o.object.key === object.key)!;
        let attempted = false;
        try {
          const selected = await this.readProperties(s, object),
            ready = await this.scene(s);
          if (
            selected.fingerprint !== target.fingerprint ||
            ready.sceneHash !== before.sceneHash ||
            ready.selectedKey !== object.key
          )
            throw Error("LIVE_PLACEMENT_DELETE_SELECTION_CHANGED");
          attempted = true;
          const native = await this.command(s, 39, {
            unit: object.key,
            field: object.type,
            value: object.name,
            expected: before.sceneHash,
          });
          z.object({ deleteRequested: z.literal(true) }).parse(native);
          let after = await this.scene(s);
          for (let i = 0; after.count === before.count && i < 30; i++) {
            await this.pause(50);
            after = await this.scene(s);
          }
          if (after.count !== before.count - 1)
            throw Error("LIVE_PLACEMENT_DELETE_COUNT_UNCONFIRMED");
          const remaining = [];
          for (const item of after.objects)
            remaining.push({ object: item, ...(await this.readProperties(s, item)) });
          if ((await this.scene(s)).sceneHash !== after.sceneHash)
            throw Error("LIVE_PLACEMENT_SCENE_CHANGED");
          const identity = (entry: (typeof originals)[number]) =>
            entry.object.type + "\0" + entry.fingerprint;
          const expected = originals
              .filter((o) => o.object.key !== object.key)
              .map(identity)
              .sort(),
            actual = remaining.map(identity).sort();
          const preserved = JSON.stringify(expected) === JSON.stringify(actual),
            fresh = await this.guard(s);
          return {
            status: preserved ? "applied" : "verification_failed",
            verificationScope:
              "Selected deletion count and visible native properties of the active layer; whole-document serialization is separate",
            deleted: true,
            removed: {
              type: object.type,
              name: target.name,
              x: target.x,
              y: target.y,
              ...(target.owner === undefined ? {} : { owner: target.owner }),
            },
            countBefore: before.count,
            countAfter: after.count,
            layer: before.layer,
            remainingPropertiesPreserved: preserved,
            wholeDocumentPersistenceVerified: false,
            referenceSafety: "not_checked",
            documentDirty: documentDirty(fresh),
            copiesCreated: 0,
            reopensMap: false,
            saved: false,
            retryMutation: false,
            native,
          };
        } catch (error) {
          return {
            status: attempted ? "unknown" : "failed",
            deleteAttempted: attempted,
            error: String(error),
            referenceSafety: "not_checked",
            copiesCreated: 0,
            reopensMap: false,
            saved: false,
            retryMutation: false,
            recovery:
              "Inspect the same current scene/dialog. Never repeat deletion or dismiss user/native confirmation dialogs automatically",
          };
        }
      });
    });
  }
  private snapshot(id: string, consume = false) {
    const s = this.snapshots.get(id);
    if (consume) this.snapshots.delete(id);
    if (!s || s.expires <= Date.now()) throw Error("LIVE_PLACEMENT_SNAPSHOT_EXPIRED_OR_CONSUMED");
    return s;
  }
  /** Preflight a group against one snapshot; each individual mutation still revalidates it. */
  checkGroupCapacity(snapshotId: string, objects: readonly { type: string; name?: string }[]) {
    const scene = this.snapshot(snapshotId).scene;
    if (scene.count + objects.length > 8192) throw Error("LIVE_PLACEMENT_SCENE_BOUND");
    const counts = new Map<string, number>(), names = new Set(scene.objects.map(object => object.name).filter(Boolean));
    for (const object of scene.objects) counts.set(object.type, (counts.get(object.type) ?? 0) + 1);
    for (const { type, name } of objects) {
      const count = (counts.get(type) ?? 0) + 1;
      if (count > templateGroupLimit) throw Error("LIVE_PLACEMENT_TEMPLATE_GROUP_BOUND");
      counts.set(type, count);
      if (name) {
        if (names.has(name)) throw Error("LIVE_PLACEMENT_UNIQUE_NAME_REQUIRED");
        names.add(name);
      }
    }
  }
  async inspectObject(input: z.input<typeof placementDeleteSchema>) {
    return this.run(async () => {
      const args = placementDeleteSchema.parse(input), s = this.snapshot(args.snapshotId);
      return withEditorLease(await this.guard(s), async () => {
        const before = await this.scene(s);
        if (before.sceneHash !== s.scene.sceneHash) throw Error("LIVE_PLACEMENT_SCENE_CHANGED");
        const item = before.objects.find(object => object.key === args.objectKey);
        if (!item) throw Error("LIVE_PLACEMENT_SOURCE_NOT_IN_SNAPSHOT");
        const properties = await this.readProperties(s, item);
        if ((await this.scene(s)).sceneHash !== before.sceneHash) throw Error("LIVE_PLACEMENT_SCENE_CHANGED");
        return { snapshotId: args.snapshotId, objectKey: item.key, type: item.type, layer: before.layer,
          sceneHash: before.sceneHash, ...properties, copiesCreated: 0, mapMutation: false };
      });
    });
  }
  async catalog(input: z.input<typeof placementCatalogSchema>) {
    return this.run(async () => {
      const args = placementCatalogSchema.parse(input),
        s = this.snapshot(args.snapshotId);
      return withEditorLease(await this.guard(s), async () => {
        if ((await this.scene(s)).sceneHash !== s.scene.sceneHash)
          throw Error("LIVE_PLACEMENT_SCENE_CHANGED");
        await this.command(s, 43, { field: "list" });
        await this.pause(100);
        const result = catalogSchema.parse(
          await this.command(s, 43, { unit: args.query, value: String(args.offset) }),
        );
        if (result.layer !== s.scene.layer) throw Error("LIVE_PLACEMENT_LAYER_CHANGED");
        return {
          ...result,
          snapshotId: args.snapshotId,
          filteredPalette: true,
          copiesCreated: 0,
          mapMutation: false,
        };
      });
    });
  }
  async create(input: z.input<typeof placementCreateSchema>) {
    return this.run(async () => {
      const args = placementCreateSchema.parse(input),
        s = this.snapshot(args.snapshotId, true);
      if (s.scene.layer === "Units" && args.owner === undefined)
        throw Error("LIVE_PLACEMENT_UNIT_OWNER_REQUIRED");
      if (s.scene.layer === "Doodads" && args.owner !== undefined)
        throw Error("LIVE_PLACEMENT_DOODAD_OWNER_UNSUPPORTED");
      return withEditorLease(await this.guard(s), async () => {
        const before = await this.scene(s);
        if (before.sceneHash !== s.scene.sceneHash) throw Error("LIVE_PLACEMENT_SCENE_CHANGED");
        if (before.preview) throw Error("LIVE_PLACEMENT_EXISTING_PASTE_PREVIEW");
        if (before.count >= 8192 || before.objects.filter((o) => o.type === args.type).length >= templateGroupLimit)
          throw Error("LIVE_PLACEMENT_TEMPLATE_GROUP_BOUND");
        const name = args.name ?? `MCP ${args.type.slice(0, 40)} ${randomUUID().slice(0, 8)}`;
        if (!name) throw Error("LIVE_PLACEMENT_CREATE_UNIQUE_NAME_REQUIRED");
        if (before.objects.some((o) => o.name === name))
          throw Error("LIVE_PLACEMENT_UNIQUE_NAME_REQUIRED");
        const originals = await this.captureType(s, before, args.type);
        await this.command(s, 44, {
          unit: String(args.catalogRow),
          field: args.type,
          expected: args.catalogHash,
          value: args.owner === undefined ? "" : String(args.owner),
        });
        let catalog: z.infer<typeof catalogSchema> | undefined;
        for (let i = 0; i < 25; i++) {
          catalog = catalogSchema.parse(await this.command(s, 43, { unit: args.type }));
          if (
            catalog.brush.startsWith("Brush: " + args.type + " (") ||
            catalog.brush === "Brush: " + args.type
          )
            break;
          await this.pause(50);
        }
        if (
          !catalog ||
          catalog.catalogHash !== args.catalogHash ||
          !(
            catalog.brush.startsWith("Brush: " + args.type + " (") ||
            catalog.brush === "Brush: " + args.type
          )
        )
          throw Error("LIVE_PALETTE_BRUSH_UNCONFIRMED");
        const idPrefix = "Brush: " + args.type + " (";
        const nativeCatalogId = catalog.brush.startsWith(idPrefix)
          ? catalog.brush.slice(idPrefix.length).match(/^([^()]{1,120})\)/)?.[1]
          : undefined;
        if (args.expectedId !== undefined && nativeCatalogId !== args.expectedId)
          throw Error("LIVE_PALETTE_CATALOG_ID_MISMATCH");
        let createdKey: string | undefined;
        try {
          // Submitted once. A lost acknowledgement never causes another click.
          await this.command(s, 45, {
            unit: catalog.brush,
            expected: before.sceneHash,
            field: args.catalogHash,
            value: String(args.catalogRow),
            token: args.owner === undefined ? "" : String(args.owner),
          });
          const placed = await this.waitForCountChange(s, before.count);
          if (placed.count !== before.count + 1) throw Error("LIVE_PLACEMENT_CREATION_UNCONFIRMED");
          await this.command(s, 31, { field: "selection" });
          const after = await this.captureType(s, placed, args.type);
          const counts = new Map<string, number>();
          for (const o of originals)
            counts.set(o.fingerprint, (counts.get(o.fingerprint) ?? 0) + 1);
          const extras: typeof after = [];
          for (const o of after) {
            const left = counts.get(o.fingerprint) ?? 0;
            if (left) counts.set(o.fingerprint, left - 1);
            else extras.push(o);
          }
          if (
            extras.length !== 1 ||
            [...counts.values()].some(Boolean) ||
            after.filter((o) => o.fingerprint === extras[0].fingerprint).length !== 1
          )
            throw Error("LIVE_PLACEMENT_NEW_INSTANCE_AMBIGUOUS");
          const item = extras[0].object;
          createdKey = item.key;
          if (args.owner !== undefined && extras[0].owner !== args.owner)
            throw Error("LIVE_PLACEMENT_CREATED_OWNER_MISMATCH");
          const result = await this.position(s, item, {
            snapshotId: args.snapshotId,
            objectKey: item.key,
            x: args.x,
            y: args.y,
            name,
          });
          const ownerVerified = args.owner === undefined || result.after.owner === args.owner;
          return {
            status: result.verified && ownerVerified ? "applied" : "verification_failed",
            ...result,
            ownerVerified,
            created: true,
            source: "native_catalog_palette",
            nativeCatalogId: nativeCatalogId ?? null,
            type: args.type,
            layer: s.scene.layer,
            countBefore: before.count,
            countAfter: result.scene.count,
            archive: s.target.archive,
            documentDirty: documentDirty(await this.guard(s)),
            copiesCreated: 0,
            reopensMap: false,
            retryMutation: false,
          };
        } catch (error) {
          return {
            status: createdKey ? "partial" : "unknown",
            objectKey: createdKey,
            error: String(error),
            archive: s.target.archive,
            copiesCreated: 0,
            reopensMap: false,
            retryMutation: false,
            recovery:
              "Inspect the same document; do not replay catalog placement, issue global Undo or replace the archive",
          };
        }
      });
    });
  }
  private async write(input: Write, duplicate: boolean) {
    return this.run(async () => {
      const { s, object } = this.consume(input);
      return withEditorLease(await this.guard(s), async () => {
        const before = await this.scene(s);
        if (before.sceneHash !== s.scene.sceneHash) throw Error("LIVE_PLACEMENT_SCENE_CHANGED");
        if (before.preview) throw Error("LIVE_PLACEMENT_EXISTING_PASTE_PREVIEW");
        input = {
          ...input,
          name:
            input.name ??
            (duplicate
              ? `MCP ${object.type.slice(0, 40)} ${randomUUID().slice(0, 8)}`
              : object.name),
        };
        if (
          input.name &&
          before.objects.some((o) => o.name === input.name && (duplicate || o.key !== object.key))
        )
          throw Error("LIVE_PLACEMENT_UNIQUE_NAME_REQUIRED");
        const matchingCount = before.objects.filter((o) => o.type === object.type).length;
        if (duplicate && (before.count >= 8192 || matchingCount >= templateGroupLimit))
          throw Error("LIVE_PLACEMENT_TEMPLATE_GROUP_BOUND");
        if (!input.name && matchingCount > templateGroupLimit) throw Error("LIVE_PLACEMENT_TEMPLATE_GROUP_BOUND");
        let changed = false,
          createdKey: string | undefined;
        try {
          let item = object;
          if (duplicate) {
            const originals = await this.captureType(s, before, item.type);
            const opened = await this.select(s, item);
            if (opened) {
              const p = await this.openedProperties(s, opened);
              await this.command(s, 38, { token: opened, expected: p.fingerprint }, true);
              await this.waitEnabled(s);
            }
            await this.command(s, 33, { unit: item.key });
            await this.command(s, 34);
            let preview = await this.scene(s);
            for (let i = 0; !preview.preview && i < 20; i++) {
              await this.pause(50);
              preview = await this.scene(s);
            }
            if (
              preview.sceneHash !== before.sceneHash ||
              !preview.preview.startsWith("Pasting: " + (item.name || item.type) + " (")
            )
              throw Error("LIVE_PLACEMENT_PREVIEW_UNCONFIRMED");
            changed = true; // Once submitted, placement is never replayed, even after a lost reply.
            await this.command(s, 34, {
              field: "commitPreview",
              unit: preview.preview,
              expected: preview.sceneHash,
            });
            const placed = await this.waitForCountChange(s, before.count);
            if (placed.count !== before.count + 1)
              throw Error("LIVE_PLACEMENT_CREATION_UNCONFIRMED");
            await this.command(s, 31, { field: "selection" });
            // Terrain's owner-data list reindexes rows on insertion. Compare full native
            // properties instead of treating ListView row IDs as persistent map tags.
            const after = await this.captureType(s, placed, item.type);
            const counts = new Map<string, number>();
            for (const o of originals)
              counts.set(o.fingerprint, (counts.get(o.fingerprint) ?? 0) + 1);
            const extras: typeof after = [];
            for (const o of after) {
              const left = counts.get(o.fingerprint) ?? 0;
              if (left) counts.set(o.fingerprint, left - 1);
              else extras.push(o);
            }
            if (
              extras.length !== 1 ||
              [...counts.values()].some(Boolean) ||
              originals.some((o) => o.fingerprint === extras[0].fingerprint) ||
              after.filter((o) => o.fingerprint === extras[0].fingerprint).length !== 1
            )
              throw Error("LIVE_PLACEMENT_NEW_INSTANCE_AMBIGUOUS");
            item = extras[0].object;
            createdKey = item.key;
          }
          changed = true;
          const result = await this.position(s, item, input);
          const final = await this.guard(s);
          return {
            status: result.verified ? "applied" : "verification_failed",
            ...result,
            created: duplicate,
            layer: s.scene.layer,
            countBefore: before.count,
            countAfter: result.scene.count,
            archive: s.target.archive,
            archiveUnchanged: true,
            documentDirty: documentDirty(final),
            windowId: final.windowId,
            copiesCreated: 0,
            reopensMap: false,
            retryMutation: false,
          };
        } catch (error) {
          if (!changed) throw error;
          return {
            status: createdKey ? "partial" : "unknown",
            objectKey: createdKey,
            archive: s.target.archive,
            copiesCreated: 0,
            reopensMap: false,
            retryMutation: false,
            error: String(error),
            recovery:
              "Inspect the same document and native dialogs; do not replay placement or overwrite the archive",
          };
        }
      });
    });
  }
  async close() {
    this.closed = true;
    await this.current;
    this.snapshots.clear();
    await this.desktop.close?.();
  }
}
