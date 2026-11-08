/** Resource imports must not accidentally distribute tooling or source code. */
export function forbiddenResourceName(name: string): boolean {
  return /\.(dll|exe|pdb|cpp|cc|cxx|c|h|hpp|hxx|cs|py|pyw|rs|go|java|ts|js|mjs|ps1|sh|bat|cmd|zip|sc2map|sc2mod)$/i.test(
    name,
  );
}
