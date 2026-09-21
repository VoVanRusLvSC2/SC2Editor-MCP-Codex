import { LayoutDocument } from "./layoutDocument.js";
import type { ElementDetails, ElementSpec, ValidationDiagnostic, ValidationReport } from "./types.js";
import { CrossFileResolver } from "./resolver.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";

const STRUCTURAL = new Set(["Anchor", "StateGroup", "Animation"]);
const ANCHOR_POS = new Set(["Min", "Mid", "Max"]);

function add(
  diagnostics: ValidationDiagnostic[],
  severity: ValidationDiagnostic["severity"],
  code: string,
  message: string,
  file: string,
  framePath?: string,
): void {
  diagnostics.push({ severity, code, message, file, framePath });
}

function walk(elements: ElementDetails[], visit: (element: ElementDetails) => void): void {
  for (const element of elements) {
    visit(element);
    walk(element.children, visit);
  }
}

function asElementSpec(element: ElementDetails): ElementSpec {
  return {
    tag: element.tag,
    attrs: { ...element.attrs },
    children: element.children.map(asElementSpec),
  };
}

export function validateLayout(
  file: string,
  doc: LayoutDocument,
  registry: SchemaRegistry,
  resolver?: CrossFileResolver,
): ValidationReport {
  const diagnostics: ValidationDiagnostic[] = doc.diagnostics.map((item) => ({
    severity: item.severity,
    code: "xml.syntax",
    message: `${item.offset}: ${item.message}`,
    file,
  }));
  const basic = doc.validateBasic();
  for (const message of basic.errors) add(diagnostics, "error", "layout.structure", message, file);
  for (const message of basic.warnings) add(diagnostics, "warning", "layout.structure", message, file);

  for (const include of doc.includes()) {
    if (resolver && !resolver.resolveInclude(include)) {
      add(diagnostics, "warning", "reference.include_missing", `Included layout is unavailable: ${include}`, file);
    }
  }

  const allFrames = doc.listFrames();
  for (const frame of allFrames) {
    const details = doc.getFrame(frame.path);
    const type = registry.getFrameType(frame.type);
    const description = registry.describeType(frame.type);
    if (!type) {
      add(diagnostics, "warning", "schema.unknown_frame_type", `Unknown/forward frame type '${frame.type}' is preserved`, file, frame.path);
    } else if (type.blizzardOnly) {
      const templateDetail = frame.template ? ` Template '${frame.template}' does not bypass that restriction.` : "";
      add(
        diagnostics,
        "warning",
        "schema.blizzard_only_runtime_uncertain",
        `Frame type '${frame.type}' is Blizzard-only/locked and may not work at SC2 runtime.${templateDetail}`,
        file,
        frame.path,
      );
    }
    if (frame.template && resolver && !resolver.resolveTemplate(frame.template, file).found && !registry.getBlizzardTemplate(frame.template)) {
      add(diagnostics, "warning", "reference.template_missing", `Template not resolved: ${frame.template}`, file, frame.path);
    }
    const requiredHookups = type?.hookups.filter((hookup) => hookup.required) ?? [];
    if (requiredHookups.length) {
      const descendantPaths = new Set(allFrames
        .filter((candidate) => candidate.path.startsWith(`${frame.path}/`))
        .map((candidate) => candidate.path.slice(frame.path.length + 1).toLowerCase()));
      const missingHookups = requiredHookups.filter((hookup) => !descendantPaths.has(hookup.path.toLowerCase()));
      let inheritedFromVerifiedTemplate = Boolean(
        frame.template && registry.getBlizzardTemplate(frame.template)?.frameType.toLowerCase() === frame.type.toLowerCase(),
      );
      if (!inheritedFromVerifiedTemplate && frame.template && resolver) {
        inheritedFromVerifiedTemplate = missingHookups.every((hookup) =>
          resolver.templateProvidesHookup(frame.template!, file, hookup.path));
      }
      if (!inheritedFromVerifiedTemplate) {
        const plan = registry.restrictionPlan(frame.type);
        inheritedFromVerifiedTemplate = allFrames.some((ancestor) => {
          if (!ancestor.template || ancestor.path === frame.path || !frame.path.startsWith(`${ancestor.path}/`)) return false;
          const relative = frame.path.slice(ancestor.path.length + 1);
          return plan?.containerRoutes.some((route) =>
            route.requiredHookupsCovered &&
            route.containerTemplate.toLowerCase() === ancestor.template!.toLowerCase() &&
            route.targetPath.toLowerCase() === relative.toLowerCase());
        }) ?? false;
      }
      if (missingHookups.length && !inheritedFromVerifiedTemplate) {
        for (const hookup of missingHookups) {
          add(diagnostics, "error", "hookup.required_missing", `Required hookup is missing: ${hookup.path} (${hookup.className})`, file, frame.path);
        }
      }
    }
    for (const anchor of details.anchors) {
      if (anchor.pos && !ANCHOR_POS.has(anchor.pos)) {
        add(diagnostics, "warning", "anchor.unknown_position", `Unknown anchor pos '${anchor.pos}'`, file, frame.path);
      }
      if (resolver && !resolver.resolveFrameReference(anchor.relative)) {
        add(diagnostics, "warning", "reference.frame_missing", `Anchor reference not resolved: ${anchor.relative}`, file, frame.path);
      }
      if (anchor.offset !== undefined && !Number.isFinite(anchor.offset)) {
        add(diagnostics, "error", "anchor.invalid_offset", "Anchor offset is not numeric", file, frame.path);
      }
    }

    const properties = new Map((description?.properties ?? []).map((property) => [property.name.toLowerCase(), property]));
    for (const element of details.elements) {
      if (STRUCTURAL.has(element.tag)) continue;
      const property = properties.get(element.tag.toLowerCase());
      if (description && !property) {
        add(diagnostics, "warning", "schema.unknown_property", `Property '${element.tag}' is not known for ${frame.type}; it is preserved`, file, frame.path);
        continue;
      }
      if (!property) continue;
      const valueType = registry.valueTypeOf(property);
      for (const problem of registry.validatePropertySpec(property, asElementSpec(element))) {
        add(diagnostics, "error", "property.invalid_value", `${element.tag}: ${problem}`, file, frame.path);
      }
      if (property.readonly) {
        add(diagnostics, "info", "property.readonly", `${element.tag} is marked read-only by the community schema`, file, frame.path);
      }
      if (valueType === "FrameReference" && resolver && element.attrs.val && !resolver.resolveFrameReference(element.attrs.val)) {
        add(diagnostics, "warning", "reference.frame_missing", `${element.tag} reference not resolved: ${element.attrs.val}`, file, frame.path);
      }
      if (valueType === "Style" && resolver && element.attrs.val && !resolver.hasStyle(element.attrs.val)) {
        add(diagnostics, "warning", "reference.style_missing", `Style not resolved: ${element.attrs.val}`, file, frame.path);
      }
      if (resolver) {
        for (const value of Object.values(element.attrs)) {
          for (const match of value.matchAll(/\{(\$[^/@}\s]+(?:\/[^/@}\s]+)*)\/@[^}]+\}/g)) {
            if (!resolver.resolveFrameReference(match[1])) {
              add(diagnostics, "warning", "reference.binding_missing", `Binding reference not resolved: ${match[1]}`, file, frame.path);
            }
          }
        }
      }
    }

    for (const element of details.elements) {
      const tag = element.tag.toLowerCase();
      const value = element.attrs.val?.toLowerCase();
      if (tag === "blendmode" && value === "colorize") {
        add(
          diagnostics,
          "error",
          "property.colorize_wrong_channel",
          "BlendMode cannot use 'Colorize'; use <ColorAdjustMode val=\"Colorize\"/> and a supported blend such as Add.",
          file,
          frame.path,
        );
      }
      if (tag === "coloradjustment") {
        add(
          diagnostics,
          "error",
          "property.color_adjustment_misnamed",
          "ColorAdjustment is not an SC2 layout property; use <ColorAdjustMode val=\"Colorize\"/>.",
          file,
          frame.path,
        );
      }
    }
    if (
      details.elements.some((element) => element.tag.toLowerCase() === "coloradjustmode" && element.attrs.val?.toLowerCase() === "colorize") &&
      !details.elements.some((element) => element.tag.toLowerCase() === "adjustmentcolor")
    ) {
      add(
        diagnostics,
        "warning",
        "property.colorize_adjustment_missing",
        "ColorAdjustMode='Colorize' needs AdjustmentColor to select the tint; ordinary Color does not replace it.",
        file,
        frame.path,
      );
    }

    walk(details.elements, (element) => {
      if (element.tag === "StateGroup" && !element.attrs.name) {
        add(diagnostics, "error", "state.name_missing", "StateGroup requires a name", file, frame.path);
      }
      if (element.tag === "When" && element.attrs.type && !registry.stateConditionTypes().includes(element.attrs.type)) {
        add(diagnostics, "warning", "state.unknown_condition", `Unknown StateGroup condition: ${element.attrs.type}`, file, frame.path);
      }
      if (element.tag === "Action" && element.attrs.type && !registry.stateActionTypes().includes(element.attrs.type)) {
        add(diagnostics, "warning", "state.unknown_action", `Unknown StateGroup action: ${element.attrs.type}`, file, frame.path);
      }
      if (element.tag === "Controller" && element.attrs.type && !registry.animationControllerTypes().includes(element.attrs.type)) {
        add(diagnostics, "warning", "animation.unknown_controller", `Unknown animation controller: ${element.attrs.type}`, file, frame.path);
      }
    });
  }

  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.filter((item) => item.severity === "warning").length;
  return { valid: errors === 0, errors, warnings, diagnostics };
}
