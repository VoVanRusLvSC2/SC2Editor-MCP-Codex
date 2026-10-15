// Copyright (c) 2026, VoVanRusLvSC2 <vladimir.lencmanis@gmail.com>
// SPDX-License-Identifier: LicenseRef-SC2Editor-MCP-Attribution-1.0
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(await fs.readFile(path.join(root, "publication-policy.json"), "utf8"));
const output = path.join(root, "work", "publication", "audit.json");
const roots = new Set(policy.rootFiles);
const docs = new Set(policy.documentation.map(name => `docs/${name}`));
const generated = new Set(policy.runtimeGeneratedFiles.map(name => `generated/${name}`));
const inDirectory = (file, directories) => directories.some(dir => file.startsWith(dir));
const entry = (category, reason) => ({ category, reason });

function classify(file) {
  if (inDirectory(file, policy.localDirectories) || /(^|\/)(node_modules|__pycache__|\.git|build|CMakeFiles)\//.test(file))
    return entry("local", "Local outputs, fixtures, inputs or build/cache directory");
  if (/\.(exe|dll|lib|exp|obj|o|a|pdb|dmp|zip|7z|mpq|sc2map|sc2mod|sc2data|m3|m3a|dds|fxa|fxe|mp3|ogg|wav|png|jpg|jpeg|webp|gz|log|tap|tsbuildinfo|pyc)$/i.test(file))
    return entry("local", "Binary/input asset or auxiliary evidence; not part of this source proposal");
  if (/\.txt$/i.test(file) && !roots.has(file) && !docs.has(file) && !file.startsWith("native/vendor/") && !file.startsWith("vendor/blizzard-models/") && !/(^|\/)(CMakeLists\.txt|[^/]*(?:LICENSE|COPYING|NOTICE|COPYRIGHT)[^/]*)$/i.test(file))
    return entry("local", "Auxiliary TXT; required license and CMake files are retained separately");
  if (roots.has(file) || docs.has(file)) return entry("candidate", "Project metadata, notices or current usage documentation");
  if (file.startsWith("schema/")) return entry("review", "Required upstream schema/provenance: redistribution scope needs review");
  if (generated.has(file) || inDirectory(file, policy.runtimeGeneratedDirectories.map(dir => `generated/${dir}`))) {
    if (/^generated\/(o200k_base\.(tiktoken|sha256)|TIKTOKEN_LICENSE\.txt)$/.test(file))
      return entry("candidate", "Runtime tokenizer vocabulary and supplied MIT notice");
    return entry("review", "Required SC2 runtime registry: preserve provenance and review data rights");
  }
  if (file.startsWith("vendor/blizzard-models/"))
    return entry("review", "Required GPL model renderer: retain sources/notices; corresponding-source and research scope unresolved");
  if (/^src\/modules\/terrain\/surface\/(core|format)\//.test(file))
    return entry("review", "Imported Surface Toolkit implementation: redistribution license not established");
  if (file === "tests/terrain-surface/observations.json")
    return entry("review", "Imported third-party observations: preserve provenance and review scope");
  if (file.startsWith("native/")) return entry("candidate", "Native backend source, pinned library source or retained upstream notice");
  if (inDirectory(file, policy.sourceDirectories))
    return entry("candidate", "Source or source test; candidate status is not a rights/secret clearance");
  return entry("local", "Outside explicit source/runtime/documentation whitelist");
}

const records = [];
const skippedDirectories = [];
async function visit(directory = "") {
  for (const item of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = directory ? `${directory}/${item.name}` : item.name;
    if (item.isSymbolicLink()) {
      records.push({ file, bytes: 0, ...entry("local", "Symlink not followed") });
    } else if (item.isDirectory()) {
      const dir = `${file}/`;
      if (inDirectory(dir, policy.localDirectories) || /(^|\/)(node_modules|__pycache__|\.git|build|CMakeFiles)\/$/.test(dir))
        skippedDirectories.push(dir);
      else await visit(file);
    } else if (item.isFile()) {
      records.push({ file, bytes: (await fs.stat(path.join(root, file))).size, ...classify(file) });
    }
  }
}
await visit();
records.sort((a, b) => a.file.localeCompare(b.file, "en"));
const required = [...policy.rootFiles, ...generated, "generated/data-xsd-index/manifest.json",
  "vendor/blizzard-models/LICENSE-GPL-2.0.txt", "vendor/blizzard-models/browser/material-bundle.js",
  "vendor/blizzard-models/dist/m3/native/model.js", "vendor/blizzard-models/src/m3/native/structures.xml",
  "native/vendor/StormLib/LICENSE", "native/casc/LICENSE-CascLib.txt"];
const missingRequiredFiles = [];
for (const file of required) {
  try { await fs.access(path.join(root, file)); } catch { missingRequiredFiles.push(file); }
}
let trackedLocalFiles = [];
let gitInventoryError;
try {
  trackedLocalFiles = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    .split("\0").filter(Boolean).filter(file => classify(file).category === "local");
} catch (error) { gitInventoryError = error.message; }
const summary = Object.fromEntries(["candidate", "review", "local"].map(category => {
  const files = records.filter(record => record.category === category);
  return [category, { files: files.length, bytes: files.reduce((sum, record) => sum + record.bytes, 0) }];
}));
const report = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), purpose: policy.purpose,
  readyForPublicPush: policy.publicationHolds.length === 0 && missingRequiredFiles.length === 0 && !gitInventoryError && trackedLocalFiles.length === 0,
  publicationHolds: policy.publicationHolds, missingRequiredFiles, summary,
  skippedDirectories, trackedLocalFiles, ...(gitInventoryError ? { gitInventoryError } : {}),
  limitations: ["Candidate is an inventory classification, not legal or secret clearance", "No past Git history audit", "Private fixtures excluded; full local test suite may need them", "No staging, source edits, deletion, copying or publishing performed"],
  files: records
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ output, readyForPublicPush: report.readyForPublicPush, summary, missingRequiredFiles, trackedLocalFiles: trackedLocalFiles.length, holds: policy.publicationHolds.map(hold => hold.id) }, null, 2)}\n`);
if (missingRequiredFiles.length || gitInventoryError) process.exitCode = 1;
