import { promises as fs } from "node:fs";
import { transferDirectory } from "./transferDirectory.js";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import * as z from "zod/v4";
import type { MemoryDesktop } from "./memoryDesktop.js";
import type { EditorWindow } from "./desktop.js";
import { libraryLimit, triggerLibrarySignature } from "./triggerLibrary.js";

const response = z.record(z.string(), z.unknown());
const dialogSchema = z.object({
  fingerprint: z.string(),
  initial: z.string(),
  manualInput: z.boolean(),
  controls: z.array(z.object({ id: z.number(), type: z.string(), text: z.string() })),
});
export class ComponentTransferError extends Error {
  constructor(
    readonly recoveryContext: {
      token: string;
      windowId: string;
      mode: string;
      componentFile: string;
    },
    cause: unknown,
  ) {
    super(String(cause), { cause });
    this.name = "ComponentTransferError";
  }
}

/** Original modal commands under a caller-held process lease. No map archive I/O. */
export class ComponentTransfer {
  constructor(
    private readonly desktop: MemoryDesktop,
    private readonly pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}
  private async command(
    w: EditorWindow,
    op: number,
    args: Parameters<MemoryDesktop["command"]>[2],
  ) {
    const value = response.parse(await this.desktop.command(w, op, args));
    if (value.status === "unknown" || value.error)
      throw Error(String(value.error ?? "LIVE_COMPONENT_NATIVE_UNKNOWN"));
    return value;
  }
  private async location(w: EditorWindow, id: string, suffix = ".SC2Lib") {
    const directory = await transferDirectory(this.desktop, w, "components");
    return path.join(directory, id + suffix);
  }
  /** Export/import one locale using the original two-stage component dialog.
   * Only a component file enters the original editor; the open map is untouched by I/O. */
  async locale(w: EditorWindow, locale: string, source?: string) {
    if (!/^[a-z]{2}[A-Z]{2}$/.test(locale)) throw Error("LIVE_LOCALE_INVALID");
    const token = randomUUID(),
      id = randomUUID(),
      file = await this.location(w, id, ".txt");
    if (source !== undefined) {
      if (!source.length || Buffer.byteLength(source) > 1024 * 1024 || source.includes("\0"))
        throw Error("LIVE_LOCALE_SOURCE_BOUND");
      await fs.writeFile(file, source, { flag: "wx" });
      await fs.writeFile(await this.location(w, id, `_${locale}.txt`), source, { flag: "wx" });
    }
    const title = source === undefined ? "Export Localized Text" : "Import Localized Text";
    const schema = dialogSchema.extend({
      title: z.string(),
      controls: z.array(
        z.object({
          id: z.number(),
          type: z.string(),
          text: z.string(),
          checked: z.number().optional(),
          tree: z
            .object({
              truncated: z.boolean(),
              items: z.array(z.object({ text: z.string(), stateImage: z.number() })),
            })
            .optional(),
        }),
      ),
    });
    let current: z.infer<typeof schema> | undefined;
    const state = async (accept: (s: z.infer<typeof schema>) => boolean) => {
      for (let i = 0; i < 100; i++) {
        let next: z.infer<typeof schema> | undefined;
        try {
          next = schema.parse(await this.command(w, 52, { token }));
        } catch (error) {
          if (!String(error).includes("DIALOG_NOT_READY")) throw error;
        }
        if (next) {
          if (next.manualInput || next.fingerprint !== next.initial)
            throw Error("LIVE_COMPONENT_MANUAL_DIALOG_CHANGED");
          if (accept(next)) return (current = next);
        }
        await this.pause(100);
      }
      throw Error("LIVE_LOCALE_DIALOG_UNCONFIRMED");
    };
    const submit = async (
      op: number,
      args: NonNullable<Parameters<MemoryDesktop["command"]>[2]> = {},
    ) => {
      if (!current) throw Error("LIVE_COMPONENT_OWNED_DIALOG_REQUIRED");
      const expected = current.fingerprint;
      current = undefined; // Never cancel or replay an uncertain transition/write.
      return this.command(w, op, { ...args, token, expected });
    };
    try {
      const begin = await this.command(w, 51, {
        unit: id,
        field: source === undefined ? "locale.export" : "locale.import",
        token,
        ...(source === undefined
          ? {}
          : { expected: createHash("sha256").update(source).digest("hex"), value: locale }),
      });
      if (begin.status !== "pending") throw Error("LIVE_COMPONENT_DIALOG_UNCONFIRMED");
      await state((s) => s.title === title);
      if ((await submit(57)).browseRequested !== true)
        throw Error("LIVE_LOCALE_BROWSE_UNCONFIRMED");
      await state(
        (s) =>
          s.title === "Choose File" &&
          s.controls.some(
            (c) =>
              c.id === 1 &&
              c.type === "Button" &&
              c.text.replaceAll("&", "") === (source === undefined ? "Save" : "Open"),
          ),
      );
      if ((await submit(53)).submitted !== true)
        throw Error("LIVE_COMPONENT_SUBMISSION_UNCONFIRMED");
      await state(
        (s) =>
          s.title === title &&
          s.controls.some(
            (c) =>
              c.type === "Static" &&
              (c.text.endsWith(id + ".txt") || c.text.endsWith(`${id}_${locale}.txt`)),
          ),
      );
      const options = await submit(59, { field: locale, value: "editor" });
      if (options.optionsSet !== true) throw Error("LIVE_LOCALE_OPTIONS_UNCONFIRMED");
      await state((s) => s.title === title);
      const configured = current!,
        tree = configured.controls.find((c) => c.id === 14 && c.type === "SysTreeView32")?.tree;
      if (
        !tree ||
        tree.truncated ||
        !tree.items.length ||
        tree.items.filter((n) => n.stateImage === 2).length !== 1 ||
        !tree.items.some((n) => n.text.endsWith(`<${locale}>`) && n.stateImage === 2) ||
        configured.controls.find((c) => c.id === 15 && c.type === "Button")?.checked !== 1
      )
        throw Error("LIVE_LOCALE_OPTIONS_UNCONFIRMED");
      if ((await submit(58)).submitted !== true)
        throw Error("LIVE_COMPONENT_SUBMISSION_UNCONFIRMED");
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
      if (!closed) throw Error("LIVE_COMPONENT_NATIVE_COMPLETION_UNKNOWN");
      await this.pause(100); // Original deferred handler's guard-release timer.
      if (source !== undefined) {
        for (const input of [file, await this.location(w, id, `_${locale}.txt`)]) {
          const stat = await fs.lstat(input);
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.size !== Buffer.byteLength(source) ||
            !(await fs.readFile(input)).equals(Buffer.from(source))
          )
            throw Error("LIVE_LOCALE_SOURCE_CHANGED_DURING_IMPORT");
        }
        return { submitted: true, file, sourceUnchanged: true, retryMutation: false };
      }
      const output = await this.location(w, id, `_${locale}.txt`);
      const stat = await fs.lstat(output);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
        throw Error("LIVE_LOCALE_EXPORTED_FILE_INVALID");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await fs.readFile(output));
      if (text.includes("\0")) throw Error("LIVE_LOCALE_EXPORTED_FILE_INVALID");
      return { submitted: true, file: output, source: text, retryMutation: false };
    } catch (error) {
      if (current && !current.manualInput && current.fingerprint === current.initial) {
        try {
          await this.command(w, 54, { token, expected: current.fingerprint });
        } catch {
          /* Preserve uncertain ownership. */
        }
      }
      throw new ComponentTransferError(
        {
          token,
          windowId: w.windowId,
          mode: source === undefined ? "locale.export" : "locale.import",
          componentFile: file,
        },
        error,
      );
    }
  }
  private async dialog(
    w: EditorWindow,
    mode: string,
    args: NonNullable<Parameters<MemoryDesktop["command"]>[2]>,
    submission: (state: z.infer<typeof dialogSchema>) => {
      op: number;
      args?: NonNullable<Parameters<MemoryDesktop["command"]>[2]>;
    },
  ) {
    const token = randomUUID();
    let current: z.infer<typeof dialogSchema> | undefined;
    const begin = await this.command(w, 51, {
      ...args,
      token,
      field: mode,
    });
    if (begin.status !== "pending") throw Error("LIVE_COMPONENT_DIALOG_UNCONFIRMED");
    try {
      for (let i = 0; i < 40; i++) {
        try {
          current = dialogSchema.parse(await this.command(w, 52, { token }));
          break;
        } catch (error) {
          if (!String(error).includes("DIALOG_NOT_READY")) throw error;
        }
        await this.pause(50);
      }
      if (!current || current.manualInput || current.fingerprint !== current.initial)
        throw Error("LIVE_COMPONENT_MANUAL_DIALOG_CHANGED");
      const next = submission(current),
        expected = current.fingerprint;
      current = undefined; // Unknown submission must not cancel or replay a mutation.
      const submitted = await this.command(w, next.op, { ...next.args, token, expected });
      if (submitted.submitted !== true) throw Error("LIVE_COMPONENT_SUBMISSION_UNCONFIRMED");
      let closed = false;
      for (let i = 0; i < 60; i++) {
        const fresh = (await this.desktop.windows()).find(
          (x) =>
            x.windowId === w.windowId &&
            x.processId === w.processId &&
            x.processStart === w.processStart,
        );
        if (fresh?.enabled) {
          closed = true;
          break;
        }
        await this.pause(100);
      }
      if (!closed) throw Error("LIVE_COMPONENT_NATIVE_COMPLETION_UNKNOWN");
      return submitted;
    } catch (error) {
      if (current && !current.manualInput && current.fingerprint === current.initial) {
        try {
          await this.command(w, 54, { token, expected: current.fingerprint });
        } catch {
          /* Preserve uncertain native ownership. */
        }
      }
      throw error;
    }
  }
  async layout(w: EditorWindow, name: string) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(name)) throw Error("LIVE_LAYOUT_NAME_INVALID");
    return this.dialog(w, "layout.add", { unit: randomUUID() }, (state) => {
      if (
        state.controls.filter((c) => c.id === 13 && c.type === "Edit").length !== 1 ||
        state.controls.filter(
          (c) => c.id === 11 && c.type === "Button" && c.text.replaceAll("&", "") === "OK",
        ).length !== 1
      )
        throw Error("LIVE_LAYOUT_NAME_DIALOG_REQUIRED");
      return { op: 56, args: { value: name } };
    });
  }
  async library(w: EditorWindow, source?: string) {
    const id = randomUUID(),
      file = await this.location(w, id);
    if (source !== undefined) {
      triggerLibrarySignature(source);
      await fs.writeFile(file, source, { flag: "wx" });
    }
    const mode = source === undefined ? "library.export" : "library.import";
    await this.dialog(
      w,
      mode,
      {
        unit: id,
        ...(source === undefined
          ? {}
          : { expected: createHash("sha256").update(source).digest("hex") }),
      },
      (state) => {
        const accept = state.controls.filter(
          (c) =>
            c.id === 1 &&
            c.type === "Button" &&
            ["Save", "Open"].includes(c.text.replaceAll("&", "")),
        );
        if (accept.length !== 1) throw Error("LIVE_COMPONENT_FILE_DIALOG_REQUIRED");
        return { op: 53 };
      },
    );
    if (source !== undefined) return { submitted: true, file, retryMutation: false };
    let previous: Buffer | undefined,
      stable = 0;
    for (let i = 0; i < 60; i++) {
      try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > libraryLimit)
          throw Error("LIVE_COMPONENT_EXPORTED_FILE_INVALID");
        const bytes = await fs.readFile(file);
        stable = previous?.equals(bytes) ? stable + 1 : 0;
        previous = bytes;
        if (stable >= 2 && bytes.toString("utf8").trimEnd().endsWith("</TriggerData>")) {
          const text = bytes.toString("utf8");
          triggerLibrarySignature(text);
          return { submitted: true, file, source: text, retryMutation: false };
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await this.pause(100);
    }
    throw Error("LIVE_COMPONENT_EXPORT_UNCONFIRMED");
  }
}
