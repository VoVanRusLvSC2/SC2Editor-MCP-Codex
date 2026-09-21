import { spawn } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { assertSnapshots, readSnapshot } from "../core/fileTransactions.js";
import { requireCutsceneDocumentRegistration } from "../modules/cutscene/documentRegistration.js";

export const archiveMetadataFile = ".sc2mcp-archive.json";
export interface ArchiveEntry {
  name: string; localPath: string; locale: number; flags: number;
  size: number; fileTime: string; internal: boolean;
}
export interface ArchiveManifest {
  protocol: "sc2-mcp-storm-v1"; stormRevision: string; headerOffset: number; entries: ArchiveEntry[];
}
export interface ArchiveOptions { adapter?: string; timeoutMs?: number; backup?: boolean; beforePublish?: () => Promise<void> }
export interface ArchiveOperationResult {
  operation: "extract" | "pack";
  archive: string; componentDirectory: string; backup?: string; adapter: string;
  verification: { entryCount: number; contentSha256: Record<string, string>; reopened: boolean };
}
export interface DirectoryEntry { file: string; size: number; sha256: string }
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export function resolveArchiveAdapter(adapter?: string) {
  const bundled = fileURLToPath(new URL(`../../native/bin/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}/sc2-mcp-archive${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
  const selected = adapter ?? process.env.SC2_UI_ARCHIVE_ADAPTER;
  if(selected) return { path: selected, native: path.resolve(selected) === path.resolve(bundled) };
  if(existsSync(bundled)) return { path: bundled, native: true };
  throw new Error("ARCHIVE_BACKEND_UNAVAILABLE: build the bundled native helper or configure SC2_UI_ARCHIVE_ADAPTER");
}
export function archiveBackendAvailable(): boolean {
  try { return existsSync(resolveArchiveAdapter().path); } catch { return false; }
}
export function safeArchivePath(name: string): string {
  const value = name.replaceAll("\\", "/");
  if(!value || value.startsWith("/") || [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || /[:*?"<>|]/.test(value)) throw new Error(`UNSAFE_ARCHIVE_NAME: ${name}`);
  if(value.split("/").some(p => !p || p === "." || p === ".." || /[. ]$/.test(p) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p))) throw new Error(`UNSAFE_ARCHIVE_NAME: ${name}`);
  return value;
}
function toolFile(file: string): boolean {
  return file.split("/").some(part => part.includes(".sc2uimcp.") || (part.startsWith(".sc2mcp-") && part !== ".sc2mcp-locales"));
}
function assertArchive(file: string): void {
  if(!/\.(?:SC2Map|SC2Mod)$/i.test(file)) throw new Error("Archive path must end in .SC2Map or .SC2Mod");
}
async function assertMissing(file: string) {
  try { await fs.lstat(file); } catch(e) { if((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
  throw new Error(`DESTINATION_EXISTS: ${file}`);
}
async function runAdapter(adapter: string, args: string[], timeoutMs = 15 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(adapter, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", failed = false;
    const timer = setTimeout(() => { failed = true; child.kill(); reject(new Error("ARCHIVE_ADAPTER_TIMEOUT")); }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      if(stdout.length > 16 * 1024 * 1024) { failed = true; child.kill(); reject(new Error("ARCHIVE_ADAPTER_OUTPUT_LIMIT")); }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-65536); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      if(failed) return;
      if(code !== 0) reject(new Error(`Archive adapter exited with ${code}: ${stderr.slice(0, 4000)}`));
      else resolve(stdout);
    });
  });
}
function parseManifest(text: string): ArchiveManifest {
  const m = JSON.parse(text) as ArchiveManifest;
  if(m.protocol !== "sc2-mcp-storm-v1" || !Array.isArray(m.entries) || m.entries.length > 100000 || !Number.isSafeInteger(m.headerOffset)) throw new Error("INVALID_ARCHIVE_MANIFEST");
  const seen = new Set<string>();
  for(const e of m.entries) {
    if(typeof e.name !== "string" || typeof e.localPath !== "string" || typeof e.fileTime !== "string" || !/^\d{1,20}$/.test(e.fileTime) || BigInt(e.fileTime) > 0xffffffffffffffffn || typeof e.internal !== "boolean") throw new Error("INVALID_ARCHIVE_ENTRY");
    safeArchivePath(e.name); safeArchivePath(e.localPath);
    for(const value of [e.locale, e.flags, e.size]) if(!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error("INVALID_ARCHIVE_ENTRY");
    const expectedLocal = (e.locale ? `.sc2mcp-locales/${e.locale}/` : "") + safeArchivePath(e.name);
    const expectedInternal = ["(listfile)", "(attributes)", "(signature)"].includes(e.name);
    if(e.localPath !== expectedLocal || e.internal !== expectedInternal || (!e.internal && toolFile(safeArchivePath(e.name)))) throw new Error("INVALID_ARCHIVE_STORAGE_PATH");
    const key = e.localPath.toLowerCase(); if(seen.has(key)) throw new Error("ARCHIVE_NAME_COLLISION"); seen.add(key);
  }
  return m;
}
export async function inspectArchive(archive: string, options: ArchiveOptions = {}): Promise<ArchiveManifest> {
  const source = path.resolve(archive); assertArchive(source);
  if(!(await fs.lstat(source)).isFile()) throw new Error("ARCHIVE_SOURCE_NOT_FILE");
  const adapter = resolveArchiveAdapter(options.adapter);
  if(!adapter.native) throw new Error("ARCHIVE_INSPECTION_REQUIRES_NATIVE_BACKEND");
  return parseManifest(await runAdapter(adapter.path, ["inspect", source], options.timeoutMs));
}
/** Hashes and pins the complete eligible tree, excluding only known tool/internal files. */
export async function directoryManifest(root: string): Promise<DirectoryEntry[]> {
  const result: DirectoryEntry[] = [], seen = new Set<string>(); let total = 0;
  if(!(await fs.lstat(root)).isDirectory()) throw new Error("COMPONENT_ROOT_NOT_DIRECTORY");
  const walk = async (relative: string) => {
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
    for(const e of entries.sort((a,b) => a.name.localeCompare(b.name))) {
      const file = relative ? `${relative}/${e.name}` : e.name;
      if(toolFile(file) || ["(listfile)", "(attributes)", "(signature)"].includes(file)) continue;
      safeArchivePath(file);
      const stat = await fs.lstat(path.join(root, file));
      if(stat.isSymbolicLink()) throw new Error(`ARCHIVE_SYMLINK: ${file}`);
      if(stat.isDirectory()) await walk(file);
      else if(stat.isFile()) {
        total += stat.size;
        if(stat.size > 512 * 1024 * 1024 || total > 4 * 1024 * 1024 * 1024 || result.length >= 100000) throw new Error("ARCHIVE_SIZE_LIMIT");
        const key = file.toLowerCase(); if(seen.has(key)) throw new Error("ARCHIVE_NAME_COLLISION"); seen.add(key);
        const bytes = await fs.readFile(path.join(root, file));
        if(bytes.length !== stat.size) throw new Error(`STALE_ARCHIVE_SOURCE: ${file}`);
        result.push({ file, size: bytes.length, sha256: hash(bytes) });
      } else throw new Error(`ARCHIVE_SPECIAL_FILE: ${file}`);
    }
  };
  await walk(""); return result.sort((a,b) => a.file.localeCompare(b.file));
}
function assertManifestEqual(a: DirectoryEntry[], b: DirectoryEntry[], code: string) {
  if(JSON.stringify(a) !== JSON.stringify(b)) throw new Error(code);
}
async function metadata(root: string) {
  const snapshot = await readSnapshot(path.join(root, archiveMetadataFile));
  if(snapshot.exists && (await fs.lstat(path.join(root, archiveMetadataFile))).isSymbolicLink()) throw new Error("ARCHIVE_METADATA_SYMLINK");
  return { snapshot, manifest: snapshot.exists ? parseManifest(snapshot.bytes.toString("utf8")) : undefined };
}
async function extractTo(adapter: { path: string; native: boolean }, source: string, destination: string, timeoutMs?: number) {
  const stdout = await runAdapter(adapter.path, ["extract", source, destination], timeoutMs);
  const manifest = adapter.native ? parseManifest(stdout) : undefined;
  const files = await directoryManifest(destination);
  if(manifest) {
    const records = manifest.entries.filter(e => !e.internal);
    const indexed = new Map(files.map(f => [f.file,f]));
    if(records.length !== files.length || records.some(e => indexed.get(e.localPath)?.size !== e.size)) throw new Error("ARCHIVE_EXTRACTION_INCOMPLETE");
    await fs.writeFile(path.join(destination, archiveMetadataFile), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  }
  return { files, manifest };
}
export async function extractArchive(archive: string, componentDirectory: string, options: ArchiveOptions = {}): Promise<ArchiveOperationResult> {
  const source = path.resolve(archive), destination = path.resolve(componentDirectory), adapter = resolveArchiveAdapter(options.adapter);
  assertArchive(source);
  if(!(await fs.lstat(source)).isFile()) throw new Error("Archive source must be a packed file");
  const original = await readSnapshot(source);
  await assertMissing(destination); await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = await fs.mkdtemp(`${destination}.sc2uimcp.`);
  try {
    const { files } = await extractTo(adapter, source, temporary, options.timeoutMs);
    await assertSnapshots(file => file, new Map([[source, original]]));
    await assertMissing(destination); await fs.rename(temporary, destination);
    return { operation: "extract", archive: source, componentDirectory: destination, adapter: adapter.path,
      verification: { entryCount: files.length, contentSha256: Object.fromEntries(files.map(f => [f.file,f.sha256])), reopened: false } };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
export async function packArchive(componentDirectory: string, archive: string, options: ArchiveOptions = {}): Promise<ArchiveOperationResult> {
  const source = path.resolve(componentDirectory), destination = path.resolve(archive), adapter = resolveArchiveAdapter(options.adapter);
  assertArchive(destination);
  const relative = path.relative(source, destination);
  if(relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("ARCHIVE_OUTPUT_INSIDE_SOURCE");
  const files = await directoryManifest(source), meta = await metadata(source);
  if(!files.length) throw new Error("EMPTY_COMPONENT_DIRECTORY");
  await requireCutsceneDocumentRegistration(source, files);
  if(!adapter.native && files.some(f => f.file.startsWith(".sc2mcp-locales/"))) throw new Error("LOCALE_PACK_REQUIRES_NATIVE_BACKEND");
  const metadataIndex = new Map(meta.manifest?.entries.filter(e => !e.internal).map(e => [e.localPath,e]));
  const records = files.map(f => {
    const known = metadataIndex.get(f.file);
    if(f.file.startsWith(".sc2mcp-locales/") && !known) throw new Error("UNTRACKED_ARCHIVE_LOCALE_ENTRY");
    return { ...f, name: known?.name ?? f.file, locale: known?.locale ?? 0, flags: known?.flags ?? 0, time: known?.fileTime ?? "0" };
  });
  const original = await readSnapshot(destination);
  if(original.exists && !(await fs.lstat(destination)).isFile()) throw new Error("ARCHIVE_DESTINATION_NOT_FILE");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const outputRoot = await fs.mkdtemp(path.join(path.dirname(destination), ".sc2mcp-export-"));
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "sc2mcp-pack-"));
  const packed = path.join(outputRoot, "result.SC2Map"), snapshot = path.join(staging,"source"), reopened = path.join(staging,"reopened");
  let backup: string | undefined;
  try {
    await fs.mkdir(snapshot); await fs.mkdir(reopened);
    for(const f of files) { await fs.mkdir(path.dirname(path.join(snapshot,f.file)), { recursive: true }); await fs.copyFile(path.join(source,f.file),path.join(snapshot,f.file)); }
    assertManifestEqual(files, await directoryManifest(snapshot), "STALE_ARCHIVE_SOURCE_DURING_SNAPSHOT");
    const plan = path.join(staging,"entries.tsv");
    await fs.writeFile(plan, records.map(f => [f.name,f.file,f.locale,f.flags,f.time].join("\t")).join("\n") + "\n");
    await runAdapter(adapter.path, ["pack",snapshot,packed,...(adapter.native ? [plan] : [])], options.timeoutMs);
    if(!(await fs.stat(packed)).isFile() || !(await fs.stat(packed)).size) throw new Error("EMPTY_PACKED_ARCHIVE");
    const verified = await extractTo(adapter,packed,reopened,options.timeoutMs);
    assertManifestEqual(files,verified.files,"ARCHIVE_CONTENT_VERIFICATION_FAILED");
    if(verified.manifest) {
      const identities = new Set(verified.manifest.entries.filter(e => !e.internal).map(e => `${safeArchivePath(e.name).toLowerCase()}:${e.locale}`));
      if(records.some(r => !identities.has(`${safeArchivePath(r.name).toLowerCase()}:${r.locale}`))) throw new Error("ARCHIVE_ENTRY_IDENTITY_CHANGED");
    }
    assertManifestEqual(files,await directoryManifest(source),"STALE_ARCHIVE_SOURCE");
    await assertSnapshots(file => file,new Map([[destination,original],[path.join(source,archiveMetadataFile),meta.snapshot]]));
    await options.beforePublish?.();
    if(original.exists && (options.backup ?? true)) { backup = `${destination}.sc2uimcp.bak`; await fs.writeFile(backup,original.bytes); }
    await assertSnapshots(file => file,new Map([[destination,original]]));
    await options.beforePublish?.();
    await fs.rename(packed,destination);
    return { operation: "pack",archive: destination,componentDirectory: source,adapter: adapter.path,backup,
      verification: { entryCount: files.length,contentSha256: Object.fromEntries(files.map(f => [f.file,f.sha256])),reopened: true } };
  } finally { await fs.rm(staging,{ recursive:true,force:true }); await fs.rm(outputRoot,{ recursive:true,force:true }); }
}
