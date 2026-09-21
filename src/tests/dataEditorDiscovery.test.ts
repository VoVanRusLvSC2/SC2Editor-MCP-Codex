import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { DataSchemaRegistry } from "../modules/data/schemaRegistry.js";

test("Data Editor registry is pinned to the supplied read-only SC2Editor", async () => {
  const schema = await DataSchemaRegistry.load(path.resolve("generated/data-editor-schema.json"));
  assert.equal(schema.editorEvidence?.editor.fileVersion, "5.0.16.97563");
  assert.equal(schema.editorEvidence?.editor.sha256, "9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164");
  assert.equal(schema.editorEvidence?.editor.readOnlyAnalysis, true);
  assert.equal((schema.editorEvidence?.catalogClassCandidates.length ?? 0) >= 1000, true);
  assert.equal((schema.editorEvidence?.qualifiedFieldCandidates.length ?? 0) >= 600, true);
  assert.equal((schema.editorEvidence?.linkTypes.length ?? 0) >= 120, true);
});

test("data.describe_type merges observed XML and exact Editor descriptor evidence", async () => {
  const schema = await DataSchemaRegistry.load(path.resolve("generated/data-editor-schema.json"));
  const result = schema.describe("CUnit", [{
    ctype: "CUnit", domain: "Unit", id: "Example", isDefault: false, attrs: { id: "Example" }, sourcePath: "UnitData.xml",
    fields: [{ path: "LifeMax", name: "LifeMax", value: "45", attrs: { value: "45" }, children: [], sourcePath: "UnitData.xml:LifeMax" }],
  }]);
  assert.equal(result.types[0].properties.some((field) => field.path === "LifeMax"), true);
  assert.equal("matchingClassCandidates" in result.editorEvidence, true);
  if (!("matchingClassCandidates" in result.editorEvidence)) throw new Error("Editor evidence unavailable");
  assert.equal((result.editorEvidence.matchingClassCandidates ?? []).some((entry) => entry.name === "CUnit"), true);
  assert.equal((result.editorEvidence.qualifiedFieldCandidates ?? []).some((entry) => entry.xmlPathCandidate === "CardLayouts.LayoutButtons.AbilCmd"), true);
  assert.equal((result.editorEvidence.runtimeApi ?? []).some((entry) => entry.name === "CatalogFieldValueSet"), true);
});

test("Data observed schema marks native repeated fields from real XML instead of warning as duplicates", async () => {
  const schema = await DataSchemaRegistry.load(path.resolve("generated/data-editor-schema.json"));
  assert.equal(schema.observedSchema?.evidence, "OBSERVED_REAL_XML");
  assert.equal(schema.observedSchema?.corpus.objects, 165161);
  assert.equal(schema.observedSchema?.corpus.parseFailures, 0);
  assert.equal(schema.observedSchema?.corpus.roundTripFailures, 0);
  assert.equal(schema.observedSchema?.corpus.objectTypes, 529);
  assert.equal(schema.observedSchema?.corpus.fieldPaths, 10509);
  assert.equal(schema.repeatableFields.has("CActorStateMonitor.On"), true);
  assert.equal(schema.repeatableFields.has("CActorStateMonitor.StateArray"), true);
  assert.equal(schema.repeatableFields.size, 435);
});

test("bundled Data schema describes observed enums, numeric ranges, and value-carried references without an active map", async () => {
  const schema = await DataSchemaRegistry.load(path.resolve("generated/data-editor-schema.json"));
  const compare = schema.fieldSpec("CValidatorUnitCompareVital", "Compare");
  assert.equal(compare?.valueType, "ENUM_CANDIDATE_OBSERVED");
  assert.deepEqual(compare?.enumCandidates, ["GE", "GT", "LE", "LT"]);

  const life = schema.fieldSpec("CUnit", "LifeMax");
  assert.equal(life?.valueType, "INTEGER_OBSERVED");
  assert.deepEqual(life?.observedRange, { min: 1, max: 500000 });

  const effect = schema.fieldSpec("CEffectSet", "EffectArray[19]");
  assert.equal(effect?.valueType, "CATALOG_REFERENCE_CANDIDATE");
  assert.ok((effect?.catalogReferenceConfidence ?? 0) >= 0.9);
  assert.ok(effect?.referenceDomainCandidates?.includes("Effect"));

  const coverage = schema.coverage();
  assert.equal(coverage.status, "PRE_L5_STATIC_EVIDENCE_COMPLETE");
  assert.equal(coverage.preL5.corpusLosslessCoveragePercent, 100);
  assert.equal(coverage.preL5.observedTypeRegistryCoveragePercent, 100);
  assert.equal(coverage.preL5.observedFieldRegistryCoveragePercent, 100);
});
