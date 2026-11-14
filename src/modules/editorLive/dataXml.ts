import { currentDocumentMatches } from "./documentIdentity.js";
import { liveFileDigest } from "./identity.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { transferDirectory } from "./transferDirectory.js";
import { createHash, randomUUID } from "node:crypto";
import * as z from "zod/v4";
import { Workspace } from "../../core/workspace.js";
import { scanXml } from "../../core/xmlScanner.js";
import type { XmlNode } from "../../core/types.js";
import { dataDomainFromType } from "../data/domains.js";
import { directoryManifest } from "../../archive/archiveAdapter.js";
import { type EditorWindow } from "./desktop.js";
import { withEditorLease } from "./editorLease.js";
import { WindowsMemoryDesktop, type MemoryDesktop } from "./memoryDesktop.js";
import type { LiveRuntime, LiveRuntimeFactory } from "./runtime.js";

const file = "Base.SC2Data/GameData/LiveData.xml";
const limit = 1024 * 1024;
const digest = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const resultSchema = z.record(z.string(), z.unknown());
export const dataReadSchema = z
  .object({
    archive: z.string().min(1).max(4096),
    windowId: z.string().regex(/^\d+$/),
    unit: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,126}$/),
  })
  .strict();
export const dataAuthorSchema = z
  .object({
    snapshotId: z.string().uuid(),
    script: z.string().min(1).max(65536),
    apply: z.boolean().default(false),
  })
  .strict();
export const dataAppendXmlSchema = z
  .object({
    snapshotId: z.string().uuid(),
    xml: z.string().min(1).max(limit),
    apply: z.boolean().default(false),
  })
  .strict();
type Target = z.infer<typeof dataReadSchema>;
interface Snapshot {
  target: Target;
  window: EditorWindow;
  archiveSha256: string;
  source: string;
  fingerprint: string;
  expires: number;
}

/** Conservative full-buffer comparison, including Actor token processing instructions.
 * Field/array order and non-whitespace content remain significant. The native
 * serializer may regroup uniquely identified catalog entries by domain. */
export function dataXmlSignature(source: string) {
  if (Buffer.byteLength(source) > limit) throw Error("LIVE_DATA_XML_BUFFER_BOUND");
  const parsed = scanXml(source);
  const root = parsed.nodes[parsed.rootIds[0]];
  if (
    parsed.rootIds.length !== 1 ||
    root?.tag !== "Catalog" ||
    parsed.diagnostics.some((d) => d.severity === "error")
  )
    throw Error("LIVE_DATA_XML_INVALID_CATALOG");
  const render = (node: XmlNode): unknown => {
    const content: unknown[] = [];
    let cursor = node.startTagEnd;
    for (const id of node.childIds) {
      const child = parsed.nodes[id];
      const gap = source.slice(cursor, child.start).replaceAll("\r\n", "\n").trim();
      if (gap) content.push(gap);
      content.push(render(child));
      cursor = child.end;
    }
    if (!node.selfClosing) {
      const tail = source.slice(cursor, node.endTagStart).replaceAll("\r\n", "\n").trim();
      if (tail) content.push(tail);
    }
    if (node === root) {
      const identities = node.childIds.map((id) => {
        const child = parsed.nodes[id];
        return child.attrs.id
          ? (dataDomainFromType(child.tag) ?? child.tag) + ":" + child.attrs.id
          : undefined;
      });
      if (identities.every(Boolean) && new Set(identities).size === identities.length) {
        const metadata = content.filter((value) => typeof value === "string");
        const entries = content.filter((value) => typeof value !== "string");
        entries.sort((a, b) =>
          JSON.stringify((a as unknown[]).slice(0, 2)).localeCompare(
            JSON.stringify((b as unknown[]).slice(0, 2)),
          ),
        );
        content.splice(0, content.length, ...metadata, ...entries);
      }
    }
    return [node.tag, Object.entries(node.attrs).sort(([a], [b]) => a.localeCompare(b)), content];
  };
  return digest(JSON.stringify(render(root)));
}

/** Add complete catalog entries without replacing or rewriting existing XML. */
export function appendDataXml(source: string, addition: string) {
  dataXmlSignature(source);
  const wrapped = addition.trim();
  dataXmlSignature(wrapped);
  const before = scanXml(source),
    incoming = scanXml(wrapped);
  const originalRoot = before.nodes[before.rootIds[0]],
    inputRoot = incoming.nodes[incoming.rootIds[0]];
  if (originalRoot.selfClosing || !inputRoot.childIds.length || inputRoot.childIds.length > 64)
    throw Error("LIVE_DATA_XML_APPEND_ENTRY_BOUND");
  const identities = new Set<string>();
  for (const id of originalRoot.childIds) {
    const node = before.nodes[id],
      domain = dataDomainFromType(node.tag);
    if (domain && node.attrs.id) identities.add(domain + ":" + node.attrs.id);
  }
  const entries: Array<{ domain: string; id: string; type: string }> = [];
  const pieces: string[] = [];
  for (const childId of inputRoot.childIds) {
    const node = incoming.nodes[childId],
      domain = dataDomainFromType(node.tag),
      id = node.attrs.id;
    if (!domain || !id || !/^[A-Za-z_][A-Za-z0-9_]{0,126}$/.test(id))
      throw Error("LIVE_DATA_XML_APPEND_ENTRY_INVALID");
    const key = domain + ":" + id;
    if (identities.has(key)) throw Error("LIVE_DATA_XML_APPEND_DUPLICATE_ID");
    identities.add(key);
    entries.push({ domain, id, type: node.tag });
    pieces.push(wrapped.slice(node.start, node.end));
  }
  const candidate =
    source.slice(0, originalRoot.endTagStart) +
    "\n" +
    pieces.join("\n") +
    "\n" +
    source.slice(originalRoot.endTagStart);
  dataXmlSignature(candidate);
  return { candidate, entries };
}

/** One native XML dataspace; existing MCP Data recipes prepare the candidate. */
export class LiveDataXml {
  busy = false;
  private closed = false;
  private pending?: Promise<unknown>;
  private snapshots = new Map<string, Snapshot>();
  constructor(
    private readonly workspace: Workspace,
    private readonly factory: () => LiveRuntimeFactory | undefined,
    private readonly desktop: MemoryDesktop = new WindowsMemoryDesktop(),
    private readonly blocked = () => false,
    private readonly pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}
  capabilities() {
    return {
      backend: "original_data_xml_commit",
      scope: "One current map-local XML dataspace, anchored by an existing local Unit",
      tools: ["live.data.read", "live.data.author", "live.data.append_xml", "live.data.release"],
      nativeCommit: true,
      archiveCopiesCreated: 0,
      reopensMap: false,
      savesMap: false,
      limits: "1 MiB native XML; 4 snapshots; 10-minute snapshots; one catalog output per batch",
      requires:
        "Existing Data window, Editor 5.0.17.98310 English x64; verified installed metadata for inherited recipes",
      unsupported: [
        "Other XML dataspaces in the same batch",
        "Localized text/import changes",
        "Terrain",
        "GUI triggers",
        "Unit placements",
      ],
      acceptance: "Native XML and model readback are separate from animation, visuals and gameplay",
    };
  }
  private async run<T>(work: () => Promise<T>) {
    if (this.closed || this.busy || this.blocked()) throw Error("LIVE_DATA_WORKFLOW_BUSY");
    this.busy = true;
    const task = work();
    this.pending = task;
    try {
      return await task;
    } finally {
      this.pending = undefined;
      this.busy = false;
    }
  }
  private async archive(input: string) {
    const archive = path.resolve(this.workspace.root, input),
      stat = await fs.lstat(archive);
    const normalize = (s: string) => (process.platform === "win32" ? s.toLowerCase() : s);
    if (
      !/\.(SC2Map|SC2Mod)$/i.test(archive) ||
      archive.startsWith("\\\\") ||
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 1024 ** 3 ||
      normalize(await fs.realpath(archive)) !== normalize(archive)
    )
      throw Error("LIVE_DATA_LOCAL_ARCHIVE_REQUIRED");
    return { archive, sha256: await liveFileDigest(archive) };
  }
  private async window(target: Target, previous?: EditorWindow) {
    const w = this.desktop.window
      ? await this.desktop.window(target.windowId)
      : (await this.desktop.windows()).find((w) => w.windowId === target.windowId);
    if (
      !w ||
      !w.enabled ||
      !w.title.startsWith("Data - [") ||
      !(await currentDocumentMatches(this.desktop, w, target.archive)) ||
      (previous && (w.processId !== previous.processId || w.processStart !== previous.processStart))
    )
      throw Error("LIVE_DATA_EXACT_DATA_WINDOW_REQUIRED");
    return w;
  }
  private async command(
    w: EditorWindow,
    op: number,
    args: Parameters<MemoryDesktop["command"]>[2] = {},
  ) {
    const value = resultSchema.parse(await this.desktop.command(w, op, args));
    if (value.error || value.status === "unknown")
      throw Error(String(value.error ?? "LIVE_DATA_NATIVE_UNKNOWN"));
    return value;
  }
  private async transfer(w: EditorWindow, id: string, candidate = false) {
    if (!z.string().uuid().safeParse(id).success) throw Error("LIVE_DATA_TRANSFER_ID_INVALID");
    return path.join(
      await transferDirectory(this.desktop, w, "data"),
      id + (candidate ? ".candidate.xml" : ".xml"),
    );
  }
  private async capture(w: EditorWindow, unit: string) {
    const id = randomUUID();
    const result = await this.command(w, 40, { unit, token: id });
    if (result.snapshotExported !== true || typeof result.fingerprint !== "string")
      throw Error("LIVE_DATA_SNAPSHOT_UNCONFIRMED");
    const location = await this.transfer(w, id),
      stat = await fs.lstat(location);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit || stat.size !== result.bytes)
      throw Error("LIVE_DATA_SNAPSHOT_INVALID");
    const source = await fs.readFile(location, "utf8");
    dataXmlSignature(source);
    const parsed = scanXml(source);
    if (
      !parsed.nodes.some(
        (n) => n.parentId === parsed.rootIds[0] && n.tag === "CUnit" && n.attrs.id === unit,
      )
    )
      throw Error("LIVE_DATA_LOCAL_ANCHOR_MISSING");
    return { source, fingerprint: result.fingerprint, bufferModified: result.bufferModified };
  }
  async read(input: Target) {
    return this.run(async () => {
      if (this.snapshots.size >= 4)
        throw Error("LIVE_DATA_SNAPSHOT_LIMIT: release completed snapshots");
      const target = dataReadSchema.parse(input),
        archive = await this.archive(target.archive);
      target.archive = archive.archive;
      const w = await this.window(target);
      return withEditorLease(w, async () => {
        const state = await this.command(w, 40, { unit: target.unit, field: "status" });
        if (!(state.xmlControl && state.selected && state.mapLocal)) {
          if (state.modified === 1) throw Error("LIVE_DATA_PRESERVE_UNSELECTED_XML_BUFFER");
          await this.command(w, 1, { unit: target.unit, field: "LifeMax" });
          let ready = false;
          for (let i = 0; i < 20; i++) {
            if ((await this.command(w, 0, { unit: target.unit })).unitReady === true) {
              ready = true;
              break;
            }
            await this.pause(150);
          }
          if (!ready) throw Error("LIVE_DATA_ANCHOR_NOT_READY");
          const selected = await this.command(w, 2, { unit: target.unit });
          if (selected.source !== path.basename(target.archive))
            throw Error("LIVE_DATA_LOCAL_ANCHOR_REQUIRED");
          // Selection is posted to the original control. Observe completion
          // before changing view; a fixed delay can lose that queued selection.
          let selectionReady = false;
          for (let i = 0; i < 20; i++) {
            const current = await this.command(w, 40, { unit: target.unit, field: "status" });
            if (current.modified === 1) throw Error("LIVE_DATA_PRESERVE_UNSELECTED_XML_BUFFER");
            if (current.selected && current.mapLocal) {
              selectionReady = true;
              break;
            }
            await this.pause(100);
          }
          if (!selectionReady) throw Error("LIVE_DATA_SELECTION_NOT_READY");
          await this.command(w, 42);
          let xmlReady = false,
            reselected = false;
          for (let i = 0; i < 30; i++) {
            const current = await this.command(w, 40, { unit: target.unit, field: "status" });
            if (
              current.xmlControl &&
              current.selected &&
              current.mapLocal &&
              current.readOnly !== 1
            ) {
              xmlReady = true;
              break;
            }
            if (current.modified === 1) throw Error("LIVE_DATA_PRESERVE_UNSELECTED_XML_BUFFER");
            // Original XML View can clear the list selection. Re-select only
            // the same local anchor, once, after proving no manual buffer exists.
            if (current.xmlControl && current.mapLocal && !current.selected && !reselected) {
              await this.command(w, 2, { unit: target.unit });
              reselected = true;
            }
            await this.pause(100);
          }
          if (!xmlReady) throw Error("LIVE_DATA_XML_VIEW_NOT_READY");
        }
        const fresh = await this.window(target, w),
          captured = await this.capture(fresh, target.unit);
        if ((await this.archive(target.archive)).sha256 !== archive.sha256)
          throw Error("LIVE_DATA_ARCHIVE_CHANGED");
        const id = randomUUID();
        this.snapshots.set(id, {
          target,
          window: fresh,
          archiveSha256: archive.sha256,
          ...captured,
          expires: Date.now() + 600000,
        });
        return {
          snapshotId: id,
          fingerprint: digest(captured.source),
          bytes: Buffer.byteLength(captured.source),
          bufferModified: captured.bufferModified,
          archive: target.archive,
          windowId: w.windowId,
          file,
          application: "current_document",
          copiesCreated: 0,
          reopensMap: false,
          scope: "Current XML dataspace only; pending typed XML is included in the snapshot",
        };
      });
    });
  }
  async author(input: z.input<typeof dataAuthorSchema>) {
    return this.run(async () => {
      const args = dataAuthorSchema.parse(input),
        s = this.snapshots.get(args.snapshotId);
      if (!s || s.expires < Date.now()) throw Error("LIVE_DATA_SNAPSHOT_EXPIRED");
      const factory = this.factory();
      if (!factory) throw Error("LIVE_DATA_AUTHORING_RUNTIME_UNAVAILABLE");
      const root = this.workspace.resolveUserPath(
        path.join(".sc2mcp-output", "live-data", randomUUID()),
      );
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), s.source, { flag: "wx" });
      await fs.writeFile(
        path.join(root, "Base.SC2Data/GameData.xml"),
        '<Includes><Catalog path="GameData/LiveData.xml"/></Includes>',
      );
      await fs.writeFile(
        path.join(root, "ComponentList.SC2Components"),
        '<Components><DataComponent Type="gada">GameData</DataComponent></Components>',
      );
      const before = await directoryManifest(root);
      let runtime: LiveRuntime | undefined;
      try {
        runtime = await factory(root);
        if (!runtime.authorData) throw Error("LIVE_DATA_AUTHORING_COMPILER_UNAVAILABLE");
        const result = resultSchema.parse(await runtime.authorData(args.script, file));
        if (result.ok !== true)
          return { status: "preparation_failed", result, nativeMutationAttempted: false, root };
        if (runtime.workspace.draftFiles().length || runtime.workspace.binary.draftFiles().length)
          throw Error("LIVE_DATA_INCOMPLETE_TRANSACTION_GROUP");
        const after = await directoryManifest(root);
        const other = before.filter((x) => x.file !== file);
        const otherAfter = after.filter((x) => x.file !== file);
        if (JSON.stringify(other) !== JSON.stringify(otherAfter))
          throw Error("LIVE_DATA_MULTI_COMPONENT_BATCH_UNSUPPORTED");
        const candidate = await fs.readFile(path.join(root, file), "utf8"),
          signature = dataXmlSignature(candidate);
        const catalog = scanXml(candidate);
        if (
          !catalog.nodes.some(
            (n) =>
              n.parentId === catalog.rootIds[0] &&
              n.tag === "CUnit" &&
              n.attrs.id === s.target.unit,
          )
        )
          throw Error("LIVE_DATA_ANCHOR_REMOVAL_UNSUPPORTED");
        const receipt = {
          root,
          file,
          result,
          candidateSha256: digest(candidate),
          copiesCreated: 0,
          reopensMap: false,
          saved: false,
        };
        if (!args.apply) return { status: "prepared", ...receipt, nativeMutationAttempted: false };
        return this.applyCandidate(args.snapshotId, s, candidate, signature, receipt);
      } finally {
        await runtime?.close();
      }
    });
  }
  /** Apply one add-only XML patch through the same guarded native buffer path. */
  async appendXml(input: z.input<typeof dataAppendXmlSchema>) {
    return this.run(async () => {
      const args = dataAppendXmlSchema.parse(input),
        snapshot = this.snapshots.get(args.snapshotId);
      if (!snapshot || snapshot.expires < Date.now()) throw Error("LIVE_DATA_SNAPSHOT_EXPIRED");
      const { candidate, entries } = appendDataXml(snapshot.source, args.xml);
      const signature = dataXmlSignature(candidate);
      const receipt = {
        candidateSha256: digest(candidate),
        entries,
        copiesCreated: 0,
        reopensMap: false,
        saved: false,
      };
      if (!args.apply) return { status: "prepared", ...receipt, nativeMutationAttempted: false };
      return this.applyCandidate(args.snapshotId, snapshot, candidate, signature, receipt);
    });
  }
  private async applyCandidate(
    id: string,
    s: Snapshot,
    candidate: string,
    signature: string,
    receipt: object,
  ) {
    // Consume before crossing the native mutation boundary; unknown commits are never replayed.
    this.snapshots.delete(id);
    const w = await this.window(s.target, s.window);
    return withEditorLease(w, async () => {
      if ((await this.archive(s.target.archive)).sha256 !== s.archiveSha256)
        throw Error("LIVE_DATA_ARCHIVE_CHANGED");
      const current = await this.capture(w, s.target.unit);
      if (current.fingerprint !== s.fingerprint || current.source !== s.source)
        throw Error("LIVE_DATA_STALE_BUFFER");
      const token = randomUUID();
      await fs.writeFile(await this.transfer(w, token, true), candidate, { flag: "wx" });
      let submitted = false;
      try {
        submitted = true;
        const native = await this.command(w, 41, {
          unit: s.target.unit,
          token,
          expected: s.fingerprint,
        });
        await this.pause(150);
        const fresh = await this.window(s.target, w),
          readback = await this.capture(fresh, s.target.unit);
        const verified = dataXmlSignature(readback.source) === signature;
        const diagnostics = await this.command(fresh, 40, { field: "messages" });
        const archiveUnchanged = (await this.archive(s.target.archive)).sha256 === s.archiveSha256;
        return {
          status: verified && archiveUnchanged ? "applied" : "verification_failed",
          ...receipt,
          native,
          nativeXmlVerified: verified,
          archiveUnchanged,
          diagnostics,
          nativeModelVerified: false,
          visualVerified: false,
          retryMutation: false,
        };
      } catch (error) {
        if (!submitted) throw error;
        return {
          status: "unknown",
          ...receipt,
          error: String(error),
          retryMutation: false,
          recovery:
            "Inspect the same document and XML buffer; never repeat the native commit or overwrite the map archive",
        };
      }
    });
  }
  release(id: string) {
    this.snapshots.delete(z.string().uuid().parse(id));
    return { released: true, mapMutation: false };
  }
  async close() {
    this.closed = true;
    await this.pending;
    this.snapshots.clear();
    await this.desktop.close?.();
  }
}
