import { LayoutDocument } from "./layoutDocument.js";
import type {
  AppliedOperation,
  ElementSpec,
  LayoutOperation,
  ScalarValue,
} from "./types.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";

function encodePathSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function resolvePath(value: string | undefined, aliases: Map<string, string>): string | undefined {
  if (!value?.startsWith("@")) return value;
  const resolved = aliases.get(value.slice(1));
  if (!resolved) throw new Error(`Unknown operation alias '${value}'`);
  return resolved;
}

function createdPath(parentPath: string | undefined, name: string): string {
  return parentPath ? `${parentPath}/${encodePathSegment(name)}` : encodePathSegment(name);
}

function validateElement(
  schema: SchemaRegistry,
  frameType: string,
  element: ElementSpec,
  allowUnknown: boolean,
  allowReadonly = true,
): void {
  const property = schema.getProperty(frameType, element.tag);
  if (!property && !allowUnknown) throw new Error(`Unknown property '${element.tag}' for frame type '${frameType}'`);
  if (property?.readonly && !allowReadonly) throw new Error(`Property '${element.tag}' is marked read-only`);
  if (!property) return;
  const issues = schema.validatePropertySpec(property, element);
  if (issues.length) throw new Error(`${element.tag}: ${issues.join("; ")}`);
}

function validateProperties(
  schema: SchemaRegistry,
  frameType: string,
  properties: ElementSpec[] | undefined,
  allowUnknown: boolean,
): void {
  for (const property of properties ?? []) validateElement(schema, frameType, property, allowUnknown);
}

function registerAlias(alias: string | undefined, path: string, aliases: Map<string, string>): void {
  if (!alias) return;
  if (!/^[A-Za-z_][\w.-]*$/.test(alias)) throw new Error(`Invalid operation alias '${alias}'`);
  if (aliases.has(alias)) throw new Error(`Duplicate operation alias '${alias}'`);
  aliases.set(alias, path);
}

function validateStateGroup(schema: SchemaRegistry, operation: Extract<LayoutOperation, { op: "upsert_state_group" }>): void {
  for (const state of operation.stateGroup.states ?? []) {
    for (const when of state.when ?? []) {
      if (!schema.stateConditionTypes().includes(when.type)) throw new Error(`Unknown StateGroup condition '${when.type}'`);
    }
    for (const action of state.actions ?? []) {
      if (!schema.stateActionTypes().includes(action.type)) throw new Error(`Unknown StateGroup action '${action.type}'`);
    }
  }
}

function validateAnimation(schema: SchemaRegistry, operation: Extract<LayoutOperation, { op: "upsert_animation" }>): void {
  for (const controller of operation.animation.controllers ?? []) {
    if (!schema.animationControllerTypes().includes(controller.type)) throw new Error(`Unknown animation controller '${controller.type}'`);
  }
}

export function applyLayoutOperations(
  doc: LayoutDocument,
  schema: SchemaRegistry,
  operations: LayoutOperation[],
): { applied: AppliedOperation[]; aliases: Record<string, string> } {
  const aliases = new Map<string, string>();
  const applied: AppliedOperation[] = [];

  for (const [index, operation] of operations.entries()) {
    const result: AppliedOperation = { index, op: operation.op };
    switch (operation.op) {
      case "create_frame": {
        const type = schema.getFrameType(operation.type);
        if (!type && !operation.allowUnknownType) throw new Error(`Unknown frame type '${operation.type}'`);
        if (type?.blizzardOnly && !operation.allowBlizzardOnly) {
          throw new Error(`Frame type '${operation.type}' is Blizzard-only/locked; explicit override is required`);
        }
        validateProperties(schema, operation.type, operation.properties, Boolean(operation.allowUnknownProperties || operation.allowUnknownType));
        const parentPath = resolvePath(operation.parentPath, aliases);
        doc.createFrame({
          parentPath,
          type: operation.type,
          name: operation.name,
          template: operation.template,
          frameFile: operation.frameFile,
          properties: operation.properties,
          anchors: operation.anchors,
        });
        const path = createdPath(parentPath, operation.name);
        registerAlias(operation.as, path, aliases);
        result.target = path;
        result.alias = operation.as;
        if (operation.template) result.templateUsage = schema.assessTemplateUsage(operation.type, operation.template);
        if (type?.blizzardOnly) result.runtimeWarning = schema.restrictionPlan(operation.type)?.runtimeNotice;
        break;
      }
      case "clone_frame": {
        const sourcePath = resolvePath(operation.sourcePath, aliases)!;
        const parentPath = resolvePath(operation.parentPath, aliases);
        doc.cloneFrame(sourcePath, { parentPath, name: operation.name });
        const path = createdPath(parentPath, operation.name);
        registerAlias(operation.as, path, aliases);
        result.target = path;
        result.alias = operation.as;
        break;
      }
      case "delete_frame": {
        const framePath = resolvePath(operation.framePath, aliases)!;
        doc.deleteFrame(framePath);
        result.target = framePath;
        break;
      }
      case "set_property": {
        const framePath = resolvePath(operation.framePath, aliases)!;
        if (operation.remove) {
          doc.removeProperty(framePath, operation.property, operation.selector);
        } else {
          const frame = doc.getFrame(framePath);
          validateElement(schema, frame.type, {
            tag: operation.property,
            value: operation.value,
            attrs: operation.attrs,
            children: operation.children,
          }, Boolean(operation.allowUnknown), operation.allowReadonly ?? true);
          doc.setProperty(framePath, operation.property, {
            value: operation.value,
            attrs: operation.attrs,
            selector: operation.selector,
            children: operation.children,
            replace: operation.replace,
          });
        }
        result.target = `${framePath}.${operation.property}`;
        break;
      }
      case "set_anchor": {
        const framePath = resolvePath(operation.framePath, aliases)!;
        doc.setAnchor(framePath, operation.anchor);
        result.target = `${framePath}@${operation.anchor.side}`;
        break;
      }
      case "apply_template": {
        const framePath = resolvePath(operation.framePath, aliases)!;
        const frameType = doc.getFrame(framePath).type;
        doc.applyTemplate(framePath, operation.template);
        result.target = framePath;
        result.templateUsage = schema.assessTemplateUsage(frameType, operation.template);
        break;
      }
      case "text.bindStyle": {
        const framePath = resolvePath(operation.framePath, aliases)!;
        const frame = doc.getFrame(framePath);
        const property = schema.getProperty(frame.type, "Style");
        if (!property) throw new Error(`Frame type '${frame.type}' does not expose the SC2 Style property`);
        doc.setProperty(framePath, "Style", { value: operation.style });
        result.target = `${framePath}.Style`;
        break;
      }
      case "upsert_state_group": {
        validateStateGroup(schema, operation);
        const framePath = resolvePath(operation.framePath, aliases)!;
        doc.upsertStateGroup(framePath, operation.stateGroup);
        result.target = `${framePath}#StateGroup:${operation.stateGroup.name}`;
        break;
      }
      case "upsert_animation": {
        validateAnimation(schema, operation);
        const framePath = resolvePath(operation.framePath, aliases)!;
        doc.upsertAnimation(framePath, operation.animation);
        result.target = `${framePath}#Animation:${operation.animation.name}`;
        break;
      }
      case "add_include":
        doc.addInclude(operation.includePath);
        result.target = operation.includePath;
        break;
      case "remove_include":
        doc.removeInclude(operation.includePath);
        result.target = operation.includePath;
        break;
      case "create_clipped_image": {
        const parentPath = resolvePath(operation.parentPath, aliases);
        doc.createClippedImage({ ...operation, parentPath });
        const path = createdPath(parentPath, operation.name);
        registerAlias(operation.as, path, aliases);
        result.target = path;
        result.alias = operation.as;
        break;
      }
      default: {
        const neverOperation: never = operation;
        throw new Error(`Unsupported operation ${(neverOperation as { op: string }).op}`);
      }
    }
    applied.push(result);
  }

  return { applied, aliases: Object.fromEntries(aliases) };
}

export function scalarRecord(value: Record<string, ScalarValue> | undefined): Record<string, ScalarValue> | undefined {
  return value ? { ...value } : undefined;
}
