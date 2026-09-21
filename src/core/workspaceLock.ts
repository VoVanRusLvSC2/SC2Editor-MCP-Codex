import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

interface Owner { pid:number; nonce:string }
async function owner(file: string): Promise<Owner | undefined> {
  try {
    const stat = await fs.lstat(file);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error("INVALID_WORKSPACE_LOCK");
    if(stat.size === 0) return undefined; // Another process may be initializing its exclusive lock.
    const parsed = JSON.parse(await fs.readFile(file,"utf8")) as Owner;
    if(!Number.isInteger(parsed.pid) || parsed.pid < 1 || typeof parsed.nonce !== "string") throw new Error("INVALID_WORKSPACE_LOCK");
    return parsed;
  } catch(e) { if((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw e; }
}
function alive(pid: number) {
  try { process.kill(pid,0); return true; }
  catch(e) { if((e as NodeJS.ErrnoException).code === "ESRCH") return false; return true; }
}
async function acquire(root: string, timeoutMs = 5000) {
  await fs.mkdir(root,{ recursive:true });
  if((await fs.lstat(root)).isSymbolicLink()) throw new Error("WORKSPACE_SYMLINK_ROOT");
  const file = path.join(root,".sc2mcp-lock.json"), reclaim = `${file}.reclaim`, token = { pid:process.pid,nonce:randomUUID() };
  const initial = path.join(root,`.sc2mcp-lock-init-${token.nonce}.json`);
  const handle = await fs.open(initial,"wx");
  try { await handle.writeFile(JSON.stringify(token)); await handle.sync(); } finally { await handle.close(); }
  const deadline = Date.now()+timeoutMs;
  try {
  while(Date.now() <= deadline) {
    const claiming = await owner(reclaim);
    if(claiming) {
      if(!alive(claiming.pid)) throw new Error("WORKSPACE_LOCK_RECLAIM_INTERRUPTED: stale reclaim marker requires inspection; no files changed");
      await new Promise(resolve => setTimeout(resolve,25)); continue;
    }
    try {
      // An initialized inode is linked exclusively: peers never see an empty
      // lock file, and a process dying during init has not claimed the lock.
      await fs.link(initial,file);
      return { file,token };
    } catch(e) { if((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    const existing = await owner(file);
    if(existing && !alive(existing.pid)) {
      let gate = false;
      try { await fs.link(initial,reclaim); gate = true; }
      catch(e) { if((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      if(gate) {
        try {
          const current = await owner(file);
          if(current?.nonce === existing.nonce && current.pid === existing.pid && !alive(current.pid)) await fs.unlink(file);
        } finally { await fs.unlink(reclaim); }
      }
    } else await new Promise(resolve => setTimeout(resolve,25));
  }
  throw new Error("WORKSPACE_LOCKED: another process owns this workspace");
  } finally { await fs.rm(initial,{ force:true }); }
}
async function release(lock: { file:string;token:Owner }) {
  const current = await owner(lock.file);
  if(current?.nonce !== lock.token.nonce || current.pid !== lock.token.pid) throw new Error("WORKSPACE_LOCK_LOST");
  await fs.unlink(lock.file);
}
export async function withWorkspaceLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  const lock = await acquire(root);
  try { return await work(); } finally { await release(lock); }
}
