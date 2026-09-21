import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Workspace } from "../src/core/workspace.js";
import { BrowseWorkspace } from "../src/modules/browse/workspace.js";
import { DataWorkspace } from "../src/modules/data/workspace.js";
import { PlacementWorkspace } from "../src/modules/placement/workspace.js";
import { PlacementDocument } from "../src/modules/placement/document.js";

// Explicit source paths must be UNPACKED map/component directories. Every run
// copies them; this script never mutates the supplied source or an MPQ archive.
const source = path.resolve(process.argv[2] ?? "src/tests/fixtures/browse-placement-map");
if (!(await fs.stat(source)).isDirectory()) throw new Error("Source must be a component directory; use the configured archive adapter first");
const fixture = !process.argv[2];
const parent = path.resolve("examples/browse-placement/runs"); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, "demo-")); await fs.cp(source, root, { recursive: true });
const workspace = new Workspace(root); const browse = new BrowseWorkspace(workspace, new DataWorkspace(workspace)); const placement = new PlacementWorkspace(workspace, browse);
const originalObjects = (await workspace.readRaw("Objects")).text;
const dependencies = await browse.dependencies();
const units = await browse.search({ query: "Marine", catalogType: "Unit", placeable: true, limit: 10 });
const unit = units.results.find((entry) => ["MAP_LOCAL", "AVAILABLE_THROUGH_DEPENDENCY"].includes(entry.availability));
if (!unit) throw new Error("No dependency-ready Unit found by the Marine query");
const decorSearches = await Promise.all(["tree", "rock", "plant", "light"].map((query) => browse.search({ query, objectKind: "Doodad", placeable: true, limit: 10 })));
const decor = decorSearches.flatMap((result) => result.results).find((entry) => ["MAP_LOCAL", "AVAILABLE_THROUGH_DEPENDENCY"].includes(entry.availability));
if (!decor) throw new Error("No dependency-ready decoration found through browse");
const chains = { unit: await browse.related({ key: unit.key, depth: 3 }), doodad: await browse.related({ key: decor.key, depth: 2 }) };
const unitPlan = await placement.addUnit({ key: unit.key, position: { x: 30, y: 40, z: 0 }, owner: 1, count: 4, layout: { type: "line", spacing: 2 }, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } });
const unitPreview = await placement.preview(unitPlan.id); const unitDryRun = await placement.apply(unitPlan.id);
if ((await workspace.readRaw("Objects")).text !== originalObjects) throw new Error("Dry-run mutated Objects");
const unitApply = await placement.apply(unitPlan.id, { dryRun: false, stage: false, backup: true });
const location = await placement.createLocation({ locationType: "custom", queries: [decor.id], area: { type: "circle", center: { x: 65, y: 65, z: 0 }, radius: 15 }, objectCount: 20, seed: 1234, minimumDistance: 1.5, scaleRange: { min: 0.85, max: 1.15 }, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } });
const locationPreview = await placement.preview(location.plan.id); const locationDryRun = await placement.apply(location.plan.id);
const locationApply = await placement.apply(location.plan.id, { dryRun: false, stage: false, backup: true });
const after = (await workspace.readRaw("Objects")).text;
const objects = new PlacementDocument(after);
const originalPreserved = originalObjects ? new PlacementDocument(originalObjects).list().every((object) => objects.list().some((entry) => JSON.stringify(entry.attributes) === JSON.stringify(object.attributes) && JSON.stringify(entry.flags) === JSON.stringify(object.flags))) : true;
const result = { version: "1.1.0-alpha.6", source, map: root, evidenceTier: fixture ? "SYNTHETIC_FIXTURE_NOT_A_REAL_MAP" : "USER_SUPPLIED_COMPONENT_DIRECTORY", dependencies, search: { units, decorSearches }, chains, unitPreview, unitDryRun, unitApply, location, locationPreview, locationDryRun, locationApply, scan: await placement.scan(), validation: { xml: objects.validate().length ? "FAIL" : "PASS", reparse: "PASS", originalObjectAttributesAndFlagsPreserved: originalPreserved, editorOpen: "NOT_EXECUTED", editorSave: "NOT_EXECUTED", visual: "NOT_EXECUTED", runtime: "NOT_EXECUTED", originalSourceSha256: createHash("sha256").update(originalObjects).digest("hex") } };
const report = path.join(root, "DEMONSTRATION.json"); await fs.writeFile(report, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ map: root, report, validation: result.validation }, null, 2));
