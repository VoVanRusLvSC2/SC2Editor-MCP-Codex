import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import { readArchiveEntry } from "../../archive/archiveAdapter.js";
import { currentDocumentMatches } from "./documentIdentity.js";
import { documentDirty, type EditorWindow } from "./desktop.js";
import type { MemoryDesktop } from "./memoryDesktop.js";
import { transferDirectory } from "./transferDirectory.js";
import { liveFileDigest } from "./identity.js";
import { layoutXmlLimit } from "./layoutXml.js";

/** Original Save can persist a layout without clearing Scintilla's modified flag.
 * Acknowledge only exact bytes in the stable archive; never discard/reselect a buffer. */
export async function acknowledgeSavedUiBuffers(
  desktop: MemoryDesktop,
  terrain: EditorWindow,
  archive: string,
  expectedSha256: string,
  readEntry = readArchiveEntry,
) {
  const results: Array<{ layout: string; status: string }> = [];
  for (const window of await desktop.windows()) {
    if (
      window.processId !== terrain.processId ||
      window.processStart !== terrain.processStart ||
      !window.enabled ||
      !window.title.startsWith("UI - [") ||
      documentDirty(window) ||
      !(await currentDocumentMatches(desktop, window, archive))
    )
      continue;
    const state = z
      .object({ layout: z.string(), source: z.string(), bufferModified: z.boolean() })
      .parse(await desktop.command(window, 60, { field: "status" }));
    if (
      !state.bufferModified ||
      state.source !== path.basename(archive) ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(state.layout)
    )
      continue;
    const token = randomUUID();
    const snapshot = z
      .object({
        snapshotExported: z.literal(true),
        fingerprint: z.string(),
        bytes: z.number().int().positive().max(layoutXmlLimit),
      })
      .parse(await desktop.command(window, 60, { unit: state.layout, field: state.source, token }));
    const file = path.join(await transferDirectory(desktop, window, "ui"), token + ".xml");
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== snapshot.bytes)
      throw Error("LIVE_UI_SAVED_SNAPSHOT_INVALID");
    const source = await fs.readFile(file);
    if ((await liveFileDigest(archive)) !== expectedSha256)
      throw Error("LIVE_UI_SAVED_ARCHIVE_CHANGED");
    let saved: Buffer;
    try {
      saved = await readEntry(archive, `Base.SC2Data/UI/Layout/${state.layout}.SC2Layout`);
    } catch {
      results.push({ layout: state.layout, status: "preserved_unresolved_saved_layout" });
      continue;
    }
    if (!source.equals(saved)) {
      results.push({ layout: state.layout, status: "preserved_unsaved_buffer" });
      continue;
    }
    if ((await liveFileDigest(archive)) !== expectedSha256)
      throw Error("LIVE_UI_SAVED_ARCHIVE_CHANGED");
    const fresh = desktop.window
      ? await desktop.window(window.windowId)
      : (await desktop.windows()).find((w) => w.windowId === window.windowId);
    if (
      !fresh ||
      fresh.processId !== window.processId ||
      fresh.processStart !== window.processStart ||
      fresh.title !== window.title
    )
      throw Error("LIVE_UI_SAVED_WINDOW_CHANGED");
    z.object({ persistedBufferAcknowledged: z.literal(true) }).parse(
      await desktop.command(fresh, 65, {
        unit: state.layout,
        field: state.source,
        expected: snapshot.fingerprint,
      }),
    );
    results.push({ layout: state.layout, status: "saved_buffer_acknowledged" });
  }
  return results;
}
