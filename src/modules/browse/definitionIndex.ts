import type { BrowseEntry, BrowseIndexSnapshot } from "./types.js";

/** Derived lookup tables live only as long as their source snapshot. Array order
 * and layered duplicates remain unchanged; these are not resolution verdicts. */
export class BrowseDefinitionIndexes {
  private readonly prepared = new WeakMap<
    BrowseIndexSnapshot,
    {
      byKey: Map<string, BrowseEntry[]>;
      byId: Map<string, BrowseEntry[]>;
      byDeclaration: Map<string, BrowseEntry[]>;
    }
  >();

  read(snapshot: BrowseIndexSnapshot) {
    const cached = this.prepared.get(snapshot);
    if (cached) return cached;
    const byKey = new Map<string, BrowseEntry[]>(),
      byId = new Map<string, BrowseEntry[]>(),
      byDeclaration = new Map<string, BrowseEntry[]>();
    const add = (map: Map<string, BrowseEntry[]>, key: string, entry: BrowseEntry) => {
      const values = map.get(key);
      if (values) values.push(entry);
      else map.set(key, [entry]);
    };
    for (const entry of snapshot.entries) {
      add(byKey, entry.key, entry);
      add(byId, entry.id.toLowerCase(), entry);
      add(byDeclaration, this.declaration(entry.id, entry.ctype, entry.file), entry);
    }
    const index = { byKey, byId, byDeclaration };
    this.prepared.set(snapshot, index);
    return index;
  }

  declaration(id: string | undefined, ctype: string, file: string) {
    return JSON.stringify([id, ctype, file]);
  }
}
