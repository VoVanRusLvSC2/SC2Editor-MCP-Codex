import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { LiveRuntimeFactory, LiveWorkspace } from "./workspace.js";
import { registerMemoryTools } from "./memoryTools.js";

const sessionId = z.string().uuid();
const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerLiveTools(
  server: McpServer,
  live: LiveWorkspace,
  factory: LiveRuntimeFactory,
) {
  live.runtimeFactory = factory;
  registerMemoryTools(server, live.memory);
  server.registerTool(
    "live.capabilities",
    {
      description:
        "Read-only connectivity/routing check; no save or live.connect required, including unsaved documents. Reports saved-checkpoint and separate opt-in live.memory scope. Memory edits support existing Unit numeric fields only, not general live Terrain authoring.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    },
    async () => result(live.capabilities()),
  );
  server.registerTool(
    "live.windows",
    {
      description:
        "Read-only connectivity/window inspection, including unsaved documents; no save or live.connect required. Lists existing Editor window/process identities, titles and file-drop availability. For live.memory edits select the matching Data window, even if the panel belongs to Terrain. Does not start or inject Editor.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    },
    async () => result(await live.windows()),
  );
  server.registerTool(
    "live.connect",
    {
      description:
        "Saved-checkpoint workflow ONLY: import an explicitly selected saved SC2Map/SC2Mod into a private authoring copy. This is not a connectivity test or prerequisite for live.memory edits. Only this workflow requires saving unsaved Editor changes first. Exact window/title guards apply; the source archive is never overwritten.",
      inputSchema: z
        .object({
          archive: z.string().min(1).max(4096),
          windowId: z.string().regex(/^\d+$/).optional(),
        })
        .strict(),
    },
    async (a) => result(await live.connect(a.archive, a.windowId)),
  );
  server.registerTool(
    "live.status",
    {
      description:
        "Read bound Editor/document identity, save/pull requirements and pending checkpoint. An observed title does not prove visual refresh or native compilation.",
      inputSchema: z.object({ sessionId }).strict(),
      annotations: { readOnlyHint: true },
    },
    async (a) => result(await live.status(a.sessionId)),
  );
  server.registerTool(
    "live.author",
    {
      description:
        "Run compact modkit.author commands in this live session's persistent imported project. Uses existing schemas, recipes, staging and save guards. Does not yet change the visible map; publish a completed batch.",
      inputSchema: z
        .object({
          sessionId,
          script: z.string().min(1).max(65536),
          mode: z.enum(["plan", "stage", "save"]).default("plan"),
        })
        .strict(),
    },
    async (a, context) =>
      live.call(
        a.sessionId,
        "modkit.author",
        { script: a.script, mode: a.mode },
        context,
      ) as Promise<any>,
  );
  server.registerTool(
    "live.call",
    {
      description:
        "Invoke an existing authoring tool against the bound session project. Original tool schema/defaults apply. No native test workers, game launch or nested live calls. Use for advanced operations beyond live.author.",
      inputSchema: z
        .object({
          sessionId,
          tool: z.string().min(1).max(128),
          arguments: z.record(z.string(), z.unknown()).default({}),
        })
        .strict(),
    },
    async (a, context) => live.call(a.sessionId, a.tool, a.arguments, context) as Promise<any>,
  );
  server.registerTool(
    "live.publish",
    {
      description:
        "Export a verified new checkpoint without replacing the user's source. present=true requests one normal file-open handoff in the same Editor, preserving native save dialogs. It is not direct in-memory application; unsupported file drop returns a manual-open path.",
      inputSchema: z.object({ sessionId, present: z.boolean().default(false) }).strict(),
    },
    async (a) => result(await live.publish(a.sessionId, a.present)),
  );
  server.registerTool(
    "live.present",
    {
      description:
        "Request opening the prepared checkpoint in the bound visible Editor once. Dirty/modal Editors require user save/finish first. Uncertain submissions are never automatically replayed.",
      inputSchema: z.object({ sessionId }).strict(),
    },
    async (a) => result(await live.present(a.sessionId)),
  );
  server.registerTool(
    "live.pull",
    {
      description:
        "Import the user's newly saved Editor archive into a fresh session revision. Refuses pending MCP drafts or saved local changes; retains both versions rather than overwriting them.",
      inputSchema: z.object({ sessionId }).strict(),
    },
    async (a) => result(await live.pull(a.sessionId)),
  );
  server.registerTool(
    "live.disconnect",
    {
      description:
        "Release session authoring resources. Never closes the visible Editor or deletes source/checkpoint files.",
      inputSchema: z.object({ sessionId }).strict(),
    },
    async (a) => result(await live.disconnect(a.sessionId)),
  );
}
