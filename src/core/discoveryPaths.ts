/** Generated maps and transaction state do not belong to the parent map index.
 * Locale entry directories remain eligible native content.
 */
export function internalWorkspaceDirectory(name: string): boolean {
  return name.startsWith(".sc2mcp-") && name !== ".sc2mcp-locales";
}
