import { Workspace } from "../../core/workspace.js";
import { scanXml } from "../../core/xmlScanner.js";
import { AiDocument } from "./document.js";
import { AiReferenceResolver } from "./references.js";
import { AiSchemaRegistry } from "./schemaRegistry.js";
import type { AiNativeNodeSpec, AiOperation, AiSelector, AiValidationReport } from "./types.js";
import { validateAiDocument } from "./validator.js";
import type { DataWorkspace } from "../data/workspace.js";
import type { BrowseWorkspace } from "../browse/workspace.js";
import path from "node:path";
import { createHash } from "node:crypto";

function resolveAlias(selector: AiSelector, aliases: Map<string, string>): AiSelector {
  if (typeof selector === "string" && selector.startsWith("@")) {
    const value = aliases.get(selector.slice(1));
    if (!value) throw new Error(`Unknown AI operation alias '${selector}'`);
    return value;
  }
  return selector;
}

function componentListWithAi(source: string): string {
  const initial = source || `<?xml version="1.0" encoding="utf-8"?>\r\n<Components>\r\n</Components>`;
  const parsed = scanXml(initial);
  const root = parsed.rootIds.map((id) => parsed.nodes[id]).find((node) => node.tag === "Components");
  if (!root || parsed.rootIds.length !== 1 || parsed.diagnostics.some((entry) => entry.severity === "error")) throw new Error("ComponentList.SC2Components must have one valid <Components> root");
  const registrations = root.childIds.map((id) => parsed.nodes[id]).filter((node) => node.tag === "DataComponent" && node.attrs.Type?.toLowerCase() === "aiai");
  if (registrations.length > 1) throw new Error("Duplicate aiai component registration");
  if (registrations.length) {
    const node = registrations[0];
    if (initial.slice(node.startTagEnd, node.endTagStart).trim() !== "CustomAI") throw new Error("aiai component must point to CustomAI; refusing to overwrite its existing path");
    return initial;
  }
  if (root.selfClosing) {
    const open = initial.slice(root.start, root.startTagEnd).replace(/\/\s*>$/, ">");
    return initial.slice(0, root.start) + `${open}\n    <DataComponent Type="aiai">CustomAI</DataComponent>\n</Components>` + initial.slice(root.end);
  }
  const newline = initial.includes("\r\n") ? "\r\n" : "\n";
  const child = root.childIds.length ? parsed.nodes[root.childIds[0]] : undefined;
  const indent = child ? initial.slice(initial.lastIndexOf("\n", child.start - 1) + 1, child.start).match(/^\s*/)?.[0] ?? "    " : "    ";
  const insertion = root.childIds.length ? `${indent}<DataComponent Type="aiai">CustomAI</DataComponent>${newline}` : `${newline}${indent}<DataComponent Type="aiai">CustomAI</DataComponent>${newline}`;
  return initial.slice(0, root.endTagStart) + insertion + initial.slice(root.endTagStart);
}

function aiFilePath(file: string): string {
  const normalized = path.posix.normalize(file.replaceAll("\\", "/"));
  if (path.posix.isAbsolute(normalized) || normalized.startsWith("../") || path.posix.basename(normalized) !== "CustomAI") throw new Error("AI_WRITE_SCOPE: only a workspace CustomAI component is writable; Trigger and Terrain writes are disabled");
  return normalized;
}

function propertyAllowed(schema: AiSchemaRegistry, name: string, allowUnconfirmed: boolean | undefined): void {
  const property = schema.property(name);
  if (!property) {
    if (!allowUnconfirmed) throw new Error(`AI property '${name}' is not typed; pass allowUnconfirmedStructure=true only with Editor/XML evidence`);
    return;
  }
  if (property.coverage !== "SUPPORTED" && !allowUnconfirmed) throw new Error(`AI property '${name}' has ${property.coverage} coverage; pass allowUnconfirmedStructure=true to write the theoretical mapping`);
}

function nativeStructureAllowed(schema: AiSchemaRegistry, spec: AiNativeNodeSpec, parent: string, allowUnconfirmed?: boolean): void {
  if (allowUnconfirmed) return;
  const node = schema.node(spec.nativeType);
  if (!node || node.coverage !== "SUPPORTED" || !node.parents.includes(parent)) throw new Error(`Native AI node '${spec.nativeType}' under '${parent}' is not confirmed writable`);
  for (const child of spec.children ?? []) nativeStructureAllowed(schema, child, spec.nativeType, allowUnconfirmed);
}

export class AiWorkspace {
  readonly references: AiReferenceResolver;

  constructor(readonly workspace: Workspace, readonly schema: AiSchemaRegistry, readonly data?: DataWorkspace, readonly browse?: BrowseWorkspace) {
    this.references = new AiReferenceResolver(workspace.root, data?.extraRoots, workspace, browse);
  }

  async open(file = "CustomAI") {
    file = aiFilePath(file);
    const raw = await this.workspace.readRaw(file);
    return { ...raw, document: raw.exists || raw.staged ? new AiDocument(raw.text, raw.file) : AiDocument.create() };
  }

  async context(args: { file?: string; definitions?: string[]; waves?: string[]; units?: string[]; includeNative?: boolean; includeTriggers?: boolean; limit?: number } = {}) {
    const file = args.file ?? "CustomAI";
    const opened = await this.open(file);
    const ir = opened.document.toIR(this.schema, args.includeNative ?? false);
    const definitionNeedles = (args.definitions ?? []).map((entry) => entry.toLowerCase());
    const waveNeedles = (args.waves ?? []).map((entry) => entry.toLowerCase());
    const limit = args.limit ?? 100;
    const definitions = ir.definitions.filter((entry) => !definitionNeedles.length || definitionNeedles.some((needle) => entry.id.toLowerCase().includes(needle))).slice(0, limit);
    const waves = ir.waves.filter((entry) => !waveNeedles.length || waveNeedles.some((needle) => entry.id.toLowerCase().includes(needle))).slice(0, limit);
    const units = (await Promise.all((args.units ?? []).map((unit) => this.references.search(unit, ["unit"], 20)))).flat();
    const triggerBindings = args.includeTriggers === false ? [] : await this.references.triggerBindings();
    return {
      component: { file, exists: opened.exists, staged: opened.staged, registeredAs: { typeCode: "aiai", path: "CustomAI" }, sha256: opened.document.sha256 },
      definitions, waves: await Promise.all(waves.map(async (wave) => ({ ...wave, graph: await this.waveGraph(wave) }))), nativeNodes: args.includeNative ? ir.nativeNodes.slice(0, limit) : undefined,
      units, triggerBindings: triggerBindings.slice(0, limit), references: await this.references.status(), diagnostics: ir.diagnostics,
      schema: { version: this.schema.data.schemaVersion, exactNativeTokens: this.schema.data.nodes.filter((entry) => entry.evidence === "EDITOR_EXE_EXACT").length, inferredNodes: this.schema.data.nodes.filter((entry) => entry.evidence === "STRUCTURE_INFERRED").length },
      operations: {
        definition: ["definition.create", "definition.update", "definition.rename", "definition.clone", "definition.delete", "definition.reorder"],
        wave: ["wave.create", "wave.update", "wave.rename", "wave.clone", "wave.delete", "wave.reorder", "composition.patch"],
        escapeHatch: ["native.add", "native.set", "native.remove"],
      },
      recommendedWorkflow: "one ai.context + one ai.apply; apply validates, diffs and atomically updates CustomAI + ComponentList only",
      scope: { triggerEditing: false, terrainEditing: false, triggerReferences: "READ_ONLY; rename/delete of referenced IDs is blocked" },
      evidencePolicy: "Unknown XML is preserved. Unconfirmed serialization is gated by allowUnconfirmedStructure.",
    };
  }

  private async waveGraph(wave: ReturnType<AiDocument["toIR"]>["waves"][number]) {
    let minerals = 0; let vespene = 0; let supply = 0; let complete = true;
    const units = [] as Array<{ unit: string; quantity: number; minerals?: number; vespene?: number; supply?: number; provenance: string[] }>;
    for (const entry of wave.composition) {
      const quantity = entry.quantity ?? 1;
      const dataMetrics = await this.data?.unitMetrics(entry.unit);
      const resolved = (await this.references.resolve("unit", entry.unit))[0];
      const metrics = dataMetrics ?? resolved?.metrics ?? {};
      if ([metrics.minerals, metrics.vespene, metrics.supply].some((value) => value === undefined)) complete = false;
      minerals += (metrics.minerals ?? 0) * quantity; vespene += (metrics.vespene ?? 0) * quantity; supply += (metrics.supply ?? 0) * quantity;
      units.push({ unit: entry.unit, quantity, ...metrics, provenance: dataMetrics?.provenance ?? resolved?.provenance ?? [] });
    }
    const rawTime = wave.properties.Time ?? wave.properties.Arrival ?? wave.properties.EditorDelay;
    return { time: rawTime === undefined ? undefined : Number(rawTime), minerals, vespene, supply, complete, units, policy: this.data ? "Values and inheritance are resolved through data.* against the current dependency catalog; missing values are not guessed." : "Values are read from current dependency catalog fields; missing/inherited values are not guessed." };
  }

  async query(args: { file?: string; text?: string; unit?: string; minTime?: number; maxTime?: number; kind?: "definitions" | "waves" | "references" | "triggerBindings" | "invalid"; limit?: number }) {
    const opened = await this.open(args.file ?? "CustomAI");
    const ir = opened.document.toIR(this.schema, false);
    const needle = args.text?.toLowerCase();
    let definitions = ir.definitions.filter((entry) => !needle || entry.id.toLowerCase().includes(needle));
    let waves = ir.waves.filter((entry) => {
      const time = Number(entry.properties.Time ?? entry.properties.Arrival ?? entry.properties.EditorDelay);
      return (!needle || entry.id.toLowerCase().includes(needle) || entry.personalityId.toLowerCase().includes(needle)) &&
        (!args.unit || entry.composition.some((unit) => unit.unit.toLowerCase() === args.unit!.toLowerCase())) &&
        (args.minTime === undefined || (Number.isFinite(time) && time >= args.minTime)) && (args.maxTime === undefined || (Number.isFinite(time) && time <= args.maxTime));
    });
    const validation = args.kind === "invalid" ? await this.validate(args.file ?? "CustomAI") : undefined;
    const limit = args.limit ?? 100;
    definitions = definitions.slice(0, limit); waves = waves.slice(0, limit);
    return { definitions: args.kind && args.kind !== "definitions" ? undefined : definitions, waves: args.kind && args.kind !== "waves" ? undefined : await Promise.all(waves.map(async (wave) => ({ ...wave, graph: await this.waveGraph(wave) }))), references: args.kind === "references" ? await this.references.search(args.text ?? "", undefined, limit) : undefined, triggerBindings: args.kind === "triggerBindings" ? (await this.references.triggerBindings()).slice(0, limit) : undefined, diagnostics: validation?.diagnostics.slice(0, limit) };
  }

  async apply(request: Parameters<AiWorkspace["applyTracked"]>[0]) { return this.workspace.withReadSet(() => this.applyTracked(request)); }
  private async applyTracked(request: { file?: string; componentListFile?: string; operations: AiOperation[]; dryRun?: boolean; stage?: boolean; backup?: boolean; expectedSha256?: Record<string, string>; expectedSourceSha256?: Record<string, string>; validate?: boolean; allowInvalid?: boolean }) {
    if (!request.operations.length) throw new Error("ai.apply requires at least one operation");
    if (request.operations.length > 250) throw new Error("ai.apply accepts at most 250 operations");
    const aiFile = aiFilePath(request.file ?? "CustomAI");
    const componentFile = path.posix.normalize((request.componentListFile ?? path.posix.join(path.posix.dirname(aiFile), "ComponentList.SC2Components")).replaceAll("\\", "/"));
    if (componentFile !== path.posix.join(path.posix.dirname(aiFile), "ComponentList.SC2Components")) throw new Error("AI_WRITE_SCOPE: componentListFile must be the sibling ComponentList.SC2Components");
    const bindings = await this.references.triggerBindings();
    const validationBindings = bindings.map((entry) => ({ ...entry }));
    const files = [aiFile, componentFile];
    let validation: AiValidationReport | undefined;
    let aliases: Record<string, string> = {};
    let applied: Array<{ index: number; op: string; target?: string }> = [];
    let sourceSha256: Record<string, string> = {};
    const transaction = await this.workspace.applyRawTransaction(files, async (sources) => {
      sourceSha256 = Object.fromEntries([...sources].map(([file, source]) => [file, createHash("sha256").update(source, "utf8").digest("hex")]));
      for (const [file, expected] of Object.entries(request.expectedSourceSha256 ?? {})) if (sourceSha256[file] !== expected) throw new Error(`AI_STALE_SOURCE: effective source/draft changed since preview: ${file}`);
      const next = new Map(sources);
      const document = sources.get(aiFile) ? new AiDocument(sources.get(aiFile)!, aiFile) : AiDocument.create();
      const beforeIr = document.toIR(this.schema);
      const aliasMap = new Map<string, string>();
      applied = [];
      for (let index = 0; index < request.operations.length; index++) {
        const operation = request.operations[index];
        if ("definition" in operation) {
          const node = document.resolve(resolveAlias(operation.definition, aliasMap));
          if (node.tag !== "Definition") throw new Error(`${operation.op} requires Definition, received ${node.tag}`);
        }
        if ("wave" in operation) {
          const node = document.resolve(resolveAlias(operation.wave, aliasMap));
          if (node.tag !== "Wave") throw new Error(`${operation.op} requires Wave, received ${node.tag}`);
        }
        let target: string | undefined;
        switch (operation.op) {
          case "definition.create": {
            if (document.toIR(this.schema).definitions.some((entry) => entry.id === operation.id)) throw new Error(`AI definition already exists: ${operation.id}`);
            const children = Object.entries(operation.properties ?? {}).map(([nativeType, value]) => { propertyAllowed(this.schema, nativeType, operation.allowUnconfirmedStructure); return { nativeType, value }; });
            const node = document.addNode(undefined, { nativeType: "Definition", attrs: { Id: operation.id }, children });
            target = document.publicId(node); break;
          }
          case "definition.update": {
            const selector = resolveAlias(operation.definition, aliasMap); const node = document.resolve(selector);
            if (node.tag !== "Definition") throw new Error(`definition.update requires Definition, received ${node.tag}`);
            for (const [name, value] of Object.entries(operation.properties)) { propertyAllowed(this.schema, name, operation.allowUnconfirmedStructure); document.setProperty(document.publicId(node), name, value); }
            target = document.publicId(document.resolve(selector)); break;
          }
          case "definition.rename": {
            const selector = resolveAlias(operation.definition, aliasMap); const node = document.resolve(selector); const oldId = node.attrs.Id ?? node.attrs.id;
            if (!oldId) throw new Error("Cannot rename a Definition without Id");
            const incoming = document.incomingReferences(oldId, this.schema, "personality");
            const triggerIncoming = bindings.filter((entry) => entry.referenceKind === "aidef" && entry.value === oldId);
            if (triggerIncoming.length) throw new Error("AI_TRIGGER_EDITING_DISABLED: definition has read-only Trigger references; rename is blocked");
            if ((incoming.length || triggerIncoming.length) && !operation.updateReferences) throw new Error(`Definition '${oldId}' has ${incoming.length + triggerIncoming.length} typed incoming reference(s); set updateReferences=true`);
            document.setAttribute(selector, node.attrs.Id !== undefined ? "Id" : "id", operation.newId);
            if (operation.updateReferences) {
              document.updateTypedReferences(oldId, operation.newId, this.schema, "personality");
            }
            target = `Definition:${operation.newId}`; break;
          }
          case "definition.clone": { const node = document.cloneNode(resolveAlias(operation.definition, aliasMap), operation.id); target = document.publicId(node); break; }
          case "definition.delete": {
            const selector = resolveAlias(operation.definition, aliasMap); const node = document.resolve(selector); const id = node.attrs.Id ?? node.attrs.id ?? document.publicId(node);
            const incoming = document.incomingReferences(id, this.schema, "personality"); const triggerIncoming = bindings.filter((entry) => entry.referenceKind === "aidef" && entry.value === id);
            if (triggerIncoming.length) throw new Error("AI_TRIGGER_EDITING_DISABLED: definition has read-only Trigger incoming reference(s); delete is blocked even with force");
            if (!operation.force && (incoming.length || triggerIncoming.length)) throw new Error(`Definition '${id}' has ${incoming.length + triggerIncoming.length} typed incoming reference(s)`);
            document.removeNode(selector); target = id; break;
          }
          case "definition.reorder": { const selector = resolveAlias(operation.definition, aliasMap); if (operation.before) document.moveNode(selector, resolveAlias(operation.before, aliasMap), "before"); else if (operation.after) document.moveNode(selector, resolveAlias(operation.after, aliasMap), "after"); else throw new Error("definition.reorder requires before or after"); break; }
          case "wave.create": {
            if (!operation.allowUnconfirmedStructure) throw new Error("Wave nesting/creation is STRUCTURE_INFERRED; pass allowUnconfirmedStructure=true after accepting the evidence report");
            const definition = document.resolve(resolveAlias(operation.definition, aliasMap));
            const children: AiNativeNodeSpec[] = Object.entries(operation.properties ?? {}).map(([nativeType, value]) => ({ nativeType, value }));
            if (operation.composition?.length) children.push({ nativeType: "CreateUnits", children: operation.composition.map((entry) => ({ nativeType: "Unit", attrs: { Type: entry.unit, Count: entry.quantity } })) });
            const node = document.addNode(document.publicId(definition), { nativeType: "Wave", attrs: { Id: operation.id }, children }); target = document.publicId(node); break;
          }
          case "wave.update": { const selector = resolveAlias(operation.wave, aliasMap); const node = document.resolve(selector); if (node.tag !== "Wave") throw new Error(`wave.update requires Wave, received ${node.tag}`); for (const [name, value] of Object.entries(operation.properties)) { propertyAllowed(this.schema, name, operation.allowUnconfirmedStructure); document.setProperty(document.publicId(node), name, value); } target = document.publicId(document.resolve(selector)); break; }
          case "wave.rename": {
            const selector = resolveAlias(operation.wave, aliasMap); const node = document.resolve(selector); const oldId = node.attrs.Id ?? node.attrs.id; if (!oldId) throw new Error("Cannot rename a Wave without Id");
            const incoming = document.incomingReferences(oldId, this.schema, "wave"); const triggerIncoming = bindings.filter((entry) => entry.referenceKind === "aidefwave" && entry.value === oldId);
            if (triggerIncoming.length) throw new Error("AI_TRIGGER_EDITING_DISABLED: wave has read-only Trigger references; rename is blocked");
            if ((incoming.length || triggerIncoming.length) && !operation.updateReferences) throw new Error(`Wave '${oldId}' has ${incoming.length + triggerIncoming.length} typed incoming reference(s); set updateReferences=true`);
            document.setAttribute(selector, node.attrs.Id !== undefined ? "Id" : "id", operation.newId);
            if (operation.updateReferences) document.updateTypedReferences(oldId, operation.newId, this.schema, "wave");
            target = `Wave:${operation.newId}`; break;
          }
          case "wave.clone": { const node = document.cloneNode(resolveAlias(operation.wave, aliasMap), operation.id); target = document.publicId(node); break; }
          case "wave.delete": { const selector = resolveAlias(operation.wave, aliasMap); const node = document.resolve(selector); const id = node.attrs.Id ?? node.attrs.id ?? document.publicId(node); const incoming = document.incomingReferences(id, this.schema, "wave"); const triggerIncoming = bindings.filter((entry) => entry.referenceKind === "aidefwave" && entry.value === id); if (triggerIncoming.length) throw new Error("AI_TRIGGER_EDITING_DISABLED: wave has read-only Trigger incoming reference(s); delete is blocked even with force"); if (!operation.force && incoming.length) throw new Error(`Wave '${id}' has ${incoming.length} typed incoming reference(s)`); document.removeNode(selector); target = id; break; }
          case "wave.reorder": { const selector = resolveAlias(operation.wave, aliasMap); if (operation.before) document.moveNode(selector, resolveAlias(operation.before, aliasMap), "before"); else if (operation.after) document.moveNode(selector, resolveAlias(operation.after, aliasMap), "after"); else throw new Error("wave.reorder requires before or after"); break; }
          case "composition.patch": {
            if (!operation.allowUnconfirmedStructure) throw new Error("Composition unit serialization is UNKNOWN_NEEDS_RESEARCH; pass allowUnconfirmedStructure=true and optionally unitTag from native evidence");
            const wave = document.resolve(resolveAlias(operation.wave, aliasMap)); const current = document.toIR(this.schema).waves.find((entry) => entry.nodeId === wave.id);
            if (!current) throw new Error("composition.patch requires a Wave");
            if (operation.mode === "replace" || operation.mode === "remove") for (const unit of [...current.composition].reverse()) if (operation.mode === "replace" || operation.units.some((entry) => entry.unit === unit.unit)) document.removeNode(`node:${document.nodes.find((node) => document.pathOf(node) === unit.path)!.id}`);
            if (operation.mode !== "remove") {
              let container = document.descendants(document.resolve(document.publicId(wave))).find((node) => node.tag === "CreateUnits");
              const pending = [...operation.units];
              if (!container) {
                const first = pending.shift();
                if (first) container = document.addNode(document.publicId(document.resolve(document.publicId(wave))), { nativeType: "CreateUnits", children: [{ nativeType: operation.unitTag ?? "Unit", attrs: { Type: first.unit, Count: first.quantity ?? 1 } }] });
              }
              for (const unit of pending) document.addNode(document.publicId(container!), { nativeType: operation.unitTag ?? "Unit", attrs: { Type: unit.unit, Count: unit.quantity ?? 1 } });
            }
            target = document.publicId(document.resolve(resolveAlias(operation.wave, aliasMap))); break;
          }
          case "native.add": { const parent = operation.parent ? resolveAlias(operation.parent, aliasMap) : undefined; nativeStructureAllowed(this.schema, operation.node, parent ? document.resolve(parent).tag : document.root().tag, operation.allowUnconfirmedStructure); const node = document.addNode(parent, operation.node); target = document.publicId(node); break; }
          case "native.set": { const selector = resolveAlias(operation.node, aliasMap); const parent = document.resolve(selector); const existing = parent.childIds.some((id) => document.nodes[id].tag.toLowerCase() === operation.property.toLowerCase()); if (!existing) propertyAllowed(this.schema, operation.property, operation.allowUnknown); else if (!this.schema.property(operation.property) && !operation.allowUnknown) throw new Error(`Unknown AI property '${operation.property}'; set allowUnknown=true only with native evidence`); document.setProperty(selector, operation.property, operation.value); target = document.publicId(document.resolve(selector)); break; }
          case "native.remove": { const selector = resolveAlias(operation.node, aliasMap); const node = document.resolve(selector); if ([node, ...document.descendants(node)].some((entry) => ["Definition", "Wave"].includes(entry.tag))) throw new Error("Use definition.delete or wave.delete for reference-safe removal; force cannot bypass read-only Trigger guards"); target = document.publicId(node); document.removeNode(selector); break; }
        }
        if ("as" in operation && operation.as) { if (!target) throw new Error(`Operation ${index} did not produce an alias target`); aliasMap.set(operation.as, target); }
        applied.push({ index, op: operation.op, target });
      }
      next.set(aiFile, document.source);
      // Always enforce read-only Trigger links, including native removals and validation opt-outs.
      const afterIr = document.toIR(this.schema);
      const reparsed = scanXml(document.source);
      if (reparsed.rootIds.length !== 1 || document.root().tag !== "AIData" || reparsed.diagnostics.some((entry) => entry.severity === "error")) throw new Error("AI_XML_INVALID: final CustomAI must reparse with exactly one AIData root");
      for (const binding of bindings) {
        const before = binding.referenceKind === "aidef" ? beforeIr.definitions : binding.referenceKind === "aidefwave" ? beforeIr.waves : [];
        const after = binding.referenceKind === "aidef" ? afterIr.definitions : binding.referenceKind === "aidefwave" ? afterIr.waves : [];
        if (binding.value && before.some((entry) => entry.id === binding.value) && !after.some((entry) => entry.id === binding.value)) throw new Error("AI_TRIGGER_EDITING_DISABLED: operation would break a read-only Trigger reference");
      }
      next.set(componentFile, componentListWithAi(next.get(componentFile) ?? ""));
      if (request.validate ?? true) {
        validation = await validateAiDocument(aiFile, document, this.schema, this.references, validationBindings);
        if (!validation.valid && !request.allowInvalid) throw new Error(`AI validation failed with ${validation.errors} error(s): ${validation.diagnostics.filter((entry) => entry.severity === "error").slice(0, 5).map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`);
      }
      aliases = Object.fromEntries([...aliasMap].map(([name, value]) => [`@${name}`, value]));
      return next;
    }, { dryRun: request.dryRun ?? true, stage: request.stage ?? true, backup: request.backup ?? true, expectedSha256: request.expectedSha256, summary: `Apply ${request.operations.length} AI operations atomically` });
    return { ...transaction, sourceSha256, applied, aliases, validation, efficiency: { toolCalls: 1, operations: request.operations.length, files: transaction.files.length, includesValidation: request.validate ?? true, includesDiff: true } };
  }

  async validate(file = "CustomAI"): Promise<AiValidationReport> {
    const opened = await this.open(file);
    return validateAiDocument(file, opened.document, this.schema, this.references);
  }
}
