import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DataXsdRegistry } from "../modules/data/xsdRegistry.js";

test("declared Data XSD registry reads a compact manifest and one selected type shard", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-xsd-index-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "types"));
  await fs.writeFile(path.join(root, "types", "unit.json"), JSON.stringify({ name: "CUnit", kind: "complex", base: "CGameObject", fields: [{ kind: "element", name: "LifeMax", type: "CFixed" }], enumValues: [], facets: [] }));
  await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify({ schemaVersion: "1", source: { file: "catalogsData.xsd", bytes: 1, sha256: "0" }, statistics: { complexTypes: 1, simpleTypes: 0, fields: 1, enumValues: 0 }, types: [{ name: "CUnit", kind: "complex", base: "CGameObject", fields: 1, enumValues: 0, shard: "types/unit.json" }] }));
  const registry = new DataXsdRegistry(path.join(root, "manifest.json"));
  assert.equal(registry.search("unit")[0]?.name, "CUnit");
  assert.equal(registry.describe("cunit")?.fields[0]?.name, "LifeMax");
  assert.equal(registry.describe("CMissing"), undefined);
});
