import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { discoverEditorPe, extractAsciiStrings, extractUtf16Strings } from "../src/modules/cutscene/peDiscovery.js";

const exe = process.argv[2];
if (!exe) throw new Error("Pass the actual SC2Editor EXE path; this read-only scan does not decompile or overwrite the existing registries");
const bytes = await fs.readFile(exe); const discovery = await discoverEditorPe(exe);
const vocabulary = ["PlacedObjects", "ObjectUnit", "ObjectDoodad", "UnitType", "Position", "Rotation", "Scale", "Variation", "Player", "HeightAbsolute", "CActorDoodad"];
const strings = [...extractAsciiStrings(bytes), ...extractUtf16Strings(bytes)];
const report = { executable: exe, sha256: createHash("sha256").update(bytes).digest("hex"), build: discovery.build,
  decompilation: "NOT_AVAILABLE_LOCALLY", evidence: vocabulary.map((term) => ({ term, exactStrings: strings.filter((entry) => entry.text === term).map((entry) => ({ fileOffset: entry.fileOffset, encoding: entry.encoding })), classification: strings.some((entry) => entry.text === term) ? "PROVEN_BY_EXE: VOCABULARY_ONLY" : "NOT_FOUND_AS_EXACT_STRING", doesNotProve: "serialization, coordinate units, required fields or runtime placement" })),
  formatBasis: "/workspace/scratch/0f9999397929/research/sc2-map-editor-mcp/packages/sc2-core/src/mapdata/objects.ts (secondary local reference)",
  realMapPlacementRoundtrip: "NOT_EXECUTED", editorOpen: "NOT_EXECUTED", editorSave: "NOT_EXECUTED", runtime: "NOT_EXECUTED" };
await fs.writeFile("generated/browse-placement-evidence.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ executable: exe, sha256: report.sha256, version: discovery.build.fileVersion, vocabulary: report.evidence.map((entry) => ({ term: entry.term, matches: entry.exactStrings.length })), report: "generated/browse-placement-evidence.json" }, null, 2));
