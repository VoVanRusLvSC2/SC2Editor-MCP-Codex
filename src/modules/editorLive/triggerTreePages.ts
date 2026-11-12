import * as z from "zod/v4";
import type { MemoryDesktop } from "./memoryDesktop.js";
import type { EditorWindow } from "./desktop.js";

const item = z.object({ handle: z.string(), parent: z.string(), depth: z.number(), text: z.string() });
const pageSchema = z.object({ tree: z.object({
  id: z.number(), count: z.number().int().min(0).max(8192), total: z.number().int().min(0).max(8192),
  offset: z.number().int().min(0), fingerprint: z.string().min(1), truncated: z.boolean(),
  items: z.array(item).max(128),
}) });

export async function readTriggerTreePage(desktop: MemoryDesktop, window: EditorWindow, id: number, offset: number, expected = "") {
  const page = pageSchema.parse(await desktop.command(window, 50, {
    field: "tree_page", unit: String(id), value: String(offset), expected,
  })).tree;
  if (page.id !== id || page.offset !== offset || page.truncated || page.total !== page.count ||
      offset > page.total || (expected && page.fingerprint !== expected) ||
      offset + page.items.length > page.total || (offset < page.total && page.items.length === 0))
    throw Error("LIVE_TRIGGER_TREE_PAGE_CHANGED");
  return page;
}

/** Reassemble a single guarded native GUI snapshot without accepting mixed revisions. */
export async function readTriggerTreePages(desktop: MemoryDesktop, window: EditorWindow, id: number, initialHash = "") {
  let fingerprint = initialHash, expectedTotal: number | undefined, offset = 0;
  const items: z.infer<typeof item>[] = [], handles = new Set<string>();
  for (;;) {
    const page = await readTriggerTreePage(desktop, window, id, offset, fingerprint);
    if (expectedTotal !== undefined && page.total !== expectedTotal)
      throw Error("LIVE_TRIGGER_TREE_PAGE_CHANGED");
    fingerprint = page.fingerprint;
    expectedTotal = page.total;
    for (const row of page.items) {
      if (handles.has(row.handle)) throw Error("LIVE_TRIGGER_TREE_PAGE_DUPLICATE");
      handles.add(row.handle);
      items.push(row);
    }
    offset += page.items.length;
    if (offset === expectedTotal) return { id, count: expectedTotal, fingerprint, truncated: false, items };
    if (offset > expectedTotal || page.items.length === 0) throw Error("LIVE_TRIGGER_TREE_PAGE_INCOMPLETE");
  }
}
