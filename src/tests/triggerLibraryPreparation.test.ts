import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../core/workspace.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { TriggerLibraries } from "../modules/trigger/libraries.js";
import type { Registry } from "../modules/trigger/authoring.js";

test("GUI library preparation shares one guarded scope and separates base revisions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "trigger-library-prepared-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "DocumentInfo"), "<DocInfo/>");
  const workspace = new Workspace(root),
    libraries = new TriggerLibraries(workspace, new DataWorkspace(workspace));
  const base: Registry = {
    schemaVersion: 1,
    build: 1,
    source: "Native",
    sha256: "a".repeat(64),
    functions: [],
  };
  await workspace.withReadSet(async () => {
    const first = await libraries.context(base);
    assert.equal(await libraries.context(base), first);
    assert.notEqual(await libraries.context({ ...base, build: 2 }), first);
    await fs.writeFile(path.join(root, "DocumentInfo"), "<DocInfo><!-- changed --></DocInfo>");
    assert.equal(await libraries.context(base), first);
    await assert.rejects(
      workspace.applyRawTransaction(
        ["Proof.txt"],
        (values) => new Map([...values, ["Proof.txt", "test"]]),
        { dryRun: false, stage: true },
      ),
      /STALE_/,
    );
  });
  const changed = await libraries.context(base);
  assert.notEqual(
    changed.revision,
    (
      await workspace.withReadSet(async () => {
        await fs.writeFile(path.join(root, "DocumentInfo"), "<DocInfo/>");
        return libraries.context(base);
      })
    ).revision,
  );
  assert.equal(await fs.stat(path.join(root, "Proof.txt")).catch(() => null), null);
});
