import * as z from "zod/v4";
import { randomUUID } from "node:crypto";
import { DATA_CATALOG_DOMAINS } from "../data/domains.js";
import {
  bindGuiCatalogContext,
  type GuiCatalogIdentity,
  type GuiCatalogReference,
} from "../trigger/catalogContext.js";
import type { MemoryDesktop } from "./memoryDesktop.js";
import { currentDocumentMatches } from "./documentIdentity.js";
import { withEditorLease } from "./editorLease.js";
import { resolveEditorModuleContext } from "./triggerContext.js";

export const liveCatalogReferences = z
  .array(
    z
      .object({
        domain: z.enum(DATA_CATALOG_DOMAINS),
        id: z
          .string()
          .min(1)
          .max(127)
          .refine((v) => ![...v].some((c) => c.charCodeAt(0) < 32)),
      })
      .strict(),
  )
  .min(1)
  .max(32);
const row = z.object({
  ready: z.literal(true),
  domain: z.string(),
  id: z.string(),
  source: z.string().min(1),
  label: z.string(),
});
/** No archive catalog mirrors: ask the original live Data list for exact raw IDs. */
export async function captureTriggerCatalog(
  desktop: MemoryDesktop,
  target: { archive: string; windowId: string },
  values: readonly GuiCatalogReference[],
  pause: (ms: number) => Promise<void>,
) {
  // Rechecks may receive identities with a source field. Only domain/ID belong
  // to the strict native request; source must be read again from the Editor.
  const refs = liveCatalogReferences.parse(values.map(({ domain, id }) => ({ domain, id })));
  const data = await resolveEditorModuleContext(desktop, target, pause, "Data");
  return withEditorLease(data, async () => {
    const identities: GuiCatalogIdentity[] = [];
    for (const ref of refs) {
      const current = desktop.window
        ? await desktop.window(data.windowId)
        : (await desktop.windows()).find((w) => w.windowId === data.windowId);
      if (
        !current?.enabled ||
        current.processId !== data.processId ||
        current.processStart !== data.processStart ||
        !(await currentDocumentMatches(desktop, current, target.archive))
      )
        throw Error("LIVE_CATALOG_DOCUMENT_CHANGED");
      const token = randomUUID();
      let prepared = false;
      try {
        // The token owns a temporary Data view, not a map mutation. The native
        // adapter refuses restoration if the user has since changed that view.
        z.object({ prepared: z.literal(true) }).parse(
          await desktop.command(current, 91, { token, unit: ref.id, value: ref.domain }),
        );
        prepared = true;
        let identity: z.infer<typeof row> | undefined;
        // Native filter changes finish asynchronously. Poll for a matching row
        // instead of treating the previous catalog's visible rows as current.
        for (let i = 0; i < 20; i++) {
          const value = await desktop.command(current, 92, { token });
          const parsed = row.safeParse(value);
          if (parsed.success) {
            identity = parsed.data;
            break;
          }
          if (!z.object({ ready: z.literal(false) }).safeParse(value).success)
            throw Error("LIVE_CATALOG_LOOKUP_UNCONFIRMED");
          await pause(100);
        }
        if (!identity)
          throw Error("LIVE_CATALOG_REFERENCE_UNRESOLVED: " + ref.domain + ":" + ref.id);
        if (identity.domain !== ref.domain || identity.id !== ref.id)
          throw Error("LIVE_CATALOG_IDENTITY_MISMATCH");
        identities.push({ domain: ref.domain, id: ref.id, source: identity.source });
      } finally {
        // A refused prepare never acquired the view and must not restore it.
        if (prepared)
          z.object({ viewRestored: z.literal(true) }).parse(
            await desktop.command(current, 93, { token }),
          );
      }
    }
    const context = bindGuiCatalogContext(identities);
    return {
      identities,
      context,
      revision: context.revision,
      windowId: data.windowId,
      scope:
        "Exact raw IDs and source identity in current original Data lists; includes committed unsaved objects; not pending XML, complete XML or gameplay validation",
    };
  });
}
