import { AiDocument } from "./document.js";
import { AiReferenceResolver, type AiTriggerBinding } from "./references.js";
import { AiSchemaRegistry } from "./schemaRegistry.js";
import type { AiValidationDiagnostic, AiValidationReport } from "./types.js";

export async function validateAiDocument(file: string, document: AiDocument, schema: AiSchemaRegistry, references: AiReferenceResolver, triggerBindings?: AiTriggerBinding[]): Promise<AiValidationReport> {
  const diagnostics: AiValidationDiagnostic[] = document.diagnostics.map((entry) => ({ level: "L1", severity: entry.severity, code: "AI_XML_PARSE", message: entry.message, file, path: `${file}@${entry.offset}` }));
  let ir;
  try { ir = document.toIR(schema); } catch (error) {
    diagnostics.push({ level: "L1", severity: "error", code: "AI_ROOT_OR_PARSE", message: error instanceof Error ? error.message : String(error), file, path: file });
    return finish(diagnostics);
  }
  for (const entry of ir.diagnostics) diagnostics.push({ level: "L1", severity: entry.severity, code: entry.code, message: entry.message, file, path: entry.path });

  duplicateDiagnostics(ir.definitions.map((entry) => ({ id: entry.id, path: `Definition[${entry.id}]` })), "AI_DUPLICATE_DEFINITION", diagnostics, file);
  duplicateDiagnostics(ir.waves.map((entry) => ({ id: `${entry.personalityId}\0${entry.id}`, path: `Definition[${entry.personalityId}]/Wave[${entry.id}]` })), "AI_DUPLICATE_WAVE", diagnostics, file);

  for (const definition of ir.definitions) {
    if (definition.id.startsWith("__anonymous_")) diagnostics.push({ level: "L2", severity: "error", code: "AI_DEFINITION_ID_MISSING", message: "Definition has no Id attribute", file, path: `Definition[node:${definition.nodeId}]` });
    for (const [name, value] of Object.entries(definition.properties)) await validateProperty(file, `Definition[${definition.id}]/${name}`, name, value, schema, references, diagnostics);
  }
  for (const wave of ir.waves) {
    const base = `Definition[${wave.personalityId}]/Wave[${wave.id}]`;
    if (wave.id.startsWith("__anonymous_")) diagnostics.push({ level: "L2", severity: "warning", code: "AI_WAVE_ID_MISSING", message: "Wave has no observed Id; preserved with positional identity", file, path: base });
    for (const [name, value] of Object.entries(wave.properties)) await validateProperty(file, `${base}/${name}`, name, value, schema, references, diagnostics);
    for (let index = 0; index < wave.composition.length; index++) {
      const unit = wave.composition[index];
      if (!unit.unit) diagnostics.push({ level: "L4", severity: "error", code: "AI_COMPOSITION_UNIT_EMPTY", message: "Composition entry has an empty unit reference", file, path: `${base}/Composition[${index}]/UnitRef` });
      else if (!(await references.resolve("unit", unit.unit)).length) diagnostics.push({ level: "L3", severity: "error", code: "AI_UNIT_MISSING", message: `Unit '${unit.unit}' was not found in the workspace/dependency catalogs`, file, path: `${base}/Composition[${index}]/UnitRef`, reference: { kind: "unit", value: unit.unit } });
      if (unit.quantity !== undefined && (!Number.isInteger(unit.quantity) || unit.quantity <= 0)) diagnostics.push({ level: "L4", severity: "error", code: "AI_COMPOSITION_QUANTITY_INVALID", message: `Quantity must be a positive integer, received ${unit.quantity}`, file, path: `${base}/Composition[${index}]/Quantity` });
    }
  }

  const definitionIds = new Set(ir.definitions.map((entry) => entry.id));
  const waveIds = new Set(ir.waves.map((entry) => entry.id));
  for (const binding of triggerBindings ?? await references.triggerBindings()) {
    if (!binding.value) continue;
    if (binding.referenceKind === "aidef" && !definitionIds.has(binding.value)) diagnostics.push({ level: "L3", severity: "error", code: "AI_TRIGGER_DEFINITION_MISSING", message: `Trigger references missing AI definition '${binding.value}'`, file: binding.file, path: binding.sourcePath, reference: { kind: "personality", value: binding.value } });
    if (binding.referenceKind === "aidefwave" && !waveIds.has(binding.value)) diagnostics.push({ level: "L3", severity: "error", code: "AI_TRIGGER_WAVE_MISSING", message: `Trigger references missing AI wave '${binding.value}'`, file: binding.file, path: binding.sourcePath, reference: { kind: "wave", value: binding.value } });
  }
  return finish(diagnostics);
}

async function validateProperty(file: string, path: string, name: string, value: string | undefined, schema: AiSchemaRegistry, references: AiReferenceResolver, diagnostics: AiValidationDiagnostic[]): Promise<void> {
  const property = schema.property(name);
  if (!property) {
    diagnostics.push({ level: "L2", severity: "info", code: "AI_UNKNOWN_PRESERVED", message: `Unknown native field <${name}> is preserved losslessly`, file, path });
    return;
  }
  if (value === undefined) return;
  if (property.valueType === "boolean" && !/^(?:0|1|true|false)$/i.test(value)) diagnostics.push({ level: "L2", severity: "error", code: "AI_BOOLEAN_INVALID", message: `${name} must be a native boolean`, file, path });
  if ((property.valueType === "integer" || property.valueType === "time") && (!Number.isFinite(Number(value)) || Number(value) < 0)) diagnostics.push({ level: "L2", severity: "error", code: "AI_NUMBER_INVALID", message: `${name} must be a non-negative number`, file, path });
  if (property.valueType === "integer" && Number.isFinite(Number(value)) && !Number.isInteger(Number(value))) diagnostics.push({ level: "L2", severity: "error", code: "AI_INTEGER_INVALID", message: `${name} must be an integer`, file, path });
  if (property.referenceKind === "player" && !/^(?:[0-9]|1[0-6])$/.test(value)) diagnostics.push({ level: "L3", severity: "error", code: "AI_PLAYER_INVALID", message: `Player '${value}' is outside the Editor slot range 0..16`, file, path, reference: { kind: "player", value } });
  if (property.referenceKind === "point" && !(await references.resolve("point", value)).length) diagnostics.push({ level: "L3", severity: "warning", code: "AI_POINT_UNRESOLVED", message: `Point '${value}' was not resolved`, file, path, reference: { kind: "point", value } });
  if (property.referenceKind === "trigger" && !(await references.resolve("trigger", value)).length) diagnostics.push({ level: "L3", severity: "warning", code: "AI_TRIGGER_UNRESOLVED", message: `Trigger '${value}' was not resolved`, file, path, reference: { kind: "trigger", value } });
}

function duplicateDiagnostics(entries: Array<{ id: string; path: string }>, code: string, diagnostics: AiValidationDiagnostic[], file: string): void {
  const seen = new Set<string>();
  for (const entry of entries) { if (seen.has(entry.id)) diagnostics.push({ level: "L2", severity: "error", code, message: `Duplicate identity '${entry.id.replace("\0", "/")}'`, file, path: entry.path }); else seen.add(entry.id); }
}

function finish(diagnostics: AiValidationDiagnostic[]): AiValidationReport {
  const errors = diagnostics.filter((entry) => entry.severity === "error").length;
  const warnings = diagnostics.filter((entry) => entry.severity === "warning").length;
  const fail = (level: "L1" | "L2" | "L3" | "L4") => diagnostics.some((entry) => entry.level === level && entry.severity === "error") ? "FAIL" as const : "PASS" as const;
  return { valid: errors === 0,validationScope:"Known static rules only; PASS means no detected error in this scope",semanticCoverage:"PARTIAL",unresolvedRules:["Full native defaults and illegal combinations","Target Editor and game behavior"], errors, warnings, levels: { L1: fail("L1"), L2: fail("L2"), L3: fail("L3"), L4: fail("L4"), L5: "UNAVAILABLE", L6: "UNTESTED" }, diagnostics };
}
