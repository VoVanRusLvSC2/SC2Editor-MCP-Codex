import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CutsceneAssetIndex } from "./assets.js";
import { cutsceneRuntimeCapabilities, generateCutsceneTrigger, runCutsceneRuntimeAdapter } from "./runtime.js";
import { CutsceneSchemaRegistry } from "./schemaRegistry.js";
import type { CutsceneComposeSpec, CutsceneOperation, NativeNodeSpec } from "./types.js";
import { CutsceneWorkspace } from "./workspace.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const nativeTimeInput = z.union([z.string().min(1), z.number().int().min(0)]);
const nativeVector = z.union([z.string().min(1), z.tuple([z.number(), z.number(), z.number()])]);
const assetSelector = z.object({
  catalog: z.string().optional(),
  id: z.string().optional(),
  path: z.string().optional(),
});
const selector = z.union([z.string().min(1), z.object({
  id: z.string().optional(),
  nodeId: z.number().int().min(0).optional(),
  guid: z.string().optional(),
  name: z.string().optional(),
  nativeType: z.string().optional(),
  occurrence: z.number().int().min(0).optional(),
})]);
const nativeNode: z.ZodType<NativeNodeSpec> = z.lazy(() => z.object({
  nativeType: z.string().regex(/^[A-Za-z_][\w:.-]*$/),
  attrs: z.record(z.string(), scalar).optional(),
  children: z.array(nativeNode).optional(),
}));

const operationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("object.add"), as: z.string().optional(), parent: selector.optional(), object: nativeNode }),
  z.object({ op: z.literal("object.remove"), object: selector }),
  z.object({ op: z.literal("object.rename"), object: selector, name: z.string().min(1) }),
  z.object({ op: z.literal("object.clone"), as: z.string().optional(), object: selector, parent: selector.optional(), name: z.string().optional() }),
  z.object({ op: z.literal("property.set"), object: selector, path: z.string().min(2), value: scalar, allowUnknown: z.boolean().optional() }),
  z.object({ op: z.literal("property.reset"), object: selector, path: z.string().min(2) }),
  z.object({ op: z.literal("timeline.add"), as: z.string().optional(), parent: selector, node: nativeNode }),
  z.object({ op: z.literal("timeline.remove"), node: selector }),
  z.object({ op: z.literal("keyframe.add"), as: z.string().optional(), track: selector, keyframe: nativeNode }),
  z.object({ op: z.literal("keyframe.update"), keyframe: selector, values: z.record(z.string(), scalar) }),
  z.object({ op: z.literal("keyframe.remove"), keyframe: selector }),
  z.object({ op: z.literal("bookmark.add"), as: z.string().optional(), name: z.string().min(1), time: z.string().optional(), jumpToBookmarkWhenHit: z.string().optional() }),
  z.object({ op: z.literal("bookmark.remove"), bookmark: selector }),
  z.object({ op: z.literal("filter.add"), as: z.string().optional(), parent: selector.optional(), filter: nativeNode }),
  z.object({ op: z.literal("filter.remove"), filter: selector }),
  z.object({
    op: z.literal("actor.add"), as: z.string().optional(), parent: selector.optional(), name: z.string().optional(),
    asset: z.object({ catalog: z.literal("Model").optional(), id: z.string().optional(), path: z.string().optional() }).optional(),
    modelLink: z.string().optional(), modelPath: z.string().optional(), position: nativeVector.optional(), rotation: nativeVector.optional(),
    scale: nativeVector.optional(), properties: z.record(z.string(), scalar).optional(), duration: nativeTimeInput.optional(), lockedToEnd: z.boolean().optional(),
  }),
  z.object({ op: z.literal("actor.face"), actors: z.array(selector).min(1), target: z.tuple([z.number(), z.number(), z.number()]), axisOffsetDegrees: z.number().optional() }),
  z.object({
    op: z.literal("text.add"), as: z.string().optional(), parent: selector.optional(), name: z.string().min(1), text: z.string(),
    position: nativeVector.optional(), enabled: z.boolean().optional(), sortIndex: z.number().int().min(0).optional(),
    duration: nativeTimeInput.optional(), lockedToEnd: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("text.animate"), as: z.string().optional(), object: selector,
    keyframes: z.array(z.object({ start: nativeTimeInput.optional(), value: z.string() })).min(1),
    enabled: z.boolean().optional(), sortIndex: z.number().int().min(0).optional(),
  }),
  z.object({ op: z.literal("animation.layer.add"), as: z.string().optional(), object: selector, name: z.string().optional(), enabled: z.boolean().optional(), filter: z.string().optional(), sortIndex: z.number().int().min(0).optional() }),
  z.object({
    op: z.literal("animation.add"), as: z.string().optional(), layer: selector, anim: z.string().min(1),
    animId: z.number().int().optional(), start: nativeTimeInput.optional(), duration: nativeTimeInput.optional(), originalDuration: nativeTimeInput.optional(),
    priority: z.number().int().optional(), looping: z.boolean().optional(), blendTime: nativeTimeInput.optional(),
    blendOutTime: nativeTimeInput.optional(), startOffset: nativeTimeInput.optional(), timeScale: z.number().positive().optional(),
    weight: z.number().min(0).optional(), rightAligned: z.boolean().optional(), lockedToEnd: z.boolean().optional(), playOnce: z.boolean().optional(),
    playForever: z.boolean().optional(), fullMatchLegacy: z.boolean().optional(), movespeed: z.number().optional(),
    originalMoveSpeed: z.number().optional(), properties: z.record(z.string(), scalar).optional(),
  }),
  z.object({ op: z.literal("animation.update"), animation: selector, values: z.record(z.string(), scalar) }),
  z.object({ op: z.literal("animation.remove"), animation: selector }),
  z.object({
    op: z.literal("property.animate"), as: z.string().optional(), object: selector, property: z.string().min(1),
    name: z.string().optional(), enabled: z.boolean().optional(), filter: z.string().optional(), sortIndex: z.number().int().min(0).optional(),
    allowUnknown: z.boolean().optional(), keyframes: z.array(z.object({
      as: z.string().optional(), start: nativeTimeInput.optional(), value: scalar, time: nativeTimeInput.optional(),
      curveInValue: z.string().optional(), curveOutValue: z.string().optional(), curveInType: z.number().int().optional(), curveOutType: z.number().int().optional(),
    })).min(1),
  }),
  z.object({ op: z.literal("light.add"), as: z.string().optional(), parent: selector.optional(), name: z.string().min(1), nativeType: z.enum(["CCutsceneNodeLight", "CCutsceneNodeEnvironmentLight"]).optional(), properties: z.record(z.string(), scalar).optional(), duration: nativeTimeInput.optional(), lockedToEnd: z.boolean().optional() }),
  z.object({ op: z.literal("light.update"), light: selector, properties: z.record(z.string(), scalar) }),
  z.object({ op: z.literal("light.remove"), light: selector }),
  z.object({ op: z.literal("light.activate"), as: z.string().optional(), light: selector.optional(), lightID: z.string().optional(), lightIndex: z.number().int().min(0).optional(), blendTime: nativeTimeInput.optional(), start: nativeTimeInput.optional() }),
  z.object({ op: z.literal("fog.upsert"), as: z.string().optional(), fog: selector.optional(), name: z.string().min(1).optional(), color: nativeVector, falloff: z.number().min(0).optional(), density: z.number().min(0).optional(), startHeight: z.number().optional(), duration: nativeTimeInput.optional(), lockedToEnd: z.boolean().optional() }),
  z.object({ op: z.literal("camera.create"), as: z.string().optional(), id: z.string().min(1), nativeType: z.string().optional(), duration: nativeTimeInput.optional(), lockedToEnd: z.boolean().optional(), properties: z.record(z.string(), scalar).optional() }),
  z.object({ op: z.literal("camera.pose"), camera: selector, properties: z.record(z.string(), scalar) }),
  z.object({ op: z.literal("shot.add"), as: z.string().optional(), camera: selector, start: z.string(), end: z.string().optional(), transition: nativeNode.optional() }),
  z.object({ op: z.literal("raw.patch"), start: z.number().int().min(0), end: z.number().int().min(0), text: z.string() }),
]);

export interface CutsceneToolContext {
  workspace: CutsceneWorkspace;
  schema: CutsceneSchemaRegistry;
  assets: CutsceneAssetIndex;
}

const operationFamilies = {
  scene: ["cutscene.create", "cutscene.compose"],
  object: ["object.add", "object.remove", "object.rename", "object.clone", "actor.add", "actor.face", "text.add"],
  property: ["property.set", "property.reset"],
  timeline: ["timeline.add", "timeline.remove", "keyframe.add", "keyframe.update", "keyframe.remove"],
  director: ["camera.create", "camera.pose", "shot.add"],
  bookmarks: ["bookmark.add", "bookmark.remove"],
  filters: ["filter.add", "filter.remove"],
  animation: ["animation.layer.add", "animation.add", "animation.update", "animation.remove"],
  propertyAnimation: ["property.animate", "text.animate", "keyframe.add", "keyframe.update", "keyframe.remove"],
  lighting: ["light.add", "light.update", "light.remove", "light.activate", "fog.upsert", "property.animate"],
  escapeHatch: ["raw.patch"],
};

export function registerCutsceneTools(server: McpServer, context: CutsceneToolContext): void {
  const { workspace, schema, assets } = context;

  server.registerTool("cutscene.register_document", {
    description: "Register existing Base.SC2Data/Cutscenes scenes as the native cuts document component. Preserve all unrelated manifest bytes and existing Index.version; a missing version requires an exact Editor-produced versionTemplate within the workspace. Atomic dry-run/staging supported. Does not certify Editor opening or playback.",
    inputSchema: z.object({ versionTemplate: z.string().optional(), dryRun: z.boolean().default(true), stage: z.boolean().default(true), backup: z.boolean().default(true) }),
  }, async args => textResult(await workspace.registerDocument(args)));

  server.registerTool("cutscene.list_files", {
    description: "List SC2Cutscene and StormCutscene resources visible in the shared map/mod workspace.",
    inputSchema: z.object({}),
  }, async () => textResult({ root: workspace.root, files: await workspace.listFiles() }));

  server.registerTool("cutscene.context", {
    description: "Token-efficient one-call context for Codex: scene summary, only relevant schema entries, high-level availability, optional batched asset searches, and the operation registry.",
    inputSchema: z.object({
      file: z.string().optional(),
      categories: z.array(z.string()).max(20).optional(),
      objectTypes: z.array(z.string()).max(20).optional(),
      assetQueries: z.array(z.object({ query: z.string().min(1), types: z.array(z.string()).optional(), limit: z.number().int().min(1).max(50).default(10) })).max(8).optional(),
      maxProperties: z.number().int().min(1).max(500).default(120),
    }),
  }, async ({ file, categories, objectTypes, assetQueries, maxProperties }) => {
    const categorySet = new Set(categories ?? []);
    const typeSet = new Set(objectTypes ?? []);
    const nodes = schema.data.nodes.filter((entry) => (!categorySet.size || categorySet.has(entry.category)) && (!typeSet.size || typeSet.has(entry.nativeType)));
    const relevantTypes = new Set([...nodes.map((entry) => entry.nativeType), ...typeSet]);
    const selectedProperties = relevantTypes.size
      ? [...new Map([...relevantTypes].flatMap((nativeType) => schema.describe(nativeType).properties).map((entry) => [`${entry.objectType}\0${entry.xmlName}`, entry])).values()]
      : schema.data.properties;
    const properties = selectedProperties.slice(0, maxProperties);
    const opened = file ? await workspace.open(file) : undefined;
    const ir = opened?.document.toIR(schema, true);
    const scene = ir ? {
      file: opened!.file,
      sha256: opened!.document.sha256,
      staged: opened!.staged,
      formatVersion: ir.formatVersion,
      objectCount: ir.objects.length,
      objects: ir.objects.slice(0, 100).map((entry) => ({ id: entry.id, nativeType: entry.nativeType, category: entry.category, name: entry.displayName, asset: entry.asset })),
      truncated: ir.objects.length > 100,
    } : undefined;
    const assetResults = await Promise.all((assetQueries ?? []).map(async (query) => ({ ...query, results: await assets.search(query.query, query.types, query.limit) })));
    const cameraNode = schema.data.nodes.find((entry) => entry.category === "camera" && entry.coverage === "SUPPORTED");
    return textResult({
      schema: { version: schema.data.schemaVersion, hash: schema.data.schemaHash, nodes, properties, propertyResultsTruncated: properties.length >= maxProperties },
      scene,
      assets: assetResults,
      operations: operationFamilies,
      highLevelAvailability: {
        cameraCreate: cameraNode ? { status: "AVAILABLE", nativeType: cameraNode.nativeType } : { status: "GATED_SCHEMA_MISSING", fallback: "object.add with an observed native Camera node" },
        cameraPose: cameraNode ? "AVAILABLE_FOR_DISCOVERED_PROPERTIES" : "GATED_SCHEMA_MISSING",
        directorShots: schema.getNode("CCutsceneElementActiveCamera") ? "ZERO_TIME_CONFIRMED_NONZERO_TIME_GATED" : "GATED_SCHEMA_MISSING",
        bookmarks: schema.getNode("CCutsceneElementBookmark") ? "AVAILABLE_NATIVE_TICKS" : "GATED_SCHEMA_MISSING",
        animationBlocks: schema.getNode("CCutsceneElementAnim") ? "AVAILABLE_SCHEMA_DRIVEN" : "GATED_SCHEMA_MISSING",
        animationTimeScaleAndWeight: schema.getProperty("CCutsceneElementAnim", "timeScale") && schema.getProperty("CCutsceneElementAnim", "weight") ? "AVAILABLE" : "GATED_SCHEMA_MISSING",
        animationEditorFields: schema.getProperty("CCutsceneElementAnim", "animId") && schema.getProperty("CCutsceneElementAnim", "rightAligned") ? "AVAILABLE_EXE_DISCOVERED" : "GATED_SCHEMA_MISSING",
        cutsceneLights: schema.getNode("CCutsceneNodeLight") ? "AVAILABLE_SCHEMA_DRIVEN" : "GATED_SCHEMA_MISSING",
        cutsceneFog: schema.getNode("CCutsceneNodeFog") ? "AVAILABLE_VIA_FOG_UPSERT" : "GATED_SCHEMA_MISSING",
        actorFacing: schema.getProperty("CCutsceneNodeActor", "position") && schema.getProperty("CCutsceneNodeActor", "rotation") ? "AVAILABLE_BATCH_ACTOR_FACE" : "GATED_SCHEMA_MISSING",
        environmentLighting: schema.getNode("CCutsceneNodeEnvironmentLight") ? "AVAILABLE_GENERIC_EXE_SCHEMA;_RUNTIME_NOT_YET_PROVEN" : "GATED_SCHEMA_MISSING",
        animatedProperties: schema.getNode("CCutsceneNodePropertyValue") && schema.getNode("CCutsceneElementPropertyCurve") ? "AVAILABLE_FOR_OBSERVED_PROPERTY_NAMES" : "GATED_SCHEMA_MISSING",
        arbitraryNativeObjects: "AVAILABLE",
        assetPlacement: schema.getNode("CCutsceneNodeActor") ? "AVAILABLE_VIA_ACTOR_ADD_USING_ASSET_SEARCH_CUTSCENE_USE" : "GATED_SCHEMA_MISSING",
        unknownPreservation: "AVAILABLE",
      },
      recommendedCallCount: file ? "1 context + 1 apply (apply already validates and returns diff; stage=false writes atomically)" : "1 context + 1 compose (compose validates and stage=false writes atomically)",
    });
  });

  server.registerTool("cutscene.create", {
    description: "Create a native CutsceneState .SC2Cutscene document. Defaults to dry-run and preserves native precision/unknown data on later edits.",
    inputSchema: z.object({ file: z.string().min(1), name: z.string().optional(), version: z.string().default("1.300000"), dryRun: z.boolean().default(true), stage: z.boolean().default(true) }),
  }, async (args) => textResult(await workspace.create(args.file, args)));

  server.registerTool("cutscene.open", {
    description: "Open a real SC2Cutscene/StormCutscene without normalizing XML. Summary mode is token-efficient; full/native modes expose the semantic IR or exact source.",
    inputSchema: z.object({ file: z.string().min(1), detail: z.enum(["summary", "full", "native"]).default("summary"), preserveNative: z.boolean().default(true) }),
  }, async ({ file, detail, preserveNative }) => {
    const opened = await workspace.open(file);
    const ir = opened.document.toIR(schema, preserveNative);
    const categoryCounts = Object.fromEntries([...new Set(ir.objects.map((entry) => entry.category))].map((category) => [category, ir.objects.filter((entry) => entry.category === category).length]));
    const nativeTypeCounts = Object.fromEntries([...new Set(ir.objects.map((entry) => entry.nativeType))].map((nativeType) => [nativeType, ir.objects.filter((entry) => entry.nativeType === nativeType).length]));
    return textResult({
      file: opened.file,
      sha256: opened.document.sha256,
      staged: opened.staged,
      summary: { formatVersion: ir.formatVersion, name: ir.name, objects: ir.objects.length, categoryCounts, nativeTypeCounts, diagnostics: ir.diagnostics },
      ir: detail === "full" ? { ...ir, objects: ir.objects.map((entry) => ({ ...entry, rawSource: undefined })) } : undefined,
      source: detail === "native" ? opened.source : undefined,
    });
  });

  server.registerTool("cutscene.inspect", {
    description: "Inspect semantic/native Cutscene objects by type, category or name. Every result includes exact raw native XML and preservation metadata.",
    inputSchema: z.object({ file: z.string().min(1), nativeType: z.string().optional(), category: z.string().optional(), name: z.string().optional(), includeRaw: z.boolean().default(false), limit: z.number().int().min(1).max(2000).default(100) }),
  }, async ({ file, includeRaw, ...query }) => {
    const opened = await workspace.open(file);
    const objects = opened.document.list(query, schema).map((entry) => includeRaw ? entry : { ...entry, rawSource: undefined });
    return textResult({ file: opened.file, sha256: opened.document.sha256, objects, diagnostics: opened.document.diagnostics });
  });

  server.registerTool("cutscene.compose", {
    description: "Create a complete scene in one transaction from schema-confirmed native objects. Refuses to guess unobserved camera/time serialization.",
    inputSchema: z.object({
      file: z.string().min(1),
      name: z.string().optional(),
      version: z.string().default("1.300000"),
      duration: z.string().optional(),
      objects: z.array(nativeNode).optional(),
      director: nativeNode.optional(),
      bookmarks: z.array(z.object({ name: z.string().min(1), time: z.string().optional(), jumpToBookmarkWhenHit: z.string().optional() })).optional(),
      filters: z.array(nativeNode).optional(),
      entries: z.array(z.object({ as: z.string().optional(), parent: selector.optional(), node: nativeNode })).optional(),
      operations: z.array(operationSchema).max(250).optional(),
      preserveNative: z.boolean().default(true),
      includeSource: z.boolean().default(false),
      dryRun: z.boolean().default(true),
      stage: z.boolean().default(true),
      allowInvalid: z.boolean().default(false),
    }),
  }, async (args) => {
    const result = await workspace.compose(args as CutsceneComposeSpec, args);
    return textResult({ ...result, source: args.includeSource ? result.source : undefined });
  });

  server.registerTool("cutscene.apply", {
    description: "Atomically apply up to 250 native/semantic operations to one private Cutscene IR, validate, then commit or rollback as a unit. Returns semantic diff.",
    inputSchema: z.object({ file: z.string().min(1), operations: z.array(operationSchema).min(1).max(250), dryRun: z.boolean().default(true), stage: z.boolean().default(true), expectedSha256: z.string().optional(), validate: z.boolean().default(true), allowInvalid: z.boolean().default(false) }),
  }, async (args) => textResult(await workspace.apply(args.file, args.operations as CutsceneOperation[], args)));

  server.registerTool("cutscene.validate", {
    description: "Run L1 XML, L2 schema, L3 reference and L4 semantic validation. L5 Editor/L6 runtime are reported UNAVAILABLE unless separately actually run.",
    inputSchema: z.object({ file: z.string().min(1) }),
  }, async ({ file }) => textResult({ file, ...(await workspace.validate(file)) }));

  server.registerTool("cutscene.diff", {
    description: "Return a semantic staged diff such as GUID/property changes instead of a noisy whole-XML rewrite.",
    inputSchema: z.object({ file: z.string().min(1) }),
  }, async ({ file }) => textResult(await workspace.diff(file)));

  server.registerTool("cutscene.save", {
    description: "Atomically save a staged Cutscene with optimistic hash guard and undo-friendly backup.",
    inputSchema: z.object({ file: z.string().min(1), expectedSha256: z.string().optional(), backup: z.boolean().default(true) }),
  }, async ({ file, expectedSha256, backup }) => textResult(await workspace.save(file, { expectedSha256, backup })));

  server.registerTool("cutscene.export", {
    description: "Export the current staged/native scene to another .SC2Cutscene path using atomic write and optional backup.",
    inputSchema: z.object({ file: z.string().min(1), output: z.string().min(1), backup: z.boolean().default(true) }),
  }, async ({ file, output, backup }) => textResult(await workspace.export(file, output, { backup })));

  server.registerTool("cutscene.schema.inspect", {
    description: "Inspect every discovered native object/property with provenance, value type, keyframeability, confidence and coverage status.",
    inputSchema: z.object({ objectType: z.string().optional(), search: z.string().optional(), coverage: z.string().optional(), limit: z.number().int().min(1).max(2000).default(200), includeCorpusFiles: z.boolean().default(false) }),
  }, async (query) => textResult(schema.inspect(query)));

  server.registerTool("cutscene.schema.coverage", {
    description: "Report honest schema/corpus/runtime coverage counts; preserve-only and untested structures are never hidden.",
    inputSchema: z.object({}),
  }, async () => textResult(schema.coverage()));

  server.registerTool("cutscene.assets.search", {
    description: "Ranked dependency-aware search over all local catalog classes, observed Cutscenes, extracted M3/M3A metadata, manifests and custom map/mod assets. Results include a ready-to-use native cutscene reference.",
    inputSchema: z.object({ query: z.string().min(1), types: z.array(z.string()).optional(), limit: z.number().int().min(1).max(200).default(25) }),
  }, async ({ query, types, limit }) => textResult({ query, results: await assets.search(query, types, limit) }));

  server.registerTool("cutscene.assets.inspect", {
    description: "Inspect and recursively resolve a catalog/custom asset through Unit→Actor→Model-style references, returning exact definitions and ready-to-use Cutscene placement candidates.",
    inputSchema: z.object({ catalog: z.string().min(1), id: z.string().min(1), maxDepth: z.number().int().min(0).max(32).default(8) }),
  }, async ({ catalog, id, maxDepth }) => textResult(await assets.resolve(catalog, id, maxDepth)));

  server.registerTool("cutscene.assets.status", {
    description: "Report indexed asset roots, catalogs, source coverage and whether exact M3 animation metadata is available.",
    inputSchema: z.object({}),
  }, async () => textResult(await assets.status()));

  server.registerTool("cutscene.assets.refresh", {
    description: "Refresh the local asset index after adding custom assets or extracting another SC2 dependency. Does not modify any asset.",
    inputSchema: z.object({}),
  }, async () => textResult(await assets.refresh()));

  server.registerTool("cutscene.animations.list", {
    description: "List real animation sequence names for a scene object or asset. Reads native M3/M3A SEQS when available and marks catalog/cutscene-only results partial instead of inventing names.",
    inputSchema: z.object({ file: z.string().min(1).optional(), object: selector.optional(), asset: assetSelector.optional() }),
  }, async ({ file, object, asset }) => {
    if ((!file || !object) && !asset) throw new Error("Provide file + object, or an asset selector");
    const observed = new Set<string>();
    let resolvedAsset = asset;
    let objectIdentity: string | undefined;
    if (file && object) {
      const opened = await workspace.open(file);
      const root = opened.document.resolve(object);
      objectIdentity = root.attrs.guid ? `guid:${root.attrs.guid}` : `node:${root.id}`;
      const descendants = new Set<number>([root.id]);
      const visit = (id: number): void => { for (const child of opened.document.nodes[id].childIds) { descendants.add(child); visit(child); } };
      visit(root.id);
      for (const id of descendants) for (const [name, value] of Object.entries(opened.document.nodes[id].attrs)) if (/anim/i.test(name) && value) observed.add(value);
      resolvedAsset ??= root.attrs.modelLink ? { catalog: "Model", id: root.attrs.modelLink } : root.attrs.modelPath ? { catalog: "Model", path: root.attrs.modelPath } : undefined;
    }
    const inventory = resolvedAsset ? await assets.animations(resolvedAsset) : undefined;
    return textResult({
      object: objectIdentity,
      asset: resolvedAsset,
      animations: [...new Set([...(inventory?.animations ?? []), ...observed])].sort(),
      attachmentPoints: inventory?.attachmentPoints ?? [],
      complete: inventory?.complete ?? false,
      sources: [...(inventory?.sources ?? []), ...(observed.size ? [{ file: file!, source: "cutscene-observed" as const, complete: false }] : [])],
      note: inventory?.note ?? "No model asset could be resolved from this object. Pass asset={catalog,id|path} or mount extracted assets.",
    });
  });

  server.registerTool("cutscene.runtime.validate", {
    description: "Run the configured external Editor/SC2 adapter. Never reports runtime PASS when no adapter executed.",
    inputSchema: z.object({ file: z.string().min(1), timeoutMs: z.number().int().min(1000).max(3_600_000).default(900_000) }),
  }, async ({ file, timeoutMs }) => {
    const capabilities = await cutsceneRuntimeCapabilities(schema);
    if (capabilities.runtimeValidation !== "AVAILABLE") return textResult({ file, status: "UNAVAILABLE", capabilities });
    const report = await runCutsceneRuntimeAdapter(workspace.root, file, timeoutMs);
    return textResult({ file, status: report.exitCode === 0 && !report.timedOut ? "PASS" : "FAIL", report });
  });

  server.registerTool("cutscene.runtime.generate_trigger", {
    description: "Generate Galaxy playback calls only when their exact signatures were indexed from local natives.galaxy.",
    inputSchema: z.object({
      cutscenePath: z.string().min(1),
      positionExpression: z.string().min(1).describe("Galaxy point expression, for example Point(0.0, 0.0)."),
      playersExpression: z.string().min(1).describe("Galaxy playergroup expression resolved by the Trigger module/caller."),
      autoPlay: z.boolean().default(false),
      variable: z.string().regex(/^[A-Za-z_]\w*$/).default("gv_cutscene"),
    }),
  }, async (args) => textResult(generateCutsceneTrigger(schema, args)));
}
