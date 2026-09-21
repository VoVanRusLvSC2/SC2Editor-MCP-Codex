import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import { Workspace } from "../src/core/workspace.js";
import { SchemaRegistry } from "../src/schema/schemaRegistry.js";
import { AiWorkspace } from "../src/modules/ai/workspace.js";
import { AiSchemaRegistry } from "../src/modules/ai/schemaRegistry.js";
import { DataWorkspace } from "../src/modules/data/workspace.js";
import { BrowseWorkspace } from "../src/modules/browse/workspace.js";

const samples = JSON.parse(await fs.readFile("src/tests/fixtures/ai-observed-documents.json", "utf8")) as Array<{ name: string; source: string; sha256: string; bytes: string }>;
const sample = samples.find((entry) => entry.name === "UA3.CustomAI")!;
await fs.mkdir("examples/ai/runs", { recursive: true });
const root = await fs.mkdtemp(path.resolve("examples/ai/runs/demo-"));
await fs.cp("src/tests/fixtures/browse-placement-map", root, { recursive: true });
const original = Buffer.from(sample.bytes, "base64");
await fs.writeFile(path.join(root, "CustomAI"), original);
const workspace = new Workspace(root, await SchemaRegistry.loadBundled());
const data = new DataWorkspace(workspace); const browse = new BrowseWorkspace(workspace, data);
const ai = new AiWorkspace(workspace, await AiSchemaRegistry.load(), data, browse);
const before = await ai.context({ includeNative: true });
const rawDefinition = before.definitions[0].rawSource!;
const request = { operations: [{ op: "definition.create" as const, id: "CodexAI_Demo", as: "demo" }] };
const preview = await ai.apply(request);
assert.equal(createHash("sha256").update(await fs.readFile(path.join(root, "CustomAI"))).digest("hex"), sample.sha256);
assert.equal(workspace.hasDraft("CustomAI"), false);
const apply = await ai.apply({ ...request, dryRun: false, stage: false, backup: true, expectedSha256: Object.fromEntries(preview.files.map((file) => [file.file, file.beforeSha256])), expectedSourceSha256: preview.sourceSha256 });
const reopened = await ai.open();
assert.ok(reopened.document.source.includes(rawDefinition));
assert.equal(createHash("sha256").update(await fs.readFile(path.join(root, "CustomAI.sc2uimcp.bak"))).digest("hex"), sample.sha256);
const validation = await ai.validate(); assert.equal(validation.valid, true);
const report = { version: "1.1.0-alpha.7", root, source: sample.source, sourceSha256: sample.sha256,
  sourceKind: "previously extracted native CustomAI inside synthetic component directory; not a complete real SC2Map demo",
  before, request, preview, apply, after: await ai.context(), validation,
  dryRunNoMutation: "PASS", originalDefinitionRawPreservation: "PASS", backupOriginalHash: "PASS", xmlReparse: "PASS",
  triggerWrite: "NOT_PERFORMED", terrainWrite: "NOT_PERFORMED", populatedWaveCreation: "NOT_PERFORMED",
  editorOpen: "NOT_EXECUTED", editorSave: "NOT_EXECUTED", runtime: "NOT_EXECUTED" };
await fs.writeFile(path.join(root, "DEMONSTRATION.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ root, report: path.join(root, "DEMONSTRATION.json"), validation: validation.levels, sourceKind: report.sourceKind }));
