import type { Workspace } from "../../core/workspace.js";
import { LiveMemory } from "./memory.js";
import { LiveDocument } from "./document.js";
import { LivePlacement } from "./placement.js";
import { LiveDataXml } from "./dataXml.js";
import { LiveTriggers } from "./triggers.js";
import { LiveUi } from "./ui.js";
import { LiveText } from "./text.js";
import { LiveImports } from "./imports.js";
import { LiveRefresh } from "./refresh.js";
import { beginRefresh, refreshBeginSchema } from "./refreshBegin.js";
import type * as z from "zod/v4";
import { WindowsLiveDesktop, type LiveDesktop } from "./desktop.js";
import type { LiveRuntimeFactory } from "./runtime.js";

/** Current document providers plus explicitly selected same-file refresh; no new working map. */
export class EditorLiveWorkspace {
  readonly memory: LiveMemory;
  readonly document: LiveDocument;
  readonly placement: LivePlacement;
  readonly data: LiveDataXml;
  readonly triggers: LiveTriggers;
  readonly ui: LiveUi;
  readonly text: LiveText;
  readonly imports: LiveImports;
  readonly refresh: LiveRefresh;
  private readonly providers: Array<{ busy: boolean; close(): Promise<void> }> = [];
  private closing = false;
  private closeTask?: Promise<void>;

  constructor(
    workspace: Workspace,
    factory: () => LiveRuntimeFactory | undefined,
    blocked: () => boolean = () => false,
    readonly desktop: LiveDesktop = new WindowsLiveDesktop(),
  ) {
    const unavailable = () => this.closing || blocked() || this.busy;
    this.memory = new LiveMemory(workspace.root, undefined, unavailable);
    this.document = new LiveDocument(workspace.root, undefined, unavailable);
    this.placement = new LivePlacement(workspace.root, undefined, unavailable);
    this.data = new LiveDataXml(workspace, factory, undefined, unavailable);
    this.triggers = new LiveTriggers(workspace, factory, undefined, unavailable);
    this.ui = new LiveUi(workspace, factory, undefined, unavailable);
    this.text = new LiveText(workspace, factory, undefined, unavailable);
    this.imports = new LiveImports(workspace, undefined, unavailable);
    this.refresh = new LiveRefresh(workspace, factory, undefined, unavailable);
    this.providers.push(
      this.memory,
      this.document,
      this.placement,
      this.data,
      this.triggers,
      this.ui,
      this.text,
      this.imports,
      this.refresh,
    );
  }

  get busy() {
    return this.providers.some((provider) => provider.busy);
  }

  windows() {
    return this.desktop.windows();
  }

  beginRefresh(input: z.infer<typeof refreshBeginSchema>) {
    return beginRefresh(this.document, this.refresh, input);
  }

  capabilities() {
    return {
      module: "editor-live",
      apiVersion: "editor-live-2026-11-08-compile-apply",
      backend: "current_document",
      copiesCreated: 0,
      reopensMap: false,
      reopensMapScope:
        "Direct mode; the explicitly selected same_file_refresh mode reloads the same path",
      startsEditor: false,
      directInMemoryMutation: true,
      sourceOverwrite: false,
      sourceOverwriteScope:
        "Native Save in direct mode; explicit refresh publishes only after original document release",
      dllInjection: true,
      dllScope: "Separate opt-in visible adapter, never the hidden test Toolkit",
      capabilityScope:
        "Direct current-document providers and native Save; explicit same_file_refresh reuses all existing component generators and reloads the same file",
      defaultWorkflow: { mode: "current_document", copies: false, save: "live.document.save" },
      document: {
        status: "live.document.status",
        save: "live.document.save",
        nativeSave: true,
        dirtiness: "Related native module captions and writable XML buffers, not only Terrain",
        pendingInlineInput: "Preserved; commit the existing native input before saving",
      },
      componentTransfer: {
        tempRoot:
          "Process-reported per-user physical staging store outside MSIX AppData redirection",
        legacyDialogPaths: "Bounded short paths shared by the packaged client and original Editor",
        longFilePaths: true,
        persistedUiBuffer:
          "Native savepoint only after exact stable-archive byte equality; mismatched pending source is preserved",
      },
      documentIdentity: {
        shortMapCaptions:
          "Read-only original Window menu plus exact map archive ownership by the same process/start identity",
        basenameOnly: false,
        dialogInput: false,
        limitations:
          "Short Mod captions, duplicate document names or missing archive ownership refuse; authoritative native document/revision IDs remain separate work",
      },
      memory: this.memory.capabilities(),
      placement: this.placement.capabilities(),
      data: this.data.capabilities(),
      triggers: this.triggers.capabilities(),
      ui: this.ui.capabilities(),
      text: this.text.capabilities(),
      imports: this.imports.capabilities(),
      refresh: this.refresh.capabilities(),
      unsupportedScope:
        "Direct in-memory mode only; explicit same_file_refresh can prepare these components with existing generators. Native model/rendering acceptance remains per component.",
      unsupported: [
        "Terrain component application",
        "Editing/replacing existing GUI trigger graphs and general localized trigger content",
        "Atomic UI/Data batches with linked localized Text, style and import components",
        "Map settings and lighting application",
        "Placement of types absent from the current filtered palette",
        "Deletion beyond 32 active-layer objects; general point/region/camera/property editing and whole-document object serialization preservation",
        "First local Data object and multiple catalog dataspace application",
        "Authoritative native document/revision identity beyond guarded windows and component snapshots",
      ],
      fallback:
        "Use supported direct providers or explicitly accepted same_file_refresh; no checkpoint substitution or replacement of a locked open archive",
      evidence:
        "Native acknowledgement, readback, persistence, rendered appearance and gameplay remain separate",
    };
  }

  close() {
    this.closing = true;
    return (this.closeTask ??= (async () => {
      const results = await Promise.allSettled(this.providers.map((provider) => provider.close()));
      if (results.some((r) => r.status === "rejected")) throw Error("EDITOR_LIVE_CLOSE_FAILED");
    })());
  }
}
