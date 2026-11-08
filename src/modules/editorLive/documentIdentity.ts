import path from "node:path";
import * as z from "zod/v4";
import { documentMatches, type EditorWindow } from "./desktop.js";

export interface DocumentIdentityReader {
  documentIdentity?(window: EditorWindow, archive: string): Promise<unknown>;
}
const proofSchema = z.object({
  verified: z.literal(true),
  archive: z.string(),
  windowId: z.string(),
  processId: z.number(),
  processStart: z.string(),
  title: z.string(),
  matchingDocuments: z.literal(1),
  lockedByProcess: z.literal(true),
  scope: z.literal("map_archive_owner_and_unique_document"),
});

/** A very short SC2 caption is a candidate only; it never establishes identity alone. */
export function shortMapCaption(window: EditorWindow, archive: string) {
  const expected = archive.replaceAll("\\", "/").toLowerCase();
  if (!/^[a-z]:\/.+\.sc2map$/.test(expected)) return false;
  const caption = window.title
      .replaceAll("\\", "/")
      .toLowerCase()
      .match(/\[(.+?)\*?\] - starcraft ii editor$/)?.[1],
    parts = caption?.split(/\.\.\.|…/);
  if (!parts || parts.length !== 2) return false;
  const [prefix, suffix] = parts;
  return (
    /^[a-z]:\/$/.test(prefix) &&
    expected.startsWith(prefix) &&
    suffix.startsWith("/") &&
    suffix.split("/").filter(Boolean).length >= 2 &&
    expected.endsWith(suffix) &&
    expected.length > prefix.length + suffix.length
  );
}

/** Shared by all current-document providers; no cached title-only binding or UI input. */
export async function currentDocumentMatches(
  desktop: DocumentIdentityReader,
  window: EditorWindow,
  archive: string,
) {
  if (documentMatches(window, archive)) return true;
  if (!shortMapCaption(window, archive) || !desktop.documentIdentity) return false;
  const proof = proofSchema.safeParse(await desktop.documentIdentity(window, archive));
  if (!proof.success) return false;
  const value = proof.data;
  return (
    path.win32.normalize(value.archive).toLowerCase() ===
      path.win32.normalize(archive).toLowerCase() &&
    value.windowId === window.windowId &&
    value.processId === window.processId &&
    value.processStart === window.processStart &&
    value.title === window.title
  );
}
