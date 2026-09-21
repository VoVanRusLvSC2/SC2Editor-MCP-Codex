import { promises as fs } from "node:fs";
import path from "node:path";
import { MapWorkspace } from "../src/modules/map/workspace.js";
import { Workspace } from "../src/core/workspace.js";

const [root, directory = "", destinationDirectory = ".sc2mcp-output/generated-map", output = "generated/map-creation-demo.json"] = process.argv.slice(2);
if (!root) throw new Error("Usage: demo-map-creation.ts workspaceRoot nativeTemplateDirectory [destinationDirectory] [report.json]");
const map = new MapWorkspace(new Workspace(root)), inspected = await map.inspectBlueprint(directory);
if (!inspected.valid) throw new Error(JSON.stringify(inspected.issues));
const id = `native_${inspected.sha256.slice(0, 20)}`;
if (!(await map.listBlueprints()).blueprints.some(b => b.id === id)) await map.registerBlueprint(id, directory, false);
const request = { blueprintId: id, expectedBlueprintSha256: inspected.sha256, destinationDirectory,
  landscape: { style: "desert" as const, seed: 20260914, relief: 0.5, materials: { base: (await map.terrain.palette(directory)).textures.find(t => t.id)?.id } },
  metadataPatch: { fogMaskStyle: "Dark" } };
const preview = await map.create(request), actual = await map.create({ ...request, dryRun: false });
if (preview.contentSha256 !== actual.contentSha256) throw new Error("CREATE_DRY_RUN_MANIFEST_MISMATCH");
const archive = path.join(destinationDirectory, ".sc2mcp-output/Created.SC2Map");
const packed = await map.export(destinationDirectory, archive, false, false);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify({ status: "PASS", template: inspected, preview, actual, packed,
  scope: "Creation from supplied native scenario, authored relief and map metadata, content-verified MPQ export; not a clean-map or Editor/runtime proof" }, null, 2) + "\n");
console.log(JSON.stringify({ status: "PASS", archive: map.workspace.resolveUserPath(archive), changedFiles: actual.changedFiles,
  dryRunManifestMatches: true, editorValidation: "NOT_EXECUTED", runtimeValidation: "NOT_EXECUTED" }, null, 2));
