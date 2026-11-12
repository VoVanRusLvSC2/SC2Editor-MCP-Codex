import { createHash } from "node:crypto";

export interface GuiCatalogReference {
  domain: string;
  id: string;
}
export interface GuiCatalogIdentity extends GuiCatalogReference {
  source: string;
}
/** Internal, read-only identity evidence supplied by a current-document adapter. */
export interface GuiCatalogContext {
  revision: string;
  validate(values?: readonly GuiCatalogReference[]): string;
}
export function bindGuiCatalogContext(
  identities: readonly GuiCatalogIdentity[],
): GuiCatalogContext {
  const rows = identities
    .map((v) => ({ domain: v.domain, id: v.id, source: v.source }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const known = new Set(rows.map((v) => JSON.stringify([v.domain, v.id])));
  if (known.size !== rows.length || rows.some((v) => !v.domain || !v.id || !v.source))
    throw Error("GUI_CATALOG_IDENTITIES_INVALID");
  const revision = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  return Object.freeze({
    revision,
    validate(values?: readonly GuiCatalogReference[]) {
      for (const v of values ?? [])
        if (!known.has(JSON.stringify([v.domain, v.id])))
          throw Error("GUI_GAMELINK_UNRESOLVED: " + v.domain + ":" + v.id);
      return revision;
    },
  });
}
