import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DataSchemaRegistry } from "../modules/data/schemaRegistry.js";

test("Data schema registry defers large JSON parsing until first schema query", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-data-schema-lazy-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const editor = path.join(root, "editor.json"), observed = path.join(root, "observed.json");
  await fs.writeFile(editor, JSON.stringify({
    schemaVersion: "test", editor: { sha256: "0", readOnlyAnalysis: true }, catalogClassCandidates: [],
    qualifiedFieldCandidates: [], linkTypes: [], fieldTypes: [], runtimeApi: [], editorSettings: [], localizationKeys: [], limitations: [],
  }));
  await fs.writeFile(observed, JSON.stringify({
    schemaVersion: "test", evidence: "OBSERVED_REAL_XML",
    corpus: { files: 1, catalogs: 1, objects: 1, objectTypes: 1, fieldInstances: 1, fieldPaths: 1, parseDiagnostics: 0, parseFailures: 0, roundTripFailures: 0 },
    repeatableUnindexedFields: ["CUnit.AbilArray"],
    types: [{ ctype: "CUnit", objects: 1, defaults: 0, parents: [], attributes: [], fields: [{ path: "AbilArray", name: "AbilArray", occurrences: 1, carriers: ["Link"], indexes: [], examples: [], nested: false, repeatableUnindexed: true }] }],
  }));

  const registry = DataSchemaRegistry.lazy(editor, observed);
  assert.deepEqual(registry.loadState(), { loaded: false, lazy: true });
  assert.equal(registry.hasObservedType("CUnit"), true);
  assert.deepEqual(registry.loadState(), { loaded: true, lazy: false });
  assert.equal(registry.repeatableFields.has("CUnit.AbilArray"), true);
});
