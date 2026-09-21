import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parsePe, extractAsciiStrings, extractUtf16Strings, attachAddresses } from "../src/modules/cutscene/peDiscovery.js";

const [editor, game, output = "generated/map-executable-analysis.json"] = process.argv.slice(2);
if (!editor || !game) throw new Error("Usage: analyze-map-executables.ts editor.exe game.exe [output.json]");
function entropy(bytes: Buffer) {
  const counts = new Uint32Array(256); for (const b of bytes) counts[b]++;
  let value = 0; for (const count of counts) if (count) { const p = count / bytes.length; value -= p * Math.log2(p); }
  return value;
}
const analyses = [];
for (const file of [editor, game]) {
  const bytes = await fs.readFile(file), pe = parsePe(bytes);
  const records = [...extractAsciiStrings(bytes), ...extractUtf16Strings(bytes)].filter(r =>
    /^(?:t3(?:Terrain|Height|Sync|Texture|Water|Hard|Cell|Vert|Fluff)|PaintedPathingLayer|quantizeBias|quantizeScale|standardHeight)$|TerrainCreate|TerrainCliff|TerrainRamp|TerrainPathing/.test(r.text));
  attachAddresses(records, bytes, pe.imageBase, pe.sections);
  const text = pe.sections.find(s => s.name === ".text");
  const samples = text ? [0, Math.floor(text.rawSize / 2), Math.max(0, text.rawSize - 65536)].map(offset => ({
    fileOffset: text.rawOffset + offset, entropyBitsPerByte: entropy(bytes.subarray(text.rawOffset + offset, text.rawOffset + Math.min(text.rawSize, offset + 65536))),
  })) : [];
  const addresses = [...new Set([pe.entryPoint, ...(text ? [text.virtualAddress] : [])])];
  const disassembly = addresses.map(rva => {
    const address = pe.imageBase + BigInt(rva);
    try {
      const value = execFileSync("objdump", ["-d", "-M", "intel", `--start-address=0x${address.toString(16)}`, `--stop-address=0x${(address + 192n).toString(16)}`, path.resolve(file)], { encoding: "utf8", maxBuffer: 1024 * 1024 });
      return { rva, status: "EXECUTED", invalidInstructions: value.split("\n").filter(line => line.includes("(bad)")).length, text: value };
    } catch { return { rva, status: "NOT_EXECUTED", reason: "objdump unavailable or disassembly failed" }; }
  });
  analyses.push({ executable: path.basename(file), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    architecture: pe.architecture, imageBase: `0x${pe.imageBase.toString(16)}`, entryPointRva: pe.entryPoint, sections: pe.sections,
    textEntropySamples: samples, terrainRecords: records, directStringXrefs: records.reduce((n, r) => n + r.xrefRvas.length, 0), disassembly,
    decompiledBusinessLogic: false, executableRun: false,
    limitations: ["High entropy/invalid instructions can indicate encoded or protected code; the mechanism is not identified", "No decoded memory image, recovered terrain writer or proof of engine semantics is produced", "String evidence does not authorize guessed native records"] });
}
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify({ scope: "Read-only paired PE and bounded disassembly analysis", analyses }, null, 2) + "\n");
console.log(JSON.stringify(analyses.map(a => ({ executable: a.executable, sha256: a.sha256, directStringXrefs: a.directStringXrefs, textEntropySamples: a.textEntropySamples, disassembly: a.disassembly.map(d => ({ rva: d.rva, status: d.status, invalidInstructions: d.invalidInstructions })), decompiledBusinessLogic: false })), null, 2));
