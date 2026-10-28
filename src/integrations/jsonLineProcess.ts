import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

interface ProcessPolicy {
  responseLimit: number;
  requestLimit?: number;
  notConnected: string;
  responseTooLarge: string;
  requestTooLarge?: string;
  invalidJson: string;
  rpcError: string;
  exitError: string;
  endOnProtocolFailure?: boolean;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/** Shared process/framing mechanics. Native job/session policy stays in each client. */
export class JsonLineProcess {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private sequence = 0;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(
    private readonly policy: ProcessPolicy,
    private readonly disconnected: () => void,
  ) {}

  get connected(): boolean {
    return !!this.child && !this.child.killed;
  }
  get pendingCount(): number {
    return this.pending.size;
  }

  start(command: string, args: string[], cwd: string): void {
    if (this.child) throw new Error("RPC_PROCESS_ALREADY_CONNECTED");
    this.buffer = "";
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stderr.resume();
    const fail = (error: Error) => {
      // A late event from an old process cannot invalidate a newer connection.
      if (this.child !== child) return;
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
      this.child = undefined;
      this.disconnected();
    };
    const protocolFailure = (code: string) => {
      fail(new Error(code));
      if (this.policy.endOnProtocolFailure) child.stdin.end();
    };
    child.on("error", fail);
    child.on("exit", (code) => fail(new Error(this.policy.exitError + code)));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (part: string) => {
      if (this.child !== child) return;
      this.buffer += part;
      if (this.buffer.length > this.policy.responseLimit) {
        protocolFailure(this.policy.responseTooLarge);
        return;
      }
      let end: number;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        if (!line.trim()) continue;
        let response: unknown;
        try {
          response = JSON.parse(line);
        } catch {
          protocolFailure(this.policy.invalidJson);
          return;
        }
        if (!response || typeof response !== "object" || Array.isArray(response)) {
          protocolFailure(this.policy.invalidJson);
          return;
        }
        const body = response as Record<string, unknown>;
        if (typeof body.id !== "number") continue; // Notifications have no request ID.
        const request = this.pending.get(body.id);
        if (!request) continue;
        this.pending.delete(body.id);
        if (body.error)
          request.reject(new Error(this.policy.rpcError + JSON.stringify(body.error)));
        else request.resolve(body.result);
      }
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    const child = this.child;
    if (!child) return Promise.reject(new Error(this.policy.notConnected));
    const id = ++this.sequence;
    const line = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    if (this.policy.requestLimit && Buffer.byteLength(line) > this.policy.requestLimit)
      return Promise.reject(new Error(this.policy.requestTooLarge));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(line, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  notify(method: string): void {
    if (!this.child) throw new Error(this.policy.notConnected);
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  }

  /** EOF preserves the Toolkit's graceful owned-handler shutdown policy. */
  async close(): Promise<void> {
    if (this.pending.size) throw new Error("RPC_REQUEST_IN_PROGRESS");
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.stdin.end();
    });
    if (this.child === child) this.child = undefined;
  }
}
