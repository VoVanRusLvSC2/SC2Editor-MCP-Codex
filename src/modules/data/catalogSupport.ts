export const CATALOG_SKIP = new Set(["node_modules", "dist", "release", ".git", ".svn"]);
export function normalizeCatalogPath(value: string): string {
  return value.replaceAll("\\", "/");
}
export function catalogProvenance(file: string): string[] {
  const values = normalizeCatalogPath(file)
    .split("/")
    .filter((entry) => /\.SC2(?:Map|Mod|Data)$/i.test(entry));
  return values.length ? values : ["workspace"];
}
