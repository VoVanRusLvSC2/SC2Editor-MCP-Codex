import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
export interface CascEntry { path: string; size: number; local: boolean; contentKey: string; encodingKey: string; localeFlags: number; nameType: number }
export interface CascPage { items: CascEntry[]; total: number; nextOffset: number | null }
export interface CascRead { path: string; size: number; offset: number; contentKey: string; encodingKey: string; base64: string }
export interface CascBackend {
  info(): Promise<Record<string, unknown>>;
  list(prefix: string, query: string, offset: number, limit: number): Promise<CascPage>;
  inspect(file: string): Promise<CascEntry>;
  read(file: string, offset: number, length: number): Promise<CascRead>;
  close(): void;
}
export const bundledCascHelper = () => fileURLToPath(new URL(`../../../native/bin/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}/sc2-mcp-casc${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));

/** Persistent local-only subprocess: native MNDX/index parsing runs once per session. */
export class NativeCascBackend implements CascBackend {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 0;
  constructor(readonly install: string, readonly helper = bundledCascHelper(), readonly timeoutMs = 30000) {}
  private start() {
    if (this.child) return this.child;
    const child = spawn(this.helper, [this.install], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    let buffer = "", stderr = "";
    const fail = (error: Error) => { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear(); };
    child.stdin.on("error", fail);
    child.stderr.on("data", data => { stderr = (stderr + data.toString()).slice(-16000); });
    child.stdout.setEncoding("utf8").on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 24 * 1024 * 1024) { fail(new Error("CASC_NATIVE_RESPONSE_BUDGET")); child.kill(); return; }
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const response = JSON.parse(line), item = this.pending.get(response.id);
          if (!item) continue;
          this.pending.delete(response.id); clearTimeout(item.timer);
          if (response.error) item.reject(new Error(response.error)); else item.resolve(response.result);
        } catch (error) { fail(new Error("CASC_NATIVE_INVALID_JSON", { cause: error })); child.kill(); }
      }
    });
    child.once("error", error => { this.child = undefined; fail(error); });
    child.once("exit", code => { this.child = undefined; fail(new Error(`CASC_NATIVE_EXIT:${code}:${stderr}`)); });
    return child;
  }
  private request<T>(op: string, ...args: Array<string | number>): Promise<T> {
    if (args.some(value => /[\r\n\t]/.test(String(value)))) return Promise.reject(new Error("CASC_PROTOCOL_DELIMITER_REFUSED"));
    const child = this.start(), id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("CASC_NATIVE_TIMEOUT")); child.kill(); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write([id, op, ...args].join("\t") + "\n");
    });
  }
  info() { return this.request<Record<string, unknown>>("info"); }
  list(prefix: string, query: string, offset: number, limit: number) { return this.request<CascPage>("list", prefix, query, offset, limit); }
  inspect(file: string) { return this.request<CascEntry>("inspect", file); }
  read(file: string, offset: number, length: number) { return this.request<CascRead>("read", file, offset, length); }
  close() { this.child?.stdin.end(); }
}
