import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Bounded metadata only. A cache hit still verifies the actual output bytes. */
export class VerifiedArtifactCache<T> {
  private readonly entries = new Map<
    string,
    { file: string; sha256: string; bytes: number; value: T }
  >();
  constructor(readonly maxEntries = 8) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0)
      throw Error("ARTIFACT_CACHE_LIMIT_INVALID");
  }

  async get(key: string, file: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry || entry.file !== file) return;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size !== entry.bytes) {
        this.entries.delete(key);
        return;
      }
      if (sha(await fs.readFile(file)) !== entry.sha256) {
        this.entries.delete(key);
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.entries.delete(key);
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry.value);
  }

  remember(key: string, file: string, bytes: Uint8Array, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, {
      file,
      sha256: sha(bytes),
      bytes: bytes.byteLength,
      value: structuredClone(value),
    });
    while (this.entries.size > this.maxEntries)
      this.entries.delete(this.entries.keys().next().value!);
  }

  clear(): void {
    this.entries.clear();
  }
}
