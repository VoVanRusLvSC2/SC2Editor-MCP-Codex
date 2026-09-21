import { APP_VERSION } from "../app/version.js";
import { registerTerrainTools, type TerrainToolContext } from "../modules/terrain/tools.js";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { Workspace } from "../core/workspace.js";
import type { AnchorSpec, AnimationSpec, ElementSpec, LayoutOperation, StateGroupSpec } from "../core/types.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";
import { bridgeCapabilities } from "../core/capabilities.js";
import { runRuntimeAdapter } from "../runtime/runtimeHarness.js";
import { registerCutsceneTools, type CutsceneToolContext } from "../modules/cutscene/tools.js";
import { registerTextTools, type TextToolContext } from "../modules/text/tools.js";
import { registerDataTools, type DataToolContext } from "../modules/data/tools.js";
import { registerBrowseTools, type BrowseToolContext } from "../modules/browse/tools.js";
import { registerPlacementTools, type PlacementToolContext } from "../modules/placement/tools.js";
import { registerAiTools, type AiToolContext } from "../modules/ai/tools.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const scalarRecord = z.record(z.string(), scalar);
const elementSchema: z.ZodType<ElementSpec> = z.lazy(() => z.object({
  tag: z.string().min(1),
  attrs: scalarRecord.optional(),
  value: scalar.optional(),
  children: z.array(elementSchema).optional(),
}));

const selectorSchema = z.object({
  index: z.union([z.string(), z.number()]).optional(),
  layer: z.union([z.string(), z.number()]).optional(),
  attrs: scalarRecord.optional(),
  occurrence: z.number().int().min(0).optional(),
}).optional();

const anchorSchema = z.object({
  side: z.enum(["Top", "Left", "Right", "Bottom", "All"]),
  relative: z.string().min(1).default("$parent"),
  pos: z.string().optional(),
  offset: z.number().optional(),
});

const mutationCommon = {
  file: z.string().min(1),
  dryRun: z.boolean().default(true),
  stage: z.boolean().default(true).describe("When dryRun=false, keep changes in memory until ui.save."),
  expectedSha256: z.string().optional(),
};

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function validateCreationProperties(
  schema: SchemaRegistry,
  frameType: string,
  properties: ElementSpec[] | undefined,
  options: { allowUnknown: boolean; allowReadonly: boolean },
): void {
  for (const element of properties ?? []) {
    const property = schema.getProperty(frameType, element.tag);
    if (!property && !options.allowUnknown) {
      throw new Error(`Unknown property '${element.tag}' for frame type '${frameType}'`);
    }
    if (property?.readonly && !options.allowReadonly) {
      throw new Error(`Property '${element.tag}' is marked read-only by the community schema`);
    }
    const value = element.value ?? element.attrs?.val;
    if (property && value !== undefined) {
      const problem = schema.validateScalar(schema.valueTypeOf(property), value);
      if (problem) throw new Error(`${element.tag}: ${problem}`);
    }
  }
}

const stateGroupSchema = z.object({
  name: z.string().min(1),
  template: z.string().optional(),
  file: z.string().optional(),
  log: z.boolean().optional(),
  defaultState: z.string().optional(),
  states: z.array(z.object({
    name: z.string().min(1),
    when: z.array(z.object({
      type: z.string().min(1),
      frame: z.string().optional(),
      operator: z.string().optional(),
      attrs: scalarRecord.optional(),
    })).optional(),
    actions: z.array(z.object({
      type: z.string().min(1),
      frame: z.string().optional(),
      on: z.string().optional(),
      undo: z.boolean().optional(),
      attrs: scalarRecord.optional(),
    })).optional(),
  })).optional(),
});

const animationSchema = z.object({
  name: z.string().min(1),
  template: z.string().optional(),
  file: z.string().optional(),
  speed: z.number().optional(),
  flags: z.string().optional(),
  events: z.array(z.object({
    event: z.string().min(1),
    action: z.string().optional(),
    frame: z.string().optional(),
  })).optional(),
  drivers: z.array(z.object({
    type: z.string().min(1),
    attrs: scalarRecord.optional(),
  })).optional(),
  controllers: z.array(z.object({
    type: z.string().min(1),
    name: z.string().optional(),
    frame: z.string().optional(),
    end: z.string().optional(),
    attrs: scalarRecord.optional(),
    keys: z.array(z.object({
      type: z.string().min(1),
      time: z.number().optional(),
      attrs: scalarRecord.optional(),
    })).optional(),
  })).optional(),
});

const layoutOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create_frame"),
    as: z.string().optional(),
    parentPath: z.string().optional(),
    type: z.string().min(1),
    name: z.string().min(1),
    template: z.string().optional(),
    frameFile: z.string().optional(),
    properties: z.array(elementSchema).optional(),
    anchors: z.array(anchorSchema).max(4).optional(),
    allowUnknownType: z.boolean().optional(),
    allowUnknownProperties: z.boolean().optional(),
    allowBlizzardOnly: z.boolean().optional(),
  }),
  z.object({ op: z.literal("clone_frame"), as: z.string().optional(), sourcePath: z.string().min(1), parentPath: z.string().optional(), name: z.string().min(1) }),
  z.object({ op: z.literal("delete_frame"), framePath: z.string().min(1) }),
  z.object({
    op: z.literal("set_property"),
    framePath: z.string().min(1),
    property: z.string().min(1),
    value: scalar.optional(),
    attrs: scalarRecord.optional(),
    selector: selectorSchema,
    children: z.array(elementSchema).optional(),
    replace: z.boolean().optional(),
    remove: z.boolean().optional(),
    allowUnknown: z.boolean().optional(),
    allowReadonly: z.boolean().optional(),
  }),
  z.object({ op: z.literal("set_anchor"), framePath: z.string().min(1), anchor: anchorSchema }),
  z.object({ op: z.literal("apply_template"), framePath: z.string().min(1), template: z.string().min(1) }),
  z.object({ op: z.literal("text.bindStyle"), framePath: z.string().min(1), style: z.string().min(1) }),
  z.object({ op: z.literal("upsert_state_group"), framePath: z.string().min(1), stateGroup: stateGroupSchema }),
  z.object({ op: z.literal("upsert_animation"), framePath: z.string().min(1), animation: animationSchema }),
  z.object({ op: z.literal("add_include"), includePath: z.string().min(1) }),
  z.object({ op: z.literal("remove_include"), includePath: z.string().min(1) }),
  z.object({
    op: z.literal("create_clipped_image"),
    as: z.string().optional(),
    parentPath: z.string().optional(),
    name: z.string().min(1),
    imageName: z.string().optional(),
    texture: z.string().min(1),
    viewportWidth: z.number().positive(),
    viewportHeight: z.number().positive(),
    imageWidth: z.number().positive(),
    imageHeight: z.number().positive(),
    offsetX: z.number().optional(),
    offsetY: z.number().optional(),
    layer: z.number().int().min(0).optional(),
    textureType: z.string().optional(),
    textureCoords: z.object({ top: z.number(), left: z.number(), bottom: z.number(), right: z.number(), layer: z.number().int().min(0).optional() }).optional(),
  }),
]);

export function createUiServer(workspace: Workspace, schema: SchemaRegistry, cutscene?: CutsceneToolContext, text?: TextToolContext, data?: DataToolContext, browse?: BrowseToolContext, placement?: PlacementToolContext, ai?: AiToolContext, terrain?: TerrainToolContext): McpServer {
  const server = new McpServer({ name: "sc2editor-mcp", version: APP_VERSION });

  server.registerTool("ui.list_files", {
    description: "List SC2Layout, StormLayout and SC2Style files in the configured VFS root.",
    inputSchema: z.object({}),
  }, async () => textResult({ root: workspace.root, ...await workspace.listFiles() }));

  server.registerTool("ui.capabilities", {
    description: "Report semantic editing, packed archive and real SC2 runtime capabilities without confusing structural validation with runtime proof.",
    inputSchema: z.object({}),
  }, async () => textResult(bridgeCapabilities(workspace.root)));

  server.registerTool("ui.runtime_probe", {
    description: "Run the configured external SC2 runtime adapter against a generated runtime-corpus manifest and return its captured engine report. Unavailable unless SC2_UI_RUNTIME_ADAPTER is configured.",
    inputSchema: z.object({
      manifest: z.string().min(1).describe("Workspace-relative runtime-corpus.json path."),
      timeoutMs: z.number().int().min(1000).max(3_600_000).default(900_000),
    }),
  }, async ({ manifest, timeoutMs }) => textResult(await runRuntimeAdapter(
    workspace.root,
    workspace.resolveUserPath(manifest),
    { timeoutMs },
  )));

  server.registerTool("ui.read_layout", {
    description: "Read a layout without normalizing or reserializing it.",
    inputSchema: z.object({ file: z.string().min(1), includeSource: z.boolean().default(false) }),
  }, async ({ file, includeSource }) => {
    const { doc } = await workspace.read(file);
    return textResult({
      file,
      sha256: doc.sha256,
      diagnostics: doc.diagnostics,
      frames: doc.listFrames(),
      source: includeSource ? doc.source : undefined,
    });
  });

  server.registerTool("ui.create_file", {
    description: "Create and stage a new SC2Layout, StormLayout, or SC2Style file. A layout can also be minimally registered in an existing DescIndex Include list.",
    inputSchema: z.object({
      file: z.string().min(1),
      kind: z.enum(["layout", "style"]),
      includeIn: z.string().optional().describe("Existing DescIndex/layout file that should receive <Include path=.../>."),
      dryRun: z.boolean().default(true),
      stage: z.boolean().default(true),
    }),
  }, async (args) => {
    if (args.kind === "style" && args.includeIn) throw new Error("SC2Style files are not registered through SC2Layout Include");
    if (args.includeIn && !args.dryRun && !args.stage) {
      throw new Error("Combined file creation + Include registration must be staged so both changes can be reviewed before saving");
    }
    if (args.includeIn) return textResult(await workspace.createLayoutWithInclude(args.file, args.includeIn, args));
    const created = await workspace.createFile(args.file, args.kind, { dryRun: args.dryRun, stage: args.stage });
    return textResult({ created, saveFiles: [args.file] });
  });

  server.registerTool("ui.add_include", {
    description: "Minimally add one unique Include to an existing DescIndex or layout without reserializing the document.",
    inputSchema: z.object({ ...mutationCommon, includePath: z.string().min(1) }),
  }, async (args) => textResult(await workspace.mutate(args.file, {
    dryRun: args.dryRun,
    stage: args.stage,
    expectedSha256: args.expectedSha256,
    summary: `Add Include ${args.includePath}`,
  }, (doc) => doc.addInclude(args.includePath))));

  server.registerTool("ui.remove_include", {
    description: "Remove exactly one Include using a minimal source-span patch.",
    inputSchema: z.object({ ...mutationCommon, includePath: z.string().min(1) }),
  }, async (args) => textResult(await workspace.mutate(args.file, {
    dryRun: args.dryRun,
    stage: args.stage,
    expectedSha256: args.expectedSha256,
    summary: `Remove Include ${args.includePath}`,
  }, (doc) => doc.removeInclude(args.includePath))));

  server.registerTool("ui.query_frames", {
    description: "Query frames by semantic criteria.",
    inputSchema: z.object({
      file: z.string().min(1),
      name: z.string().optional(),
      type: z.string().optional(),
      template: z.string().optional(),
      property: z.string().optional(),
      handle: z.string().optional(),
      under: z.string().optional(),
      limit: z.number().int().min(1).max(2000).optional(),
    }),
  }, async ({ file, ...query }) => {
    const { doc } = await workspace.read(file);
    return textResult({ file, sha256: doc.sha256, frames: doc.queryFrames(query) });
  });

  server.registerTool("ui.get_frame", {
    description: "Get a frame, typed-looking properties, anchors, children and exact source.",
    inputSchema: z.object({ file: z.string().min(1), framePath: z.string().min(1) }),
  }, async ({ file, framePath }) => {
    const { doc } = await workspace.read(file);
    return textResult({ file, sha256: doc.sha256, frame: doc.getFrame(framePath) });
  });

  server.registerTool("ui.describe_type", {
    description: "Describe a frame type, underlying class inheritance, effective properties and hookups.",
    inputSchema: z.object({ type: z.string().min(1) }),
  }, async ({ type }) => {
    const description = schema.describeType(type);
    if (!description) throw new Error(`Unknown frame type: ${type}`);
    return textResult({
      ...description,
      restrictionPlan: schema.restrictionPlan(type),
      recommendedTemplates: schema.compatibleTemplates(type, 8).map((template) => ({
        ...template,
        usage: schema.assessTemplateUsage(type, template.reference),
      })),
    });
  });

  server.registerTool("ui.get_schema", {
    description: "Search the schema registry without creating one MCP tool per XML property.",
    inputSchema: z.object({
      kind: z.enum(["frameType", "frameClass", "simpleType", "complexType", "animation", "state", "style"]).optional(),
      search: z.string().optional(),
      includeBlizzard: z.boolean().default(true),
      limit: z.number().int().min(1).max(2000).optional(),
    }),
  }, async (args) => textResult(schema.query(args)));

  server.registerTool("ui.audit_schema_coverage", {
    description: "Audit every known frame type, inheritance chain, declared property and referenced value type. Reports structural coverage separately from authoritative scalar validation coverage.",
    inputSchema: z.object({}),
  }, async () => textResult(schema.auditCoverage()));

  server.registerTool("ui.describe_property", {
    description: "Describe one scalar/table/compound property, including effective complex attributes, child elements and enum values for schema-driven clients.",
    inputSchema: z.object({ type: z.string().min(1), property: z.string().min(1) }),
  }, async ({ type, property }) => {
    const description = schema.describeProperty(type, property);
    if (!description) throw new Error(`Unknown property '${property}' for frame type '${type}'`);
    return textResult(description);
  });

  server.registerTool("ui.apply", {
    description: "Atomically apply up to 100 ordered layout operations in one MCP call. Supports @aliases for newly created frames and returns validation plus minimal diff; no draft/disk change survives a failed operation.",
    inputSchema: z.object({
      file: z.string().min(1),
      operations: z.array(layoutOperationSchema).min(1).max(100),
      dryRun: z.boolean().default(true),
      stage: z.boolean().default(true),
      expectedSha256: z.string().optional(),
      validate: z.boolean().default(true),
      allowInvalid: z.boolean().default(false),
      backup: z.boolean().default(true),
    }),
  }, async (args) => textResult(await workspace.apply(args.file, args.operations as LayoutOperation[], {
    dryRun: args.dryRun,
    stage: args.stage,
    expectedSha256: args.expectedSha256,
    validate: args.validate,
    allowInvalid: args.allowInvalid,
    backup: args.backup,
  })));

  server.registerTool("ui.list_blizzard_templates", {
    description: "Search the bundled catalog of top-level templates observed in real Blizzard Core.SC2Mod layouts.",
    inputSchema: z.object({
      search: z.string().optional(),
      frameType: z.string().optional(),
      limit: z.number().int().min(1).max(2000).optional(),
    }),
  }, async (args) => textResult({
    templates: schema.queryBlizzardTemplates(args).map((template) => ({
      ...template,
      usage: schema.assessTemplateUsage(template.frameType, template.reference),
    })),
  }));

  server.registerTool("ui.describe_blizzard_template", {
    description: "Describe one real Blizzard template and its compatibility with an optional target frame type.",
    inputSchema: z.object({ reference: z.string().min(1), targetType: z.string().optional() }),
  }, async ({ reference, targetType }) => {
    const template = schema.getBlizzardTemplate(reference);
    if (!template) throw new Error(`Blizzard template not found in the bundled Core corpus: ${reference}`);
    const effectiveTarget = targetType ?? template.frameType;
    return textResult({
      template,
      targetType: effectiveTarget,
      compatible: schema.isTemplateCompatible(effectiveTarget, reference),
      usage: schema.assessTemplateUsage(effectiveTarget, reference),
    });
  });

  server.registerTool("ui.create_frame", {
    description: "Create any schema-known SC2 frame type with generic properties and anchors.",
    inputSchema: z.object({
      ...mutationCommon,
      parentPath: z.string().optional(),
      type: z.string().min(1),
      name: z.string().min(1),
      template: z.string().optional(),
      frameFile: z.string().optional().describe("SC2 descriptor file= attribute, used by cross-file overrides such as GameUI/UIContainer."),
      properties: z.array(elementSchema).optional(),
      anchors: z.array(anchorSchema).max(4).optional(),
      allowUnknownType: z.boolean().default(false),
      allowUnknownProperties: z.boolean().default(false),
      allowReadonlyProperties: z.boolean().default(true).describe("Community readonly metadata is advisory and contradicted by many Core layouts."),
      allowBlizzardOnly: z.boolean().default(false),
    }),
  }, async (args) => {
    const type = schema.getFrameType(args.type);
    if (!type && !args.allowUnknownType) throw new Error(`Unknown frame type '${args.type}'. Use ui.describe_type/ui.get_schema or explicitly allow it.`);
    if (type?.blizzardOnly && !args.allowBlizzardOnly) throw new Error(`Frame type '${args.type}' is marked Blizzard-only; explicit override required.`);
    validateCreationProperties(schema, args.type, args.properties, {
      allowUnknown: args.allowUnknownProperties || args.allowUnknownType,
      allowReadonly: args.allowReadonlyProperties,
    });
    const mutation = await workspace.mutate(args.file, {
      dryRun: args.dryRun,
      stage: args.stage,
      expectedSha256: args.expectedSha256,
      summary: `Create ${args.type} ${args.name}`,
    }, (doc) => doc.createFrame({
      parentPath: args.parentPath,
      type: args.type,
      name: args.name,
      template: args.template,
      frameFile: args.frameFile,
      properties: args.properties,
      anchors: args.anchors,
    }));
    return textResult({
      ...mutation,
      templateUsage: args.template ? schema.assessTemplateUsage(args.type, args.template) : undefined,
    });
  });

  server.registerTool("ui.create_from_blizzard_template", {
    description: "Create a frame from a template verified against the bundled Blizzard corpus. This is the guarded path for Blizzard-only types such as LaunchURLButton.",
    inputSchema: z.object({
      ...mutationCommon,
      parentPath: z.string().optional(),
      type: z.string().min(1),
      name: z.string().min(1),
      template: z.string().min(1),
      frameFile: z.string().optional(),
      properties: z.array(elementSchema).optional(),
      anchors: z.array(anchorSchema).max(4).optional(),
      allowUnknownProperties: z.boolean().default(false),
      allowReadonlyProperties: z.boolean().default(true),
    }),
  }, async (args) => {
    const template = schema.getBlizzardTemplate(args.template);
    if (!template) throw new Error(`Template '${args.template}' was not observed in the bundled Blizzard Core corpus`);
    if (!schema.isTemplateCompatible(args.type, args.template)) {
      throw new Error(`Template '${args.template}' (${template.frameType}) is not class-compatible with '${args.type}'`);
    }
    validateCreationProperties(schema, args.type, args.properties, {
      allowUnknown: args.allowUnknownProperties,
      allowReadonly: args.allowReadonlyProperties,
    });
    const mutation = await workspace.mutate(args.file, {
      dryRun: args.dryRun,
      stage: args.stage,
      expectedSha256: args.expectedSha256,
      summary: `Create ${args.type} ${args.name} from verified Blizzard template ${args.template}`,
    }, (doc) => doc.createFrame({
      parentPath: args.parentPath,
      type: args.type,
      name: args.name,
      template: args.template,
      frameFile: args.frameFile,
      properties: args.properties,
      anchors: args.anchors,
    }));
    return textResult({ ...mutation, templateUsage: schema.assessTemplateUsage(args.type, args.template) });
  });

  server.registerTool("ui.create_restricted_frame", {
    description: "Automatically choose a verified direct or container-template route for any Blizzard-only type. Required hookups are inherited when possible, but locked frames may still fail at SC2 runtime.",
    inputSchema: z.object({
      ...mutationCommon,
      parentPath: z.string().optional(),
      type: z.string().min(1),
      name: z.string().min(1),
      properties: z.array(elementSchema).optional(),
      anchors: z.array(anchorSchema).max(4).optional(),
    }),
  }, async (args) => {
    const plan = schema.restrictionPlan(args.type);
    if (!plan) throw new Error(`Unknown frame type '${args.type}'`);
    if (!plan.restricted) throw new Error(`Frame type '${args.type}' is not Blizzard-only; use ui.create_frame`);
    if (plan.recommended.strategy === "explicit-override") {
      throw new Error(`No verified template route for '${args.type}'. Use ui.create_frame with allowBlizzardOnly only after manual hookup review.`);
    }
    if (plan.recommended.strategy === "unrestricted") throw new Error(`Unexpected unrestricted plan for '${args.type}'`);

    validateCreationProperties(schema, args.type, args.properties, { allowUnknown: false, allowReadonly: true });
    const route = plan.recommended;
    const containerName = args.name;
    const escapedName = containerName.replaceAll("~", "~0").replaceAll("/", "~1");
    const containerPath = args.parentPath ? `${args.parentPath}/${escapedName}` : escapedName;
    const runtimeTargetPath = route.strategy === "container-template"
      ? `${containerPath}/${route.targetPath}`
      : containerPath;
    const mutation = await workspace.mutate(args.file, {
      dryRun: args.dryRun,
      stage: args.stage,
      expectedSha256: args.expectedSha256,
      summary: `Create restricted ${args.type} through ${route.strategy}`,
    }, (doc) => {
      if (route.strategy === "direct-template") {
        doc.createFrame({
          parentPath: args.parentPath,
          type: args.type,
          name: args.name,
          template: route.template,
          properties: args.properties,
          anchors: args.anchors,
        });
        return;
      }
      doc.createFrame({
        parentPath: args.parentPath,
        type: route.containerFrameType,
        name: containerName,
        template: route.template,
      });
      const targetSegments = route.targetPath.split("/").filter(Boolean);
      if (targetSegments.length !== 1) {
        if (args.properties?.length || args.anchors?.length) {
          throw new Error(`The verified target is nested at '${route.targetPath}'; automatic property override currently supports direct template children only`);
        }
        return;
      }
      doc.createFrame({
        parentPath: containerPath,
        type: args.type,
        name: targetSegments[0],
        properties: args.properties,
        anchors: args.anchors,
      });
    });
    return textResult({ mutation, restrictionPlan: plan, created: { containerPath, runtimeTargetPath } });
  });

  server.registerTool("ui.create_clipped_image", {
    description: "Convenience operation for AI/GUI: create a sized viewport Frame and an oversized child Image clipped by the viewport (SC2 default).",
    inputSchema: z.object({
      ...mutationCommon,
      parentPath: z.string().optional(),
      name: z.string().min(1),
      imageName: z.string().optional(),
      texture: z.string().min(1),
      viewportWidth: z.number().positive(),
      viewportHeight: z.number().positive(),
      imageWidth: z.number().positive(),
      imageHeight: z.number().positive(),
      offsetX: z.number().optional(),
      offsetY: z.number().optional(),
      layer: z.number().int().min(0).optional(),
      textureType: z.enum(["None", "Normal", "Border", "HorizontalBorder", "EndCap", "NineSlice", "Circular"]).optional(),
      textureCoords: z.object({
        top: z.number(), left: z.number(), bottom: z.number(), right: z.number(), layer: z.number().int().min(0).optional(),
      }).optional(),
    }),
  }, async (args) => textResult(await workspace.mutate(args.file, {
    dryRun: args.dryRun,
    stage: args.stage,
    expectedSha256: args.expectedSha256,
    summary: `Create clipped image viewport ${args.name}`,
  }, (doc) => doc.createClippedImage(args))));

  server.registerTool("ui.create_button", {
    description: "Convenience wrapper over ui.create_frame for a Button.",
    inputSchema: z.object({
      ...mutationCommon,
      parentPath: z.string().optional(),
      name: z.string().min(1),
      text: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      template: z.string().optional(),
      anchors: z.array(anchorSchema).max(4).optional(),
    }),
  }, async (args) => {
    const template = args.template ?? schema.recommendedTemplate("Button")?.reference;
    const mutation = await workspace.mutate(args.file, {
      dryRun: args.dryRun,
      stage: args.stage,
      expectedSha256: args.expectedSha256,
      summary: `Create Button ${args.name}`,
    }, (doc) => doc.createButton({ ...args, template }));
    return textResult({
      ...mutation,
      selectedTemplate: template,
      templateUsage: template ? schema.assessTemplateUsage("Button", template) : undefined,
    });
  });

  server.registerTool("ui.clone_frame", {
    description: "Clone one exact frame subtree and change only its name/indentation.",
    inputSchema: z.object({
      ...mutationCommon,
      sourcePath: z.string().min(1),
      parentPath: z.string().optional(),
      name: z.string().min(1),
    }),
  }, async (args) => textResult(await workspace.mutate(args.file, {
    dryRun: args.dryRun,
    stage: args.stage,
    expectedSha256: args.expectedSha256,
    summary: `Clone ${args.sourcePath} as ${args.name}`,
  }, (doc) => doc.cloneFrame(args.sourcePath, { parentPath: args.parentPath, name: args.name }))));

  server.registerTool("ui.delete_frame", {
    description: "Delete one frame subtree; defaults to dry-run and can be staged.",
    inputSchema: z.object({ ...mutationCommon, framePath: z.string().min(1) }),
  }, async (args) => textResult(await workspace.mutate(args.file, {
    dryRun: args.dryRun,
    stage: args.stage,
    expectedSha256: args.expectedSha256,
    summary: `Delete ${args.framePath}`,
  }, (doc) => doc.deleteFrame(args.framePath))));

  server.registerTool("ui.apply_template", {
    description: "Set a frame template reference by patching only the opening tag. Returns an explicit ordinary-template or locked-frame runtime expectation.",
    inputSchema: z.object({ ...mutationCommon, framePath: z.string().min(1), template: z.string().min(1) }),
  }, async (args) => {
    const { doc } = await workspace.read(args.file);
    const targetType = doc.getFrame(args.framePath).type;
    const mutation = await workspace.mutate(args.file, {
      dryRun: args.dryRun,
      stage: args.stage,
      expectedSha256: args.expectedSha256,
      summary: `Apply template ${args.template} to ${args.framePath}`,
    }, (mutable) => mutable.applyTemplate(args.framePath, args.template));
    return textResult({ ...mutation, templateUsage: schema.assessTemplateUsage(targetType, args.template) });
  });

  server.registerTool("ui.get_property", {
    description: "Get all or a selected occurrence of a frame property, including table/index/layer forms.",
    inputSchema: z.object({
      file: z.string().min(1),
      framePath: z.string().min(1),
      property: z.string().min(1),
      selector: selectorSchema,
    }),
  }, async ({ file, framePath, property, selector }) => {
    const { doc } = await workspace.read(file);
    return textResult({ file, sha256: doc.sha256, values: doc.getProperty(framePath, property, selector) });
  });

  server.registerTool("ui.set_property", {
    description: "Set, create or remove a universal typed property with optional table selectors and complex children.",
    inputSchema: z.object({
      ...mutationCommon,
      framePath: z.string().min(1),
      property: z.string().min(1),
      value: scalar.optional(),
      attrs: scalarRecord.optional(),
      selector: selectorSchema,
      children: z.array(elementSchema).optional(),
      replace: z.boolean().default(false),
      remove: z.boolean().default(false),
      allowUnknown: z.boolean().default(false),
      allowReadonly: z.boolean().default(true).describe("Community readonly metadata is advisory; Blizzard layouts often set these fields."),
    }),
  }, async (args) => textResult(await workspace.mutate(args.file, {
    dryRun: args.dryRun,
    stage: args.stage,
    expectedSha256: args.expectedSha256,
    summary: `${args.remove ? "Remove" : "Set"} ${args.framePath}.${args.property}`,
  }, (doc) => {
    if (args.remove) {
      doc.removeProperty(args.framePath, args.property, args.selector);
      return;
    }
    const frame = doc.getFrame(args.framePath);
    const property = schema.getProperty(frame.type, args.property);
    if (!property && !args.allowUnknown) throw new Error(`Unknown property '${args.property}' for frame type '${frame.type}'`);
    if (property?.readonly && !args.allowReadonly) throw new Error(`Property '${args.property}' is marked read-only`);
    if (property && args.value !== undefined) {
      const problem = schema.validateScalar(schema.valueTypeOf(property), args.value);
      if (problem) throw new Error(problem);
    }
    doc.setProperty(args.framePath, args.property, {
      value: args.value,
      attrs: args.attrs,
      selector: args.selector,
      children: args.children,
      replace: args.replace,
    });
  })));

  server.registerTool("ui.get_anchor", {
    description: "Get all anchors, including the side-less All anchor form.",
    inputSchema: z.object({ file: z.string().min(1), framePath: z.string().min(1) }),
  }, async ({ file, framePath }) => {
    const { doc } = await workspace.read(file);
    return textResult({ file, sha256: doc.sha256, anchors: doc.getFrame(framePath).anchors });
  });

  server.registerTool("ui.set_anchor", {
    description: "Create or minimally patch one anchor by side.",
    inputSchema: z.object({ ...mutationCommon, framePath: z.string().min(1), anchor: anchorSchema }),
  }, async (args) => textResult(await workspace.mutate(args.file, {
    dryRun: args.dryRun,
    stage: args.stage,
    expectedSha256: args.expectedSha256,
    summary: `Set ${args.anchor.side} anchor on ${args.framePath}`,
  }, (doc) => doc.setAnchor(args.framePath, args.anchor as AnchorSpec))));

  server.registerTool("ui.get_state_group", {
    description: "Read one StateGroup as a generic semantic tree.",
    inputSchema: z.object({ file: z.string().min(1), framePath: z.string().min(1), name: z.string().min(1) }),
  }, async ({ file, framePath, name }) => {
    const { doc } = await workspace.read(file);
    return textResult({ file, sha256: doc.sha256, stateGroup: doc.getStateGroup(framePath, name) });
  });

  server.registerTool("ui.upsert_state_group", {
    description: "Create or replace one named StateGroup with When and Action semantics.",
    inputSchema: z.object({ ...mutationCommon, framePath: z.string().min(1), stateGroup: stateGroupSchema }),
  }, async (args) => {
    for (const state of args.stateGroup.states ?? []) {
      for (const when of state.when ?? []) {
        if (!schema.stateConditionTypes().includes(when.type)) throw new Error(`Unknown StateGroup condition '${when.type}'`);
      }
      for (const action of state.actions ?? []) {
        if (!schema.stateActionTypes().includes(action.type)) throw new Error(`Unknown StateGroup action '${action.type}'`);
      }
    }
    return textResult(await workspace.mutate(args.file, {
      dryRun: args.dryRun,
      stage: args.stage,
      expectedSha256: args.expectedSha256,
      summary: `Upsert StateGroup ${args.stateGroup.name}`,
    }, (doc) => doc.upsertStateGroup(args.framePath, args.stateGroup as StateGroupSpec)));
  });

  server.registerTool("ui.get_animation", {
    description: "Read one named animation, controllers, drivers, events and keys.",
    inputSchema: z.object({ file: z.string().min(1), framePath: z.string().min(1), name: z.string().min(1) }),
  }, async ({ file, framePath, name }) => {
    const { doc } = await workspace.read(file);
    return textResult({ file, sha256: doc.sha256, animation: doc.getAnimation(framePath, name) });
  });

  server.registerTool("ui.upsert_animation", {
    description: "Create or replace a schema-checked animation with any supported controller type.",
    inputSchema: z.object({ ...mutationCommon, framePath: z.string().min(1), animation: animationSchema }),
  }, async (args) => {
    for (const controller of args.animation.controllers ?? []) {
      if (!schema.animationControllerTypes().includes(controller.type)) {
        throw new Error(`Unknown animation controller '${controller.type}'`);
      }
    }
    return textResult(await workspace.mutate(args.file, {
      dryRun: args.dryRun,
      stage: args.stage,
      expectedSha256: args.expectedSha256,
      summary: `Upsert Animation ${args.animation.name}`,
    }, (doc) => doc.upsertAnimation(args.framePath, args.animation as AnimationSpec)));
  });

  server.registerTool("ui.validate", {
    description: "Validate XML, schema types/properties, anchors, states, animations and cross-file references. For image tinting, SC2 uses ColorAdjustMode=Colorize plus AdjustmentColor and a supported BlendMode such as Add; ColorAdjustment and BlendMode=Colorize are invalid.",
    inputSchema: z.object({ file: z.string().min(1) }),
  }, async ({ file }) => textResult({ file, ...(await workspace.validate(file)) }));

  server.registerTool("ui.diff", {
    description: "Show the current staged minimal diff without writing.",
    inputSchema: z.object({ file: z.string().min(1) }),
  }, async ({ file }) => textResult(await workspace.diff(file)));

  server.registerTool("ui.save", {
    description: "Save the complete staged text group containing this file; checks original bytes/existence, with backups and compensation on handled write failure. Returns savedFiles.",
    inputSchema: z.object({
      file: z.string().min(1),
      expectedSha256: z.string().optional(),
      backup: z.boolean().default(true),
    }),
  }, async ({ file, expectedSha256, backup }) => textResult(await workspace.save(file, { expectedSha256, backup })));

  server.registerTool("ui.discard", {
    description: "Discard the complete staged group containing this file without changing disk files.",
    inputSchema: z.object({ file: z.string().min(1) }),
  }, async ({ file }) => textResult({ file, discarded: workspace.discard(file) }));

  server.registerTool("ui.list_styles", {
    description: "List styles from one SC2Style file.",
    inputSchema: z.object({ file: z.string().min(1) }),
  }, async ({ file }) => {
    const { doc } = await workspace.readStyle(file);
    return textResult({ file, sha256: doc.sha256, styles: doc.listStyles() });
  });

  server.registerTool("ui.get_style", {
    description: "Read one named SC2Style definition.",
    inputSchema: z.object({ file: z.string().min(1), name: z.string().min(1) }),
  }, async ({ file, name }) => {
    const { doc } = await workspace.readStyle(file);
    return textResult({ file, sha256: doc.sha256, style: doc.getStyle(name) });
  });

  server.registerTool("ui.upsert_style", {
    description: "Create or minimally patch a named SC2Style definition.",
    inputSchema: z.object({
      ...mutationCommon,
      name: z.string().min(1),
      attrs: scalarRecord,
    }),
  }, async (args) => textResult(await workspace.mutateStyle(args.file, {
    dryRun: args.dryRun,
    stage: args.stage,
    expectedSha256: args.expectedSha256,
    summary: `Upsert style ${args.name}`,
  }, (doc) => doc.upsertStyle(args.name, args.attrs))));

  if (cutscene) registerCutsceneTools(server, cutscene);
  if (text) registerTextTools(server, text);
  if (data) registerDataTools(server, data);
  if (browse) registerBrowseTools(server, browse);
  if (placement) registerPlacementTools(server, placement);
  if (ai) registerAiTools(server, ai);
  if (terrain) registerTerrainTools(server, terrain);
  return server;
}
