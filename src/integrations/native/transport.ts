import { nativeOutcome } from "./outcome.js";
import { JsonLineProcess } from "../jsonLineProcess.js";
import { nativeRelease } from "./release.js";
import { nativeQueuedMethods, nativeJobIdentity, nativeJobTerminal } from "./background.js";

export interface NativeResult {
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  structuredContent?: Record<string, any>;
  isError?: boolean;
  nativeJobReport?: Record<string, any>;
}
export interface NativeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface NativeClient {
  start(): Promise<void>;
  call(name: string, args: Record<string, unknown>): Promise<NativeResult>;
  close(): Promise<void>;
  info(): unknown;
  describe?(): NativeTool[];
}

/** A retained stdio frontend; native requests are serialized by NativeEditorBridge. */
export class NativeStdioClient implements NativeClient {
  private readonly process = new JsonLineProcess(
    {
      responseLimit: 64 * 1024 * 1024,
      notConnected: "NATIVE_NOT_CONNECTED",
      responseTooLarge: "NATIVE_PROTOCOL_RESPONSE_TOO_LARGE",
      invalidJson: "NATIVE_PROTOCOL_INVALID_JSON",
      rpcError: "NATIVE_RPC: ",
      exitError: "NATIVE_FRONTEND_EXIT_",
    },
    () => {
      this.starting = undefined;
    },
  );
  private starting?: Promise<void>;
  private serverInfo?: Record<string, unknown>;
  private tools = new Set<string>();
  private definitions: NativeTool[] = [];
  private queuedCalls = 0;
  private uncertainJob?: { stage: string; jobId?: string; reason: string };
  constructor(
    private command: string,
    private args: string[],
    private cwd: string,
  ) {}
  info() {
    return {
      connected: this.process.connected,
      server: this.serverInfo,
      tools: [...this.tools],
      queueRecoveryRequired: !!this.uncertainJob,
      ...(this.uncertainJob ? { uncertainJob: this.uncertainJob } : {}),
    };
  }
  describe() {
    return this.definitions;
  }
  start(): Promise<void> {
    return (this.starting ??= this.connect().catch((error) => {
      this.starting = undefined;
      throw error;
    }));
  }
  private async connect() {
    this.tools.clear();
    this.definitions = [];
    this.serverInfo = undefined;
    this.process.start(this.command, this.args, this.cwd);
    const initialized = await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "SC2EditorToolkit", version: "1" },
    });
    this.serverInfo = initialized.serverInfo;
    if (
      initialized.serverInfo?.name !== "sc2-native-toolkit" ||
      initialized.serverInfo?.version !== nativeRelease.version
    ) {
      await this.close();
      throw Error("NATIVE_TOOLKIT_VERSION_MISMATCH: expected " + nativeRelease.version);
    }
    this.process.notify("notifications/initialized");
    const listed = await this.rpc("tools/list", {});
    this.definitions = listed.tools;
    this.tools = new Set(listed.tools.map((tool: { name: string }) => tool.name));
  }
  private rpc(method: string, params: unknown): Promise<any> {
    return this.process.request(method, params);
  }
  async call(name: string, args: Record<string, unknown>) {
    const operation = nativeQueuedMethods[name];
    if ((operation || name === "sc2_submit_job") && this.uncertainJob)
      throw Error("NATIVE_QUEUE_RECOVERY_REQUIRED: stop the owned frontend before more work");
    await this.start();
    if (!this.tools.has(name)) throw Error("NATIVE_TOOL_UNAVAILABLE: " + name);
    // A synchronous SDK stdio handler blocks later control requests. Keep its
    // original operation and result, but use bounded queue observations instead.
    if (operation && this.tools.has("sc2_submit_job") && this.tools.has("sc2_job_wait"))
      return this.queuedCall(operation, args);
    return this.rpc("tools/call", { name, arguments: args }) as Promise<NativeResult>;
  }
  private value(raw: NativeResult) {
    if (raw.structuredContent) return raw.structuredContent;
    return JSON.parse(raw.content?.find((c) => c.type === "text")?.text ?? "{}") as Record<
      string,
      any
    >;
  }
  private async queuedCall(
    operation: string,
    args: Record<string, unknown>,
  ): Promise<NativeResult> {
    this.queuedCalls++;
    let id: string | undefined,
      stage = "submission";
    try {
      const admission = (await this.rpc("tools/call", {
        name: "sc2_submit_job",
        arguments: { operation, arguments: args },
      })) as NativeResult;
      let value = this.value(admission);
      if (admission.isError && !Object.hasOwn(value, "jobId")) return admission;
      let identity = nativeJobIdentity(value);
      id = identity.id;
      let responseError = admission.isError === true;
      if (value.operation !== operation) throw Error("NATIVE_JOB_RESPONSE_IDENTITY_MISMATCH");
      stage = "observation";
      while (!nativeJobTerminal.has(identity.state)) {
        const raw = (await this.rpc("tools/call", {
          name: "sc2_job_wait",
          arguments: { job_id: id, wait_ms: 500 },
        })) as NativeResult;
        value = this.value(raw);
        identity = nativeJobIdentity(value);
        if (identity.id !== id || value.operation !== operation)
          throw Error("NATIVE_JOB_RESPONSE_IDENTITY_MISMATCH");
        responseError = raw.isError === true;
      }
      const result = value.result;
      if (
        identity.state === "SUCCEEDED" &&
        (!result || typeof result !== "object" || Array.isArray(result))
      )
        throw Error("NATIVE_JOB_RESULT_UNCONFIRMED");
      const failed = identity.state !== "SUCCEEDED",
        structuredContent = {
          ...(result ?? {}),
          ...(failed
            ? {
                status: "FAILED",
                error: result?.error ?? value.error ?? "Native operation " + identity.state,
              }
            : {}),
          transportJob: {
            id,
            operation,
            state: identity.state,
            responseError,
            automaticRetry: false,
          },
        };
      return {
        isError:
          failed ||
          responseError ||
          ["failed", "cancelled"].includes(nativeOutcome(structuredContent) ?? ""),
        structuredContent,
        nativeJobReport: value,
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      };
    } catch (error) {
      this.uncertainJob = {
        stage,
        ...(id ? { jobId: id } : {}),
        reason: String(error).slice(0, 1000),
      };
      throw error;
    } finally {
      this.queuedCalls--;
    }
  }
  async close() {
    if (this.process.pendingCount || this.queuedCalls)
      throw Error("NATIVE_REQUEST_IN_PROGRESS: cannot abort an active native handler");
    await this.process.close();
    this.starting = undefined;
    this.tools.clear();
    this.definitions = [];
    this.serverInfo = undefined;
    this.uncertainJob = undefined;
  }
}
