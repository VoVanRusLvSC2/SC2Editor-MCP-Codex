import type { ModuleSelection } from "./moduleSelection.js";

const builderTools = new Set([
  "map.preview",
  "data.modkit.query",
  "document.inspect",
  "document.plan_file",
  "document.create",
  "document.validate_plan",
  "document.dependencies.list",
  "document.terrain_sets.list",
  "map.create",
  "map.import",
  "map.export",
  "map.inspect",
  "trigger.describe_functions",
  "trigger.plan_file",
  "trigger.recipe_skirmish",
  "trigger.generate_runtime",
  "trigger.apply",
  "trigger.save",
  "trigger.validate",
  "trigger.inspect",
  "terrain.plan_file",
  "terrain.inspect",
  "terrain.palette",
  "terrain.cliff.paint",
  "terrain.ramp.create",
  "terrain.ramp.remove",
  "terrain.apply",
  "terrain.save",
  "terrain.validate",
  "placement.geometry_check",
  "placement.addBatch",
  "placement.apply",
  "placement.validate",
  "placement.scan",
  "ui.recipe_timer",
  "ui.assets.register",
  "ui.assets.save",
  "ui.hookup.validate",
  "ui.save",
  "ui.discard",
  "text.context",
  "text.apply",
  "text.validate",
  "data.apply",
  "data.query",
  "data.context",
  "data.resolve",
  "casc.search",
  "casc.file.inspect",
  "casc.read_text",
  "casc.mount",
  "settings.inspect",
  "settings.plan_file",
  "settings.apply",
  "settings.save",
]);

/** Discovery policy only; hidden tools remain available to internal batch dispatch. */
export class ToolVisibilityPolicy {
  readonly focused: boolean;
  private readonly workflow: boolean;
  private readonly workflowTools: Set<string>;

  constructor(readonly selection: ModuleSelection) {
    this.focused = ["map-builder", "workflow", "cutscene-preview"].includes(selection.profile);
    this.workflow = ["workflow", "cutscene-preview"].includes(selection.profile);
    this.workflowTools = new Set([
      "modkit.author",
      "modkit.author_help",
      "modkit.batch",
      "modkit.tools",
      "modkit.enable_tools",
      "modkit.capabilities",
      "modkit.usage",
      ...(selection.profile === "cutscene-preview"
        ? ["cutscene.preview", "cutscene.render"]
        : ["ui.preview_batch"]),
    ]);
  }

  visible(name: string): boolean {
    return this.workflow
      ? this.workflowTools.has(name)
      : !this.focused || name.startsWith("modkit.") || builderTools.has(name);
  }
}
