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
import { configureLiveWait, configureLivePeriodic } from "./triggerWait.js";
import { editLiteralNumber } from "./triggerNumber.js";
import { editLiteralChoice } from "./triggerChoice.js";
import { readTriggerTreePage, readTriggerTreePages } from "./triggerTreePages.js";
import { resolveTriggerContext } from "./triggerContext.js";
import { collectGuiValues } from "../trigger/authoring.js";
import type { GuiCatalogIdentity } from "../trigger/catalogContext.js";
import { captureTriggerCatalog, liveCatalogReferences } from "./triggerCatalog.js";

export const triggerTargetSchema = z
  .object({ archive: z.string().min(1).max(4096), windowId: z.string().regex(/^\d+$/) })
  .strict();
export const triggerTreeSchema = triggerTargetSchema.extend({
  offset: z.number().int().min(0).max(8192).default(0),
  limit: z.number().int().min(1).max(128).default(128),
  expectedFingerprint: z.string().regex(/^\d+$/).optional(),
}).strict();
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
    planFile: z.string().min(1).max(4096).optional(),
    plan: z.union([triggerPlanSchema, z.array(triggerPlanSchema).min(1).max(100)]).optional(),
  })
  .strict().superRefine((value, ctx) => {
    if ((value.planFile === undefined) === (value.plan === undefined))
      ctx.addIssue({ code: "custom", message: "Provide exactly one of planFile or plan" });
  });
export const triggerCreateSchema = triggerTargetSchema.extend({
  name: triggerPrepareSchema.shape.name,
  plan: triggerPrepareSchema.shape.plan.unwrap(),
}).strict();
export const triggerCatalogSchema = triggerTargetSchema.extend({references:liveCatalogReferences}).strict();
export const triggerVerifySchema = triggerTargetSchema
  .extend({ name: triggerPrepareSchema.shape.name, expectedFile: z.string().min(1).max(4096) })
  .strict();
export const triggerRenameSchema = triggerTargetSchema.extend({
  path: z.string().min(1).max(1024).refine(value => value.split("/").length <= 16 && value.split("/").every(part => part.trim().length > 0)),
  name: z.string().trim().min(1).max(80).refine(value => [...value].every(c => c.charCodeAt(0) >= 32 && c !== "*" && c !== "/")),
}).strict();
export const triggerAppendActionSchema = triggerTargetSchema.extend({
  path: triggerRenameSchema.shape.path,
  action: z.enum(["skip_remaining", "wait", "builtin_default"]),
  seconds: z.number().min(0).max(3600).multipleOf(0.01).optional(),
  actionName: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().max(100).optional(),
  useDefaults: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.action === "wait") !== (value.seconds !== undefined))
    ctx.addIssue({ code: "custom", message: "wait requires seconds; skip_remaining must omit seconds" });
  if (value.action === "builtin_default") {
    if (!value.actionName || value.useDefaults !== true || value.actionName.toLowerCase() === "custom script")
      ctx.addIssue({ code: "custom", message: "builtin_default requires a non-script actionName and useDefaults=true" });
  } else if (value.actionName !== undefined || value.category !== undefined || value.useDefaults !== undefined)
    ctx.addIssue({ code: "custom", message: "actionName, category and useDefaults are for builtin_default only" });
});
export const triggerSetWaitSchema = triggerTargetSchema.extend({
  path: triggerRenameSchema.shape.path,
  actionIndex: z.number().int().min(1).max(8192),
  expectedDetailHash: z.string().regex(/^\d+$/),
  seconds: z.number().min(0).max(3600).multipleOf(0.01),
}).strict();
export const triggerAppendEventSchema = triggerTargetSchema.extend({
  path: triggerRenameSchema.shape.path,
  event: z.enum(["periodic", "builtin_default"]).default("builtin_default"),
  eventName: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().max(100).optional(),
  useDefaults: z.boolean().optional(),
  seconds: z.number().min(0.01).max(3600).multipleOf(0.01).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.event === "periodic") {
    if (value.seconds === undefined || value.eventName !== undefined || value.category !== undefined || value.useDefaults !== undefined)
      ctx.addIssue({ code: "custom", message: "periodic requires seconds and does not accept default-event fields" });
  } else if (!value.eventName || value.useDefaults !== true || value.seconds !== undefined)
    ctx.addIssue({ code: "custom", message: "builtin_default requires eventName and useDefaults=true and omits seconds" });
});
export const triggerSetPeriodicSchema = triggerTargetSchema.extend({
  path: triggerRenameSchema.shape.path,
  eventIndex: z.number().int().min(1).max(8192),
  expectedDetailHash: z.string().regex(/^\d+$/),
  seconds: z.number().min(0.01).max(3600).multipleOf(0.01),
}).strict();
export const triggerDetailsSchema = triggerTargetSchema.extend({
  path: triggerRenameSchema.shape.path,
  section: z.enum(["actions", "events"]).default("actions"),
  offset: z.number().int().min(0).max(8192).default(0),
  limit: z.number().int().min(1).max(32).default(16),
  includeDetail: z.boolean().default(false),
}).strict();
export const triggerParametersSchema = triggerTargetSchema.extend({
  path: triggerRenameSchema.shape.path,
  section: z.enum(["actions", "events"]),
  itemIndex: z.number().int().min(1).max(8192),
  expectedDetailHash: z.string().regex(/^\d+$/),
  offset: z.number().int().min(0).max(8192).default(0),
  limit: z.number().int().min(1).max(32).default(16),
}).strict();
export const triggerSetRealSchema = triggerParametersSchema.extend({
  parameterIndex: z.number().int().min(1).max(8192),
  expectedParameterHash: z.string().regex(/^\d+$/),
  value: z.number().min(-3600).max(3600).multipleOf(0.01),
}).strict();
export const triggerSetIntegerSchema = triggerParametersSchema.extend({
  parameterIndex: z.number().int().min(1).max(8192),
  expectedParameterHash: z.string().regex(/^\d+$/),
  value: z.number().int().min(-2147483648).max(2147483647),
}).strict();
export const triggerSetUnitSchema = triggerParametersSchema.extend({
  parameterIndex: z.number().int().min(1).max(8192),
  expectedParameterHash: z.string().regex(/^\d+$/),
  unitName: z.string().trim().min(1).max(100).refine(value => [...value].every(c => c.charCodeAt(0) >= 32)),
}).strict();
export const triggerSetPointSchema = triggerParametersSchema.extend({
  parameterIndex: z.number().int().min(1).max(8192),
  expectedParameterHash: z.string().regex(/^\d+$/),
  pointName: z.string().trim().min(1).max(100).refine(value => [...value].every(c => c.charCodeAt(0) >= 32)),
}).strict();
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
const fullTreeSchema = z.object({ id: z.number(), count: z.number(), fingerprint: z.string(), truncated: z.boolean(),
  items: z.array(z.object({ handle: z.string(), parent: z.string(), depth: z.number(), text: z.string() })) });
type FullTree = z.infer<typeof fullTreeSchema>;
function canonicalTree(tree: FullTree) {
  const indices = new Map(tree.items.map((item, index) => [item.handle, index]));
  return tree.items.map(item => ({ parent: item.parent === "0" ? -1 : indices.get(item.parent), depth: item.depth, text: item.text }));
}
function detailPreserved(before: FullTree, after: FullTree, changedHandle: string) {
  return after.items.length === before.items.length && before.items.every(old =>
    after.items.some(now => now.handle === old.handle && now.parent === old.parent &&
      (old.handle === changedHandle || now.text === old.text)));
}
interface PreparedLibrary {
  catalog?: { identities:GuiCatalogIdentity[]; revision:string };
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
const guiTypeSuffix = (text: string) => label(text).match(/( <[^<>\r\n]+>)$/)?.[1] ?? "";
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
    private readonly pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
  ) {}
  capabilities() {
    return {
      backend: "original_trigger_library_import",
      tools: [
        "live.trigger.inspect",
        "live.trigger.prepare",
        "live.trigger.create",
        "live.trigger.income",
        "live.trigger.catalog",
        "live.trigger.apply",
        "live.trigger.verify",
        "live.trigger.release",
        "live.trigger.tree",
        "live.trigger.rename",
        "live.trigger.append_action",
        "live.trigger.details",
        "live.trigger.set_wait",
        "live.trigger.append_event",
        "live.trigger.append_numeric",
        "live.trigger.append_configured",
        "live.trigger.configure",
        "live.trigger.set_periodic",
        "live.trigger.parameters",
        "live.trigger.set_real",
        "live.trigger.set_integer",
        "live.trigger.set_unit",
        "live.trigger.set_point",
      ],
      scope:
        "Add a self-contained GUI library; rename GUI elements; append built-in actions/events and edit existing direct literal Real, Integer, Unit Type or named Point parameters",
      copiesCreated: 0,
      reopensMap: false,
      savesMap: false,
      limits:
        "1 MiB; Core GUI references; up to 32 exact live Game Links; English embedded names; 4 prepared libraries for 10 minutes",
      unsupported: [
        "Replacing existing map-root/library graphs or editing parameters beyond supported direct literal Real, Integer, Unit Type or named Point values",
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
  private async moduleTree(w: EditorWindow, id: number) {
    let value: { trees: Array<z.infer<typeof fullTreeSchema>> };
    try {
      value = z.object({ trees: z.array(fullTreeSchema) }).parse(await this.desktop.command(w, 50, { field: "trees" }));
    } catch (error) {
      if (!String(error).includes("LIVE_MEMORY_RESULT_BOUND") &&
          !String(error).includes("LIVE_MODULE_TREE_UNREADABLE")) throw error;
      return readTriggerTreePages(this.desktop, w, id);
    }
    const tree = value.trees.find(t => t.id === id);
    if (!tree) throw Error("LIVE_TRIGGER_TREE_UNREADABLE_OR_TOO_LARGE");
    if (tree.truncated) return readTriggerTreePages(this.desktop, w, id, tree.fingerprint);
    if (tree.count !== tree.items.length)
      throw Error("LIVE_TRIGGER_TREE_UNREADABLE_OR_TOO_LARGE");
    return tree;
  }
  private fullTree(w: EditorWindow) { return this.moduleTree(w, 28); }
  private async selectTrigger(w: EditorWindow, path: string, groupName: "Actions" | "Events" = "Actions") {
    const left = await this.fullTree(w);
    let parent = "0", trigger: typeof left.items[number] | undefined;
    for (const part of path.split("/")) {
      const matches = left.items.filter(item => item.parent === parent && label(item.text) === part);
      if (matches.length !== 1) throw Error("LIVE_TRIGGER_PATH_NOT_UNIQUE_OR_MISSING");
      trigger = matches[0]; parent = trigger.handle;
    }
    if (!trigger) throw Error("LIVE_TRIGGER_PATH_NOT_FOUND");
    z.object({ selectionRequested: z.literal(true) }).parse(await this.desktop.command(w, 55, {
      unit: "28", field: trigger.handle, expected: left.fingerprint,
    }));
    let detail: Awaited<ReturnType<LiveTriggers["moduleTree"]>> | undefined;
    for (let i = 0; i < 30; i++) {
      try { detail = await this.moduleTree(w, 134); }
      catch (error) { if (!String(error).includes("TREE_UNREADABLE_OR_TOO_LARGE")) throw error; }
      if (detail?.items.some(item => item.depth === 0 && label(item.text) === label(trigger!.text))) break;
      await this.pause(100);
    }
    if (!detail) throw Error("LIVE_TRIGGER_ACTION_GROUP_NOT_FOUND");
    const roots = detail.items.filter(item => item.depth === 0 && label(item.text) === label(trigger!.text));
    const groups = roots.length === 1 ? detail.items.filter(item => item.parent === roots[0].handle && item.text === groupName) : [];
    if (groups.length !== 1) throw Error("LIVE_TRIGGER_ACTION_GROUP_NOT_FOUND");
    return { left, trigger, detail, group: groups[0] };
  }
  async details(input: z.input<typeof triggerDetailsSchema>) {
    return this.run(async () => {
      const args = triggerDetailsSchema.parse(input), archive = await this.archive(args.archive);
      const target = { archive: archive.archive, windowId: args.windowId }, w = await this.window(target);
      return withEditorLease(w, async () => {
        const selected = await this.selectTrigger(w, args.path, args.section === "events" ? "Events" : "Actions");
        const allActions = selected.detail.items.filter(item => item.parent === selected.group.handle)
          .map((item, index) => ({ index: index + 1, text: item.text }));
        const actions = allActions.slice(args.offset, args.offset + args.limit);
        return { path: args.path, section: args.section,
          ...(args.section === "events" ? { events: actions, totalEvents: allActions.length } : { actions, totalActions: allActions.length }),
          detailFingerprint: selected.detail.fingerprint, offset: args.offset,
          nextOffset: args.offset + actions.length < allActions.length ? args.offset + actions.length : null,
          ...(args.includeDetail ? { detail: selected.detail } : {}), archive: target.archive,
          windowId: w.windowId, copiesCreated: 0, mapMutation: false };
      });
    });
  }
  private async selectItemParameters(w: EditorWindow, args: z.infer<typeof triggerParametersSchema>) {
    const selected = await this.selectTrigger(w, args.path, args.section === "events" ? "Events" : "Actions");
    if (selected.detail.fingerprint !== args.expectedDetailHash) throw Error("LIVE_TRIGGER_DETAIL_CHANGED");
    const items = selected.detail.items.filter(item => item.parent === selected.group.handle);
    const item = items[args.itemIndex - 1];
    if (!item) throw Error("LIVE_TRIGGER_ITEM_INDEX_OUT_OF_RANGE");
    z.object({ selectionRequested: z.literal(true) }).parse(await this.desktop.command(w, 55, {
      unit: "134", field: item.handle, expected: selected.detail.fingerprint,
    }));
    let parameters: Awaited<ReturnType<LiveTriggers["moduleTree"]>> | undefined;
    let previous = "", stable = false;
    for (let i = 0; i < 30; i++) {
      await this.pause(100);
      try { parameters = await this.moduleTree(w, 468); }
      catch (error) { if (!String(error).includes("TREE_UNREADABLE_OR_TOO_LARGE")) throw error; }
      if (parameters && parameters.items.some(row => row.parent === "0") && previous === parameters.fingerprint) { stable = true; break; }
      previous = parameters?.fingerprint ?? "";
    }
    if (!parameters || !stable) throw Error("LIVE_TRIGGER_PARAMETERS_UNAVAILABLE");
    const roots = parameters.items.filter(row => row.parent === "0");
    if (roots.length !== 1) throw Error("LIVE_TRIGGER_PARAMETERS_AMBIGUOUS");
    return { ...selected, item, parameters, root: roots[0] };
  }
  async parameters(input: z.input<typeof triggerParametersSchema>) {
    return this.run(async () => {
      const args = triggerParametersSchema.parse(input), archive = await this.archive(args.archive);
      const target = { archive: archive.archive, windowId: args.windowId }, w = await this.window(target);
      return withEditorLease(w, async () => {
        const selected = await this.selectItemParameters(w, args);
        const allParameters = selected.parameters.items.filter(item => item.parent === selected.root.handle)
          .map((item, index) => ({ index: index + 1, text: item.text }));
        const parameters = allParameters.slice(args.offset, args.offset + args.limit);
        return { path: args.path, section: args.section, itemIndex: args.itemIndex, itemText: selected.item.text,
          parameterRoot: selected.root.text, parameters, totalParameters: allParameters.length, offset: args.offset,
          nextOffset: args.offset + parameters.length < allParameters.length ? args.offset + parameters.length : null,
          parameterFingerprint: selected.parameters.fingerprint,
          detailFingerprint: selected.detail.fingerprint, archive: target.archive, windowId: w.windowId,
          copiesCreated: 0, mapMutation: false };
      });
    });
  }
  async setReal(input: z.input<typeof triggerSetRealSchema>) {
    return this.setNumber(triggerSetRealSchema.parse(input), "real");
  }
  async setInteger(input: z.input<typeof triggerSetIntegerSchema>) {
    return this.setNumber(triggerSetIntegerSchema.parse(input), "integer");
  }
  private async setNumber(args: z.infer<typeof triggerSetRealSchema>, field: "real" | "integer") {
    return this.run(async () => {
      const archive = await this.archive(args.archive);
      const target = { archive: archive.archive, windowId: args.windowId }, w = await this.window(target);
      return withEditorLease(w, async () => {
        const selected = await this.selectItemParameters(w, args);
        if (selected.parameters.fingerprint !== args.expectedParameterHash) throw Error("LIVE_TRIGGER_PARAMETER_CHANGED");
        const rows = selected.parameters.items.filter(item => item.parent === selected.root.handle);
        const parameter = rows[args.parameterIndex - 1], match = parameter?.text.match(/^(.+?):\s*(-?\d+(?:\.\d+)?)$/);
        if (!parameter || !match || selected.parameters.items.some(item => item.parent === parameter.handle))
          throw Error("LIVE_TRIGGER_PARAMETER_NOT_LITERAL_NUMBER");
        const previousValue = Number(match[2]);
        const edit = await editLiteralNumber({ desktop: this.desktop, window: w,
          triggerHandle: selected.trigger.handle, itemHandle: selected.item.handle, parameterHandle: parameter.handle,
          leftHash: selected.left.fingerprint, detailHash: selected.detail.fingerprint, parameterHash: selected.parameters.fingerprint,
          field, value: args.value, guardArchive: async () => {
            if ((await this.archive(target.archive)).sha256 !== archive.sha256) throw Error("LIVE_TRIGGER_ARCHIVE_CHANGED");
          }, pause: this.pause });
        const receipt = { path: args.path, section: args.section, itemIndex: args.itemIndex,
          parameterIndex: args.parameterIndex, previousValue, value: args.value,
          saved: false, copiesCreated: 0, reopensMap: false, retryMutation: false };
        if (edit.status !== "submitted") return { ...receipt, ...edit, parameterVerified: false };
        try {
          const afterDetail = await this.moduleTree(edit.window, 134), afterParams = await this.moduleTree(edit.window, 468);
          const preservedDetail = detailPreserved(selected.detail, afterDetail, selected.item.handle);
          const before = canonicalTree(selected.parameters), after = canonicalTree(afterParams);
          const targetIndex = selected.parameters.items.findIndex(item => item.handle === parameter.handle);
          const changed = after[targetIndex]?.text.match(/^(.+?):\s*(-?\d+(?:\.\d+)?)$/);
          const parameterPreserved = before.length === after.length && before.every((old, index) =>
            old.parent === after[index]?.parent && old.depth === after[index]?.depth &&
            (index === targetIndex || old.text === after[index]?.text));
          const verified = preservedDetail && parameterPreserved && !!changed && changed[1] === match[1] &&
            Math.abs(Number(changed[2]) - args.value) <= 0.00001;
          return { ...receipt, status: verified ? "applied" : "verification_failed", parameterVerified: verified,
            ...(verified ? { detailFingerprint: afterDetail.fingerprint, parameterFingerprint: afterParams.fingerprint } : {}) };
        } catch (error) {
          return { ...receipt, status: "unknown", error: String(error), parameterVerified: false,
            recovery: "Inspect the same parameter and editor state; do not replay an uncertain commit." };
        }
      });
    });
  }
  async setUnit(input: z.input<typeof triggerSetUnitSchema>) {
    const args = triggerSetUnitSchema.parse(input);
    return this.setChoice(args, "unit", args.unitName);
  }
  async setPoint(input: z.input<typeof triggerSetPointSchema>) {
    const args = triggerSetPointSchema.parse(input);
    return this.setChoice(args, "point", args.pointName);
  }
  private async setChoice(args: z.infer<typeof triggerSetUnitSchema> | z.infer<typeof triggerSetPointSchema>,
    kind: "unit" | "point", name: string) {
    return this.run(async () => {
      const archive = await this.archive(args.archive);
      const target = { archive: archive.archive, windowId: args.windowId }, w = await this.window(target);
      return withEditorLease(w, async () => {
        const selected = await this.selectItemParameters(w, args);
        if (selected.parameters.fingerprint !== args.expectedParameterHash) throw Error("LIVE_TRIGGER_PARAMETER_CHANGED");
        const rows = selected.parameters.items.filter(item => item.parent === selected.root.handle);
        const parameter = rows[args.parameterIndex - 1], match = parameter?.text.match(/^(.+?):\s*(.*)$/);
        if (!parameter || !match || selected.parameters.items.some(item => item.parent === parameter.handle))
          throw Error("LIVE_TRIGGER_PARAMETER_NOT_LITERAL_CHOICE");
        const edit = await editLiteralChoice({ desktop: this.desktop, window: w,
          triggerHandle: selected.trigger.handle, itemHandle: selected.item.handle, parameterHandle: parameter.handle,
          leftHash: selected.left.fingerprint, detailHash: selected.detail.fingerprint,
          parameterHash: selected.parameters.fingerprint, kind, name,
          guardArchive: async () => {
            if ((await this.archive(target.archive)).sha256 !== archive.sha256) throw Error("LIVE_TRIGGER_ARCHIVE_CHANGED");
          }, pause: this.pause });
        const receipt = { path: args.path, section: args.section, itemIndex: args.itemIndex,
          parameterIndex: args.parameterIndex, ...(kind === "unit" ? { unitName: name } : { pointName: name }), saved: false,
          copiesCreated: 0, reopensMap: false, retryMutation: false };
        if (edit.status !== "submitted") return { ...receipt, ...edit, parameterVerified: false };
        try {
          const afterDetail = await this.moduleTree(edit.window, 134), afterParams = await this.moduleTree(edit.window, 468);
          const before = canonicalTree(selected.parameters), after = canonicalTree(afterParams);
          const index = selected.parameters.items.findIndex(item => item.handle === parameter.handle);
          const preserved = before.length === after.length && before.every((old, i) =>
            old.parent === after[i]?.parent && old.depth === after[i]?.depth && (i === index || old.text === after[i]?.text));
          const verified = detailPreserved(selected.detail, afterDetail, selected.item.handle) && preserved &&
            after[index]?.text === match[1] + ": " + name;
          return { ...receipt, status: verified ? "applied" : "verification_failed", parameterVerified: verified,
            ...(verified ? { detailFingerprint: afterDetail.fingerprint, parameterFingerprint: afterParams.fingerprint } : {}),
            ...(kind === "unit" ? { unitIdentity: "unique_editor_display_name", catalogIdVerified: false } :
              { pointIdentity: "unique_editor_point_name" }) };
        } catch (error) {
          return { ...receipt, status: "unknown", error: String(error), parameterVerified: false,
            recovery: "Inspect the same parameter and editor state; do not replay an uncertain commit." };
        }
      });
    });
  }
  async setWait(input: z.infer<typeof triggerSetWaitSchema>) {
    return this.setDuration({ kind: "wait", args: triggerSetWaitSchema.parse(input) });
  }
  async setPeriodic(input: z.infer<typeof triggerSetPeriodicSchema>) {
    return this.setDuration({ kind: "periodic", args: triggerSetPeriodicSchema.parse(input) });
  }
  private async setDuration(input: { kind: "wait"; args: z.infer<typeof triggerSetWaitSchema> } |
    { kind: "periodic"; args: z.infer<typeof triggerSetPeriodicSchema> }) {
    return this.run(async () => {
      const args = input.args, archive = await this.archive(args.archive), periodic = input.kind === "periodic";
      const index = input.kind === "periodic" ? input.args.eventIndex : input.args.actionIndex;
      const target = { archive: archive.archive, windowId: args.windowId }, w = await this.window(target);
      return withEditorLease(w, async () => {
        const selected = await this.selectTrigger(w, args.path, periodic ? "Events" : "Actions");
        if (selected.detail.fingerprint !== args.expectedDetailHash) throw Error("LIVE_TRIGGER_DETAIL_CHANGED");
        const actions = selected.detail.items.filter(item => item.parent === selected.group.handle);
        const action = actions[index - 1];
        const pattern = periodic ? /^Timer\s*-\s*Every\s+([0-9]+(?:\.[0-9]+)?)\s+seconds of Game Time$/ :
          /^General\s*-\s*Wait\s+([0-9]+(?:\.[0-9]+)?)\s+Game Time seconds$/;
        const currentValue = action?.text.match(pattern);
        if (!action || !currentValue) throw Error(periodic ? "LIVE_TRIGGER_SELECTED_EVENT_NOT_LITERAL_PERIODIC" : "LIVE_TRIGGER_SELECTED_ACTION_NOT_LITERAL_GAME_TIME_WAIT");
        if (Math.abs(Number(currentValue[1]) - args.seconds) <= 0.00001)
          return { status: "already_current", path: args.path, ...(periodic ? { eventIndex: index } : { actionIndex: index }),
            seconds: args.seconds, saved: false, copiesCreated: 0, mapMutation: false };
        z.object({ selectionRequested: z.literal(true) }).parse(await this.desktop.command(w, 55, {
          unit: "134", field: action.handle, expected: selected.detail.fingerprint,
        }));
        const configure = periodic ? configureLivePeriodic : configureLiveWait;
        const result = await configure({ desktop: this.desktop, window: w,
          triggerHandle: selected.trigger.handle, actionHandle: action.handle,
          left: selected.left, detail: selected.detail, seconds: args.seconds,
          tree: (window, id) => this.moduleTree(window, id),
          guardArchive: async () => { if ((await this.archive(target.archive)).sha256 !== archive.sha256) throw Error("LIVE_TRIGGER_ARCHIVE_CHANGED"); },
          pause: this.pause });
        return { ...result, path: args.path, ...(periodic ? { eventIndex: index } : { actionIndex: index }),
          previousSeconds: Number(currentValue[1]), seconds: args.seconds, saved: false,
          copiesCreated: 0, reopensMap: false };
      });
    });
  }
  async tree(input: z.input<typeof triggerTreeSchema>) {
    return this.run(async () => {
      const args = triggerTreeSchema.parse(input), archive = await this.archive(args.archive);
      const target = { archive: archive.archive, windowId: args.windowId }, w = await this.window(target);
      return withEditorLease(w, async () => {
        const page = await readTriggerTreePage(this.desktop, w, 28, args.offset, args.expectedFingerprint);
        const items = page.items.slice(0, args.limit);
        return { tree: { ...page, items, truncated: items.length !== page.total }, offset: args.offset,
          nextOffset: args.offset + items.length < page.total ? args.offset + items.length : null,
          archive: target.archive, windowId: w.windowId, copiesCreated: 0, mapMutation: false };
      });
    });
  }
  async rename(input: z.infer<typeof triggerRenameSchema>) {
    return this.run(async () => {
      const args = triggerRenameSchema.parse(input), archive = await this.archive(args.archive);
      const target = { archive: archive.archive, windowId: args.windowId }, w = await this.window(target);
      return withEditorLease(w, async () => {
        const before = await this.fullTree(w);
        let parent = "0", selected: typeof before.items[number] | undefined;
        for (const part of args.path.split("/")) {
          const matches = before.items.filter(item => item.parent === parent && label(item.text) === part);
          if (matches.length !== 1) throw Error("LIVE_TRIGGER_PATH_NOT_UNIQUE_OR_MISSING");
          selected = matches[0]; parent = selected.handle;
        }
        if (!selected || before.items.some(item => item.parent === selected!.parent && item.handle !== selected!.handle &&
          (label(item.text) === args.name || label(item.text) === args.name + guiTypeSuffix(item.text))))
          throw Error("LIVE_TRIGGER_RENAME_NAME_EXISTS");
        if (label(selected.text) === args.name) throw Error("LIVE_TRIGGER_RENAME_NO_CHANGE");
        if ((await this.archive(target.archive)).sha256 !== archive.sha256) throw Error("LIVE_TRIGGER_ARCHIVE_CHANGED");
        try {
          const submitted = z.object({ submitted: z.literal(true), displaySuffix: z.string().default("") }).parse(await this.desktop.command(w, 66, {
            unit: "28", field: selected.handle, expected: before.fingerprint, value: args.name,
          }));
          const current = await this.window(target, w), after = await this.fullTree(current);
          const oldByHandle = new Map(before.items.map(item => [item.handle, item]));
          const verified = after.items.length === before.items.length && after.items.every(item => {
            const original = oldByHandle.get(item.handle);
            return original && original.parent === item.parent &&
              label(item.text) === (item.handle === selected!.handle ? args.name + submitted.displaySuffix : label(original.text));
          });
          return { status: verified ? "applied" : "verification_failed", path: args.path,
            name: args.name, archive: target.archive, nativeTreeVerified: verified,
            copiesCreated: 0, reopensMap: false, saved: false, retryMutation: false };
        } catch (error) {
          return { status: "unknown", path: args.path, name: args.name, error: String(error),
            retryMutation: false, saved: false,
            recovery: "Inspect the same GUI tree and any native dialog; do not replay an uncertain rename." };
        }
      });
    });
  }
  async appendAction(input: z.infer<typeof triggerAppendActionSchema>) {
    return this.appendGuiItem({ kind: "action", args: triggerAppendActionSchema.parse(input) });
  }
  async appendEvent(input: z.input<typeof triggerAppendEventSchema>) {
    return this.appendGuiItem({ kind: "event", args: triggerAppendEventSchema.parse(input) });
  }
  private async appendGuiItem(input: { kind: "action"; args: z.infer<typeof triggerAppendActionSchema> } |
    { kind: "event"; args: z.infer<typeof triggerAppendEventSchema> }) {
    return this.run(async () => {
      const args = input.args, archive = await this.archive(args.archive), isEvent = input.kind === "event";
      const actionArgs = input.kind === "action" ? input.args : undefined;
      const eventArgs = input.kind === "event" ? input.args : undefined;
      const periodic = eventArgs?.event === "periodic";
      const nativeAction = eventArgs ? (periodic ? "Periodic Event" : eventArgs.eventName!) : actionArgs!.action === "wait" ? "Wait" : actionArgs!.action === "skip_remaining" ? "Skip Remaining Actions" : actionArgs!.actionName!;
      const category = eventArgs ? (periodic ? "Timer" : (eventArgs.category ?? "")) : actionArgs!.action === "builtin_default" ? (actionArgs!.category ?? "") : "General";
      const kind = eventArgs ? eventArgs.event : actionArgs!.action;
      const dialogTitle = isEvent ? "Event" : "Action";
      const target = { archive: archive.archive, windowId: args.windowId }, w = await this.window(target);
      return withEditorLease(w, async () => {
        const { left, trigger, detail, group } = await this.selectTrigger(w, args.path, isEvent ? "Events" : "Actions");
        const insertion = detail.items.filter(item => item.parent === group.handle).at(-1) ?? group;
        z.object({ selectionRequested: z.literal(true) }).parse(await this.desktop.command(w, 55, {
          unit: "134", field: insertion.handle, expected: detail.fingerprint,
        }));
        if ((await this.archive(target.archive)).sha256 !== archive.sha256) throw Error("LIVE_TRIGGER_ARCHIVE_CHANGED");
        const token = randomUUID();
        let commitAttempted = false, actionVerified = false;
        const readDialog = async () => z.object({ title: z.literal(dialogTitle), fingerprint: z.string(), initial: z.string(), manualInput: z.boolean() })
          .parse(await this.desktop.command(w, 52, { token }));
        try {
          z.object({ status: z.literal("pending") }).parse(await this.desktop.command(w, 51, {
            unit: randomUUID(), field: isEvent ? "trigger.event" : "trigger.action", expected: left.fingerprint + ":" + detail.fingerprint,
            value: trigger.handle + ":" + insertion.handle, token,
          }));
          let dialog: Awaited<ReturnType<typeof readDialog>> | undefined;
          for (let i = 0; i < 100; i++) {
            try { dialog = await readDialog(); break; }
            catch (error) { if (!String(error).includes("DIALOG_NOT_READY")) throw error; }
            await this.pause(100);
          }
          if (!dialog || dialog.manualInput || dialog.fingerprint !== dialog.initial) throw Error("LIVE_TRIGGER_ACTION_DIALOG_CHANGED");
          const selection = z.object({ optionsSet: z.literal(true), category: z.string() }).parse(await this.desktop.command(w, 59, {
            token, expected: dialog.fingerprint, field: nativeAction, value: category,
          }));
          dialog = await readDialog();
          if (dialog.manualInput || dialog.fingerprint !== dialog.initial) throw Error("LIVE_TRIGGER_ACTION_DIALOG_CHANGED");
          if ((await this.archive(target.archive)).sha256 !== archive.sha256) throw Error("LIVE_TRIGGER_ARCHIVE_CHANGED");
          commitAttempted = true;
          z.object({ submitted: z.literal(true) }).parse(await this.desktop.command(w, 58, {
            token, expected: dialog.fingerprint, field: nativeAction, value: selection.category,
          }));
          let current: EditorWindow | undefined;
          for (let i = 0; i < 100; i++) {
            current = this.desktop.window ? await this.desktop.window(w.windowId) : (await this.desktop.windows()).find(x => x.windowId === w.windowId);
            if (!current || current.processId !== w.processId || current.processStart !== w.processStart) throw Error("LIVE_TRIGGER_WINDOW_CHANGED");
            if (current.enabled) break;
            await this.pause(100);
          }
          if (!current?.enabled) throw Error("LIVE_TRIGGER_ACTION_COMPLETION_UNKNOWN");
          const after = await this.moduleTree(current, 134), previous = new Map(detail.items.map(item => [item.handle, item]));
          const unchanged = detail.items.every(item => after.items.some(now => now.handle === item.handle && now.parent === item.parent && now.text === item.text));
          const added = after.items.filter(item => !previous.has(item.handle));
          const groupChildren = after.items.filter(item => item.parent === group.handle);
          const expectedAction = kind === "wait" ? /^General\s*-\s*Wait\s+\d+(?:\.\d+)?\s+Game Time seconds$/i :
            kind === "periodic" ? /^Timer\s*-\s*Every\s+\d+(?:\.\d+)?\s+seconds of Game Time$/i : kind === "skip_remaining" ? /skip remaining actions/i : /\S/;
          const verified = unchanged && added.length === 1 && added[0].parent === group.handle && groupChildren.at(-1)?.handle === added[0].handle &&
            expectedAction.test(added[0].text);
          if (verified && (actionArgs?.action === "wait" || periodic)) {
            actionVerified = true;
            const configure = periodic ? configureLivePeriodic : configureLiveWait;
            const wait = await configure({ desktop: this.desktop, window: current,
              triggerHandle: trigger.handle, actionHandle: added[0].handle,
              left: await this.fullTree(current), detail: after, seconds: periodic ? eventArgs!.seconds! : actionArgs!.seconds!,
              tree: (window, id) => this.moduleTree(window, id),
              guardArchive: async () => { if ((await this.archive(target.archive)).sha256 !== archive.sha256) throw Error("LIVE_TRIGGER_ARCHIVE_CHANGED"); },
              pause: this.pause });
            if (wait.status !== "applied") return { status: wait.status === "unknown" ? "unknown" : "partial",
              path: args.path, ...(periodic ? { event: "periodic", createdEvent: true, seconds: eventArgs!.seconds } : { action: actionArgs!.action, createdAction: true, seconds: actionArgs!.seconds }),
              parameterVerified: false, parameterResult: wait, retryMutation: false, saved: false,
              recovery: "The action or event was already created. Inspect its parameter and dialog; do not append it again." };
            return { status: "applied", path: args.path, ...(periodic ? { event: "periodic", seconds: eventArgs!.seconds } : { action: actionArgs!.action, seconds: actionArgs!.seconds }),
              nativeTreeVerified: true, parameterVerified: true, copiesCreated: 0, reopensMap: false, saved: false, retryMutation: false };
          }
          const defaults = kind === "builtin_default";
          return { status: verified ? (defaults ? "needs_parameters" : "applied") : "verification_failed", path: args.path, kind,
            ...(!isEvent ? { action: kind } : {}),
            ...(defaults ? { ...(isEvent ? { createdEvent: verified ? true : "unconfirmed", eventName: nativeAction } : { createdAction: verified ? true : "unconfirmed", actionName: nativeAction }), category: selection.category,
              nativeLabel: added[0]?.text, itemIndex: verified ? groupChildren.length : undefined,
              detailFingerprint: verified ? after.fingerprint : undefined,
              parametersVerified: false, parameterState: "editor_defaults_unverified" } : {}),
            nativeTreeVerified: verified, copiesCreated: 0, reopensMap: false, saved: false, retryMutation: false };
        } catch (error) {
          if (!commitAttempted) {
            try {
              const dialog = await readDialog();
              if (!dialog.manualInput && dialog.fingerprint === dialog.initial)
                await this.desktop.command(w, 54, { token, expected: dialog.fingerprint });
            } catch { /* Leave manually edited and unrecognised dialogs untouched. */ }
          }
          return { status: actionVerified ? "partial" : commitAttempted ? "unknown" : "stopped", path: args.path, kind,
            ...(actionVerified ? (periodic ? { createdEvent: true } : { createdAction: true }) : {}), error: String(error), retryMutation: false, saved: false,
            recovery: "Inspect this trigger and any open dialog; never replay an uncertain insertion." };
        }
      });
    });
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
  async create(input: z.input<typeof triggerCreateSchema>) {
    const args = triggerCreateSchema.parse(input);
    return this.run(async () => {
      const archive = await this.archive(args.archive);
      const window = await resolveTriggerContext(this.desktop, { archive: archive.archive, windowId: args.windowId }, this.pause);
      const prepared = await this.prepareImpl({ archive: archive.archive, windowId: window.windowId, name: args.name, plan: args.plan });
      const applied = await this.applyImpl(prepared.planId);
      return { ...applied, planId: prepared.planId, sourceWindowId: args.windowId, windowId: window.windowId, archive: archive.archive };
    });
  }
  async catalog(input:z.input<typeof triggerCatalogSchema>) {
    const args=triggerCatalogSchema.parse(input);
    return this.run(async()=>{
      const archive=await this.archive(args.archive);
      const captured=await captureTriggerCatalog(this.desktop,{archive:archive.archive,windowId:args.windowId},args.references,this.pause);
      return {references:captured.identities,catalogRevision:captured.revision,catalogReferenceCount:captured.identities.length,
        nativeCatalogVerified:true,scope:captured.scope,archive:archive.archive,windowId:captured.windowId,mapMutation:false,copiesCreated:0,reopensMap:false};
    });
  }
  async prepare(input: z.input<typeof triggerPrepareSchema>) {
    return this.run(() => this.prepareImpl(input));
  }
  private async prepareImpl(input: z.input<typeof triggerPrepareSchema>) {
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
      let planText: string;
      if (args.planFile !== undefined) {
        const raw = await this.workspace.readRaw(args.planFile);
        if (!raw.exists || raw.staged) throw Error("LIVE_TRIGGER_SAVED_PLAN_REQUIRED");
        planText = raw.text;
      } else planText = JSON.stringify(args.plan);
      if (Buffer.byteLength(planText) > libraryLimit) throw Error("LIVE_TRIGGER_PLAN_BYTE_LIMIT");
      const parsed: unknown = JSON.parse(planText),
        requests = z
          .array(triggerPlanSchema)
          .min(1)
          .max(100)
          .parse(Array.isArray(parsed) ? parsed : [parsed]);
      if (
        requests.some((r) => r.stringFiles?.length) ||
        /"translations"\s*:|"objectId"\s*:/.test(planText)
      )
        throw Error("LIVE_TRIGGER_EXTERNAL_CONTEXT_UNSUPPORTED");
      const links=requests.flatMap(r=>collectGuiValues(r)).filter(v=>v.kind==="gamelink") as Array<{domain:string;id:string}>;
      const uniqueLinks=[...new Map(links.map(v=>[JSON.stringify([v.domain,v.id]),{domain:v.domain,id:v.id}])).values()];
      const catalog=uniqueLinks.length?await captureTriggerCatalog(this.desktop,target,uniqueLinks,this.pause):undefined;
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
        if(catalog) {
          if(!runtime.bindTriggerCatalog)throw Error("LIVE_TRIGGER_CATALOG_BINDING_UNAVAILABLE");
          runtime.bindTriggerCatalog(catalog.context);
        }
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
          catalog:catalog?{identities:catalog.identities,revision:catalog.revision}:undefined,
        });
        return {
          status: "prepared",
          planId: id,
          name: args.name,
          file,
          bytes: Buffer.byteLength(source),
          sha256: digest(source),
          nativeProfile: profile,
          catalogReferenceCount:catalog?.identities.length??0,
          catalogRevision:catalog?.revision,
          copiesCreated: 0,
          mapMutation: false,
          saved: false,
        };
      } finally {
        await runtime.close();
      }
  }
  async apply(planId: string) {
    return this.run(() => this.applyImpl(planId));
  }
  private async applyImpl(planId: string) {
      const id = z.string().uuid().parse(planId),
        p = this.plans.get(id);
      if (!p || p.expires <= Date.now()) throw Error("LIVE_TRIGGER_PLAN_EXPIRED");
      const w = await this.window(p.target, p.window);
      if(p.catalog) {
        const current=await captureTriggerCatalog(this.desktop,p.target,p.catalog.identities,this.pause);
        if(current.revision!==p.catalog.revision)throw Error("LIVE_TRIGGER_CATALOG_STALE");
      }
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
          catalogReferenceCount:p.catalog?.identities.length??0,
          nativeCatalogVerified:p.catalog?true:undefined,
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
