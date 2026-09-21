import { randomBytes } from "node:crypto";
import type { XmlNode } from "../../core/types.js";
import { CutsceneDocument } from "./document.js";
import { CutsceneSchemaRegistry } from "./schemaRegistry.js";
import { parseCutsceneTime } from "./time.js";
import type { CutsceneNodeSelector, CutsceneOperation, NativeNodeSpec } from "./types.js";

function guid(): string {
  return BigInt(`0x${randomBytes(8).toString("hex")}`).toString(10);
}

function stableSpec(spec: NativeNodeSpec): NativeNodeSpec {
  const needsGuid = /^CCutscene(?:Node|Element)/.test(spec.nativeType);
  return {
    ...spec,
    attrs: { ...(needsGuid && spec.attrs?.guid === undefined ? { guid: guid() } : {}), ...(spec.attrs ?? {}) },
    children: spec.children?.map(stableSpec),
  };
}

function resolveAlias(selector: CutsceneNodeSelector | string, aliases: Record<string, string>): CutsceneNodeSelector | string {
  if (typeof selector === "string" && selector.startsWith("@")) {
    const found = aliases[selector.slice(1)];
    if (!found) throw new Error(`Unknown transaction alias '${selector}'`);
    return found;
  }
  return selector;
}

function childByTag(doc: CutsceneDocument, parent: XmlNode, tag: string): XmlNode {
  const child = parent.childIds.map((id) => doc.nodes[id]).find((candidate) => candidate.tag === tag);
  if (!child) throw new Error(`Child '${tag}' was not found under ${parent.tag}`);
  return child;
}

function propertyTarget(doc: CutsceneDocument, object: CutsceneNodeSelector | string, path: string): { node: XmlNode; attribute: string } {
  const parts = path.split("/").filter(Boolean);
  const attr = parts.pop();
  if (!attr?.startsWith("@") || attr.length === 1) throw new Error(`Property path '${path}' must end with /@attribute or be @attribute`);
  let node = doc.resolve(object);
  for (const part of parts) node = childByTag(doc, node, part);
  return { node, attribute: attr.slice(1) };
}

function nativeTime(value: string): string {
  const parsed = parseCutsceneTime(value);
  if (parsed.nativeValue !== undefined) return parsed.nativeValue;
  throw new Error(`Cannot convert '${value}' to native Cutscene ticks until discovery determines this Editor build's time base. Pass an exact native integer value.`);
}

function nativeTimeInput(value: string | number): string {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) throw new Error(`Native Cutscene time '${value}' must be a non-negative integer tick value`);
    return String(value);
  }
  return nativeTime(value);
}

function setKnownProperties(
  doc: CutsceneDocument,
  schema: CutsceneSchemaRegistry,
  selector: CutsceneNodeSelector | string,
  values: Record<string, string | number | boolean>,
): void {
  const node = doc.resolve(selector);
  for (const [name, value] of Object.entries(values)) {
    if (!schema.getProperty(node.tag, name)) throw new Error(`Unknown native property '${node.tag}.${name}'; inspect cutscene.schema.inspect first`);
    doc.setAttribute({ nodeId: node.id }, name, nativeTypedScalar(schema, node.tag, name, value));
  }
}

function nativeTypedScalar(
  schema: CutsceneSchemaRegistry,
  nativeType: string,
  name: string,
  value: string | number | boolean,
): string | number | boolean {
  const definition = schema.getProperty(nativeType, name);
  if (typeof value === "number" && definition && ["Decimal", "Fixed", "Angle"].includes(definition.valueType)) {
    if (!Number.isFinite(value)) throw new Error(`${nativeType}.${name} must be finite`);
    return value.toFixed(6);
  }
  return value;
}

function locateCategory(doc: CutsceneDocument, schema: CutsceneSchemaRegistry, category: string): XmlNode | undefined {
  return doc.nodes.find((node) => schema.category(node.tag) === category);
}

function nativeVector(value: string | [number, number, number]): string {
  if (typeof value === "string") return value;
  if (value.some((entry) => !Number.isFinite(entry))) throw new Error("Cutscene vector components must be finite numbers");
  return value.map((entry) => entry.toFixed(6)).join(",");
}

export function applyCutsceneOperations(
  doc: CutsceneDocument,
  schema: CutsceneSchemaRegistry,
  operations: CutsceneOperation[],
): { aliases: Record<string, string>; applied: Array<{ index: number; op: string; target?: string; alias?: string }> } {
  const aliases: Record<string, string> = {};
  const applied: Array<{ index: number; op: string; target?: string; alias?: string }> = [];
  operations.forEach((operation, index) => {
    let target: string | undefined;
    switch (operation.op) {
      case "object.add":
        target = doc.addNode(operation.parent ? resolveAlias(operation.parent, aliases) : undefined, stableSpec(operation.object));
        break;
      case "object.remove":
        doc.removeNode(resolveAlias(operation.object, aliases));
        break;
      case "object.rename":
        doc.setAttribute(resolveAlias(operation.object, aliases), "name", operation.name);
        target = typeof operation.object === "string" ? operation.object : undefined;
        break;
      case "object.clone":
        target = doc.cloneNode(resolveAlias(operation.object, aliases), operation.parent ? resolveAlias(operation.parent, aliases) : undefined, operation.name);
        break;
      case "property.set": {
        const object = resolveAlias(operation.object, aliases);
        const { node, attribute } = propertyTarget(doc, object, operation.path);
        const definition = schema.getProperty(node.tag, attribute);
        if (!definition && !operation.allowUnknown) throw new Error(`Unknown native property '${node.tag}.${attribute}'. Set allowUnknown=true to use the lossless escape hatch.`);
        doc.setAttribute({ nodeId: node.id }, attribute, operation.value);
        target = doc.resolve(object).attrs.guid ? `guid:${doc.resolve(object).attrs.guid}` : undefined;
        break;
      }
      case "property.reset": {
        const { node, attribute } = propertyTarget(doc, resolveAlias(operation.object, aliases), operation.path);
        doc.removeAttribute({ nodeId: node.id }, attribute);
        break;
      }
      case "timeline.add":
        target = doc.addNode(resolveAlias(operation.parent, aliases), stableSpec(operation.node));
        break;
      case "timeline.remove":
        doc.removeNode(resolveAlias(operation.node, aliases));
        break;
      case "keyframe.add":
        target = doc.addNode(resolveAlias(operation.track, aliases), stableSpec(operation.keyframe));
        break;
      case "keyframe.update": {
        const keyframe = resolveAlias(operation.keyframe, aliases);
        for (const [name, value] of Object.entries(operation.values)) doc.setAttribute(keyframe, name, value);
        break;
      }
      case "keyframe.remove":
        doc.removeNode(resolveAlias(operation.keyframe, aliases));
        break;
      case "bookmark.add": {
        const track = locateCategory(doc, schema, "bookmark-track");
        if (!track) throw new Error("No native bookmark track exists. Add a schema-confirmed CCutsceneNodeBookmark first.");
        const attrs: Record<string, string> = { guid: guid(), bookmarkName: operation.name };
        if (operation.time !== undefined) attrs.start = nativeTime(operation.time);
        if (operation.jumpToBookmarkWhenHit) attrs.jumpToBookmarkWhenHit = operation.jumpToBookmarkWhenHit;
        target = doc.addNode({ nodeId: track.id }, { nativeType: "CCutsceneElementBookmark", attrs });
        break;
      }
      case "bookmark.remove":
        doc.removeNode(resolveAlias(operation.bookmark, aliases));
        break;
      case "filter.add":
        target = doc.addNode(operation.parent ? resolveAlias(operation.parent, aliases) : undefined, stableSpec(operation.filter));
        break;
      case "filter.remove":
        doc.removeNode(resolveAlias(operation.filter, aliases));
        break;
      case "actor.add": {
        const modelLink = operation.modelLink ?? operation.asset?.id;
        const modelPath = operation.modelPath ?? operation.asset?.path;
        if (!modelLink && !modelPath) throw new Error("actor.add requires modelLink, modelPath, or asset.id/path from cutscene.assets.search");
        if (modelLink && modelPath) throw new Error("actor.add received both a catalog modelLink and a raw modelPath; choose the cutsceneUse returned by the asset index");
        const attrs: Record<string, string | number | boolean> = {
          ...(operation.properties ?? {}),
          name: operation.name ?? modelLink ?? modelPath ?? "Actor",
          ...(modelLink ? { modelLink } : { modelPath: modelPath! }),
          ...(operation.position === undefined ? {} : { position: nativeVector(operation.position) }),
          ...(operation.rotation === undefined ? {} : { rotation: nativeVector(operation.rotation) }),
          ...(operation.scale === undefined ? {} : { scale: nativeVector(operation.scale) }),
        };
        for (const name of Object.keys(attrs)) {
          if (!schema.getProperty("CCutsceneNodeActor", name)) throw new Error(`Unknown CCutsceneNodeActor property '${name}'; inspect cutscene.schema.inspect first`);
          attrs[name] = nativeTypedScalar(schema, "CCutsceneNodeActor", name, attrs[name]);
        }
        const children = operation.duration === undefined ? undefined : [{
          nativeType: "CCutsceneElementObject",
          attrs: { duration: nativeTimeInput(operation.duration), ...(operation.lockedToEnd === undefined ? {} : { lockedToEnd: operation.lockedToEnd }) },
        }];
        target = doc.addNode(operation.parent ? resolveAlias(operation.parent, aliases) : undefined, stableSpec({ nativeType: "CCutsceneNodeActor", attrs, children }));
        break;
      }
      case "actor.face": {
        if (!operation.actors.length) throw new Error("actor.face requires at least one actor");
        const [targetX, targetY] = operation.target;
        for (const selector of operation.actors) {
          const actor = doc.resolve(resolveAlias(selector, aliases));
          if (actor.tag !== "CCutsceneNodeActor") throw new Error(`${actor.tag} is not CCutsceneNodeActor`);
          const position = actor.attrs.position?.split(",").map(Number);
          if (!position || position.length !== 3 || position.some((value) => !Number.isFinite(value))) throw new Error(`Actor '${actor.attrs.name ?? actor.attrs.guid}' has no valid native position`);
          const priorRotation = actor.attrs.rotation?.split(",").map(Number) ?? [0, 0, 0];
          if (priorRotation.length !== 3 || priorRotation.some((value) => !Number.isFinite(value))) throw new Error(`Actor '${actor.attrs.name ?? actor.attrs.guid}' has no valid native rotation`);
          const yaw = ((Math.atan2(targetY - position[1], targetX - position[0]) * 180 / Math.PI + (operation.axisOffsetDegrees ?? 0)) % 360 + 360) % 360;
          doc.setAttribute({ nodeId: actor.id }, "rotation", nativeVector([priorRotation[0], priorRotation[1], yaw]));
        }
        break;
      }
      case "text.add": {
        const nativeType = "CCutsceneNodeText";
        if (!schema.getNode(nativeType)) throw new Error(`${nativeType} is unavailable in the discovered Editor schema`);
        const attrs: Record<string, string | number | boolean> = {
          name: operation.name,
          text: operation.text,
          ...(operation.position === undefined ? {} : { position: nativeVector(operation.position) }),
          ...(operation.enabled === undefined ? {} : { enabled: operation.enabled }),
          ...(operation.sortIndex === undefined ? {} : { sortIndex: operation.sortIndex }),
        };
        for (const name of Object.keys(attrs)) if (!schema.getProperty(nativeType, name)) throw new Error(`Unknown ${nativeType} property '${name}'`);
        const children = operation.duration === undefined ? undefined : [{
          nativeType: "CCutsceneElementObject",
          attrs: { duration: nativeTimeInput(operation.duration), ...(operation.lockedToEnd === undefined ? {} : { lockedToEnd: operation.lockedToEnd }) },
        }];
        target = doc.addNode(operation.parent ? resolveAlias(operation.parent, aliases) : undefined, stableSpec({ nativeType, attrs, children }));
        break;
      }
      case "text.animate": {
        const object = resolveAlias(operation.object, aliases);
        const node = doc.resolve(object);
        if (node.tag !== "CCutsceneNodeText") throw new Error(`text.animate requires CCutsceneNodeText, received ${node.tag}`);
        const attrs: Record<string, string | number | boolean> = {
          name: "Property - Text",
          propertyName: "text",
          ...(operation.enabled === undefined ? {} : { enabled: operation.enabled }),
          ...(operation.sortIndex === undefined ? {} : { sortIndex: operation.sortIndex }),
        };
        const children = operation.keyframes.map((keyframe) => ({
          nativeType: "CCutsceneElementPropertyValue",
          attrs: { ...(keyframe.start === undefined ? {} : { start: nativeTimeInput(keyframe.start) }), value: keyframe.value },
        }));
        target = doc.addNode({ nodeId: node.id }, stableSpec({ nativeType: "CCutsceneNodePropertyValue", attrs, children }));
        break;
      }
      case "animation.layer.add": {
        const object = resolveAlias(operation.object, aliases);
        const attrs: Record<string, string | number | boolean> = {
          name: operation.name ?? "Animation Layer",
          ...(operation.enabled === undefined ? {} : { enabled: operation.enabled }),
          ...(operation.filter === undefined ? {} : { filter: operation.filter }),
          ...(operation.sortIndex === undefined ? {} : { sortIndex: operation.sortIndex }),
        };
        const owner = doc.resolve(object);
        const emptyDefault = owner.childIds.map(id => doc.nodes[id]).find(child =>
          child.tag === "CCutsceneNodeAnimLayer" && child.attrs.name === "Animation Layer" &&
          child.childIds.length === 0 && Object.keys(child.attrs).every(key => ["guid", "name", "enabled"].includes(key)));
        if (emptyDefault) {
          target = `guid:${emptyDefault.attrs.guid}`;
          for (const [name, value] of Object.entries(attrs)) doc.setAttribute(target, name, value);
        } else {
          target = doc.addNode(object, stableSpec({ nativeType: "CCutsceneNodeAnimLayer", attrs }));
        }
        break;
      }
      case "animation.add": {
        const attrs: Record<string, string | number | boolean> = {
          ...(operation.properties ?? {}),
          anim: operation.anim,
          ...(operation.animId === undefined ? {} : { animId: operation.animId }),
          ...(operation.start === undefined ? {} : { start: nativeTimeInput(operation.start) }),
          ...(operation.duration === undefined ? {} : { duration: nativeTimeInput(operation.duration) }),
          ...(operation.originalDuration === undefined ? {} : { originalDuration: nativeTimeInput(operation.originalDuration) }),
          ...(operation.priority === undefined ? {} : { priority: operation.priority }),
          ...(operation.looping === undefined ? {} : { looping: operation.looping }),
          ...(operation.blendTime === undefined ? {} : { blendTime: nativeTimeInput(operation.blendTime) }),
          ...(operation.blendOutTime === undefined ? {} : { blendOutTime: nativeTimeInput(operation.blendOutTime) }),
          ...(operation.startOffset === undefined ? {} : { startOffset: nativeTimeInput(operation.startOffset) }),
          ...(operation.timeScale === undefined ? {} : { timeScale: operation.timeScale }),
          ...(operation.weight === undefined ? {} : { weight: operation.weight }),
          ...(operation.rightAligned === undefined ? {} : { rightAligned: operation.rightAligned }),
          ...(operation.lockedToEnd === undefined ? {} : { lockedToEnd: operation.lockedToEnd }),
          ...(operation.playOnce === undefined ? {} : { playOnce: operation.playOnce }),
          ...(operation.playForever === undefined ? {} : { playForever: operation.playForever }),
          ...(operation.fullMatchLegacy === undefined ? {} : { fullMatchLegacy: operation.fullMatchLegacy }),
          ...(operation.movespeed === undefined ? {} : { movespeed: operation.movespeed }),
          ...(operation.originalMoveSpeed === undefined ? {} : { originalMoveSpeed: operation.originalMoveSpeed }),
        };
        for (const name of Object.keys(attrs)) {
          if (!schema.getProperty("CCutsceneElementAnim", name)) throw new Error(`Unknown CCutsceneElementAnim property '${name}'; inspect cutscene.schema.inspect before using properties`);
          attrs[name] = nativeTypedScalar(schema, "CCutsceneElementAnim", name, attrs[name]);
        }
        target = doc.addNode(resolveAlias(operation.layer, aliases), stableSpec({ nativeType: "CCutsceneElementAnim", attrs }));
        break;
      }
      case "animation.update":
        setKnownProperties(doc, schema, resolveAlias(operation.animation, aliases), operation.values);
        break;
      case "animation.remove":
        doc.removeNode(resolveAlias(operation.animation, aliases));
        break;
      case "property.animate": {
        const object = resolveAlias(operation.object, aliases);
        const parent = doc.resolve(object);
        if (!schema.getProperty(parent.tag, operation.property) && !schema.isObservedTrackProperty(operation.property) && !operation.allowUnknown) {
          throw new Error(`Property track '${parent.tag}.${operation.property}' was not observed. Set allowUnknown=true only with native evidence.`);
        }
        const trackAttrs: Record<string, string | number | boolean> = {
          name: operation.name ?? `Property - ${operation.property}`,
          propertyName: operation.property,
          ...(operation.enabled === undefined ? {} : { enabled: operation.enabled }),
          ...(operation.filter === undefined ? {} : { filter: operation.filter }),
          ...(operation.sortIndex === undefined ? {} : { sortIndex: operation.sortIndex }),
        };
        const children: NativeNodeSpec[] = operation.keyframes.map((keyframe) => ({
          nativeType: "CCutsceneElementPropertyCurve",
          attrs: {
            ...(keyframe.start === undefined ? {} : { start: nativeTimeInput(keyframe.start) }),
            value: keyframe.value,
            time: nativeTimeInput(keyframe.time ?? keyframe.start ?? 0),
            ...(keyframe.curveInValue === undefined ? {} : { curveInValue: keyframe.curveInValue }),
            ...(keyframe.curveOutValue === undefined ? {} : { curveOutValue: keyframe.curveOutValue }),
            ...(keyframe.curveInType === undefined ? {} : { curveInType: keyframe.curveInType }),
            ...(keyframe.curveOutType === undefined ? {} : { curveOutType: keyframe.curveOutType }),
          },
        }));
        target = doc.addNode({ nodeId: parent.id }, stableSpec({ nativeType: "CCutsceneNodePropertyValue", attrs: trackAttrs, children }));
        break;
      }
      case "light.add": {
        const nativeType = operation.nativeType ?? "CCutsceneNodeLight";
        const attrs: Record<string, string | number | boolean> = { name: operation.name, ...(operation.properties ?? {}) };
        for (const name of Object.keys(attrs)) {
          if (!schema.getProperty(nativeType, name)) throw new Error(`Unknown ${nativeType} property '${name}'; inspect cutscene.schema.inspect first`);
          attrs[name] = nativeTypedScalar(schema, nativeType, name, attrs[name]);
        }
        const children = operation.duration === undefined ? undefined : [{
          nativeType: "CCutsceneElementObject",
          attrs: {
            duration: nativeTimeInput(operation.duration),
            ...(operation.lockedToEnd === undefined ? {} : { lockedToEnd: operation.lockedToEnd }),
          },
        }];
        target = doc.addNode(operation.parent ? resolveAlias(operation.parent, aliases) : undefined, stableSpec({ nativeType, attrs, children }));
        break;
      }
      case "light.update": {
        const light = resolveAlias(operation.light, aliases);
        const node = doc.resolve(light);
        if (!/^(?:CCutsceneNodeLight|CCutsceneNodeEnvironmentLight)$/.test(node.tag)) throw new Error(`${node.tag} is not a discovered editable light type`);
        setKnownProperties(doc, schema, light, operation.properties);
        break;
      }
      case "light.remove":
        doc.removeNode(resolveAlias(operation.light, aliases));
        break;
      case "light.activate": {
        const track = locateCategory(doc, schema, "director-light-track");
        if (!track) throw new Error("No Director active-light track exists");
        const light = operation.light ? doc.resolve(resolveAlias(operation.light, aliases)) : undefined;
        if (light && light.tag !== "CCutsceneNodeLight") throw new Error(`${light.tag} is not CCutsceneNodeLight`);
        if (light && !light.attrs.guid) throw new Error("Cutscene light has no native guid");
        const attrs: Record<string, string | number> = {
          lightGUID: light?.attrs.guid ?? "0",
          ...(operation.lightID === undefined ? {} : { lightID: operation.lightID }),
          ...(operation.lightIndex === undefined ? {} : { lightIndex: operation.lightIndex }),
          ...(operation.blendTime === undefined ? {} : { blendTime: nativeTimeInput(operation.blendTime) }),
          ...(operation.start === undefined ? {} : { start: nativeTimeInput(operation.start) }),
        };
        if (!light && !operation.lightID) throw new Error("light.activate requires either a Cutscene light object or a lighting catalog lightID");
        target = doc.addNode({ nodeId: track.id }, stableSpec({ nativeType: "CCutsceneElementActiveLight", attrs }));
        break;
      }
      case "fog.upsert": {
        const nativeType = "CCutsceneNodeFog";
        if (!schema.getNode(nativeType)) throw new Error(`${nativeType} is unavailable in the discovered Editor schema`);
        let fog: XmlNode | undefined;
        if (operation.fog) fog = doc.resolve(resolveAlias(operation.fog, aliases));
        else {
          const candidates = doc.nodes.filter((node) => node.tag === nativeType);
          if (candidates.length > 1) throw new Error("fog.upsert found multiple fog nodes; provide fog selector");
          fog = candidates[0];
        }
        const properties: Record<string, string | number | boolean> = {
          ...(operation.name === undefined ? {} : { name: operation.name }),
          fogColor: nativeVector(operation.color),
          ...(operation.falloff === undefined ? {} : { fogFalloff: operation.falloff }),
          ...(operation.density === undefined ? {} : { fogDensity: operation.density }),
          ...(operation.startHeight === undefined ? {} : { fogStartHeight: operation.startHeight }),
        };
        for (const name of Object.keys(properties)) {
          if (!schema.getProperty(nativeType, name)) throw new Error(`Unknown ${nativeType} property '${name}'; inspect cutscene.schema.inspect first`);
          properties[name] = nativeTypedScalar(schema, nativeType, name, properties[name]);
        }
        if (fog) {
          if (fog.tag !== nativeType) throw new Error(`${fog.tag} is not ${nativeType}`);
          for (const [name, value] of Object.entries(properties)) doc.setAttribute({ nodeId: fog.id }, name, value);
          target = fog.attrs.guid ? `guid:${fog.attrs.guid}` : undefined;
          if (operation.duration !== undefined) {
            let block = fog.childIds.map((id) => doc.nodes[id]).find((node) => node.tag === "CCutsceneElementObject");
            if (!block) {
              doc.addNode({ nodeId: fog.id }, stableSpec({ nativeType: "CCutsceneElementObject", attrs: { duration: nativeTimeInput(operation.duration), ...(operation.lockedToEnd === undefined ? {} : { lockedToEnd: operation.lockedToEnd }) } }));
            } else {
              doc.setAttribute({ nodeId: block.id }, "duration", nativeTimeInput(operation.duration));
              if (operation.lockedToEnd !== undefined) doc.setAttribute({ nodeId: block.id }, "lockedToEnd", operation.lockedToEnd);
            }
          }
        } else {
          const children = operation.duration === undefined ? undefined : [{ nativeType: "CCutsceneElementObject", attrs: { duration: nativeTimeInput(operation.duration), ...(operation.lockedToEnd === undefined ? {} : { lockedToEnd: operation.lockedToEnd }) } }];
          target = doc.addNode(undefined, stableSpec({ nativeType, attrs: properties, children }));
        }
        break;
      }
      case "camera.create": {
        const discovered = operation.nativeType
          ? schema.getNode(operation.nativeType)
          : schema.data.nodes.find((entry) => entry.category === "camera" && entry.coverage === "SUPPORTED");
        if (!discovered) throw new Error("camera.create is unavailable until discovery observes the native Camera node type for this Editor build. Supply a schema-confirmed nativeType or use object.add.");
        const properties = operation.properties ?? {};
        const cameraAttrs: Record<string, string | number | boolean> = { name: operation.id };
        for (const [name, value] of Object.entries(properties)) {
          if (!schema.getProperty(discovered.nativeType, name)) throw new Error(`Unknown camera property '${name}' for ${discovered.nativeType}; inspect cutscene.schema.inspect first`);
          cameraAttrs[name] = nativeTypedScalar(schema, discovered.nativeType, name, value);
        }
        const children = operation.duration === undefined ? undefined : [{
          nativeType: "CCutsceneElementObject",
          attrs: { duration: nativeTimeInput(operation.duration), ...(operation.lockedToEnd === undefined ? {} : { lockedToEnd: operation.lockedToEnd }) },
        }];
        target = doc.addNode(undefined, stableSpec({ nativeType: discovered.nativeType, attrs: cameraAttrs, children }));
        break;
      }
      case "camera.pose": {
        const camera = resolveAlias(operation.camera, aliases);
        const node = doc.resolve(camera);
        if (schema.category(node.tag) !== "camera") throw new Error(`${node.tag} is not a discovered Camera node`);
        for (const [name, value] of Object.entries(operation.properties)) {
          if (!schema.getProperty(node.tag, name)) throw new Error(`Unknown camera property '${name}' for ${node.tag}; inspect cutscene.schema.inspect first`);
          doc.setAttribute(camera, name, nativeTypedScalar(schema, node.tag, name, value));
        }
        break;
      }
      case "shot.add": {
        const track = locateCategory(doc, schema, "director-camera-track");
        if (!track) throw new Error("No Director active-camera track exists");
        const camera = doc.resolve(resolveAlias(operation.camera, aliases));
        if (!camera.attrs.guid) throw new Error("Camera target has no native guid");
        const shotType = "CCutsceneElementActiveCamera";
        if (!schema.getProperty(shotType, "start") && operation.start !== "0" && operation.start !== "0s") {
          throw new Error("The native start-time field for Director shots has not been confirmed by discovery for this schema. Use timeline.add with observed native attributes.");
        }
        const attrs: Record<string, string | number> = { guid: guid(), cameraIndex: 0, objectGuid: camera.attrs.guid };
        if (operation.start !== "0" && operation.start !== "0s") attrs.start = nativeTime(operation.start);
        if (operation.end !== undefined) {
          if (!schema.getProperty(shotType, "end")) throw new Error("The native end-time field for Director shots has not been confirmed; use the next shot/block representation observed by discovery.");
          attrs.end = nativeTime(operation.end);
        }
        target = doc.addNode({ nodeId: track.id }, { nativeType: shotType, attrs, children: operation.transition ? [operation.transition] : undefined });
        break;
      }
      case "raw.patch":
        doc.rawPatch(operation.start, operation.end, operation.text);
        break;
    }
    const alias = "as" in operation ? operation.as : undefined;
    if (alias) {
      if (!target) throw new Error(`Operation ${operation.op} cannot assign alias '${alias}' without creating a target`);
      aliases[alias] = target;
    }
    applied.push({ index, op: operation.op, target, alias });
  });
  return { aliases, applied };
}
