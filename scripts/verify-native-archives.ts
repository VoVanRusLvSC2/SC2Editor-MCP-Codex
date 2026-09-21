import { promises as fs } from "node:fs";
import path from "node:path";
import { directoryManifest, extractArchive, inspectArchive, packArchive } from "../src/archive/archiveAdapter.js";

const input = path.resolve(process.argv[2] ?? "inputs"), output = path.resolve(process.argv[3] ?? "generated/archive-verification");
await fs.mkdir(output, { recursive: true });
const results = [];
for(const name of (await fs.readdir(input)).filter(n => /\.SC2Map$/i.test(n)).sort()) {
  const root = path.join(output, name.replace(/[^a-zA-Z0-9_-]/g,"_"));
  await fs.mkdir(root, { recursive: true });
  const original = path.join(input,name), componentDirectory = path.join(root,"components"), repacked = path.join(root,"repacked.SC2Map");
  const manifest = await inspectArchive(original);
  const extracted = await extractArchive(original,componentDirectory);
  const packed = await packArchive(componentDirectory,repacked,{ backup:false });
  const reopened = await inspectArchive(repacked);
  const files = await directoryManifest(componentDirectory);
  const result = { source:name, originalEntries:manifest.entries.length, reopenedEntries:reopened.entries.length,
    userEntries:files.length, localeEntries:manifest.entries.filter(e => e.locale !== 0).length,
    extracted:extracted.verification.entryCount, verification:packed.verification,
    editorValidation:"NOT_EXECUTED",runtimeValidation:"NOT_EXECUTED" };
  results.push(result); console.log(`${name}: ${files.length} user entries verified`);
}
if(!results.length) throw new Error("NO_NATIVE_MAPS");
await fs.writeFile(path.join(output,"report.json"),JSON.stringify({ date:new Date().toISOString(),results },null,2) + "\n");
