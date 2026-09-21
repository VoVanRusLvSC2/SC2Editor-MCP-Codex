import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CutsceneSchemaRegistry } from "../modules/cutscene/schemaRegistry.js";
import { CutsceneWorkspace } from "../modules/cutscene/workspace.js";

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-cutscene-mcp-"));
  const schema = await CutsceneSchemaRegistry.load(path.join(root, "missing.json"));
  const workspace = new CutsceneWorkspace(root, schema);
  const file = "Cutscenes/Test.SC2Cutscene";
  await fs.mkdir(path.join(root, "Cutscenes"), { recursive: true });
  await fs.writeFile(path.join(root, file), `<?xml version="1.0" encoding="utf-8"?>\n<CutsceneState cutsceneVersion="1.300000">\n    <CCutsceneNodeActor guid="1" name="Marine" modelLink="Marine" future="keep"/>\n</CutsceneState>\n`, "utf8");
  return { root, file, workspace };
}

test("cutscene.apply is atomic when a later operation fails", async () => {
  const { root, file, workspace } = await setup();
  const before = await fs.readFile(path.join(root, file), "utf8");
  await assert.rejects(workspace.apply(file, [
    { op: "property.set", object: "guid:1", path: "@modelLink", value: "Marine2" },
    { op: "property.set", object: "guid:1", path: "@invented", value: "x" },
  ], { dryRun: false, stage: true }), /Unknown native property/);
  assert.equal(await fs.readFile(path.join(root, file), "utf8"), before);
  assert.equal((await workspace.open(file)).staged, false);
});

test("cutscene staging, semantic diff, backup and atomic save work", async () => {
  const { root, file, workspace } = await setup();
  await workspace.apply(file, [{ op: "property.set", object: "guid:1", path: "@modelLink", value: "Marine2" }], { dryRun: false, stage: true });
  const diff = await workspace.diff(file);
  assert.equal(diff.changed, true);
  assert.equal(diff.changes.some((entry) => entry.property === "modelLink"), true);
  const saved = await workspace.save(file);
  assert.equal(saved.saved, true);
  assert.match(await fs.readFile(path.join(root, file), "utf8"), /modelLink="Marine2"/);
  assert.match(await fs.readFile(path.join(root, `${file}.sc2editormcp.bak`), "utf8"), /modelLink="Marine"/);
  assert.equal((await fs.readdir(path.dirname(path.join(root, file)))).some((name) => name.endsWith(".tmp")), false);
});

test("cutscene.compose creates a native Director/bookmark tree in one call", async () => {
  const { workspace } = await setup();
  const result = await workspace.compose({ file: "Cutscenes/Composed.SC2Cutscene", name: "Composed", bookmarks: [{ name: "Intro", time: "0" }] }, { dryRun: false, stage: true });
  assert.equal(result.accepted, true);
  assert.match(result.source, /<CutsceneState cutsceneVersion="1.300000" name="Composed">/);
  assert.match(result.source, /<CCutsceneNodeDirector/);
  assert.match(result.source, /<CCutsceneElementBookmark[^>]+bookmarkName="Intro"/);
  await workspace.save("Cutscenes/Composed.SC2Cutscene");
});

