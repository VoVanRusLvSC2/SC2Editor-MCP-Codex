import { scanXml } from "./xmlScanner.js";

/** Exact-content cache for read-only XML consumers. Freeze the complete tree so
 * callers cannot poison later reads. Writers retain their own source patches.
 */
export class XmlParseCache {
  private readonly entries = new Map<
    string,
    { parsed: ReturnType<typeof scanXml>; bytes: number; structureItems: number }
  >();
  private bytes = 0;
  private structureItems = 0;
  private hits = 0;
  private parses = 0;
  constructor(
    readonly maxEntries = 3,
    readonly maxSourceBytes = 8 * 1024 * 1024,
    readonly maxStructureItems = 150000,
  ) {
    if (
      [maxEntries, maxSourceBytes, maxStructureItems].some(
        (value) => !Number.isSafeInteger(value) || value < 0,
      )
    )
      throw Error("XML_CACHE_LIMIT_INVALID");
  }
  read(source: string): ReturnType<typeof scanXml> {
    const cached = this.entries.get(source);
    if (cached) {
      this.hits++;
      this.entries.delete(source);
      this.entries.set(source, cached);
      return cached.parsed;
    }
    const parsed = scanXml(source);
    this.parses++;
    for (const node of parsed.nodes) {
      Object.freeze(node.attrs);
      Object.freeze(node.childIds);
      for (const span of node.attrSpans) Object.freeze(span);
      Object.freeze(node.attrSpans);
      Object.freeze(node);
    }
    for (const diagnostic of parsed.diagnostics) Object.freeze(diagnostic);
    Object.freeze(parsed.nodes);
    Object.freeze(parsed.rootIds);
    Object.freeze(parsed.diagnostics);
    Object.freeze(parsed);
    const bytes = Buffer.byteLength(source);
    const structureItems =
      parsed.nodes.length +
      parsed.diagnostics.length +
      parsed.nodes.reduce((count, node) => count + node.attrSpans.length, 0);
    if (
      bytes <= this.maxSourceBytes &&
      structureItems <= this.maxStructureItems &&
      this.maxEntries > 0
    ) {
      while (
        this.entries.size &&
        (this.entries.size >= this.maxEntries ||
          this.bytes + bytes > this.maxSourceBytes ||
          this.structureItems + structureItems > this.maxStructureItems)
      ) {
        const key = this.entries.keys().next().value!;
        this.bytes -= this.entries.get(key)!.bytes;
        this.structureItems -= this.entries.get(key)!.structureItems;
        this.entries.delete(key);
      }
      this.entries.set(source, { parsed, bytes, structureItems });
      this.bytes += bytes;
      this.structureItems += structureItems;
    }
    return parsed;
  }
  stats() {
    return {
      entries: this.entries.size,
      sourceBytes: this.bytes,
      hits: this.hits,
      parses: this.parses,
      maxEntries: this.maxEntries,
      maxSourceBytes: this.maxSourceBytes,
      structureItems: this.structureItems,
      maxStructureItems: this.maxStructureItems,
    };
  }
}
