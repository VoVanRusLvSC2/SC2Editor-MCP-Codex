import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type * as z from "zod/v4";
import { liveDigest } from "./identity.js";
import type { EditorWindow } from "./desktop.js";

interface PendingIdentity {
  id: string;
  archive: string;
  processId: number;
  processStart: string;
}
/** Retains uncertain component submissions across MCP sessions. Caller holds the process lease. */
export class PendingComponent<T extends PendingIdentity> {
  constructor(
    private readonly namespace: string,
    private readonly schema: z.ZodType<T>,
    private readonly errorPrefix: string,
  ) {}
  private async file(w: EditorWindow, archive: string) {
    const directory = path.join(os.tmpdir(), "SC2EditorToolkit-live-memory", this.namespace);
    await fs.mkdir(directory, { recursive: true });
    if (
      (await fs.lstat(directory)).isSymbolicLink() ||
      path.resolve(await fs.realpath(directory)).toLowerCase() !== directory.toLowerCase()
    )
      throw Error(this.errorPrefix + "_DIRECTORY_INVALID");
    return path.join(
      directory,
      liveDigest(
        JSON.stringify([w.processId, w.processStart, path.resolve(archive).toLowerCase()]),
      ) + ".json",
    );
  }
  async read(w: EditorWindow, archive: string) {
    try {
      const file = await this.file(w, archive),
        stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
        throw Error(this.errorPrefix + "_RECORD_INVALID");
      const value = this.schema.parse(JSON.parse(await fs.readFile(file, "utf8")));
      if (
        value.processId !== w.processId ||
        value.processStart !== w.processStart ||
        path.resolve(value.archive).toLowerCase() !== path.resolve(archive).toLowerCase()
      )
        throw Error(this.errorPrefix + "_RECORD_INVALID");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async reserve(w: EditorWindow, input: T) {
    const record = this.schema.parse(input);
    if (record.processId !== w.processId || record.processStart !== w.processStart)
      throw Error(this.errorPrefix + "_RECORD_INVALID");
    const text = JSON.stringify(record) + "\n";
    // Refuse before native mutation if recovery would be unable to read its journal.
    if (Buffer.byteLength(text, "utf8") > 16384) throw Error(this.errorPrefix + "_RECORD_INVALID");
    await fs.writeFile(await this.file(w, record.archive), text, {
      flag: "wx",
    });
  }
  async release(w: EditorWindow, archive: string, id: string) {
    if ((await this.read(w, archive))?.id !== id) throw Error(this.errorPrefix + "_ID_CHANGED");
    await fs.unlink(await this.file(w, archive));
  }
}
