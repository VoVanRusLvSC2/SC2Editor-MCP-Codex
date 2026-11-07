import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";

export const editorWindowSchema = z
  .object({
    windowId: z.string().regex(/^\d+$/),
    processId: z.number().int().positive(),
    processStart: z.string().regex(/^\d+$/),
    title: z.string().max(8192),
    enabled: z.boolean(),
    acceptsFiles: z.boolean(),
  })
  .strict();
export type EditorWindow = z.infer<typeof editorWindowSchema>;
export interface LiveDesktop {
  windows(): Promise<EditorWindow[]>;
  present(window: EditorWindow, archive: string): Promise<unknown>;
}

/** Public Windows file-drop handoff only. No injection, keyboard input or worker launch. */
export class WindowsLiveDesktop implements LiveDesktop {
  private readonly executable =
    process.env.SC2_LIVE_BRIDGE ??
    fileURLToPath(new URL("../../../native/bin/windows-x64/sc2-mcp-live.exe", import.meta.url));

  private run(args: string[]): Promise<unknown> {
    if (process.platform !== "win32") throw Error("LIVE_WINDOWS_REQUIRED");
    if (!existsSync(this.executable)) throw Error("LIVE_BRIDGE_NOT_BUILT: npm run live:build");
    return new Promise((resolve, reject) => {
      execFile(
        this.executable,
        args,
        { windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024 },
        (error, stdout) => {
          if (error) return reject(new Error("LIVE_DESKTOP_FAILED: " + error.message));
          try {
            const result = JSON.parse(stdout);
            if (result.error) throw Error(String(result.error));
            resolve(result);
          } catch (cause) {
            reject(cause);
          }
        },
      );
    });
  }

  async windows() {
    return z
      .array(editorWindowSchema)
      .max(32)
      .parse(await this.run(["list"]));
  }

  present(window: EditorWindow, archive: string) {
    return this.run([
      "open",
      window.windowId,
      String(window.processId),
      window.processStart,
      window.title,
      archive,
    ]);
  }
}

export function documentMatches(window: EditorWindow, archive: string): boolean {
  const normalized = window.title.replaceAll("\\", "/").toLowerCase();
  const expected = archive.replaceAll("\\", "/").toLowerCase();
  if (normalized.includes("[" + expected + "]") || normalized.includes("[" + expected + "*]"))
    return true;
  // SC2 itself abbreviates long paths, including GetWindowText. Keep the root
  // and a multi-directory suffix; never accept a basename-only title.
  const titlePath = normalized.match(/\[(.+?)\*?\] - starcraft ii editor$/)?.[1];
  if (!titlePath) return false;
  const parts = titlePath.split(/\.\.\.|…/);
  if (parts.length !== 2) return false;
  const [prefix, suffix] = parts;
  return (
    /^[a-z]:\/$/.test(prefix) &&
    suffix.startsWith("/") &&
    suffix.split("/").filter(Boolean).length >= 3 &&
    suffix.length >= 20 &&
    expected.startsWith(prefix) &&
    expected.endsWith(suffix) &&
    expected.length > prefix.length + suffix.length
  );
}

export const documentDirty = (window: EditorWindow) => /\*\]/.test(window.title);
