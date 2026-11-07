import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Workspace } from "../../core/workspace.js";
import { directoryManifest, extractArchive } from "../../archive/archiveAdapter.js";
import {
  documentDirty,
  documentMatches,
  WindowsLiveDesktop,
  type LiveDesktop,
  type EditorWindow,
} from "./desktop.js";

export interface LiveRuntime {
  workspace: Workspace;
  call(tool: string, args: Record<string, unknown>, context?: unknown): Promise<unknown>;
  export(archive: string): Promise<unknown>;
  close(): Promise<void>;
}
export type LiveRuntimeFactory = (root: string) => Promise<LiveRuntime>;
interface Checkpoint {
  archive: string;
  sha256: string;
  presentation: "not_requested" | "request_uncertain" | "requested" | "observed";
}
interface Session {
  id: string;
  originalArchive: string;
  sourceArchive: string;
  sourceSha256: string;
  window: EditorWindow;
  directory: string;
  runtime: LiveRuntime;
  baseline: string;
  revision: number;
  checkpoint?: Checkpoint;
  busy: boolean;
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const allowedTool =
  /^(?:ui|text|data|browse|placement|terrain|script|trigger|settings|ai|assets|lighting|casc|map)\./;

/** Saved checkpoint collaboration, independent of the hidden native acceptance bridge. */
export class LiveWorkspace {
  private readonly sessions = new Map<string, Session>();
  private connecting = false;
  private closing = false;
  private closeTask?: Promise<void>;
  private readonly inflight = new Set<Promise<void>>();
  runtimeFactory?: LiveRuntimeFactory;

  constructor(
    readonly workspace: Workspace,
    readonly desktop: LiveDesktop = new WindowsLiveDesktop(),
    private readonly unpack: (
      archive: string,
      directory: string,
    ) => Promise<unknown> = extractArchive,
  ) {}

  capabilities() {
    return {
      module: "live",
      backend: "saved_checkpoint",
      directInMemoryMutation: false,
      sourceOverwrite: false,
      dllInjection: false,
      startsEditor: false,
      handoff:
        "One normal file-open request to the explicitly bound visible Editor; native save/dependency dialogs remain user-owned",
      refreshVerification:
        "Exact window/process identity, full or qualified abbreviated title path and archive hash; title matching is not an authoritative in-memory document path or visual proof",
      commands: [
        "live.windows",
        "live.connect",
        "live.status",
        "live.author",
        "live.call",
        "live.publish",
        "live.present",
        "live.pull",
        "live.disconnect",
      ],
    };
  }

  async windows() {
    return this.desktop.windows();
  }

  private async archive(file: string) {
    const absolute = path.resolve(this.workspace.root, file);
    if (!/\.(?:SC2Map|SC2Mod)$/i.test(absolute) || absolute.startsWith("\\\\"))
      throw Error("LIVE_LOCAL_ARCHIVE_REQUIRED");
    const stat = await fs.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 * 1024)
      throw Error("LIVE_ARCHIVE_INVALID");
    return { absolute, bytes: await fs.readFile(absolute) };
  }

  private async manifest(runtime: LiveRuntime) {
    return JSON.stringify(await directoryManifest(runtime.workspace.root));
  }

  private get(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw Error("LIVE_SESSION_NOT_FOUND");
    return session;
  }

  private async exclusive<T>(id: string, work: (session: Session) => Promise<T>): Promise<T> {
    if (this.closing) throw Error("LIVE_CLOSING");
    const session = this.get(id);
    if (session.busy) throw Error("LIVE_SESSION_BUSY");
    session.busy = true;
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.inflight.add(done);
    try {
      return await work(session);
    } finally {
      session.busy = false;
      release();
      this.inflight.delete(done);
    }
  }

  private async window(session: Session) {
    const found = (await this.desktop.windows()).find(
      (w) =>
        w.windowId === session.window.windowId &&
        w.processId === session.window.processId &&
        w.processStart === session.window.processStart,
    );
    if (!found) throw Error("LIVE_EDITOR_SESSION_CHANGED");
    return found;
  }

  private async observe(session: Session) {
    const window = await this.window(session),
      checkpoint = session.checkpoint;
    if (
      checkpoint &&
      checkpoint.presentation !== "observed" &&
      documentMatches(window, checkpoint.archive)
    ) {
      const current = await this.archive(checkpoint.archive);
      if (hash(current.bytes) !== checkpoint.sha256)
        throw Error(
          "LIVE_CHECKPOINT_CHANGED: preserve the saved Editor version; pull it explicitly",
        );
      checkpoint.presentation = "observed";
      session.sourceArchive = checkpoint.archive;
      session.sourceSha256 = checkpoint.sha256;
    }
    return window;
  }

  private async assertSource(session: Session) {
    const source = await this.archive(session.sourceArchive);
    if (hash(source.bytes) !== session.sourceSha256)
      throw Error(
        "LIVE_EDITOR_SAVE_CHANGED: live.pull imports saved user edits; pending MCP changes are never discarded",
      );
  }

  private async editable(session: Session) {
    const window = await this.observe(session);
    if (!documentMatches(window, session.sourceArchive)) throw Error("LIVE_DOCUMENT_CHANGED");
    if (!window.enabled) throw Error("LIVE_EDITOR_DIALOG_OPEN: finish the native dialog first");
    if (documentDirty(window))
      throw Error("LIVE_SAVE_REQUIRED: save the map in Editor, then live.pull before editing");
    if (session.checkpoint && session.checkpoint.presentation !== "observed")
      throw Error("LIVE_CHECKPOINT_AWAITING_EDITOR");
    await this.assertSource(session);
    return window;
  }

  private async importRuntime(directory: string, bytes: Buffer, extension: string) {
    if (!this.runtimeFactory) throw Error("LIVE_RUNTIME_UNAVAILABLE");
    const archive = path.join(directory, "Input" + extension),
      root = path.join(directory, "Map");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(archive, bytes, { flag: "wx" });
    await this.unpack(archive, root);
    return this.runtimeFactory(root);
  }

  async connect(archive: string, windowId?: string) {
    if (this.closing || this.connecting) throw Error("LIVE_CONNECT_BUSY");
    this.connecting = true;
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.inflight.add(done);
    let runtime: LiveRuntime | undefined;
    try {
      if (this.sessions.size >= 4) throw Error("LIVE_SESSION_LIMIT");
      const source = await this.archive(archive),
        windows = (await this.desktop.windows()).filter(
          (w) => (!windowId || w.windowId === windowId) && documentMatches(w, source.absolute),
        );
      if (windows.length !== 1)
        throw Error(
          "LIVE_EXACT_DOCUMENT_WINDOW_REQUIRED: open this saved archive in Editor and select its windowId",
        );
      const window = windows[0];
      if (!window.enabled) throw Error("LIVE_EDITOR_DIALOG_OPEN");
      if (documentDirty(window))
        throw Error("LIVE_SAVE_REQUIRED: save the open map before connecting");
      if ([...this.sessions.values()].some((s) => s.window.windowId === window.windowId))
        throw Error("LIVE_WINDOW_ALREADY_BOUND");
      const id = randomUUID(),
        directory = this.workspace.resolveUserPath(path.join(".sc2mcp-output", "live", id));
      runtime = await this.importRuntime(
        path.join(directory, "r0"),
        source.bytes,
        path.extname(source.absolute),
      );
      const current = await this.archive(source.absolute),
        fresh = (await this.desktop.windows()).find((w) => w.windowId === window.windowId);
      if (
        !fresh ||
        fresh.processStart !== window.processStart ||
        fresh.processId !== window.processId ||
        !documentMatches(fresh, source.absolute) ||
        documentDirty(fresh) ||
        !fresh.enabled ||
        !current.bytes.equals(source.bytes)
      )
        throw Error("LIVE_SOURCE_CHANGED_DURING_CONNECT");
      const session: Session = {
        id,
        originalArchive: source.absolute,
        sourceArchive: source.absolute,
        sourceSha256: hash(source.bytes),
        window,
        directory,
        runtime,
        baseline: await this.manifest(runtime),
        revision: 0,
        busy: false,
      };
      this.sessions.set(id, session);
      runtime = undefined;
      return await this.status(id);
    } finally {
      this.connecting = false;
      try {
        await runtime?.close();
      } finally {
        release();
        this.inflight.delete(done);
      }
    }
  }

  async status(id: string) {
    const session = this.get(id),
      window = await this.observe(session);
    const sourceChanged =
      hash((await this.archive(session.sourceArchive)).bytes) !== session.sourceSha256;
    return {
      sessionId: id,
      backend: "saved_checkpoint",
      window,
      sourceArchive: session.sourceArchive,
      originalArchive: session.originalArchive,
      authoringRoot: session.runtime.workspace.root,
      busy: session.busy,
      unsavedEditorChanges: documentDirty(window),
      sourceChanged,
      localChanges: session.baseline !== (await this.manifest(session.runtime)),
      pendingDrafts: [
        ...session.runtime.workspace.draftFiles(),
        ...session.runtime.workspace.binary.draftFiles(),
      ],
      checkpoint: session.checkpoint,
      documentMatches: documentMatches(window, session.sourceArchive),
      nextAction: !window.enabled
        ? "finish_editor_dialog"
        : documentDirty(window)
          ? "save_in_editor_then_pull"
          : sourceChanged
            ? "pull_saved_editor_changes"
            : session.checkpoint && session.checkpoint.presentation !== "observed"
              ? "present_or_open_checkpoint_in_editor"
              : "author_or_publish",
      renderedAppearance: "not_verified_by_document_title",
    };
  }

  async call(id: string, tool: string, args: Record<string, unknown>, context?: unknown) {
    if (tool === "map.minimap.rebuild" && args.backend !== "overview")
      throw Error(
        "LIVE_NATIVE_WORKER_NOT_ALLOWED: run native minimap acceptance outside the visible collaboration session",
      );
    if (
      !allowedTool.test(tool) &&
      !["modkit.author", "modkit.save", "modkit.discard", "modkit.author_help"].includes(tool)
    )
      throw Error(
        "LIVE_TOOL_NOT_ALLOWED: authoring tools only; no native workers or nested live sessions",
      );
    return this.exclusive(id, async (session) => {
      await this.editable(session);
      return session.runtime.call(tool, args, context);
    });
  }

  async publish(id: string, present = false) {
    return this.exclusive(id, async (session) => {
      await this.editable(session);
      const revision = session.revision + 1,
        archive = session.runtime.workspace.resolveUserPath(
          path.join(
            ".sc2mcp-output",
            "Checkpoint-" +
              session.id.slice(0, 8) +
              "-" +
              revision +
              path.extname(session.originalArchive),
          ),
        );
      const exported = await session.runtime.export(archive);
      await this.editable(session);
      const bytes = (await this.archive(archive)).bytes;
      session.revision = revision;
      session.checkpoint = { archive, sha256: hash(bytes), presentation: "not_requested" };
      session.baseline = await this.manifest(session.runtime);
      const receipt = {
        sessionId: id,
        archive,
        sha256: hash(bytes),
        sourceArchiveUnchanged: true,
        exported,
        nextAction: "Open this checkpoint in the same Editor; save prompts remain user-owned",
        directlyAppliedInMemory: false,
      };
      await fs.writeFile(
        path.join(session.directory, "Checkpoint-" + revision + ".json"),
        JSON.stringify(receipt, null, 2) + "\n",
        { flag: "wx" },
      );
      return { ...receipt, ...(present ? { handoff: await this.presentSession(session) } : {}) };
    });
  }

  private async presentSession(session: Session) {
    const checkpoint = session.checkpoint;
    if (!checkpoint) throw Error("LIVE_NO_CHECKPOINT");
    const window = await this.observe(session);
    if (checkpoint.presentation === "observed")
      return { status: "document_observed", visualVerified: false };
    if (checkpoint.presentation !== "not_requested")
      return { status: "awaiting_editor_no_retry", presentation: checkpoint.presentation };
    if (!documentMatches(window, session.sourceArchive)) throw Error("LIVE_DOCUMENT_CHANGED");
    if (!window.enabled || documentDirty(window))
      return { status: "save_required", submitted: false, archive: checkpoint.archive };
    await this.assertSource(session);
    if (hash((await this.archive(checkpoint.archive)).bytes) !== checkpoint.sha256)
      throw Error("LIVE_CHECKPOINT_CHANGED");
    if (!window.acceptsFiles)
      return { status: "manual_open_required", submitted: false, archive: checkpoint.archive };
    checkpoint.presentation = "request_uncertain";
    const result = await this.desktop.present(window, checkpoint.archive);
    checkpoint.presentation = "requested";
    return { status: "open_requested", result, submitted: true, nativeLoadConfirmed: false };
  }

  async present(id: string) {
    return this.exclusive(id, (session) => this.presentSession(session));
  }

  async pull(id: string) {
    return this.exclusive(id, async (session) => {
      const window = await this.window(session);
      if (!window.enabled || documentDirty(window)) throw Error("LIVE_SAVE_REQUIRED");
      const sourcePath =
        session.checkpoint && documentMatches(window, session.checkpoint.archive)
          ? session.checkpoint.archive
          : session.sourceArchive;
      if (!documentMatches(window, sourcePath)) throw Error("LIVE_DOCUMENT_CHANGED");
      if (
        session.checkpoint &&
        session.checkpoint.presentation !== "observed" &&
        sourcePath !== session.checkpoint.archive
      )
        throw Error(
          "LIVE_CHECKPOINT_AWAITING_EDITOR: open the published checkpoint before importing further user edits",
        );
      if (
        session.runtime.workspace.draftFiles().length ||
        session.runtime.workspace.binary.draftFiles().length ||
        session.baseline !== (await this.manifest(session.runtime))
      )
        throw Error(
          "LIVE_LOCAL_CHANGES_CONFLICT: keep both versions; publish or disconnect before importing saved Editor changes",
        );
      const source = await this.archive(sourcePath);
      if (sourcePath === session.sourceArchive && hash(source.bytes) === session.sourceSha256)
        return { sessionId: id, unchanged: true };
      const revision = session.revision + 1;
      const runtime = await this.importRuntime(
        path.join(session.directory, "pull-" + revision),
        source.bytes,
        path.extname(sourcePath),
      );
      try {
        const fresh = await this.window(session);
        if (
          !fresh.enabled ||
          documentDirty(fresh) ||
          !documentMatches(fresh, sourcePath) ||
          !(await this.archive(sourcePath)).bytes.equals(source.bytes)
        )
          throw Error("LIVE_SOURCE_CHANGED_DURING_PULL");
        const baseline = await this.manifest(runtime);
        const previous = session.runtime;
        session.runtime = runtime;
        session.baseline = baseline;
        session.sourceArchive = sourcePath;
        session.sourceSha256 = hash(source.bytes);
        session.checkpoint = undefined;
        session.revision = revision;
        await previous.close();
      } catch (error) {
        if (session.runtime !== runtime) await runtime.close();
        throw error;
      }
      return {
        sessionId: id,
        imported: true,
        sourceArchive: sourcePath,
        authoringRoot: runtime.workspace.root,
      };
    });
  }

  async disconnect(id: string) {
    return this.exclusive(id, async (session) => {
      if (
        session.runtime.workspace.draftFiles().length ||
        session.runtime.workspace.binary.draftFiles().length
      )
        throw Error(
          "LIVE_PENDING_DRAFTS: save or discard staged transaction groups before disconnect",
        );
      await session.runtime.close();
      this.sessions.delete(id);
      return { disconnected: true, editorClosed: false, filesRetained: session.directory };
    });
  }

  close() {
    return (this.closeTask ??= this.closeImpl());
  }

  private async closeImpl() {
    this.closing = true;
    await Promise.all([...this.inflight]);
    const results = await Promise.allSettled(
      [...this.sessions.values()].map((s) => s.runtime.close()),
    );
    this.sessions.clear();
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length) throw Error("LIVE_RUNTIME_CLOSE_FAILED");
  }
}
