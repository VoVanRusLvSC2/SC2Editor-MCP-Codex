import { JsonLineProcess } from "../jsonLineProcess.js";
export interface GameResult {
  [key: string]: unknown;
  content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  >;
  structuredContent?: Record<string, any>;
  isError?: boolean;
}

export interface GameTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface GameClient {
  start(): Promise<void>;
  call(name: string, args: Record<string, unknown>): Promise<GameResult>;
  close(): Promise<void>;
  tools(): GameTool[];
  info(): unknown;
}

/** Private external runtime: no upstream source or binaries are bundled here. */
export class GameStdioClient implements GameClient {
  private readonly process = new JsonLineProcess(
    {
      responseLimit: 32 * 1024 * 1024,
      requestLimit: 1024 * 1024,
      notConnected: "GAME_NOT_CONNECTED",
      responseTooLarge: "GAME_RESPONSE_TOO_LARGE",
      requestTooLarge: "GAME_REQUEST_TOO_LARGE",
      invalidJson: "GAME_INVALID_JSON",
      rpcError: "GAME_RPC: ",
      exitError: "GAME_FRONTEND_EXIT_",
      endOnProtocolFailure: true,
    },
    () => {
      this.starting = undefined;
    },
  );
  private starting?: Promise<void>;
  private listed: GameTool[] = [];
  private server?: Record<string, unknown>;
  constructor(
    private command: string,
    private args: string[],
    private cwd: string,
  ) {}
  tools() {
    return this.listed;
  }
  info() {
    return {
      connected: this.process.connected,
      server: this.server,
      toolCount: this.listed.length,
    };
  }
  start() {
    return (this.starting ??= this.connect().catch((e) => {
      this.starting = undefined;
      throw e;
    }));
  }
  private async connect() {
    this.listed = [];
    this.server = undefined;
    this.process.start(this.command, this.args, this.cwd);
    const initialized = await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "SC2EditorToolkit-game", version: "1" },
    });
    this.server = initialized.serverInfo;
    if (this.server?.name !== "sc2-game-toolkit" || this.server?.version !== "0.1.0-dev") {
      await this.close();
      throw Error("GAME_TOOLKIT_VERSION_MISMATCH");
    }
    this.process.notify("notifications/initialized");
    const result = await this.rpc("tools/list", {});
    this.listed = result.tools;
    if (!Array.isArray(this.listed) || !this.listed.some((t) => t.name === "game.attach")) {
      await this.close();
      throw Error("GAME_TOOLKIT_CONTRACT_MISMATCH");
    }
  }
  private rpc(method: string, params: unknown): Promise<any> {
    return this.process.request(method, params);
  }
  async call(name: string, args: Record<string, unknown>) {
    await this.start();
    if (!this.listed.some((t) => t.name === name)) throw Error("GAME_TOOL_UNAVAILABLE: " + name);
    return this.rpc("tools/call", { name, arguments: args });
  }
  async close() {
    if (this.process.pendingCount) throw Error("GAME_REQUEST_IN_PROGRESS");
    await this.process.close();
    this.starting = undefined;
    this.listed = [];
    this.server = undefined;
  }
}
