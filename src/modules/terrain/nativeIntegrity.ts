import type { TerrainIssue } from "./types.js";

/** Envelope checks independently exercised against the four native maps.
 * Raw flags and vertex sub-data are deliberately not interpreted as pathing/colors.
 */
export function inspectNativeIntegrity(sources: ReadonlyMap<string, Buffer>, width: number, height: number) {
  const issues: TerrainIssue[] = [];
  const components: Array<{ name: string; status: "PASS" | "FAIL" | "MISSING" | "PRESERVE_ONLY"; details?: unknown }> = [];
  const inspect = (name: string, versions: number[], magic: string, minimum: number, read: (bytes: Buffer, version: number) => unknown) => {
    const bytes = sources.get(name);
    if (!bytes?.length) { components.push({ name, status: "MISSING" }); return; }
    try {
      if (bytes.length < minimum || bytes.toString("ascii", 0, 4) !== magic) throw new Error("INVALID_HEADER");
      const version = bytes.readUInt32LE(4);
      if (!versions.includes(version)) {
        components.push({ name, status: "PRESERVE_ONLY", details: { version } });
        issues.push({ severity: "warning", code: "TERRAIN_NATIVE_VERSION_UNCHECKED", message: `${name}: ${version}` });
        return;
      }
      components.push({ name, status: "PASS", details: read(bytes, version) });
    } catch (error) {
      components.push({ name, status: "FAIL" });
      issues.push({ severity: "error", code: "TERRAIN_NATIVE_COMPONENT_INVALID", message: `${name}: ${String(error)}` });
    }
  };
  const histogram = (bytes: Buffer, offset: number, stride: 1 | 2) => {
    const values = new Map<number, number>();
    for (let i = offset; i < bytes.length; i += stride) {
      const value = stride === 1 ? bytes[i] : bytes.readUInt16LE(i);
      values.set(value, (values.get(value) ?? 0) + 1);
    }
    return [...values].sort((a, b) => a[0] - b[0]).map(([rawValue, cells]) => ({ rawValue, cells }));
  };
  inspect("t3CellFlags", [101, 102], "LFCT", 32, bytes => {
    if (bytes.readUInt32LE(24) !== width || bytes.readUInt32LE(28) !== height || bytes.length !== 32 + width * height) throw new Error("CELL_GRID_SIZE_MISMATCH");
    return { cells: [width, height], rawFlags: histogram(bytes, 32, 1), pathingSemantics: "NOT_VERIFIED" };
  });
  inspect("t3SyncCliffLevel", [100], "CLIF", 32, bytes => {
    if (bytes.readUInt32LE(8) !== width || bytes.readUInt32LE(12) !== height || bytes.length !== 32 + width * height * 2) throw new Error("CLIFF_GRID_SIZE_MISMATCH");
    return { cells: [width, height], rawLevels: histogram(bytes, 32, 2), geometryConsistency: "NOT_VERIFIED" };
  });
  inspect("t3VertCol", [103, 104], "VTCL", 32, (bytes, version) => {
    const entries = bytes.readUInt32LE(8), fixedSize = version === 104 ? 36 : 28;
    if (entries > Math.floor((bytes.length - 32) / fixedSize)) throw new Error("VERTEX_ENTRY_COUNT_EXCEEDS_FILE");
    let offset = 32, subDataBytes = 0;
    for (let i = 0; i < entries; i++) {
      if (offset + fixedSize > bytes.length) throw new Error("TRUNCATED_VERTEX_ENTRY");
      const size = bytes.readUInt32LE(offset + fixedSize - 4);
      if (size > bytes.length - offset - fixedSize) throw new Error("TRUNCATED_VERTEX_SUBDATA");
      offset += fixedSize + size; subDataBytes += size;
    }
    if (offset !== bytes.length) throw new Error("UNEXPLAINED_VERTEX_TRAILING_BYTES");
    return { version, entries, subDataBytes, subDataSemantics: "OPAQUE", writer: false };
  });
  return { valid: !issues.some(i => i.severity === "error"), components, issues,
    validationScope: "Known native envelopes, dimensions and variable-entry boundaries; not cliff geometry, vertex color meaning or engine pathing" };
}
