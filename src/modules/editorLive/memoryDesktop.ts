import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { WindowsLiveDesktop, editorWindowSchema, type EditorWindow } from "./desktop.js";
import * as z from "zod/v4";
import { existsSync } from "node:fs";
import type { DocumentIdentityReader } from "./documentIdentity.js";

export interface MemoryDesktop extends DocumentIdentityReader {
  close?(): Promise<void>;
  windows(): Promise<EditorWindow[]>;
  window?(windowId: string): Promise<EditorWindow | undefined>;
  temporaryDirectory?(window: EditorWindow): Promise<string>;
  componentDirectory?(window: EditorWindow): Promise<string>;
  documentState?(window: EditorWindow): Promise<unknown>;
  command(
    window: EditorWindow,
    operation: number,
    args?: {
      unit?: string;
      field?: string;
      expected?: string;
      value?: string;
      token?: string;
    },
  ): Promise<unknown>;
}

/** Explicit opt-in to our visible Data adapter; never the hidden test bridge. */
export class WindowsMemoryDesktop extends WindowsLiveDesktop implements MemoryDesktop {
  private child?: ChildProcessWithoutNullStreams;
  private exited?: Promise<void>;
  private pending?: {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
    nullable: boolean;
  };
  private uncertain = false;
  private buffer = "";

  private start() {
    if (process.platform !== "win32") throw Error("LIVE_WINDOWS_REQUIRED");
    if (!existsSync(this.executable)) throw Error("LIVE_BRIDGE_NOT_BUILT: npm run live:build");
    if (this.child) return;
    const child = spawn(this.executable, ["memory-stdio"], { windowsHide: true, stdio: "pipe" });
    this.child = child;
    this.exited = new Promise((resolve) =>
      child.once("close", () => {
        this.uncertain = true;
        if (this.pending) {
          clearTimeout(this.pending.timer);
          this.pending.reject(Error("LIVE_MEMORY_BRIDGE_EXITED"));
          this.pending = undefined;
        }
        resolve();
      }),
    );
    child.on("error", (error) => {
      this.uncertain = true;
      if (this.pending) clearTimeout(this.pending.timer);
      this.pending?.reject(error);
    });
    child.stdin.on("error", (error) => {
      this.uncertain = true;
      if (this.pending) clearTimeout(this.pending.timer);
      this.pending?.reject(error);
    });
    child.stderr.on("data", () => {});
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (part: string) => {
      this.buffer += part;
      if (this.buffer.length > 256 * 1024) {
        this.uncertain = true;
        if (this.pending) clearTimeout(this.pending.timer);
        this.pending?.reject(Error("LIVE_MEMORY_RESPONSE_BOUND"));
        return;
      }
      let end;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        const pending = this.pending;
        this.pending = undefined;
        if (!pending) {
          this.uncertain = true;
          continue;
        }
        clearTimeout(pending.timer);
        try {
          const result = JSON.parse(line);
          if (result === null ? !pending.nullable : typeof result !== "object")
            throw Error("LIVE_MEMORY_RESPONSE_INVALID");
          if (result?.error) pending.reject(Error(String(result.error)));
          else pending.resolve(result);
        } catch (error) {
          this.uncertain = true;
          pending.reject(error instanceof Error ? error : Error(String(error)));
        }
      }
    });
  }

  private request(args: string[]): Promise<unknown> {
    if (this.uncertain || this.pending)
      return Promise.reject(Error("LIVE_MEMORY_BRIDGE_UNCERTAIN_OR_BUSY"));
    this.start();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.uncertain = true;
        reject(Error("LIVE_MEMORY_BRIDGE_TIMEOUT_UNCERTAIN"));
      }, 45000);
      this.pending = { resolve, reject, timer, nullable: args[0] === "window" };
      this.child!.stdin.write(JSON.stringify(args) + "\n", (error) => {
        if (error) {
          this.uncertain = true;
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  override async windows() {
    return z
      .array(editorWindowSchema)
      .max(32)
      .parse(await this.request(["list"]));
  }
  async window(windowId: string) {
    if (!/^\d+$/.test(windowId)) throw Error("LIVE_WINDOW_ID_INVALID");
    const value = await this.request(["window", windowId]);
    return value == null ? undefined : editorWindowSchema.parse(value);
  }
  documentIdentity(window: EditorWindow, archive: string) {
    return this.request([
      "archive-owner",
      window.windowId,
      String(window.processId),
      window.processStart,
      window.title,
      archive,
    ]);
  }
  async temporaryDirectory(window: EditorWindow) {
    return z
      .object({ temporaryDirectory: z.string().min(1).max(259) })
      .parse(await this.command(window, 64)).temporaryDirectory;
  }
  async componentDirectory(window: EditorWindow) {
    return z
      .object({ componentDirectory: z.string().min(1).max(259) })
      .parse(await this.command(window, 64)).componentDirectory;
  }
  documentState(window: EditorWindow) {
    return this.command(window, 25);
  }
  async close() {
    this.child?.stdin.end();
    await this.exited;
  }
  command(
    window: EditorWindow,
    operation: number,
    args: {
      unit?: string;
      field?: string;
      expected?: string;
      value?: string;
      token?: string;
    } = {},
  ) {
    return this.request([
      "memory-command",
      window.windowId,
      String(window.processId),
      window.processStart,
      window.title,
      String(operation),
      args.unit ?? "",
      args.field ?? "",
      args.expected ?? "",
      args.value ?? "",
      args.token ?? "",
    ]);
  }
}
