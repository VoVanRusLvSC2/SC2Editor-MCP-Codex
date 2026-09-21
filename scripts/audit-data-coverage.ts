import { DataSchemaRegistry } from "../src/modules/data/schemaRegistry.js";

const registry = await DataSchemaRegistry.load();
const report = registry.coverage();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

const preL5 = report.preL5;
if (
  report.status !== "PRE_L5_STATIC_EVIDENCE_COMPLETE" ||
  preL5.corpusLosslessCoveragePercent !== 100 ||
  preL5.observedTypeRegistryCoveragePercent !== 100 ||
  preL5.observedFieldRegistryCoveragePercent !== 100 ||
  (preL5.corpus?.objectTypes ?? 0) < 500 ||
  (preL5.corpus?.fieldPaths ?? 0) < 10_000 ||
  preL5.editorClassCandidates < 1_000 ||
  preL5.editorQualifiedFieldDescriptors < 600
) throw new Error("Data pre-L5 coverage gate failed");
