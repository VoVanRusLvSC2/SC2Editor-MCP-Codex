import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  extractAsciiStrings,
  extractUtf16Strings,
  parsePe,
  attachAddresses,
} from "../src/modules/cutscene/peDiscovery.js";
const exe = process.argv[2];
if (!exe)
  throw new Error(
    "Usage: discover-terrain-editor.ts SC2Editor_x64.exe [output.json]",
  );
const bytes = await fs.readFile(exe),
  pe = parsePe(bytes);
const records = [
  ...extractAsciiStrings(bytes),
  ...extractUtf16Strings(bytes),
].filter((r) =>
  /^t3(?:Terrain|Height|Sync|Texture|Water|Hard|Cell|Vert|Fluff)|^Terrain|CTerrain|EDSTR_TERRAIN|quantizeBias|quantizeScale|standardHeight/.test(
    r.text,
  ),
);
attachAddresses(records, bytes, pe.imageBase, pe.sections);
const result = {
  executable: path.basename(exe),
  sha256: createHash("sha256").update(bytes).digest("hex"),
  architecture: pe.architecture,
  records,
  count: records.length,
  evidence:
    "EXE strings, addresses and candidate cross-references; NOT recovered serialization/business logic",
  writerStatus: {
    height: "reference-supported + native corpus",
    textures: "reference-supported + native corpus",
    water: "existing v110 entry cloning only",
    cliffs: "not recovered",
    ramps: "not recovered",
    pathing: "not recovered",
  },
};
await fs.writeFile(
  process.argv[3] ?? "generated/terrain-editor-evidence.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    sha256: result.sha256,
    records: records.length,
    recordsWithXrefs: records.filter((r) => r.xrefRvas.length).length,
  }),
);
