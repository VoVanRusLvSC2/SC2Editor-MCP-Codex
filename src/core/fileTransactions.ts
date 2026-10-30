import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { withWorkspaceLock } from "./workspaceLock.js";
import { prepareFileJournal, commitFileJournal, discardFileJournal, type FileJournal } from "./recoveryJournal.js";

export interface FileSnapshot { bytes: Buffer; exists: boolean }
export class FileTransactionFailure extends Error {
  readonly code="FILE_TRANSACTION_FAILED";
  readonly causeCode:string|null;
  constructor(readonly state:{written:string[];restored:string[];recoveryRequired:boolean;stagedState:"UNCHANGED_BY_COMMIT"},cause:unknown) {
    const causeCode=(cause as NodeJS.ErrnoException)?.code??null;
    super("FILE_TRANSACTION_FAILED: "+String(cause)+"; code="+(causeCode??"unknown")+"; written="+(state.written.join(',')||'none')+"; restored="+(state.restored.join(',')||'none')+"; recoveryRequired="+state.recoveryRequired+"; staged=unchanged",{cause});
    this.causeCode=causeCode;
  }
}
export class TransactionQueue {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly root?:string,private readonly recover?:() => Promise<unknown>) {}
  run<T>(work: () => Promise<T>): Promise<T> {
    const run = () => this.root ? withWorkspaceLock(this.root,async () => { await this.recover?.(); return work(); }) : work();
    const next = this.pending.then(run, run);
    this.pending = next.catch(() => undefined);
    return next;
  }
}
export async function readSnapshot(file: string): Promise<FileSnapshot> {
  try { return { bytes: await fs.readFile(file), exists: true }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { bytes: Buffer.alloc(0), exists: false }; throw error; }
}
export function decodeUtf8(bytes: Buffer, file: string): string {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) throw new Error(`UNSUPPORTED_TEXT_ENCODING: ${file}; binary/non-UTF8 bytes cannot be edited through XML tools`);
  return text;
}
/** Bounded independent reads; preserve the first mismatch/error in source order.
 * Drain every started read before returning, including failed comparisons.
 */
export async function changedSnapshot(
  resolve: (file: string) => string,
  originals: ReadonlyMap<string, FileSnapshot>,
): Promise<string | undefined> {
  const entries = [...originals];
  for (let offset = 0; offset < entries.length; offset += 4) {
    const chunk = entries.slice(offset, offset + 4);
    const results = await Promise.allSettled(
      chunk.map(async ([file, original]) => {
        const disk = await readSnapshot(resolve(file));
        return disk.exists !== original.exists || !disk.bytes.equals(original.bytes);
      }),
    );
    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      if (result.status === "rejected") throw result.reason;
      if (result.value) return chunk[index][0];
    }
  }
  return undefined;
}

export async function assertSnapshots(
  resolve: (file: string) => string,
  originals: ReadonlyMap<string, FileSnapshot>,
): Promise<void> {
  const changed = await changedSnapshot(resolve, originals);
  if (changed !== undefined) throw new Error(`STALE_FILE_TRANSACTION: ${changed}`);
}

/** Per-file atomic rename with compensation on handled failures; not crash-wide atomicity. */
export async function commitFiles(
  resolve: (file: string) => string,
  originals: ReadonlyMap<string, FileSnapshot>,
  next: ReadonlyMap<string, Buffer>,
  options: { backup?: boolean; backupSuffix?: string; removeFiles?: ReadonlySet<string>; guard?: () => void; verify?: () => Promise<void>; journalRoot?:string } = {},
): Promise<string[]> {
  const removed = options.removeFiles ?? new Set<string>();
  const changed = [...next.keys()].filter(file => removed.has(file) ? originals.get(file)!.exists : !originals.get(file)!.bytes.equals(next.get(file)!) || !originals.get(file)!.exists);
  const temps = new Map<string, string>(), renamed: string[] = [];
  let journal: FileJournal | undefined;
  try {
    await assertSnapshots(resolve, originals); options.guard?.();
    await options.verify?.();
    for (const file of changed) {
      if (removed.has(file)) continue;
      const absolute = resolve(file); await fs.mkdir(path.dirname(absolute), { recursive: true });
      const temporary = `${absolute}.sc2uimcp.${randomUUID()}.tmp`; temps.set(file, temporary);
      await fs.writeFile(temporary, next.get(file)!);
      if(options.journalRoot) { const handle = await fs.open(temporary,"r+"); try { await handle.sync(); } finally { await handle.close(); } }
    }
    if (options.backup ?? true) for (const file of changed) {
      const original = originals.get(file)!;
      if (original.exists) await fs.writeFile(resolve(`${file}${options.backupSuffix ?? ".sc2uimcp.bak"}`), original.bytes);
    }
    await assertSnapshots(resolve, originals); options.guard?.();
    await options.verify?.(); options.guard?.();
    if(options.journalRoot) journal = await prepareFileJournal(options.journalRoot,resolve,originals,new Map(changed.map(file => [file,next.get(file)!])),removed);
    await assertSnapshots(resolve,originals); await options.verify?.(); options.guard?.();
    for (const file of changed) {
      if (removed.has(file)) await fs.unlink(resolve(file)); else await fs.rename(temps.get(file)!, resolve(file));
      renamed.push(file);
    }
    await commitFileJournal(journal);
  } catch (error) {
    const written=[...renamed],restored:string[]=[];
    if(journal?.committed)throw new FileTransactionFailure({written,restored,recoveryRequired:false,stagedState:"UNCHANGED_BY_COMMIT"},error);
    const failures: string[] = [];
    for (const file of [...renamed].reverse()) {
      try {
        const disk = await readSnapshot(resolve(file));
        if (removed.has(file) ? disk.exists : !disk.exists || !disk.bytes.equals(next.get(file)!)) throw new Error("File changed during compensation", { cause: error });
        const original = originals.get(file)!;
        if (original.exists) await fs.writeFile(resolve(file), original.bytes); else if (disk.exists) await fs.unlink(resolve(file));
        restored.push(file);
      } catch (restoreError) { failures.push(file+": "+String(restoreError)); }
    }
    if (failures.length) throw new FileTransactionFailure({written,restored,recoveryRequired:true,stagedState:"UNCHANGED_BY_COMMIT"},new Error("Restoration failed for "+failures.join(", "),{cause:error}));
    try { await discardFileJournal(journal); }
    catch(cleanupError) { throw new FileTransactionFailure({written,restored,recoveryRequired:true,stagedState:"UNCHANGED_BY_COMMIT"},new Error("Journal cleanup failed: "+String(cleanupError),{cause:error})); }
    throw new FileTransactionFailure({written,restored,recoveryRequired:false,stagedState:"UNCHANGED_BY_COMMIT"},error);
  } finally {
    for (const temporary of temps.values()) await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
  return changed;
}
