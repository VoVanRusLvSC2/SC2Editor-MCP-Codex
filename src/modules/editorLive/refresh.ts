import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import type { Workspace } from "../../core/workspace.js";
import { directoryManifest, extractArchive } from "../../archive/archiveAdapter.js";
import { documentTargetSchema } from "./document.js";
import { currentArchive, currentModuleWindow } from "./identity.js";
import { WindowsMemoryDesktop } from "./memoryDesktop.js";
import type { EditorWindow } from "./desktop.js";
import { withEditorLease } from "./editorLease.js";
import { PendingComponent } from "./pendingComponent.js";
import { RefreshTransfer, refreshReadinessError, type RefreshDesktop } from "./refreshTransfer.js";
import { refreshAuthoringAllowed } from "./refreshPolicy.js";
import type { LiveRuntime, LiveRuntimeFactory } from "./runtime.js";
import {
  acquireRefreshProject,
  readRefreshProject,
  readCompiledAttestation,
  writeCompiledAttestation,
} from "./refreshProject.js";
import { prepareRefreshPackage, ensureRefreshRollback } from "./refreshPackage.js";
import { prepareRefreshResources, refreshResourcesSchema } from "./refreshResources.js";
import { commitFiles, decodeUtf8, readSnapshot } from "../../core/fileTransactions.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/),
  location = z.string().min(1).max(4096);
const pendingSchema = z
  .object({
    id: z.string().uuid(),
    archive: location,
    processId: z.number().int().positive(),
    processStart: z.string().regex(/^\d+$/),
    windowId: z.string().regex(/^\d+$/),
    sourceSha256: digest,
    candidateSha256: digest,
    directory: location,
    candidate: location,
    rollback: location,
    opening: location,
  })
  .strict();
export const refreshPrepareSchema = documentTargetSchema
  .extend({ mode: z.literal("same_file_refresh") })
  .strict();
export const refreshSessionSchema = z.object({ sessionId: z.string().uuid() }).strict();
export const refreshAdoptSchema = refreshSessionSchema
  .extend({ jobId: z.string().uuid() })
  .strict();
export const refreshCallSchema = refreshSessionSchema
  .extend({ tool: z.string().min(1).max(120), args: z.record(z.string(), z.unknown()) })
  .strict();
export const refreshAuthorSchema = refreshSessionSchema
  .extend({ script: z.string().min(1).max(131072) })
  .strict();
export const refreshRecoverSchema = documentTargetSchema
  .extend({ pendingId: z.string().uuid() })
  .strict();
export const refreshResumeSchema = documentTargetSchema
  .extend({ preparedDirectory: location })
  .strict();
interface Session {
  target: z.infer<typeof documentTargetSchema>;
  window: EditorWindow;
  sourceSha256: string;
  fingerprint: string;
  directory: string;
  runtime: LiveRuntime;
  baseline: Map<string, string>;
  compileSnapshot?: { archive: string; sha256: string; manifest: string };
  compiledAttestation?: { manifest: string; runtimeSha256: string };
  releaseProject: () => Promise<void>;
}
export interface RefreshExpectedDocument {
  processId: number;
  processStart: string;
  sha256: string;
}
type Unpack = (source: string, destination: string) => Promise<unknown>;

/** All existing generators, one validated package, one explicitly accepted same-file native refresh. */
export class LiveRefresh {
  busy = false;
  private closed = false;
  private active?: Promise<unknown>;
  private closeTask?: Promise<void>;
  private readonly sessions = new Map<string, Session>();
  hasSession(id: string): boolean {
    return this.sessions.has(id);
  }
  private readonly pending = new PendingComponent(
    "pending-refresh",
    pendingSchema,
    "LIVE_REFRESH_PENDING",
  );
  private readonly transfer: RefreshTransfer;
  nativeCompiled?: (id: string) => Promise<{
    source: { absolute: string; sha256: string };
    outputSha256: string;
    bytes: Buffer;
  }>;
  constructor(
    private readonly workspace: Workspace,
    private readonly factory: () => LiveRuntimeFactory | undefined,
    private readonly desktop: RefreshDesktop = new WindowsMemoryDesktop(),
    private readonly blocked = () => false,
    private readonly unpack: Unpack = extractArchive,
    pause?: (ms: number) => Promise<void>,
  ) {
    this.transfer = new RefreshTransfer(desktop, pause);
  }
  capabilities() {
    return {
      backend: "same_file_refresh",
      requiresExplicitMode: true,
      tools: [
        "live.refresh.prepare",
        "live.refresh.begin",
        "live.refresh.resume",
        "live.refresh.call",
        "live.refresh.author",
        "live.refresh.resources",
        "live.refresh.compile_snapshot",
        "live.refresh.adopt_compiled",
        "live.refresh.compile_begin",
        "live.refresh.compile_finish",
        "live.refresh.compile_apply",
        "live.refresh.apply",
        "live.refresh.recover",
        "live.refresh.release",
      ],
      scope:
        "Existing component authoring generators, validated same-file publication and original native document reload",
      createsNewWorkingMap: false,
      reopensSamePath: true,
      startsEditor: false,
      resetsNativeUndo: true,
      requires:
        "Clean current Terrain document, no pending XML/inline buffers; explicit same_file_refresh workflow",
      recovery:
        "Shared journal before close, internal rollback archive, preserved components and one-shot open marker",
      evidence:
        "Native load/title and saved-file checks do not establish every component's model, rendering or gameplay",
      resources:
        "Add, replace or remove Assets files in one guarded prepared group; 32 files, 64 MiB each, 128 MiB total source and original bytes",
    };
  }
  private async run<T>(work: () => Promise<T>) {
    if (this.closed || this.busy || this.blocked()) throw Error("LIVE_REFRESH_WORKFLOW_BUSY");
    this.busy = true;
    const task = work();
    this.active = task;
    try {
      return await task;
    } finally {
      this.active = undefined;
      this.busy = false;
    }
  }
  private session(id: string) {
    const s = this.sessions.get(z.string().uuid().parse(id));
    if (!s) throw Error("LIVE_REFRESH_SESSION_MISSING");
    return s;
  }
  async prepare(input: z.infer<typeof refreshPrepareSchema>, expected?: RefreshExpectedDocument) {
    return this.run(async () => {
      if (this.sessions.size >= 4) throw Error("LIVE_REFRESH_SESSION_LIMIT");
      const args = refreshPrepareSchema.parse(input),
        factory = this.factory();
      if (!factory) throw Error("LIVE_REFRESH_COMPILER_UNAVAILABLE");
      const archive = await currentArchive(this.workspace.root, args.archive),
        target = { archive: archive.archive, windowId: args.windowId },
        w = await currentModuleWindow(this.desktop, target, "Terrain");
      if (
        expected &&
        (w.processId !== expected.processId ||
          w.processStart !== expected.processStart ||
          archive.sha256 !== expected.sha256)
      )
        throw Error("LIVE_REFRESH_EXPECTED_DOCUMENT_CHANGED");
      return withEditorLease(w, async () => {
        const pending = await this.pending.read(w, target.archive);
        if (pending) throw Error("LIVE_REFRESH_RECOVERY_REQUIRED: " + pending.id);
        const state = await this.transfer.inspect(w);
        const notReady = refreshReadinessError(w, state);
        if (notReady) throw Error(notReady);
        const sessionId = randomUUID(),
          directory = this.workspace.resolveUserPath(
            path.join(".sc2mcp-output/editor-live/refresh", sessionId),
          ),
          components = path.join(directory, "Components");
        await this.unpack(target.archive, components);
        const releaseProject = await acquireRefreshProject(directory);
        let runtime: LiveRuntime | undefined;
        try {
          runtime = await factory(components);
          const fresh = await currentModuleWindow(this.desktop, target, "Terrain", w),
            after = await this.transfer.inspect(fresh);
          if (
            !after.refreshReady ||
            after.refreshFingerprint !== state.refreshFingerprint ||
            (await currentArchive(this.workspace.root, target.archive)).sha256 !== archive.sha256
          )
            throw Error("LIVE_REFRESH_PREPARATION_CONTEXT_CHANGED");
          const baseline = new Map(
            (await directoryManifest(components)).map((f) => [f.file, f.sha256]),
          );
          await fs.writeFile(
            path.join(directory, "Session.json"),
            JSON.stringify({
              id: sessionId,
              archive: target.archive,
              sourceSha256: archive.sha256,
              baseline: Object.fromEntries(baseline),
            }) + "\n",
            { flag: "wx" },
          );
          this.sessions.set(sessionId, {
            target,
            window: w,
            sourceSha256: archive.sha256,
            fingerprint: state.refreshFingerprint,
            directory,
            runtime,
            baseline,
            releaseProject,
          });
          return {
            sessionId,
            mode: "same_file_refresh",
            componentDirectory: components,
            preparedDirectory: directory,
            archive: target.archive,
            sourceSha256: archive.sha256,
            editorChanged: false,
            newWorkingMapCopies: 0,
            internalPackedStagingRequired: true,
          };
        } catch (error) {
          try {
            await runtime?.close();
          } finally {
            await releaseProject();
          }
          throw error;
        }
      });
    });
  }
  async resume(input: z.infer<typeof refreshResumeSchema>) {
    return this.run(async () => {
      if (this.sessions.size >= 4) throw Error("LIVE_REFRESH_SESSION_LIMIT");
      const args = refreshResumeSchema.parse(input),
        factory = this.factory();
      if (!factory) throw Error("LIVE_REFRESH_COMPILER_UNAVAILABLE");
      const { directory, record } = await readRefreshProject(
          this.workspace.root,
          args.preparedDirectory,
        ),
        archive = await currentArchive(this.workspace.root, args.archive),
        target = { archive: archive.archive, windowId: args.windowId };
      if (this.sessions.has(record.id)) throw Error("LIVE_REFRESH_SESSION_ALREADY_ACTIVE");
      if (
        path.resolve(record.archive).toLowerCase() !== target.archive.toLowerCase() ||
        record.sourceSha256 !== archive.sha256
      )
        throw Error("LIVE_REFRESH_STALE_DOCUMENT");
      const w = await currentModuleWindow(this.desktop, target, "Terrain");
      return withEditorLease(w, async () => {
        const pending = await this.pending.read(w, target.archive);
        if (pending) throw Error("LIVE_REFRESH_RECOVERY_REQUIRED: " + pending.id);
        const state = await this.transfer.inspect(w);
        const notReady = refreshReadinessError(w, state);
        if (notReady) throw Error(notReady);
        const releaseProject = await acquireRefreshProject(directory);
        let runtime: LiveRuntime | undefined;
        try {
          runtime = await factory(path.join(directory, "Components"));
          const after = await this.transfer.inspect(
            await currentModuleWindow(this.desktop, target, "Terrain", w),
          );
          if (
            !after.refreshReady ||
            after.refreshFingerprint !== state.refreshFingerprint ||
            (await currentArchive(this.workspace.root, target.archive)).sha256 !== archive.sha256
          )
            throw Error("LIVE_REFRESH_PREPARATION_CONTEXT_CHANGED");
          this.sessions.set(record.id, {
            target,
            window: w,
            sourceSha256: archive.sha256,
            fingerprint: state.refreshFingerprint,
            directory,
            runtime,
            baseline: new Map(Object.entries(record.baseline)),
            compiledAttestation: await readCompiledAttestation(
              directory,
              record.id,
              record.sourceSha256,
            ),
            releaseProject,
          });
          return {
            sessionId: record.id,
            preparedDirectory: directory,
            componentDirectory: runtime.workspace.root,
            resumed: true,
            editorChanged: false,
          };
        } catch (error) {
          try {
            await runtime?.close();
          } finally {
            await releaseProject();
          }
          throw error;
        }
      });
    });
  }
  private async dispose(s: Session) {
    try {
      await s.runtime.close();
    } finally {
      await s.releaseProject();
    }
  }
  private async consumed<T extends object>(
    s: Session,
    work: () => Promise<T>,
  ): Promise<T & { cleanupError?: string }> {
    const result = await work();
    try {
      await this.dispose(s);
    } catch (error) {
      return { ...result, cleanupError: String(error) };
    }
    return result;
  }
  async call(input: z.infer<typeof refreshCallSchema>, context?: unknown) {
    return this.run(async () => {
      const args = refreshCallSchema.parse(input),
        s = this.session(args.sessionId);
      if (!refreshAuthoringAllowed(args.tool, args.args))
        throw Error("LIVE_REFRESH_AUTHORING_ONLY");
      return s.runtime.call(args.tool, args.args, context);
    });
  }
  async author(input: z.infer<typeof refreshAuthorSchema>) {
    return this.run(async () => {
      const args = refreshAuthorSchema.parse(input),
        s = this.session(args.sessionId);
      if (!s.runtime.author) throw Error("LIVE_REFRESH_COMPILER_UNAVAILABLE");
      return s.runtime.author(args.script);
    });
  }
  async resources(input: z.infer<typeof refreshResourcesSchema>) {
    return this.run(async () => {
      const args = refreshResourcesSchema.parse(input),
        s = this.session(args.sessionId);
      return prepareRefreshResources(this.workspace, s.runtime.workspace, args.changes);
    });
  }
  async compileSnapshot(input: z.infer<typeof refreshSessionSchema>) {
    return this.run(async () => {
      const { sessionId } = refreshSessionSchema.parse(input),
        s = this.session(sessionId);
      const packed = await prepareRefreshPackage(
        s.runtime,
        s.baseline,
        s.target.archive,
        s.directory,
        { compileSnapshot: true },
      );
      if (!packed || !packed.changed.includes("Triggers"))
        throw Error("LIVE_REFRESH_COMPILE_CHANGED_GUI_REQUIRED");
      s.compileSnapshot = {
        archive: packed.candidate,
        sha256: packed.sha256,
        manifest: JSON.stringify(packed.manifest),
      };
      return {
        archive: packed.candidate,
        sha256: packed.sha256,
        sessionId,
        changed: packed.changed,
        internalTestArtifact: true,
        editorChanged: false,
        newWorkingMapCopies: 0,
        runtimeVerified: false,
      };
    });
  }
  async adoptCompiled(input: z.infer<typeof refreshAdoptSchema>) {
    return this.run(async () => {
      const args = refreshAdoptSchema.parse(input),
        s = this.session(args.sessionId),
        snapshot = s.compileSnapshot,
        lookup = this.nativeCompiled;
      if (!snapshot) throw Error("LIVE_REFRESH_COMPILE_SNAPSHOT_REQUIRED");
      if (!lookup) throw Error("LIVE_REFRESH_NATIVE_COMPILER_UNAVAILABLE");
      const proof = await lookup(args.jobId);
      if (
        path.resolve(proof.source.absolute).toLowerCase() !==
          path.resolve(snapshot.archive).toLowerCase() ||
        proof.source.sha256 !== snapshot.sha256
      )
        throw Error("LIVE_REFRESH_COMPILED_SOURCE_MISMATCH");
      decodeUtf8(proof.bytes, "MapScript.galaxy");
      return s.runtime.workspace.transactions.run(async () => {
        const workspace = s.runtime.workspace,
          file = "MapScript.galaxy";
        if (workspace.draftFiles().length || workspace.binary.draftFiles().length)
          throw Error("LIVE_REFRESH_SAVE_COMPLETE_COMPONENT_GROUPS_FIRST");
        const verify = async () => {
          if (JSON.stringify(await directoryManifest(workspace.root)) !== snapshot.manifest)
            throw Error("LIVE_REFRESH_COMPILE_COMPONENTS_STALE");
          const again = await lookup(args.jobId);
          if (
            again.source.sha256 !== snapshot.sha256 ||
            path.resolve(again.source.absolute).toLowerCase() !==
              path.resolve(snapshot.archive).toLowerCase() ||
            again.outputSha256 !== proof.outputSha256 ||
            !again.bytes.equals(proof.bytes)
          )
            throw Error("LIVE_REFRESH_COMPILED_ARTIFACT_STALE");
        };
        const original = await readSnapshot(workspace.resolveUserPath(file));
        await verify();
        const attestation = {
          sessionId: args.sessionId,
          sourceSha256: s.sourceSha256,
          manifest: snapshot.manifest,
          runtimeSha256: proof.outputSha256,
        };
        s.compiledAttestation = attestation;
        await writeCompiledAttestation(s.directory, attestation);
        await commitFiles(
          (name) => workspace.resolveUserPath(name),
          new Map([[file, original]]),
          new Map([[file, proof.bytes]]),
          { backup: false, journalRoot: workspace.root, verify },
        );
        s.compileSnapshot = undefined;
        return {
          status: "prepared",
          sessionId: args.sessionId,
          jobId: args.jobId,
          sourceSha256: snapshot.sha256,
          sha256: proof.outputSha256,
          nativeCompilePassed: true,
          editorChanged: false,
          gameplayVerified: false,
        };
      });
    });
  }
  private async compiledCurrent(s: Session): Promise<boolean> {
    if (!s.compiledAttestation) return false;
    const workspace = s.runtime.workspace;
    if (workspace.draftFiles().length || workspace.binary.draftFiles().length) return false;
    const current = await directoryManifest(workspace.root),
      original = JSON.parse(s.compiledAttestation.manifest) as typeof current,
      withoutRuntime = (rows: typeof current) =>
        rows.filter((row) => row.file !== "MapScript.galaxy");
    return (
      JSON.stringify(withoutRuntime(current)) === JSON.stringify(withoutRuntime(original)) &&
      current.find((row) => row.file === "MapScript.galaxy")?.sha256 ===
        s.compiledAttestation.runtimeSha256
    );
  }
  async isCompiledCurrent(sessionId: string): Promise<boolean> {
    return this.run(async () => this.compiledCurrent(this.session(sessionId)));
  }
  async apply(input: z.infer<typeof refreshSessionSchema>) {
    return this.run(async () => {
      const { sessionId } = refreshSessionSchema.parse(input),
        s = this.session(sessionId);
      if (s.compiledAttestation && !(await this.compiledCurrent(s)))
        throw Error(
          "LIVE_REFRESH_COMPILED_COMPONENTS_STALE: recompile the changed prepared session before applying",
        );
      const packed = await prepareRefreshPackage(
        s.runtime,
        s.baseline,
        s.target.archive,
        s.directory,
      );
      if (!packed) {
        // Applying an empty package completes the session just like a published
        // package: otherwise its project lease blocks the next request forever.
        this.sessions.delete(sessionId);
        return this.consumed(s, async () => ({
          status: "unchanged" as const,
          editorChanged: false,
          newWorkingMapCopies: 0,
        }));
      }
      const w = await currentModuleWindow(this.desktop, s.target, "Terrain", s.window);
      return withEditorLease(w, async () => {
        const previous = await this.pending.read(w, s.target.archive);
        if (previous) throw Error("LIVE_REFRESH_RECOVERY_REQUIRED: " + previous.id);
        const state = await this.transfer.inspect(w);
        const notReady = refreshReadinessError(w, state);
        if (notReady) throw Error("LIVE_REFRESH_STALE_DOCUMENT: " + notReady);
        if (
          state.refreshFingerprint !== s.fingerprint ||
          (await currentArchive(this.workspace.root, s.target.archive)).sha256 !== s.sourceSha256
        )
          throw Error("LIVE_REFRESH_STALE_DOCUMENT");
        const pendingId = randomUUID(),
          rollback = path.join(s.directory, "OriginalArchive.rollback"),
          record = {
            id: pendingId,
            ...s.target,
            processId: w.processId,
            processStart: w.processStart,
            sourceSha256: s.sourceSha256,
            candidateSha256: packed.sha256,
            directory: s.directory,
            candidate: packed.candidate,
            rollback,
            opening: path.join(s.directory, "Opening.json"),
          };
        await ensureRefreshRollback(s.target.archive, rollback, s.sourceSha256);
        await this.pending.reserve(w, record);
        this.sessions.delete(sessionId); // No replay, including after a lost native close reply.
        return this.consumed(s, async () => {
          try {
            await this.transfer.release(w, state.refreshFingerprint, record);
            await this.transfer.publish(record);
            const result = await this.transfer.recover(record);
            if (["refreshed", "not_published"].includes(result.status))
              await this.pending.release(w, s.target.archive, pendingId);
            return {
              ...result,
              pendingId,
              changed: packed.changed,
              ...(packed.changed.includes("Triggers") && {
                triggerRuntime: "changed_runtime_not_semantically_verified",
              }),
              archive: s.target.archive,
              newWorkingMapCopies: 0,
              internalRollback: rollback,
              reopensSamePath: true,
              resetsNativeUndo: true,
              nativeModelVerified: false,
              visualVerified: false,
            };
          } catch (error) {
            const publication = await this.transfer.publication(record).catch((inspection) => ({
              publication: "unknown",
              sourcePublished: null,
              publicationError: String(inspection),
            }));
            return {
              ...publication,
              status: "recovery_required",
              pendingId,
              error: String(error),
              archive: s.target.archive,
              preparedDirectory: s.directory,
              internalRollback: rollback,
              retryMutation: false,
            };
          }
        });
      });
    });
  }
  async recover(input: z.infer<typeof refreshRecoverSchema>) {
    return this.run(async () => {
      const args = refreshRecoverSchema.parse(input),
        archive = await currentArchive(this.workspace.root, args.archive),
        w = this.desktop.window
          ? await this.desktop.window(args.windowId)
          : (await this.desktop.windows()).find((w) => w.windowId === args.windowId);
      if (!w) throw Error("LIVE_REFRESH_PROCESS_OR_FRAME_CHANGED");
      return withEditorLease(w, async () => {
        const record = await this.pending.read(w, archive.archive);
        if (!record || record.id !== args.pendingId || record.windowId !== args.windowId)
          throw Error("LIVE_REFRESH_PENDING_ID_CHANGED");
        // Journal paths were generated under this workspace; never follow a substituted path.
        const expected = path.join(this.workspace.root, ".sc2mcp-output/editor-live/refresh");
        if (
          !path.resolve(record.directory).startsWith(path.resolve(expected) + path.sep) ||
          (await fs.realpath(record.directory)).toLowerCase() !==
            path.resolve(record.directory).toLowerCase() ||
          record.opening !== path.join(record.directory, "Opening.json")
        )
          throw Error("LIVE_REFRESH_RECOVERY_PATH_INVALID");
        const result = await this.transfer.recover(record);
        if (["refreshed", "not_published"].includes(result.status))
          await this.pending.release(w, record.archive, record.id);
        return {
          ...result,
          pendingId: record.id,
          archive: record.archive,
          newWorkingMapCopies: 0,
          nativeModelVerified: false,
          visualVerified: false,
        };
      });
    });
  }
  async release(id: string) {
    return this.run(async () => {
      const s = this.session(id);
      this.sessions.delete(id);
      await this.dispose(s);
      return { released: true, preparedDirectory: s.directory, editorChanged: false };
    });
  }
  close() {
    return (this.closeTask ??= (async () => {
      this.closed = true;
      await this.active?.catch(() => {});
      const result = await Promise.allSettled(
        [...this.sessions.values()].map((s) => this.dispose(s)),
      );
      this.sessions.clear();
      await this.desktop.close?.();
      if (result.some((r) => r.status === "rejected")) throw Error("LIVE_REFRESH_CLOSE_FAILED");
    })());
  }
}
