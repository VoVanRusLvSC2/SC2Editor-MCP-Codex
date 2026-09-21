import { DataDocument } from "./document.js";
import type { DataSchemaRegistry } from "./schemaRegistry.js";
import type { DataDiagnostic, DataObject, DataValidationReport } from "./types.js";

export interface IndexedDataObject extends DataObject { file: string; layer: "workspace" | "dependency" }

export function validateDataDocuments(primaryFile: string, documents: Array<{ file: string; document: DataDocument; layer: "workspace" | "dependency" }>, schema?: DataSchemaRegistry): DataValidationReport {
  const diagnostics: DataDiagnostic[] = [];
  const objects: IndexedDataObject[] = [];
  for (const record of documents) {
    for (const problem of record.document.diagnostics) diagnostics.push({
      level: "L1", severity: problem.severity, code: "DATA_XML_PARSE", message: problem.message,
      file: record.file, path: `${record.file}@${problem.offset}`,
    });
    let root;
    try { root = record.document.root(); } catch (error) {
      diagnostics.push({ level: "L1", severity: "error", code: "DATA_ROOT_MISSING", message: error instanceof Error ? error.message : String(error), file: record.file, path: record.file });
      continue;
    }
    if (root.tag !== "Catalog") diagnostics.push({ level: "L1", severity: "error", code: "DATA_ROOT_INVALID", message: `Expected <Catalog>, found <${root.tag}>`, file: record.file, path: record.file });
    for (const object of record.document.objects()) objects.push({ ...object, file: record.file, layer: record.layer });
  }

  const byDomainId = new Map<string, IndexedDataObject[]>();
  const byId = new Map<string, IndexedDataObject[]>();
  for (const object of objects) {
    if (!object.id) {
      if (!object.isDefault) diagnostics.push({ level: "L2", severity: "warning", code: "DATA_ID_MISSING", message: `${object.ctype} has no id and is not marked default`, file: object.file, path: object.ctype });
      continue;
    }
    const domainKey = `${object.domain ?? object.ctype}\0${object.id}`.toLowerCase();
    byDomainId.set(domainKey, [...(byDomainId.get(domainKey) ?? []), object]);
    const idKey = object.id.toLowerCase();
    byId.set(idKey, [...(byId.get(idKey) ?? []), object]);
  }
  for (const records of byDomainId.values()) {
    const workspace = records.filter((entry) => entry.layer === "workspace");
    if (workspace.length > 1) for (const object of workspace) diagnostics.push({ level: "L2", severity: "error", code: "DATA_DUPLICATE_ID", message: `Duplicate ${object.domain ?? object.ctype} id '${object.id}' in workspace`, file: object.file, path: `${object.ctype}:${object.id}` });
  }

  for (const object of objects.filter((entry) => entry.layer === "workspace")) {
    if (object.parent) {
      const key = `${object.domain ?? object.ctype}\0${object.parent}`.toLowerCase();
      if (!(byDomainId.get(key)?.length)) diagnostics.push({ level: "L3", severity: "warning", code: "DATA_PARENT_UNRESOLVED", message: `Parent '${object.parent}' was not found in domain ${object.domain ?? object.ctype}`, file: object.file, path: `${object.ctype}:${object.id ?? "<default>"}@parent`, reference: { kind: object.domain ?? object.ctype, value: object.parent } });
    }
    const walk = (fields: DataObject["fields"], parentPath = "") => {
      const siblings = new Map<string, number>();
      for (const field of fields) {
        const key = `${field.name}\0${field.index ?? ""}`;
        siblings.set(key, (siblings.get(key) ?? 0) + 1);
        if (field.link && !(byId.get(field.link.toLowerCase())?.length)) diagnostics.push({ level: "L3", severity: "warning", code: "DATA_LINK_UNRESOLVED", message: `Link '${field.link}' was not found in the loaded dependency chain`, file: object.file, path: `${object.ctype}:${object.id ?? "<default>"}.${field.path}@Link`, reference: { kind: "catalog", value: field.link } });
        walk(field.children, `${field.path}.`);
      }
      for (const [key, count] of siblings) if (count > 1) {
        const [name, index] = key.split("\0");
        const fieldPath = `${parentPath}${name}`;
        if (!index && schema?.repeatableFields.has(`${object.ctype}.${fieldPath}`)) continue;
        diagnostics.push({ level: "L4", severity: "warning", code: "DATA_FIELD_DUPLICATE", message: `Field '${name}${index ? `[${index}]` : ""}' occurs ${count} times at one level`, file: object.file, path: `${object.ctype}:${object.id ?? "<default>"}.${fieldPath}` });
      }
    };
    walk(object.fields);

    if (!schema?.hasObservedType(object.ctype)) {
      diagnostics.push({ level: "L4", severity: "info", code: "DATA_TYPE_PRESERVE_ONLY", message: `${object.ctype} is not present in the bundled real-XML corpus; it remains generically editable and losslessly preserved`, file: object.file, path: `${object.ctype}:${object.id ?? "<default>"}` });
    }
    const checkObserved = (fields: DataObject["fields"]) => {
      for (const field of fields) {
        const spec = schema?.fieldSpec(object.ctype, field.path);
        const diagnosticPath = `${object.ctype}:${object.id ?? "<default>"}.${field.path}`;
        if (!spec) {
          diagnostics.push({ level: "L4", severity: "info", code: "DATA_FIELD_PRESERVE_ONLY", message: `${object.ctype}.${field.path} is not present in the bundled real-XML corpus`, file: object.file, path: diagnosticPath });
        } else if (field.value !== undefined) {
          const numeric = Number(field.value);
          if (spec.valueType === "CATALOG_REFERENCE_CANDIDATE" && (spec.catalogReferenceConfidence ?? 0) >= 0.9 && field.value) {
            const targets = byId.get(field.value.toLowerCase()) ?? [];
            if (!targets.length) diagnostics.push({
              level: "L3", severity: "warning", code: "DATA_VALUE_REFERENCE_UNRESOLVED",
              message: `Observed catalog-reference field points to '${field.value}', which was not found in the loaded dependency chain`,
              file: object.file, path: `${diagnosticPath}@value`,
              reference: { kind: spec.referenceDomainCandidates?.join("|") || "catalog", value: field.value },
            });
            else if (spec.referenceDomainCandidates?.length && !targets.some((target) => target.domain && spec.referenceDomainCandidates!.includes(target.domain))) diagnostics.push({
              level: "L3", severity: "warning", code: "DATA_VALUE_REFERENCE_DOMAIN_MISMATCH",
              message: `Reference '${field.value}' resolves outside the corpus-observed domain candidates: ${spec.referenceDomainCandidates.join(", ")}`,
              file: object.file, path: `${diagnosticPath}@value`,
              reference: { kind: spec.referenceDomainCandidates.join("|"), value: field.value },
            });
          }
          if (spec.valueType === "BOOLEAN_OBSERVED" && field.value !== "0" && field.value !== "1") diagnostics.push({ level: "L4", severity: "warning", code: "DATA_VALUE_BOOLEAN_UNOBSERVED", message: `Observed boolean field expects native 0/1, found '${field.value}'`, file: object.file, path: diagnosticPath });
          if (spec.valueType === "INTEGER_OBSERVED" && (!Number.isFinite(numeric) || !Number.isInteger(numeric))) diagnostics.push({ level: "L4", severity: "warning", code: "DATA_VALUE_INTEGER_UNOBSERVED", message: `Observed integer field received '${field.value}'`, file: object.file, path: diagnosticPath });
          if (spec.valueType === "NUMBER_OBSERVED" && !Number.isFinite(numeric)) diagnostics.push({ level: "L4", severity: "warning", code: "DATA_VALUE_NUMBER_UNOBSERVED", message: `Observed numeric field received '${field.value}'`, file: object.file, path: diagnosticPath });
          if (spec.valueType === "ENUM_CANDIDATE_OBSERVED" && spec.enumCandidates?.length && !spec.enumCandidates.includes(field.value)) diagnostics.push({ level: "L4", severity: "warning", code: "DATA_VALUE_ENUM_UNOBSERVED", message: `Value '${field.value}' is outside the corpus-observed candidate set: ${spec.enumCandidates.join(", ")}`, file: object.file, path: diagnosticPath });
          if (Number.isFinite(numeric) && spec.observedRange && ((spec.observedRange.min !== undefined && numeric < spec.observedRange.min) || (spec.observedRange.max !== undefined && numeric > spec.observedRange.max))) diagnostics.push({ level: "L4", severity: "info", code: "DATA_VALUE_OUTSIDE_OBSERVED_RANGE", message: `Value ${numeric} is outside the corpus-observed range ${spec.observedRange.min ?? "-∞"}..${spec.observedRange.max ?? "∞"}`, file: object.file, path: diagnosticPath });
        }
        checkObserved(field.children);
      }
    };
    checkObserved(object.fields);
  }

  // Parent-cycle detection follows domain-scoped inheritance exactly.
  for (const object of objects.filter((entry) => entry.layer === "workspace" && entry.id && entry.parent)) {
    const visited = new Set<string>();
    let current: IndexedDataObject | undefined = object;
    while (current?.parent) {
      const key = `${current.domain ?? current.ctype}\0${current.parent}`.toLowerCase();
      if (visited.has(key)) {
        diagnostics.push({ level: "L4", severity: "error", code: "DATA_PARENT_CYCLE", message: `Inheritance cycle reaches '${current.parent}'`, file: object.file, path: `${object.ctype}:${object.id}@parent` });
        break;
      }
      visited.add(key);
      current = byDomainId.get(key)?.[0];
    }
  }

  diagnostics.push({ level: "L5", severity: "info", code: "DATA_EDITOR_UNAVAILABLE", message: "SC2Editor Data Module validation was not executed in this environment", file: primaryFile, path: primaryFile });
  diagnostics.push({ level: "L6", severity: "info", code: "DATA_RUNTIME_UNTESTED", message: "Game runtime validation was not executed", file: primaryFile, path: primaryFile });
  const errors = diagnostics.filter((entry) => entry.severity === "error").length;
  const warnings = diagnostics.filter((entry) => entry.severity === "warning").length;
  const failed = (level: DataDiagnostic["level"]) => diagnostics.some((entry) => entry.level === level && entry.severity === "error");
  return { valid: errors === 0,validationScope:"Known static rules only; PASS means no detected error in this scope",semanticCoverage:"PARTIAL",unresolvedRules:["Full native defaults and illegal combinations","Target Editor and game behavior"], errors, warnings, diagnostics, levels: { L1: failed("L1") ? "FAIL" : "PASS", L2: failed("L2") ? "FAIL" : "PASS", L3: failed("L3") ? "FAIL" : "PASS", L4: failed("L4") ? "FAIL" : "PASS", L5: "UNAVAILABLE", L6: "UNTESTED" } };
}
