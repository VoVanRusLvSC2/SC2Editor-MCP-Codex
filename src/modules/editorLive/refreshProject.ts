import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import { withWorkspaceLock } from "../../core/workspaceLock.js";

export const refreshProjectSchema = z
  .object({
    id: z.string().uuid(),
    archive: z.string().min(1).max(4096),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    baseline: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  })
  .strict();

const attestationSchema = z
  .object({
    sessionId: z.string().uuid(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    manifest: z.string().max(8 * 1024 * 1024),
    runtimeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type CompiledAttestation = z.infer<typeof attestationSchema>;

async function attestationFiles(directory: string) {
  return (await fs.readdir(directory))
    .filter((name) => /^CompiledAttestation-\d{6}\.json$/.test(name))
    .sort();
}

/** An append-only record is written and flushed before the prepared runtime changes. */
export async function writeCompiledAttestation(directory: string, input: CompiledAttestation) {
  const record = attestationSchema.parse(input),
    files = await attestationFiles(directory);
  const number = files.length ? Number(files.at(-1)!.slice(20, 26)) + 1 : 1;
  if (number > 999999) throw Error("LIVE_REFRESH_ATTESTATION_LIMIT");
  const file = path.join(directory, `CompiledAttestation-${String(number).padStart(6, "0")}.json`);
  const handle = await fs.open(file, "wx");
  try {
    await handle.writeFile(JSON.stringify(record) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return record;
}

export async function readCompiledAttestation(
  directory: string,
  sessionId: string,
  sourceSha256: string,
) {
  const files = await attestationFiles(directory);
  if (!files.length) return undefined;
  const file = path.join(directory, files.at(-1)!),
    stat = await fs.lstat(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 8 * 1024 * 1024 ||
    (await fs.realpath(file)).toLowerCase() !== file.toLowerCase()
  )
    throw Error("LIVE_REFRESH_ATTESTATION_INVALID");
  const record = attestationSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
  if (record.sessionId !== sessionId || record.sourceSha256 !== sourceSha256)
    throw Error("LIVE_REFRESH_ATTESTATION_INVALID");
  z.array(
    z
      .object({
        file: z.string(),
        size: z.number().int().nonnegative(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  ).parse(JSON.parse(record.manifest));
  return record;
}
export async function readRefreshProject(root: string, directory: string) {
  const absolute = path.resolve(root, directory),
    parent = path.join(root, ".sc2mcp-output/editor-live/refresh");
  if (
    path.dirname(absolute) !== path.resolve(parent) ||
    !z.string().uuid().safeParse(path.basename(absolute)).success ||
    (await fs.realpath(absolute)).toLowerCase() !== absolute.toLowerCase()
  )
    throw Error("LIVE_REFRESH_PROJECT_PATH_INVALID");
  const file = path.join(absolute, "Session.json"),
    stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
    throw Error("LIVE_REFRESH_PROJECT_RECORD_INVALID");
  const record = refreshProjectSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
  if (record.id !== path.basename(absolute)) throw Error("LIVE_REFRESH_PROJECT_RECORD_INVALID");
  return { directory: absolute, record };
}

/** One MCP owner per prepared project; never steals a live owner's drafts. */
export async function acquireRefreshProject(directory: string, markerRoot = path.join(os.tmpdir(), 'SC2EditorToolkit-live-refresh')) {
  // Reuse the existing filesystem gate for stale-owner reclamation. A native
  // process lease alone cannot serialize two different Editors resuming one project.
  const owner = randomUUID(), marker = path.join(markerRoot, `${process.pid}-${owner}.lock`), markerText = 'active-refresh\n';
  // The panel holds this same gate while checking markers and requesting reload.
  // Create the marker under it before opening a mutable prepared session.
  await withWorkspaceLock(markerRoot, async () => {
    await fs.writeFile(marker, markerText, {flag:'wx'});
  });
  const releaseMarker = async () => {
    const stat = await fs.lstat(marker);
    if (!stat.isFile() || stat.isSymbolicLink() || (await fs.readFile(marker,'utf8')) !== markerText) throw Error('LIVE_REFRESH_MARKER_CHANGED');
    await fs.unlink(marker);
  };
  try { return await withWorkspaceLock(directory, async () => {
    const file = path.join(directory, "Prepared.lock"),
      text = JSON.stringify({ pid: process.pid, owner }) + "\n";
    let handle;
    try {
      handle = await fs.open(file, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256)
        throw Error("LIVE_REFRESH_PROJECT_LEASE_INVALID", { cause: error });
      const before = await fs.readFile(file, "utf8"),
        old = z
          .object({ pid: z.number().int().positive(), owner: z.string().uuid() })
          .strict()
          .parse(JSON.parse(before));
      try {
        process.kill(old.pid, 0);
        throw Error("LIVE_REFRESH_PROJECT_OWNED", { cause: error });
      } catch (state) {
        if ((state as NodeJS.ErrnoException).code !== "ESRCH") throw state;
      }
      if ((await fs.readFile(file, "utf8")) !== before)
        throw Error("LIVE_REFRESH_PROJECT_OWNER_CHANGED", { cause: error });
      await fs.unlink(file);
      handle = await fs.open(file, "wx");
    }
    try {
      await handle.writeFile(text);
    } finally {
      await handle.close();
    }
    return async () => {
      await withWorkspaceLock(directory, async () => {
        if ((await fs.readFile(file, "utf8")) !== text)
          throw Error("LIVE_REFRESH_PROJECT_OWNER_CHANGED");
        await fs.unlink(file);
      });
      await releaseMarker();
    };
  }); } catch (error) { await releaseMarker(); throw error; }
}
