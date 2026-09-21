import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { FileSnapshot } from "./fileTransactions.js";

interface JournalEntry { file:string; originalExists:boolean; afterExists:boolean; originalSha256:string; afterSha256:string; before:string }
interface JournalManifest { version:1; state:"prepared"|"committed"; entries:JournalEntry[] }
export interface FileJournal { root:string; directory:string; manifest:JournalManifest; committed:boolean }
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function durable(file: string, bytes: Buffer | string) {
  const handle = await fs.open(file,"wx");
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function noSymlink(file: string) {
  try { if((await fs.lstat(file)).isSymbolicLink()) throw new Error("JOURNAL_SYMLINK"); }
  catch(e) { if((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
}
async function cleanup(journal: FileJournal) {
  await fs.rm(journal.directory,{ recursive:true,force:true });
  await fs.rmdir(journal.root).catch(e => { if(!["ENOENT","ENOTEMPTY","EEXIST"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e; });
}
async function manifestWrite(journal: FileJournal, manifest: JournalManifest) {
  const temporary = path.join(journal.directory,`manifest-${randomUUID()}.tmp`);
  await durable(temporary,JSON.stringify(manifest)+"\n");
  await fs.rename(temporary,path.join(journal.directory,"manifest.json"));
  journal.manifest = manifest; journal.committed = manifest.state === "committed";
}
export async function prepareFileJournal(root: string, resolve: (file:string) => string, originals: ReadonlyMap<string,FileSnapshot>, next: ReadonlyMap<string,Buffer>, removed: ReadonlySet<string>): Promise<FileJournal | undefined> {
  if(!next.size) return undefined;
  const journalRoot = path.join(root,".sc2mcp-journal"); await noSymlink(journalRoot); await fs.mkdir(journalRoot,{ recursive:true });
  const directory = await fs.mkdtemp(path.join(journalRoot,"commit-"));
  const journal: FileJournal = { root:journalRoot,directory,manifest:{ version:1,state:"prepared",entries:[] },committed:false };
  try {
    for(const [file,bytes] of next) {
      const relative = path.relative(root,resolve(file)).replaceAll("\\","/");
      if(!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative) || relative.split("/").some(p => p.startsWith(".sc2mcp-"))) throw new Error("INVALID_JOURNAL_TARGET");
      const original = originals.get(file)!;
      const before = `${journal.manifest.entries.length}.before`;
      await durable(path.join(directory,before),original.bytes);
      journal.manifest.entries.push({ file:relative,originalExists:original.exists,afterExists:!removed.has(file),originalSha256:hash(original.bytes),afterSha256:hash(bytes),before });
    }
    await manifestWrite(journal,journal.manifest); return journal;
  } catch(e) { await cleanup(journal); throw e; }
}
export async function commitFileJournal(journal?: FileJournal) {
  if(!journal) return;
  await manifestWrite(journal,{ ...journal.manifest,state:"committed" });
  // A committed journal left by a cleanup failure is safe to collect on restart.
  await cleanup(journal).catch(() => undefined);
}
export async function discardFileJournal(journal?: FileJournal) { if(journal) await cleanup(journal); }

/** Called only while holding the workspace process lock. Preflight all targets
 * before restoration; unknown external content is never overwritten.
 */
export async function recoverFileJournals(root: string, resolve: (file:string) => string) {
  const journalRoot = path.join(root,".sc2mcp-journal"); await noSymlink(journalRoot);
  let directories;
  try { directories = await fs.readdir(journalRoot,{ withFileTypes:true }); }
  catch(e) { if((e as NodeJS.ErrnoException).code === "ENOENT") return { recovered:0 }; throw e; }
  let recovered = 0;
  for(const item of directories.sort((a,b) => a.name.localeCompare(b.name))) {
    if(!item.isDirectory() || item.isSymbolicLink() || !/^commit-[a-zA-Z0-9_-]+$/.test(item.name)) throw new Error("INVALID_RECOVERY_JOURNAL_DIRECTORY");
    const directory = path.join(journalRoot,item.name), manifestFile = path.join(directory,"manifest.json");
    await noSymlink(manifestFile);
    let bytes;
    try { bytes = await fs.readFile(manifestFile); }
    catch(e) {
      if((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      // No manifest means prepare was interrupted before the first target rename.
      await fs.rm(directory,{ recursive:true,force:true }); continue;
    }
    if(bytes.length > 1024*1024) throw new Error("INVALID_RECOVERY_JOURNAL_SIZE");
    const manifest = JSON.parse(bytes.toString("utf8")) as JournalManifest;
    if(manifest.version !== 1 || !["prepared","committed"].includes(manifest.state) || !Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > 64) throw new Error("INVALID_RECOVERY_JOURNAL");
    const journal = { root:journalRoot,directory,manifest,committed:manifest.state === "committed" };
    const seen = new Set<string>();
    const originals: Array<{ target:string; bytes:Buffer; exists:boolean }> = [];
    for(const entry of manifest.entries) {
      if(typeof entry.file !== "string" || !entry.file || entry.file.includes("\\") || entry.file.split("/").some(p => !p || p === "." || p === ".." || p.startsWith(".sc2mcp-")) || path.isAbsolute(entry.file) || !/^\d+\.before$/.test(entry.before) || !/^[a-f0-9]{64}$/.test(entry.originalSha256) || !/^[a-f0-9]{64}$/.test(entry.afterSha256) || typeof entry.originalExists !== "boolean" || typeof entry.afterExists !== "boolean" || seen.has(entry.file)) throw new Error("INVALID_RECOVERY_ENTRY");
      seen.add(entry.file); const target = resolve(entry.file);
      if(journal.committed) continue;
      const before = path.join(directory,entry.before); await noSymlink(before);
      const original = await fs.readFile(before); if(hash(original) !== entry.originalSha256) throw new Error("RECOVERY_ORIGINAL_HASH_MISMATCH");
      let disk = Buffer.alloc(0), exists = true;
      try { disk = await fs.readFile(target); } catch(e) { if((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; exists=false; }
      const diskHash = hash(disk);
      const unchanged = exists === entry.originalExists && diskHash === entry.originalSha256;
      const written = exists === entry.afterExists && (!exists || diskHash === entry.afterSha256);
      if(!unchanged && !written) throw new Error(`RECOVERY_CONFLICT: ${entry.file}; external content preserved`);
      originals.push({ target,bytes:original,exists:entry.originalExists });
    }
    for(const original of originals) {
      if(!original.exists) { await fs.rm(original.target,{ force:true }); continue; }
      await fs.mkdir(path.dirname(original.target),{ recursive:true });
      const temporary = `${original.target}.sc2uimcp.recover.${randomUUID()}.tmp`;
      await durable(temporary,original.bytes); await fs.rename(temporary,original.target);
    }
    if(!journal.committed) recovered++;
    await cleanup(journal);
  }
  await fs.rmdir(journalRoot).catch(e => { if(!["ENOENT","ENOTEMPTY"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e; });
  return { recovered };
}
