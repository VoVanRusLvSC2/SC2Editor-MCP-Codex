import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RefreshCompiler } from "../modules/editorLive/refreshCompile.js";
import type { Project } from "./project.js";

/** Wire the existing live-session and optional native bridge without exposing either implementation to the other. */
export function registerLiveCompileTools(server: McpServer, project: Project) {
  const compiler = new RefreshCompiler({
    snapshot: (sessionId) => project.live.current.refresh.compileSnapshot({ sessionId }),
    submit: (archive) =>
      project.nativeGate.protect(project.nativeEditor).check({
        archive,
        checks: ["compile"],
        includeDiffs: false,
        deadlineSeconds: 1200,
      }),
    job: (id) => project.nativeGate.protect(project.nativeEditor).job(id),
    adopt: (sessionId, jobId) => project.live.current.refresh.adoptCompiled({ sessionId, jobId }),
    current: (sessionId) => project.live.current.refresh.isCompiledCurrent(sessionId),
    active: (sessionId) => project.live.current.refresh.hasSession(sessionId),
  });
  const schema = z.object({ sessionId: z.string().uuid() }).strict();
  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  });
  server.registerTool(
    "live.refresh.compile_begin",
    {
      description:
        "Create a guarded internal snapshot and submit one unscoped native Editor compilation in an owned hidden worker. An active job is never replayed. After a confirmed compile_failed, retryFailed=true explicitly submits a new job after corrections. After successful adoption, unchanged components return prepared; changed components start a new compilation. Observe with compile_finish; unknown submission or adoption is never automatically retried.",
      inputSchema: schema.extend({ retryFailed: z.boolean().default(false) }).strict(),
    },
    async ({ sessionId, retryFailed }) => result(await compiler.begin(sessionId, retryFailed)),
  );
  server.registerTool(
    "live.refresh.compile_finish",
    {
      description:
        "Observe the owned compilation job for up to waitMs (default 20000, maximum 30000); when passed, adopt its exact verified Galaxy into the unchanged prepared session. A changed session returns compile_stale: run compile_begin again. Pending jobs are never restarted and uncertain adoption is not replayed. Apply separately through live.refresh.apply. Compilation does not establish gameplay.",
      inputSchema: schema
        .extend({ waitMs: z.number().int().min(0).max(30000).default(20000) })
        .strict(),
    },
    async ({ sessionId, waitMs }) => result(await compiler.finish(sessionId, waitMs)),
  );
  server.registerTool(
    "live.refresh.compile_apply",
    {
      description:
        "Explicitly save the prepared changes to the same open map after its already-started native compilation succeeds. Observe/adopt for up to waitMs, then invoke the normal guarded same-file refresh exactly once. Pending, failed, stale or unknown compilation never applies. A reload resets native Undo; an uncertain refresh must use live.refresh.recover, never repeat the apply.",
      inputSchema: schema
        .extend({ waitMs: z.number().int().min(0).max(30000).default(20000) })
        .strict(),
    },
    async ({ sessionId, waitMs }) => {
      const compilation = await compiler.finish(sessionId, waitMs);
      if (compilation.status !== "prepared") return result(compilation);
      const applied = await project.live.current.refresh.apply({ sessionId });
      return result({ ...applied, nativeCompilePassed: true, gameplayVerified: false });
    },
  );
}
