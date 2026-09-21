import { CutsceneDocument } from "./document.js";
import { CutsceneSchemaRegistry } from "./schemaRegistry.js";
import type { CutsceneValidationDiagnostic, CutsceneValidationReport } from "./types.js";

export function validateCutscene(doc: CutsceneDocument, schema: CutsceneSchemaRegistry): CutsceneValidationReport {
  const diagnostics: CutsceneValidationDiagnostic[] = doc.diagnostics.map((entry) => ({
    level: "L1_XML",
    severity: entry.severity,
    code: "XML_PARSE",
    message: entry.message,
  }));
  let rootOk = false;
  try {
    const root = doc.root();
    rootOk = root.tag === "CutsceneState";
    if (!rootOk) diagnostics.push({ level: "L2_SCHEMA", severity: "error", code: "ROOT_TYPE", message: `Expected CutsceneState root, found ${root.tag}`, nodeId: root.id });
    if (!root.attrs.cutsceneVersion) diagnostics.push({ level: "L2_SCHEMA", severity: "warning", code: "MISSING_VERSION", message: "CutsceneState has no cutsceneVersion; exact Editor compatibility is unknown.", nodeId: root.id });
  } catch (error) {
    diagnostics.push({ level: "L1_XML", severity: "error", code: "MISSING_ROOT", message: String(error) });
  }

  const guidOwners = new Map<string, number>();
  for (const node of doc.nodes) {
    if (!schema.getNode(node.tag)) diagnostics.push({ level: "L2_SCHEMA", severity: "info", code: "PRESERVE_ONLY_NODE", message: `Unknown native node ${node.tag} is preserved losslessly.`, nodeId: node.id });
    if (node.attrs.guid) {
      const prior = guidOwners.get(node.attrs.guid);
      if (prior !== undefined) diagnostics.push({ level: "L3_REFERENCES", severity: "error", code: "DUPLICATE_GUID", message: `GUID ${node.attrs.guid} is shared by nodes ${prior} and ${node.id}.`, nodeId: node.id });
      else guidOwners.set(node.attrs.guid, node.id);
    }
    for (const [name, value] of Object.entries(node.attrs)) {
      if (/guid$/i.test(name) && name.toLowerCase() !== "guid" && value !== "0" && !guidOwners.has(value) && !doc.nodes.some((candidate) => candidate.attrs.guid === value)) {
        diagnostics.push({ level: "L3_REFERENCES", severity: "warning", code: "UNRESOLVED_GUID", message: `${node.tag}.${name} references GUID ${value}, which is not defined in this document. It may be external.`, nodeId: node.id });
      }
      if (/^(start|end|duration)$/i.test(name) && /^-/.test(value)) diagnostics.push({ level: "L4_SEMANTIC", severity: "error", code: "NEGATIVE_TIME", message: `${node.tag}.${name} cannot be negative (${value}).`, nodeId: node.id });
    }
  }

  const xmlPass = !diagnostics.some((entry) => entry.level === "L1_XML" && entry.severity === "error");
  const schemaPass = rootOk && !diagnostics.some((entry) => entry.level === "L2_SCHEMA" && entry.severity === "error");
  const referencesPass = !diagnostics.some((entry) => entry.level === "L3_REFERENCES" && entry.severity === "error");
  const semanticPass = !diagnostics.some((entry) => entry.level === "L4_SEMANTIC" && entry.severity === "error");
  return {
    validationScope:"Known root/GUID/time checks; not complete native property semantics",semanticCoverage:"PARTIAL",unresolvedRules:["Complete native property schema and timeline semantics","Target Editor and game playback"],
    valid: xmlPass && schemaPass && referencesPass && semanticPass,
    highestCompletedLevel: "L4_SEMANTIC",
    diagnostics,
    levels: {
      L1_XML: xmlPass ? "PASS" : "FAIL",
      L2_SCHEMA: schemaPass ? "PASS" : "FAIL",
      L3_REFERENCES: referencesPass ? "PASS" : "FAIL",
      L4_SEMANTIC: semanticPass ? "PASS" : "FAIL",
      L5_EDITOR: "UNAVAILABLE",
      L6_RUNTIME: "UNAVAILABLE",
    },
  };
}

