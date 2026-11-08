import { promises as fs } from "node:fs";
import path from "node:path";
import * as z from "zod/v4";
import { directoryManifest, safeArchivePath } from "../../archive/archiveAdapter.js";
import {
  assertSnapshots,
  commitFiles,
  readSnapshot,
  type FileSnapshot,
} from "../../core/fileTransactions.js";
import type { Workspace } from "../../core/workspace.js";
import { liveDigest } from "./identity.js";
import { forbiddenResourceName } from "./resourcePolicy.js";

const changeSchema = z
  .object({
    action: z.enum(["add", "replace", "remove"]),
    path: z.string().min(8).max(240),
    source: z.string().min(1).max(4096).optional(),
    expectedSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.action === "remove") === (value.source !== undefined))
      ctx.addIssue({ code: "custom", message: "add/replace require source; remove must omit it" });
  });
export const refreshResourcesSchema = z
  .object({ sessionId: z.string().uuid(), changes: z.array(changeSchema).min(1).max(32) })
  .strict();

/** Apply an entire resource group to prepared components, never to an open archive. */
export async function prepareRefreshResources(
  parent: Workspace,
  target: Workspace,
  changes: z.infer<typeof changeSchema>[],
) {
  return target.transactions.run(async () => {
    const manifest = await directoryManifest(target.root);
    const existing = new Map(manifest.map((file) => [file.file.toLowerCase(), file.file]));
    const targets = new Set<string>();
    const sourceSnapshots = new Map<string, FileSnapshot>();
    const originals = new Map<string, FileSnapshot>();
    const next = new Map<string, Buffer>();
    const removed = new Set<string>();
    const receipt: Array<{ action: string; path: string; sha256?: string }> = [];
    let bytesTotal = 0;
    for (const change of changes) {
      const requested = safeArchivePath(change.path),
        lower = requested.toLowerCase();
      if (
        !/^assets\/[^/]+\/.+$/i.test(requested) ||
        requested.split("/").some((part) => part.toLowerCase().startsWith(".sc2mcp")) ||
        forbiddenResourceName(requested) ||
        targets.has(lower)
      )
        throw Error("LIVE_REFRESH_RESOURCE_PATH_INVALID: " + change.path);
      targets.add(lower);
      const present = existing.get(lower);
      if ((change.action === "add") === (present !== undefined))
        throw Error("LIVE_REFRESH_RESOURCE_EXISTENCE_CONFLICT: " + requested);
      const file = present ?? requested;
      if (manifest.some((entry) => lower.startsWith(entry.file.toLowerCase() + "/")))
        throw Error("LIVE_REFRESH_RESOURCE_PATH_COLLISION: " + requested);
      target.binary.assertNoDraft([file]);
      if (target.draftFiles().some((draft) => draft.toLowerCase() === file.toLowerCase()))
        throw Error("LIVE_REFRESH_RESOURCE_DRAFT_PRESENT: " + file);
      const destination = target.resolveUserPath(file);
      if (present) {
        const stat = await fs.lstat(destination);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024)
          throw Error("LIVE_REFRESH_RESOURCE_TARGET_INVALID: " + file);
      }
      const original = await readSnapshot(destination);
      if (original.exists !== (present !== undefined))
        throw Error("LIVE_REFRESH_RESOURCE_TARGET_CHANGED: " + file);
      if (
        change.expectedSha256 &&
        (!original.exists || liveDigest(original.bytes) !== change.expectedSha256)
      )
        throw Error("LIVE_REFRESH_RESOURCE_EXPECTED_MISMATCH: " + file);
      originals.set(file, original);
      bytesTotal += original.bytes.length;
      if (change.action === "remove") {
        next.set(file, original.bytes);
        removed.add(file);
        receipt.push({ action: change.action, path: file });
      } else {
        const source = parent.resolveUserPath(change.source!);
        const stat = await fs.lstat(source);
        if (
          forbiddenResourceName(source) ||
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          !stat.size ||
          stat.size > 64 * 1024 * 1024 ||
          (await fs.realpath(source)).toLowerCase() !== path.resolve(source).toLowerCase()
        )
          throw Error("LIVE_REFRESH_RESOURCE_SOURCE_INVALID");
        const snapshot = await readSnapshot(source);
        if (
          !snapshot.exists ||
          snapshot.bytes.length !== stat.size ||
          snapshot.bytes.subarray(0, 2).equals(Buffer.from("MZ"))
        )
          throw Error("LIVE_REFRESH_RESOURCE_SOURCE_INVALID");
        const previous = sourceSnapshots.get(source);
        if (previous && !previous.bytes.equals(snapshot.bytes))
          throw Error("LIVE_REFRESH_RESOURCE_SOURCE_CHANGED");
        sourceSnapshots.set(source, snapshot);
        bytesTotal += snapshot.bytes.length;
        next.set(file, snapshot.bytes);
        receipt.push({ action: change.action, path: file, sha256: liveDigest(snapshot.bytes) });
      }
      if (bytesTotal > 128 * 1024 * 1024) throw Error("LIVE_REFRESH_RESOURCE_BYTE_BOUND");
    }
    await commitFiles((file) => target.resolveUserPath(file), originals, next, {
      backup: false,
      removeFiles: removed,
      journalRoot: target.root,
      verify: () => assertSnapshots((file) => file, sourceSnapshots),
    });
    return { prepared: true, files: receipt, editorChanged: false, savedMap: false };
  });
}
