import { APP_VERSION } from "../app/version.js";
import type { TerrainWorkspace } from "../modules/terrain/workspace.js";
import type { MapWorkspace } from "../modules/map/workspace.js";
import { mapCreateSchema, mapBlueprintRegistrationSchema } from "../modules/map/tools.js";
import { terrainPlanSchema, terrainGenerateSchema, terrainLandscapeSchema, terrainFeatureSchema, terrainApplySchema } from "../modules/terrain/schemas.js";
import type { TerrainOperation } from "../modules/terrain/types.js";
import type { AnchorSpec, ElementSpec, LayoutOperation, PropertySelector, ScalarValue } from "../core/types.js";
import { Workspace } from "../core/workspace.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";
import { bridgeCapabilities } from "../core/capabilities.js";
import { runRuntimeAdapter } from "../runtime/runtimeHarness.js";
import type { BrowseWorkspace } from "../modules/browse/workspace.js";
import type { PlacementWorkspace } from "../modules/placement/workspace.js";
import { scatterDoodadsSchema, snapObjectsSchema } from "../modules/placement/decorationSchemas.js";
import { compactPlacementPlan } from "../modules/placement/summary.js";
import { addPlacementSchema, createLocationSchema } from "../modules/placement/tools.js";
import type { AiWorkspace } from "../modules/ai/workspace.js";
import { aiApplySchema } from "../modules/ai/tools.js";
import type { AiOperation } from "../modules/ai/types.js";

export interface GuiApiRequest {
  method: string;
  pathname: string;
  query?: URLSearchParams;
  body?: unknown;
}

export interface GuiApiResponse {
  status: number;
  body: unknown;
}

type JsonRecord = Record<string, unknown>;

export interface GuiAuthoringContext {
  projectStatus?: () => unknown;
  projectPreflight?:()=>Promise<unknown>;
  browse: BrowseWorkspace;
  placement: PlacementWorkspace;
  ai?: AiWorkspace;
  terrain?: TerrainWorkspace;
  map?: MapWorkspace;
}

function asObject(value: unknown, label = "body"): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonRecord;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : asString(value, label);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error("Expected a boolean value");
  return value;
}

function asScalar(value: unknown, label: string): ScalarValue {
  if (!["string", "number", "boolean"].includes(typeof value)) throw new Error(`${label} must be a scalar`);
  return value as ScalarValue;
}

function requiredQuery(query: URLSearchParams, name: string): string {
  return asString(query.get(name), name);
}

function mutationOptions(body: JsonRecord, summary: string) {
  return {
    dryRun: asBoolean(body.dryRun, false),
    stage: asBoolean(body.stage, true),
    expectedSha256: optionalString(body.expectedSha256, "expectedSha256"),
    summary,
  };
}

function parseProperties(value: unknown): ElementSpec[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("properties must be an array");
  return value.map((item, index) => {
    const row = asObject(item, `properties[${index}]`);
    const attrs = row.attrs === undefined
      ? undefined
      : Object.fromEntries(Object.entries(asObject(row.attrs, `properties[${index}].attrs`))
        .map(([name, entry]) => [name, asScalar(entry, name)]));
    return {
      tag: asString(row.tag, `properties[${index}].tag`),
      value: row.value === undefined ? undefined : asScalar(row.value, `properties[${index}].value`),
      attrs,
    };
  });
}

function parseAnchors(value: unknown): AnchorSpec[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("anchors must be an array");
  return value.map((item, index) => {
    const row = asObject(item, `anchors[${index}]`);
    const side = asString(row.side, `anchors[${index}].side`);
    if (!["Top", "Left", "Right", "Bottom", "All"].includes(side)) throw new Error(`Invalid anchor side '${side}'`);
    if (row.offset !== undefined && typeof row.offset !== "number") throw new Error("anchor offset must be numeric");
    return {
      side: side as AnchorSpec["side"],
      relative: optionalString(row.relative, "anchor.relative") ?? "$parent",
      pos: optionalString(row.pos, "anchor.pos"),
      offset: row.offset as number | undefined,
    };
  });
}

function parseSelector(value: unknown): PropertySelector | undefined {
  if (value === undefined) return undefined;
  const row = asObject(value, "selector");
  const attrs = row.attrs === undefined
    ? undefined
    : Object.fromEntries(Object.entries(asObject(row.attrs, "selector.attrs"))
      .map(([name, entry]) => [name, asScalar(entry, name)]));
  if (row.occurrence !== undefined && (!Number.isInteger(row.occurrence) || Number(row.occurrence) < 0)) {
    throw new Error("selector.occurrence must be a non-negative integer");
  }
  return {
    index: row.index as string | number | undefined,
    layer: row.layer as string | number | undefined,
    attrs,
    occurrence: row.occurrence as number | undefined,
  };
}

function validateProperties(schema: SchemaRegistry, frameType: string, properties: ElementSpec[] | undefined): void {
  for (const spec of properties ?? []) {
    const property = schema.getProperty(frameType, spec.tag);
    if (!property) throw new Error(`Unknown property '${spec.tag}' for frame type '${frameType}'`);
    const value = spec.value ?? spec.attrs?.val;
    if (value === undefined) continue;
    const problem = schema.validateScalar(schema.valueTypeOf(property), value);
    if (problem) throw new Error(`${spec.tag}: ${problem}`);
  }
}

function errorResponse(error: unknown): GuiApiResponse {
  const message = error instanceof Error ? error.message : String(error);
  return { status: /not found|unknown/i.test(message) ? 404 : 400, body: { error: message } };
}

const LAYOUT_OPERATIONS = new Set([
  "create_frame", "clone_frame", "delete_frame", "set_property", "set_anchor", "apply_template",
  "upsert_state_group", "upsert_animation", "add_include", "remove_include", "create_clipped_image",
]);

const UI_CONTAINER_PRESETS = [
  { name: "GameUI/UIContainer", file: "GameUI", label: "All in-game UI" },
  { name: "GameUI/UIContainer/FullscreenLowerContainer", file: "GameUI", label: "Below the console" },
  { name: "GameUI/UIContainer/ConsoleUIContainer", file: "GameUI", label: "Console-attached UI" },
  { name: "GameUI/UIContainer/FullscreenUpperContainer", file: "GameUI", label: "Above the console" },
] as const;

function parseOperations(value: unknown): LayoutOperation[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("operations must be a non-empty array");
  if (value.length > 100) throw new Error("operations accepts at most 100 entries");
  return value.map((entry, index) => {
    const operation = asObject(entry, `operations[${index}]`);
    const op = asString(operation.op, `operations[${index}].op`);
    if (!LAYOUT_OPERATIONS.has(op)) throw new Error(`Unsupported layout operation '${op}'`);
    return operation as unknown as LayoutOperation;
  });
}

export async function dispatchGuiApi(
  workspace: Workspace,
  schema: SchemaRegistry,
  request: GuiApiRequest,
  authoring?: GuiAuthoringContext,
): Promise<GuiApiResponse> {
  const method = request.method.toUpperCase();
  const query = request.query ?? new URLSearchParams();

  try {
    if (request.pathname.startsWith("/api/map/")) {
      if (!authoring?.map) throw new Error("Map context is unavailable");
      const map = authoring.map, endpoint = request.pathname.slice("/api/map/".length);
      if (method === "GET") {
        if (endpoint === "blueprints") return { status: 200, body: await map.listBlueprints() };
        if (endpoint === "blueprint") return { status: 200, body: await map.inspectBlueprint(query.get("directory") ?? "") };
      }
      if (method === "POST") {
        if (endpoint === "create") return { status: 200, body: await map.create(mapCreateSchema.parse(request.body)) };
        if (endpoint === "blueprint/register") {
          const body = mapBlueprintRegistrationSchema.parse(request.body);
          return { status: 200, body: await map.registerBlueprint(body.id, body.directory, body.dryRun) };
        }
      }
      return { status: 404, body: { error: "Unknown map endpoint" } };
    }
    if (request.pathname.startsWith("/api/terrain/")) {
      if (!authoring?.terrain) throw new Error("Terrain context is unavailable");
      const terrain = authoring.terrain, dir = query.get("directory") ?? "", endpoint = request.pathname.slice("/api/terrain/".length);
      if (method === "GET") {
        if (endpoint === "inspect") return { status: 200, body: await terrain.inspect(dir) };
        if (endpoint === "components") return { status: 200, body: await terrain.inspectComponents(dir) };
        if(endpoint === "lighting") return {status:200,body:await terrain.lighting(dir)};
        if (endpoint === "styles") return { status: 200, body: terrain.styles() };
        if (endpoint === "palette") return { status: 200, body: await terrain.palette(dir) };
        if (endpoint === "preview") { const mode = query.get("mode") ?? "height"; if (!["height", "texture", "water", "cliff"].includes(mode)) throw new Error("Invalid terrain preview mode"); return { status: 200, body: await terrain.preview(query.get("planId") ?? undefined, dir, mode as "height" | "texture" | "water" | "cliff", 256) }; }
      }
      if (method === "POST") {
        const body = asObject(request.body);
        if (endpoint === "plan") return { status: 200, body: await terrain.plan(terrainPlanSchema.parse(body) as {directory:string;operations:TerrainOperation[];maxSlope?:number}) };
        if(endpoint === "landscape") return {status:200,body:await terrain.landscape(terrainLandscapeSchema.parse(body))};
        if (endpoint === "generate") return { status: 200, body: await terrain.generate(terrainGenerateSchema.parse(body)) };
        if (endpoint === "feature") { const { feature, ...args } = body; return { status: 200, body: await terrain.feature(asString(feature, "feature"), terrainFeatureSchema.parse(args)) }; }
        if (endpoint === "apply") { const { planId, ...options } = terrainApplySchema.parse(body); return { status: 200, body: await terrain.apply(planId, options) }; }
        if (endpoint === "save") return { status: 200, body: await terrain.save(asString(body.transactionId, "transactionId"), {dryRun:asBoolean(body.dryRun,true),backup:asBoolean(body.backup,true)}) };
        if (endpoint === "rollback") return { status: 200, body: await terrain.rollback(asString(body.transactionId, "transactionId"), asBoolean(body.dryRun,true)) };
      }
      return { status: 404, body: { error: "Endpoint not found" } };
    }
    if(method==="GET"&&request.pathname==="/api/project/preflight")return authoring?.projectPreflight?{status:200,body:await authoring.projectPreflight()}:{status:503,body:{error:"Full project context is unavailable"}};
    if (method === "GET" && request.pathname === "/api/project/status") {
      return authoring?.projectStatus ? { status: 200, body: authoring.projectStatus() } : { status: 503, body: { error: "Full project context is unavailable" } };
    }
    if (method === "GET" && request.pathname === "/api/health") {
      const coverage = schema.auditCoverage();
      return { status: 200, body: {
        ok: true,
        version: APP_VERSION,
        workspace: workspace.root,
        frameTypes: coverage.frameTypes.total,
        properties: coverage.properties.declared,
      } };
    }
    if (method === "GET" && request.pathname === "/api/files") {
      return { status: 200, body: { root: workspace.root, ...await workspace.listFiles() } };
    }
    if (method === "GET" && request.pathname.startsWith("/api/ai/")) {
      if (!authoring?.ai) throw new Error("A.I. Module context is unavailable");
      const file = query.get("file") ?? "CustomAI";
      if (request.pathname === "/api/ai/context") return { status: 200, body: await authoring.ai.context({ file, definitions: query.get("q") ? [query.get("q")!] : undefined, waves: query.get("q") ? [query.get("q")!] : undefined, includeNative: query.get("includeNative") === "true", limit: 100 }) };
      if (request.pathname === "/api/ai/schema") return { status: 200, body: authoring.ai.schema.describe(query.get("type") ?? undefined) };
      if (request.pathname === "/api/ai/validate") return { status: 200, body: await authoring.ai.validate(file) };
      return { status: 404, body: { error: "Endpoint not found" } };
    }
    if (method === "GET" && request.pathname === "/api/capabilities") {
      return { status: 200, body: bridgeCapabilities(workspace.root) };
    }
    if (method === "GET" && request.pathname === "/api/browse/search") {
      if (!authoring) throw new Error("Browse / Placement context is unavailable");
      return { status: 200, body: await authoring.browse.search({
        query: query.get("q") ?? undefined,
        catalogType: query.get("catalogType") ?? undefined,
        dependency: query.get("dependency") ?? undefined,
        placeable: query.get("placeable") === "true" ? true : undefined,
        limit: Math.min(Math.max(Number(query.get("limit") ?? 50), 1), 200),
      }) };
    }
    if (method === "GET" && request.pathname === "/api/browse/details") {
      if (!authoring) throw new Error("Browse / Placement context is unavailable");
      return { status: 200, body: await authoring.browse.get({ key: requiredQuery(query, "key") }) };
    }
    if (method === "GET" && request.pathname === "/api/browse/dependencies") {
      if (!authoring) throw new Error("Browse / Placement context is unavailable");
      return { status: 200, body: await authoring.browse.dependencies() };
    }
    if (method === "GET" && request.pathname === "/api/placement/scan") {
      if (!authoring) throw new Error("Browse / Placement context is unavailable");
      return { status: 200, body: await authoring.placement.scan(query.get("file") ?? "Objects") };
    }
    if (method === "GET" && request.pathname === "/api/layout") {
      const file = requiredQuery(query, "file");
      const { doc } = await workspace.read(file);
      return { status: 200, body: {
        file,
        sha256: doc.sha256,
        staged: workspace.hasDraft(file),
        diagnostics: doc.diagnostics,
        frames: doc.listFrames(),
        source: doc.source,
      } };
    }
    if (method === "GET" && request.pathname === "/api/frame") {
      const file = requiredQuery(query, "file");
      const framePath = requiredQuery(query, "path");
      const { doc } = await workspace.read(file);
      const frame = doc.getFrame(framePath);
      return { status: 200, body: {
        file,
        sha256: doc.sha256,
        frame,
        type: schema.describeType(frame.type),
        restrictionPlan: schema.restrictionPlan(frame.type),
      } };
    }
    if (method === "GET" && request.pathname === "/api/types") {
      const limit = Math.min(Math.max(Number(query.get("limit") ?? 200), 1), 2000);
      return { status: 200, body: schema.query({
        kind: "frameType",
        search: query.get("search") ?? undefined,
        includeBlizzard: query.get("includeBlizzard") !== "false",
        limit,
      }) };
    }
    if (method === "GET" && request.pathname === "/api/containers") {
      return { status: 200, body: {
        presets: UI_CONTAINER_PRESETS,
        customAllowed: true,
        notice: "Presets come from Blizzard Core GameUI.SC2Layout; any descriptor path can also be entered explicitly.",
      } };
    }
    if (method === "GET" && request.pathname === "/api/templates") {
      const type = requiredQuery(query, "type");
      const limit = Math.min(Math.max(Number(query.get("limit") ?? 100), 1), 500);
      const templates = schema.compatibleTemplates(type, limit).map((template) => ({
        ...template,
        usage: schema.assessTemplateUsage(type, template.reference),
      }));
      return { status: 200, body: { type, recommended: templates[0], templates } };
    }
    if (method === "GET" && request.pathname === "/api/type") {
      const type = requiredQuery(query, "type");
      const description = schema.describeType(type);
      if (!description) throw new Error(`Unknown frame type: ${type}`);
      return { status: 200, body: { ...description, restrictionPlan: schema.restrictionPlan(type) } };
    }
    if (method === "GET" && request.pathname === "/api/schema/coverage") {
      return { status: 200, body: schema.auditCoverage() };
    }
    if (method === "GET" && request.pathname === "/api/property/schema") {
      const type = requiredQuery(query, "type");
      const property = requiredQuery(query, "property");
      const description = schema.describeProperty(type, property);
      if (!description) throw new Error(`Unknown property '${property}' for frame type '${type}'`);
      return { status: 200, body: description };
    }
    if (method === "GET" && request.pathname === "/api/schema/state") {
      return { status: 200, body: { conditions: schema.stateConditionTypes(), actions: schema.stateActionTypes() } };
    }
    if (method === "GET" && request.pathname === "/api/schema/animation") {
      return { status: 200, body: { controllerTypes: schema.animationControllerTypes() } };
    }
    if (method === "GET" && request.pathname === "/api/diff") {
      return { status: 200, body: await workspace.diff(requiredQuery(query, "file")) };
    }
    if (method === "GET" && request.pathname === "/api/validate") {
      return { status: 200, body: await workspace.validate(requiredQuery(query, "file")) };
    }
    if (method !== "POST") return { status: 404, body: { error: "Endpoint not found" } };

    const body = asObject(request.body);
    if (request.pathname === "/api/ai/apply") {
      if (!authoring?.ai) throw new Error("A.I. Module context is unavailable");
      const parsed = aiApplySchema.parse(body);
      return { status: 200, body: await authoring.ai.apply({ ...parsed, operations: parsed.operations as AiOperation[] }) };
    }
    if (request.pathname === "/api/placement/unit" || request.pathname === "/api/placement/doodad") {
      if (!authoring) throw new Error("Browse / Placement context is unavailable");
      const input = addPlacementSchema.parse(body);
      const plan = request.pathname.endsWith("unit") ? await authoring.placement.addUnit(input) : await authoring.placement.addDoodad(input);
      return { status: 200, body: { plan, preview: await authoring.placement.preview(plan.id) } };
    }
    if (request.pathname === "/api/placement/scatterDoodads" || request.pathname === "/api/placement/snapToTerrain") {
      if (!authoring) throw new Error("Browse / Placement context is unavailable");
      const created = request.pathname.endsWith("scatterDoodads") ? await authoring.placement.scatterDoodads(scatterDoodadsSchema.parse(body)) : await authoring.placement.snapObjects(snapObjectsSchema.parse(body));
      return { status: 200, body: { ...created, plan: compactPlacementPlan(created.plan), preview: await authoring.placement.preview(created.plan.id) } };
    }
    if (request.pathname === "/api/placement/location") {
      if (!authoring) throw new Error("Browse / Placement context is unavailable");
      const input = createLocationSchema.parse(body);
      if (input.terrain) {
        if (!authoring.terrain) throw new Error("Terrain context is unavailable");
        const created = await authoring.terrain.createLocation(input as Parameters<TerrainWorkspace["createLocation"]>[0]);
        return { status: 200, body: { ...created, applyModule: "terrain", preview: await authoring.terrain.preview(created.plan.id) } };
      }
      const created = await authoring.placement.createLocation(input);
      return { status: 200, body: { ...created, applyModule: "placement", preview: await authoring.placement.preview(created.plan.id) } };
    }
    if (request.pathname === "/api/placement/preview") {
      if (!authoring) throw new Error("Browse / Placement context is unavailable");
      return { status: 200, body: await authoring.placement.preview(asString(body.planId, "planId")) };
    }
    if (request.pathname === "/api/placement/apply") {
      if (!authoring) throw new Error("Browse / Placement context is unavailable");
      return { status: 200, body: await authoring.placement.apply(asString(body.planId, "planId"), { dryRun: asBoolean(body.dryRun, true), stage: asBoolean(body.stage, true), backup: asBoolean(body.backup, true) }) };
    }
    if (request.pathname === "/api/apply") {
      const file = asString(body.file, "file");
      const result = await workspace.apply(file, parseOperations(body.operations), {
        dryRun: asBoolean(body.dryRun, false),
        stage: asBoolean(body.stage, true),
        expectedSha256: optionalString(body.expectedSha256, "expectedSha256"),
        validate: asBoolean(body.validate, true),
        allowInvalid: asBoolean(body.allowInvalid, false),
        backup: asBoolean(body.backup, true),
      });
      return { status: result.accepted ? 200 : 422, body: result };
    }
    if (request.pathname === "/api/runtime/probe") {
      const manifest = asString(body.manifest, "manifest");
      const timeoutMs = body.timeoutMs === undefined ? 900_000 : Number(body.timeoutMs);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3_600_000) throw new Error("timeoutMs must be between 1000 and 3600000");
      return { status: 200, body: await runRuntimeAdapter(workspace.root, workspace.resolveUserPath(manifest), { timeoutMs }) };
    }
    if (request.pathname === "/api/file/create") {
      const file = asString(body.file, "file");
      const kind = asString(body.kind, "kind");
      if (kind !== "layout" && kind !== "style") throw new Error("kind must be layout or style");
      const includeIn = optionalString(body.includeIn, "includeIn");
      if (includeIn && kind === "style") throw new Error("SC2Style files cannot be added through a layout Include");
      if (includeIn) {
        const options = { dryRun: asBoolean(body.dryRun, false), stage: asBoolean(body.stage, true) };
        if (!options.dryRun && !options.stage) throw new Error("Combined file creation and Include registration must be staged");
        return { status: 200, body: await workspace.createLayoutWithInclude(file, includeIn, options) };
      }
      const created = await workspace.createFile(file, kind, {
        dryRun: asBoolean(body.dryRun, false),
        stage: asBoolean(body.stage, true),
      });
      return { status: 200, body: { created } };
    }
    if (request.pathname === "/api/frame/create") {
      const file = asString(body.file, "file");
      const type = asString(body.type, "type");
      const typeSchema = schema.getFrameType(type);
      if (!typeSchema) throw new Error(`Unknown frame type '${type}'`);
      if (typeSchema.blizzardOnly && !asBoolean(body.allowBlizzardOnly, false)) {
        throw new Error(`Frame type '${type}' is Blizzard-only/locked; explicit override is required`);
      }
      const properties = parseProperties(body.properties);
      validateProperties(schema, type, properties);
      const template = optionalString(body.template, "template");
      const result = await workspace.mutate(file, mutationOptions(body, `Create ${type} ${String(body.name)}`), (doc) => {
        doc.createFrame({
          parentPath: optionalString(body.parentPath, "parentPath"),
          type,
          name: asString(body.name, "name"),
          template,
          frameFile: optionalString(body.frameFile, "frameFile"),
          properties,
          anchors: parseAnchors(body.anchors),
        });
      });
      return { status: 200, body: {
        ...result,
        templateUsage: template ? schema.assessTemplateUsage(type, template) : undefined,
      } };
    }
    if (request.pathname === "/api/frame/delete") {
      const file = asString(body.file, "file");
      const framePath = asString(body.framePath, "framePath");
      return { status: 200, body: await workspace.mutate(
        file,
        mutationOptions(body, `Delete ${framePath}`),
        (doc) => doc.deleteFrame(framePath),
      ) };
    }
    if (request.pathname === "/api/property/set") {
      const file = asString(body.file, "file");
      const framePath = asString(body.framePath, "framePath");
      const propertyName = asString(body.property, "property");
      const result = await workspace.mutate(file, mutationOptions(body, `Set ${framePath}.${propertyName}`), (doc) => {
        const frame = doc.getFrame(framePath);
        const property = schema.getProperty(frame.type, propertyName);
        if (!property && !asBoolean(body.allowUnknown, false)) {
          throw new Error(`Unknown property '${propertyName}' for frame type '${frame.type}'`);
        }
        const value = body.value === undefined ? undefined : asScalar(body.value, "value");
        if (property && value !== undefined) {
          const problem = schema.validateScalar(schema.valueTypeOf(property), value);
          if (problem) throw new Error(problem);
        }
        if (asBoolean(body.remove, false)) {
          doc.removeProperty(framePath, propertyName, parseSelector(body.selector));
        } else {
          const attrs = body.attrs === undefined
            ? undefined
            : Object.fromEntries(Object.entries(asObject(body.attrs, "attrs"))
              .map(([name, entry]) => [name, asScalar(entry, name)]));
          doc.setProperty(framePath, propertyName, {
            value,
            attrs,
            selector: parseSelector(body.selector),
            replace: asBoolean(body.replace, false),
          });
        }
      });
      return { status: 200, body: result };
    }
    if (request.pathname === "/api/anchor/set") {
      const file = asString(body.file, "file");
      const framePath = asString(body.framePath, "framePath");
      const anchor = parseAnchors([asObject(body.anchor, "anchor")])![0];
      return { status: 200, body: await workspace.mutate(
        file,
        mutationOptions(body, `Set ${anchor.side} anchor on ${framePath}`),
        (doc) => doc.setAnchor(framePath, anchor),
      ) };
    }
    if (request.pathname === "/api/template/apply") {
      const file = asString(body.file, "file");
      const framePath = asString(body.framePath, "framePath");
      const template = asString(body.template, "template");
      const { doc } = await workspace.read(file);
      const targetType = doc.getFrame(framePath).type;
      const result = await workspace.mutate(file, mutationOptions(body, `Apply template ${template}`), (mutable) => {
        mutable.applyTemplate(framePath, template);
      });
      return { status: 200, body: {
        ...result,
        templateUsage: schema.assessTemplateUsage(targetType, template),
      } };
    }
    if (request.pathname === "/api/save") {
      const file = asString(body.file, "file");
      return { status: 200, body: await workspace.save(file, {
        expectedSha256: optionalString(body.expectedSha256, "expectedSha256"),
        backup: asBoolean(body.backup, true),
      }) };
    }
    if (request.pathname === "/api/discard") {
      const file = asString(body.file, "file");
      return { status: 200, body: { file, discarded: workspace.discard(file) } };
    }
    return { status: 404, body: { error: "Endpoint not found" } };
  } catch (error) {
    return errorResponse(error);
  }
}
