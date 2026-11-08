import { promises as fs } from "node:fs";
import { transferDirectory } from "./transferDirectory.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import type { MemoryDesktop } from "./memoryDesktop.js";
import type { EditorWindow } from "./desktop.js";
import { liveDigest } from "./identity.js";
import { ComponentTransferError } from "./componentTransfer.js";

export interface ImportBytes {
  name: string;
  bytes: Buffer;
}
const stateSchema = z.object({
  title: z.string(),
  fingerprint: z.string(),
  initial: z.string(),
  manualInput: z.boolean(),
});
export interface StagedImport {
  id: string;
  directory: string;
  manifestSha256: string;
  files: Array<{ name: string; size: number; sha256: string }>;
}
export async function stageImport(
  files: ImportBytes[],
  desktop: MemoryDesktop,
  window: EditorWindow,
): Promise<StagedImport> {
  const id = randomUUID(),
    root = await transferDirectory(desktop, window, "components");
  const directory = path.join(root, id + ".SC2Lib");
  await fs.mkdir(directory);
  const entries = [];
  for (const { name, bytes } of files) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(name) || name.includes(".."))
      throw Error("LIVE_IMPORT_NAME_INVALID");
    await fs.writeFile(path.join(directory, name), bytes, { flag: "wx" });
    entries.push({ name, size: bytes.length, sha256: liveDigest(bytes) });
  }
  const manifest = entries.map((f) => f.sha256 + "\t" + f.name + "\n").join("");
  await fs.writeFile(directory + ".assets", manifest, { flag: "wx" });
  return { id, directory, manifestSha256: liveDigest(manifest), files: entries };
}

/** Original folder picker and Import Files; never writes the open archive. */
export class ImportTransfer {
  constructor(
    private readonly desktop: MemoryDesktop,
    private readonly pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}
  async apply(w: EditorWindow, staged: StagedImport, prefix: string) {
    const token = randomUUID();
    let current: z.infer<typeof stateSchema> | undefined;
    const command = async (op: number, args: Parameters<MemoryDesktop["command"]>[2] = {}) => {
      const value = z
        .record(z.string(), z.unknown())
        .parse(await this.desktop.command(w, op, { ...args, token }));
      if (value.error || value.status === "unknown")
        throw Error(String(value.error ?? "LIVE_IMPORT_NATIVE_UNKNOWN"));
      return value;
    };
    const state = async (title: string) => {
      for (let i = 0; i < 100; i++) {
        try {
          const next = stateSchema.parse(await command(52));
          if (next.manualInput || next.fingerprint !== next.initial)
            throw Error("LIVE_IMPORT_MANUAL_DIALOG_CHANGED");
          if (next.title === title) return (current = next);
        } catch (error) {
          if (!String(error).includes("DIALOG_NOT_READY")) throw error;
        }
        await this.pause(100);
      }
      throw Error("LIVE_IMPORT_DIALOG_UNCONFIRMED");
    };
    const submit = async (op: number, args: Parameters<MemoryDesktop["command"]>[2] = {}) => {
      if (!current) throw Error("LIVE_IMPORT_OWNED_DIALOG_REQUIRED");
      const expected = current.fingerprint;
      current = undefined; // A lost transition/commit cannot be replayed or cancelled.
      return command(op, { ...args, expected });
    };
    try {
      if (
        (
          await command(51, {
            unit: staged.id,
            field: "import.files",
            expected: staged.manifestSha256,
          })
        ).status !== "pending"
      )
        throw Error("LIVE_IMPORT_DIALOG_UNCONFIRMED");
      await state("Import Files");
      if ((await submit(57)).browseRequested !== true)
        throw Error("LIVE_IMPORT_BROWSE_UNCONFIRMED");
      await state("Browse For Folder");
      if ((await submit(53, { field: "selectFolder" })).folderSelected !== true)
        throw Error("LIVE_IMPORT_FOLDER_UNCONFIRMED");
      await state("Browse For Folder");
      if ((await submit(53, { field: "confirmFolder" })).submitted !== true)
        throw Error("LIVE_IMPORT_FOLDER_UNCONFIRMED");
      await state("Import Files");
      if ((await submit(59, { value: prefix })).optionsSet !== true)
        throw Error("LIVE_IMPORT_PREFIX_UNCONFIRMED");
      await state("Import Files");
      if ((await submit(58)).submitted !== true) throw Error("LIVE_IMPORT_SUBMISSION_UNCONFIRMED");
      let closed = false;
      for (let i = 0; i < 100; i++) {
        const fresh = this.desktop.window
          ? await this.desktop.window(w.windowId)
          : (await this.desktop.windows()).find((x) => x.windowId === w.windowId);
        if (
          fresh?.enabled &&
          fresh.processId === w.processId &&
          fresh.processStart === w.processStart
        ) {
          closed = true;
          break;
        }
        await this.pause(100);
      }
      if (!closed) throw Error("LIVE_IMPORT_NATIVE_COMPLETION_UNKNOWN");
      await this.pause(100);
      for (const file of staged.files) {
        const actual = path.join(staged.directory, file.name),
          stat = await fs.lstat(actual);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.size !== file.size ||
          liveDigest(await fs.readFile(actual)) !== file.sha256
        )
          throw Error("LIVE_IMPORT_STAGED_SOURCE_CHANGED");
      }
      return { submitted: true, retryMutation: false };
    } catch (error) {
      if (current && !current.manualInput && current.fingerprint === current.initial) {
        try {
          await command(54, { expected: current.fingerprint });
        } catch {
          /* Leave unknown ownership alone. */
        }
      }
      throw new ComponentTransferError(
        { token, windowId: w.windowId, mode: "import.files", componentFile: staged.directory },
        error,
      );
    }
  }
}
