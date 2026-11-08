import { promises as fs } from "node:fs";
import path from "node:path";
import * as z from "zod/v4";
import { directoryManifest, type DirectoryEntry } from "../../archive/archiveAdapter.js";
import { editorLoadFiles, prepareEditorLoad } from "../map/editorLoad.js";
import { currentArchive, liveDigest, liveFileDigest } from "./identity.js";
import type { LiveRuntime } from "./runtime.js";

/** Pin every prepared component to the reopened package. Map export can add
 * its established load prerequisites; independently derive those exact bytes. */
async function assertPreparedContents(
  root: string,
  manifest: DirectoryEntry[],
  emitted: Record<string, string>,
  declaredLoadChanges: string[],
) {
  const expected = new Map(manifest.map((file) => [file.file, file.sha256]));
  if (declaredLoadChanges.length) {
    if (
      new Set(declaredLoadChanges).size !== declaredLoadChanges.length ||
      declaredLoadChanges.some((file) => !editorLoadFiles.includes(file))
    )
      throw Error("LIVE_REFRESH_EXPORT_LOAD_DECLARATION_INVALID");
    const inputs = new Map<string, Buffer>();
    for (const file of editorLoadFiles) {
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(path.join(root, file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        bytes = Buffer.alloc(0);
      }
      const pinned = expected.get(file);
      if (pinned !== undefined && liveDigest(bytes) !== pinned)
        throw Error("LIVE_REFRESH_COMPONENTS_CHANGED_DURING_EXPORT: " + file);
      if (pinned === undefined && bytes.length)
        throw Error("LIVE_REFRESH_COMPONENTS_CHANGED_DURING_EXPORT: " + file);
      inputs.set(file, bytes);
    }
    const load = prepareEditorLoad(inputs);
    if (
      load.changed.length !== declaredLoadChanges.length ||
      load.changed.some((file) => !declaredLoadChanges.includes(file))
    )
      throw Error("LIVE_REFRESH_EXPORT_LOAD_DECLARATION_INVALID");
    for (const file of load.changed) expected.set(file, liveDigest(load.next.get(file)!));
  }
  const keys = new Set([...expected.keys(), ...Object.keys(emitted)]);
  for (const file of keys)
    if (expected.get(file) !== emitted[file])
      throw Error("LIVE_REFRESH_EXPORT_COMPONENT_MISMATCH: " + file);
}

/** Finish validation and same-volume staging before the native document is closed. */
export async function prepareRefreshPackage(
  runtime: LiveRuntime,
  baseline: ReadonlyMap<string, string>,
  archive: string,
  directory: string,
  options: { compileSnapshot?: boolean } = {},
) {
  if (runtime.workspace.draftFiles().length || runtime.workspace.binary.draftFiles().length)
    throw Error("LIVE_REFRESH_SAVE_COMPLETE_COMPONENT_GROUPS_FIRST");
  const manifest = await directoryManifest(runtime.workspace.root),
    after = new Map(manifest.map((f) => [f.file, f.sha256]));
  // A GUI graph is only the source: the game executes MapScript.galaxy.
  // Publishing a changed graph with the old runtime silently loses behavior.
  // Keep the prepared session intact so the caller can generate a compatible
  // runtime or use a separately qualified native Editor regeneration path.
  if (
    !options.compileSnapshot &&
    baseline.get("Triggers") !== after.get("Triggers") &&
    (!after.has("MapScript.galaxy") ||
      baseline.get("MapScript.galaxy") === after.get("MapScript.galaxy"))
  )
    throw Error(
      "LIVE_REFRESH_TRIGGER_RUNTIME_SYNC_REQUIRED: regenerate MapScript.galaxy from the changed GUI graph before applying",
    );
  if (
    ![...new Set([...baseline.keys(), ...after.keys()])].some(
      (f) => baseline.get(f) !== after.get(f),
    )
  )
    return undefined;
  const packedPath = path.join(
      runtime.workspace.root,
      ".sc2mcp-output",
      "refresh" + path.extname(archive),
    ),
    exported = await runtime.export(packedPath),
    packed = await currentArchive(runtime.workspace.root, packedPath),
    verification = z
      .object({
        verification: z.object({
          reopened: z.literal(true),
          contentSha256: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
        }),
        editorLoad: z.object({ changed: z.array(z.string()) }).optional(),
      })
      .parse(exported),
    emitted = verification.verification.contentSha256;
  if (JSON.stringify(await directoryManifest(runtime.workspace.root)) !== JSON.stringify(manifest))
    throw Error("LIVE_REFRESH_COMPONENTS_CHANGED_DURING_EXPORT");
  await assertPreparedContents(
    runtime.workspace.root,
    manifest,
    emitted,
    verification.editorLoad?.changed ?? [],
  );
  const changed = [...new Set([...baseline.keys(), ...Object.keys(emitted)])].filter(
      (f) => baseline.get(f) !== emitted[f],
    ),
    candidate = options.compileSnapshot
      ? packed.archive
      : await stageRefreshCandidate(packed.archive, archive, packed.sha256, directory);
  await fs.writeFile(
    path.join(directory, "PreparedManifest.json"),
    JSON.stringify({ changed, manifest, exported, candidate, candidateSha256: packed.sha256 }) +
      "\n",
  );
  return { candidate, sha256: packed.sha256, changed, manifest };
}

/** rename must stay on the original archive's volume, even when SC2_UI_ROOT is elsewhere. */
export async function stageRefreshCandidate(
  packed: string,
  archive: string,
  sha256: string,
  directory: string,
) {
  const [source, target] = await Promise.all([fs.stat(packed), fs.stat(archive)]);
  if (source.dev === target.dev) return packed;
  // The original archive's canonical path was checked before preparation. mkdtemp
  // creates a new directory atomically; existing adjacent paths are never followed.
  const staging = await fs.mkdtemp(path.join(path.dirname(archive), ".sc2mcp-refresh-")),
    candidate = path.join(staging, "Package" + path.extname(archive));
  await fs.writeFile(
    path.join(directory, "Staging.json"),
    JSON.stringify({ staging, candidate, packed, sha256 }) + "\n",
  );
  await fs.copyFile(packed, candidate, fs.constants.COPYFILE_EXCL);
  if ((await currentArchive(staging, candidate)).sha256 !== sha256)
    throw Error("LIVE_REFRESH_STAGED_PACKAGE_INVALID");
  return candidate;
}

/** A failed pre-close reservation may leave a valid rollback; reuse, never replace it. */
export async function ensureRefreshRollback(archive: string, rollback: string, sha256: string) {
  try {
    await fs.copyFile(archive, rollback, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = await fs.lstat(rollback);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 1024 ** 3 ||
    path.resolve(await fs.realpath(rollback)).toLowerCase() !==
      path.resolve(rollback).toLowerCase() ||
    (await liveFileDigest(rollback)) !== sha256
  )
    throw Error("LIVE_REFRESH_ROLLBACK_INVALID");
}
