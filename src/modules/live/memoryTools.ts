import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { memoryReadSchema, memoryValueSchema, type LiveMemory } from "./memory.js";

const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});
export function registerMemoryTools(server: McpServer, memory: LiveMemory) {
  server.registerTool(
    "live.memory.capabilities",
    {
      description:
        "Scope and build requirements for direct in-memory edits in an existing visible Editor. Separate adapter, no hidden test worker or map reopen. Currently existing map-local Unit numeric fields only.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    },
    async () => result(memory.capabilities()),
  );
  server.registerTool(
    "live.memory.read",
    {
      description:
        "Read a complete numeric Unit field from the explicitly selected open Data Editor and issue a 90-second single-use snapshot. Explicitly loads our separate visible Data DLL. Uses and cancels the original inline editor; may mark the document dirty. Preserves unsaved values and never saves/reopens the map. Disconnect checkpoint sessions first.",
      inputSchema: memoryReadSchema,
    },
    async (args) => result(await memory.read(args)),
  );
  server.registerTool(
    "live.memory.set",
    {
      description:
        "Change one Unit numeric field directly in the open Editor using a live.memory.read snapshot. Rechecks process/document, source archive, map-local ownership and current complete value. Original native editing and readback; no disk write/reopen. Applied means verified field value, not rendering/gameplay acceptance. Unknown commits are never retried.",
      inputSchema: z.object({ snapshotId: z.string().uuid(), value: memoryValueSchema }).strict(),
    },
    async (args) => result(await memory.set(args.snapshotId, args.value)),
  );
}
