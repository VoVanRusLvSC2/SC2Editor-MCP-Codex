import type { McpServer } from "@modelcontextprotocol/server";
import { CallToolResultSchema } from "@modelcontextprotocol/core";
import * as z from "zod/v4";
import type { EditorLiveWorkspace } from "./workspace.js";
import { registerMemoryTools } from "./memoryTools.js";
import { documentTargetSchema, documentSaveSchema } from "./document.js";
import {
  placementWriteSchema,
  placementInspectSchema,
  placementPrepareSchema,
  placementCatalogSchema,
  placementCreateSchema,
  placementDeleteSchema,
} from "./placement.js";
import { dataReadSchema, dataAuthorSchema } from "./dataXml.js";
import { triggerTargetSchema, triggerPrepareSchema, triggerVerifySchema } from "./triggers.js";
import { uiReadSchema, uiAuthorSchema } from "./ui.js";
import { textReadSchema, textAuthorSchema, textVerifySchema } from "./text.js";
import { importPrepareSchema, importApplySchema, importVerifySchema } from "./imports.js";
import {
  refreshPrepareSchema,
  refreshSessionSchema,
  refreshAdoptSchema,
  refreshAuthorSchema,
  refreshCallSchema,
  refreshRecoverSchema,
  refreshResumeSchema,
} from "./refresh.js";
import { refreshResourcesSchema } from "./refreshResources.js";
import { refreshBeginSchema } from "./refreshBegin.js";
const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});
const forwardedResult = (value: unknown) =>
  value && typeof value === "object" && "content" in value
    ? CallToolResultSchema.parse(value)
    : result(value);
export function registerEditorLiveTools(
  server: McpServer,
  live: EditorLiveWorkspace,
  capabilities: () => unknown = () => live.capabilities(),
) {
  registerMemoryTools(server, live.memory);
  server.registerTool(
    "live.refresh.begin",
    {
      description:
        "Begin explicitly accepted same_file_refresh for the current map. With saveIfDirty=true, use only when the user requested saving: native Save includes existing manual edits and runs once before preparation. Rechecks the same process, archive hash and clean related modules; pending dialogs/inline input and uncertain saves stop without replay. With saveIfDirty=false, dirty maps return save_required. A successful result has sessionId; prepare failures retain the Save receipt. Does not close or reopen the map yet.",
      inputSchema: refreshBeginSchema,
    },
    async (a) => result(await live.beginRefresh(a)),
  );
  server.registerTool(
    "live.refresh.resume",
    {
      description:
        "Resume preserved prepared components after an MCP reconnect or failed preparation. Requires their preparedDirectory, the same original source hash and a clean matching current Terrain document. A project-owner lease preserves another live MCP session's drafts. Does not repeat authoring, close, publication or opening. Pending native refreshes require recover instead.",
      inputSchema: refreshResumeSchema,
    },
    async (a) => result(await live.refresh.resume(a)),
  );
  server.registerTool(
    "live.refresh.prepare",
    {
      description:
        "Explicit same_file_refresh workflow: snapshot a clean current Terrain document into a component workspace for all existing authoring generators. Requires user acceptance of reloading the same file; no new working map. Pending native XML/inline edits refuse. Does not close/change the editor yet. Returns sessionId for repeated compact author or detailed call operations.",
      inputSchema: refreshPrepareSchema,
    },
    async (a) => result(await live.refresh.prepare(a)),
  );
  server.registerTool(
    "live.refresh.author",
    {
      description:
        "Run existing compact authoring commands in a prepared same-file refresh session. Commands commit complete component groups in its private component workspace; the visible document stays unchanged until apply. Supports existing Data, Terrain, placements, GUI, Text, UI and settings generators; native test workers, nested sessions and archive handoffs refuse.",
      inputSchema: refreshAuthorSchema,
    },
    async (a) => result(await live.refresh.author(a)),
  );
  server.registerTool(
    "live.refresh.call",
    {
      description:
        "Call an existing detailed component authoring/query tool in the prepared refresh workspace. No nested live/test workers or archive import/export. Save complete staged groups before live.refresh.apply. Does not modify the visible document yet.",
      inputSchema: refreshCallSchema,
    },
    async (a, context) => forwardedResult(await live.refresh.call(a, context)),
  );
  server.registerTool(
    "live.refresh.resources",
    {
      description:
        "Prepare one guarded group of up to 32 Assets resource additions, replacements or removals within an existing same-file refresh session. Supply each action, Assets/<folder>/path and workspace source for add/replace; optional expectedSha256 guards existing bytes. Up to 64 MiB per file and 128 MiB total input/original bytes. Resource source/executable exclusions apply. This changes prepared components only; references, editor rendering and gameplay still require separate validation. Apply the whole session once with live.refresh.apply.",
      inputSchema: refreshResourcesSchema,
    },
    async (a) => result(await live.refresh.resources(a)),
  );
  server.registerTool(
    "live.refresh.compile_snapshot",
    {
      description:
        "Create an internal, non-working test archive of the prepared session for native GUI compilation, including the exact changed Triggers and all other prepared components. This deliberately permits a stale MapScript only in the internal test snapshot; it does not close, publish to, or change the user's map. Requires a changed GUI graph and no unsaved component drafts. The snapshot hash and component manifest are retained for a later verified adoption step; compilation and adoption are separate operations.",
      inputSchema: refreshSessionSchema,
    },
    async (a) => result(await live.refresh.compileSnapshot(a)),
  );
  server.registerTool(
    "live.refresh.adopt_compiled",
    {
      description:
        "Adopt Galaxy from a successful unscoped editor.check compile job in this MCP process. Requires the exact current compile_snapshot archive and unchanged prepared component manifest; verifies source, job-owned artifact hash, size and encoding again before journalled workspace write. The visible map is unchanged until refresh.apply. Native compilation is not gameplay acceptance.",
      inputSchema: refreshAdoptSchema,
    },
    async (a) => result(await live.refresh.adoptCompiled(a)),
  );
  server.registerTool(
    "live.refresh.apply",
    {
      description:
        "Validate/pack all prepared edits before any native close; guard source hash, process, clean buffers and frame fingerprint. Changed GUI Triggers with unchanged MapScript.galaxy are refused: regenerate and save the runtime in the prepared session first. Changed runtime bytes alone do not prove semantic equivalence. Preserve a recovery journal and internal rollback archive, release the current document through original Close, atomically publish to the same file and load that same path in the same Editor. No new working map. Resets native Undo. Unknown close/publication/open never replay; use recover with pendingId. Native load/persistence is distinct from component-model, rendered and gameplay acceptance.",
      inputSchema: refreshSessionSchema,
    },
    async (a) => result(await live.refresh.apply(a)),
  );
  server.registerTool(
    "live.refresh.recover",
    {
      description:
        "Inspect/recover a pending same-file refresh after a lost reply. Requires original Terrain frame/process, archive and pendingId. Never repeats close or publication. Opens the actual old/new archive only from its empty original frame and only once; subsequent calls observe the prior open. Conflicts/dialogs/manual drafts remain untouched. Preserves prepared components and internal rollback.",
      inputSchema: refreshRecoverSchema,
    },
    async (a) => result(await live.refresh.recover(a)),
  );
  server.registerTool(
    "live.refresh.release",
    {
      description:
        "Release an unused refresh session, retaining prepared component files. Does not modify the editor or clear a pending native recovery journal.",
      inputSchema: refreshSessionSchema,
    },
    async (a) => result(await live.refresh.release(a.sessionId)),
  );
  server.registerTool(
    "live.import.prepare",
    {
      description:
        "Stage up to 16 new resource files for the current Import window. Supply workspace source paths, flat resource names and prefix=Assets/<folder>/. Checks original tree and saved archive for collisions; does not overwrite imports or reserved components. 1 MiB per file, 8 MiB total. Prepares components only, without map copy/reopen/save.",
      inputSchema: importPrepareSchema,
    },
    async (a) => result(await live.imports.prepare(a)),
  );
  server.registerTool(
    "live.import.apply",
    {
      description:
        "Apply a fresh live.import.prepare snapshot once through original Import Files and folder picker. Native source handles pin the staged resources, prefix and checked files are guarded, original tree verifies added paths. Returns pendingId; request native same-file Save separately, then live.import.verify. Unknown submissions never replay. No archive replacement/copy/reopen/automatic save.",
      inputSchema: importApplySchema,
    },
    async (a) => result(await live.imports.apply(a)),
  );
  server.registerTool(
    "live.import.verify",
    {
      description:
        "After native same-file Save, verify exact saved bytes of a pending resource import. Requires pendingId and the same current Import window. Retains uncertainty before Save; resolves a clean saved mismatch without replaying import. Read-only archive inspection, no copy/reopen/mutation. Resource persistence does not establish rendered acceptance.",
      inputSchema: importVerifySchema,
    },
    async (a) => result(await live.imports.verify(a)),
  );
  server.registerTool(
    "live.import.release",
    {
      description:
        "Release an unused resource-import snapshot; never clears a pending native submission.",
      inputSchema: importApplySchema,
    },
    async (a) => result(live.imports.release(a.snapshotId)),
  );
  server.registerTool(
    "live.text.read",
    {
      description:
        "Export one existing locale's current local text tables through the original Text window, including unsaved exportable text, GUI names and hotkeys. keys= returns bounded exact-key values. Returns a ten-minute snapshot, without map copy/save/reopen. Unreferenced strings absent from native export are outside this snapshot.",
      inputSchema: textReadSchema,
    },
    async (a) => result(await live.text.read(a)),
  );
  server.registerTool(
    "live.text.author",
    {
      description:
        "Reuse existing Text operations on live.text.read. Compact text set key=... value=... [table=GameStrings] defaults to the captured locale. apply=false prepares; apply=true imports once in the current document. Native exports stay stale until Save: import_submitted returns pendingId and a cross-session guard. Use native same-file live.document.save, then live.text.verify; never replay import. Removal, styles/assets and other locales refuse. No map copy/reopen/automatic save.",
      inputSchema: textAuthorSchema,
    },
    async (a) => result(await live.text.author(a)),
  );
  server.registerTool(
    "live.text.verify",
    {
      description:
        "Verify a previously submitted Text import after native same-file Save. Requires its pendingId and exact current Text window/locale. Re-exports the saved current model, compares expected text and releases the shared pending guard, retaining mismatches. No write/import/reopen/copy; never replays the mutation.",
      inputSchema: textVerifySchema,
    },
    async (a) => result(await live.text.verify(a)),
  );
  server.registerTool(
    "live.text.release",
    {
      description: "Release an unused current localized Text snapshot without changing the map.",
      inputSchema: z.object({ snapshotId: z.string().uuid() }).strict(),
    },
    async (a) => result(live.text.release(a.snapshotId)),
  );
  server.registerTool(
    "live.ui.create",
    {
      description:
        "Add one new map-local layout through original Add Layout in the current UI window, protecting deferred filename dialogs and pending manual XML. Unique ASCII name, original root readback; no map copy/reopen/save. Unknown creation never replays.",
      inputSchema: uiReadSchema,
    },
    async (a) => result(await live.ui.create(a)),
  );
  server.registerTool(
    "live.ui.read",
    {
      description:
        "Snapshot one current map-local UI XML buffer including pending typed content. Selects the native map source/layout only when that preserves manual XML. Requires the exact UI window, archive and layout name. Returns a bounded 10-minute snapshot token; no map copy/save/reopen.",
      inputSchema: uiReadSchema,
    },
    async (a) => result(await live.ui.read(a)),
  );
  server.registerTool(
    "live.ui.author",
    {
      description:
        "Run existing compact typed UI operations on a live.ui.read snapshot. Commands ui frame/property/anchor/remove/template omit file=. Adjacent compatible operations group into one UI transaction. apply=false prepares; apply=true writes the current original XML buffer once with full stale guards and readback. One layout only; additional Text/import/style files refuse. Buffer acceptance is distinct from native model, same-file persistence and rendered/gameplay checks. No map copy/reopen/save.",
      inputSchema: uiAuthorSchema,
    },
    async (a) => result(await live.ui.author(a)),
  );
  server.registerTool(
    "live.ui.release",
    {
      description: "Release an unused current UI snapshot without changing the map.",
      inputSchema: z.object({ snapshotId: z.string().uuid() }).strict(),
    },
    async (a) => result(live.ui.release(a.snapshotId)),
  );
  server.registerTool(
    "live.trigger.inspect",
    {
      description:
        "Read bounded native trigger-library/map root labels from the exact current Triggers window. No map copy/save/reopen. Native handles are transient UI identities; this is not a full graph snapshot.",
      inputSchema: triggerTargetSchema,
      annotations: { readOnlyHint: true },
    },
    async (a) => result(await live.triggers.inspect(a)),
  );
  server.registerTool(
    "live.trigger.prepare",
    {
      description:
        "Reuse the existing typed GUI generator on a saved workspace planFile (one trigger.plan request or batch) to prepare one new self-contained native library. Includes real folders, events, variables, functions and actions; no Custom Script. Core references and embedded English names only; translated/non-name text and map-instance references refuse before import. Tool-owned component files only, no map copy. Returns a 10-minute single-use planId; does not apply or save.",
      inputSchema: triggerPrepareSchema,
    },
    async (a) => result(await live.triggers.prepare(a)),
  );
  server.registerTool(
    "live.trigger.apply",
    {
      description:
        "Import a prepared new GUI library once through original Import Library in the current document. Checks the same window/process, saved archive and root labels, then re-exports the selected new library for graph readback. Never overwrites existing map-root triggers or reopens/copies/saves the map. Unknown outcomes consume the plan and never replay. Native graph readback, compilation and gameplay are separate.",
      inputSchema: z.object({ planId: z.string().uuid() }).strict(),
    },
    async (a) => result(await live.triggers.apply(a.planId)),
  );
  server.registerTool(
    "live.trigger.release",
    {
      description:
        "Release an unused prepared GUI library without changing the current map; local preparation artifacts remain.",
      inputSchema: z.object({ planId: z.string().uuid() }).strict(),
    },
    async (a) => result(live.triggers.release(a.planId)),
  );
  server.registerTool(
    "live.trigger.verify",
    {
      description:
        "Recover verification without replaying import: select the uniquely named current GUI library, export it with the original Editor and compare the complete graph with a saved expected SC2Lib component file. May change UI selection/open its owned export dialog, but no map content, archive copy, save or reopen. Returns graph readback separately from compilation/gameplay.",
      inputSchema: triggerVerifySchema,
    },
    async (a) => result(await live.triggers.verify(a)),
  );
  server.registerTool(
    "live.placement.catalog",
    {
      description:
        "Read a bounded page of the original catalog palette for a fresh placement snapshot. Selects List palette style; does not change map content. Returns exact display types/rows and a stale guard hash for live.placement.create. Current UI filters apply; this is not a complete dependency catalog.",
      inputSchema: placementCatalogSchema,
    },
    async (a) => result(await live.placement.catalog(a)),
  );
  server.registerTool(
    "live.placement.create",
    {
      description:
        "Create one new Doodad or Unit from the original palette in the current open document, without an existing instance of its type. Use a fresh inspect snapshot and exact catalog row/display type/hash. Optional expectedId checks the original brush's catalog ID before creation. Units require an explicit available owner. Native properties verify name/coordinates/owner; footprint/grid adjustments retain failed exact verification. Creation submits once; unknown/partial results never replay. No map copy/reopen/save. Current scene/group bounds apply.",
      inputSchema: placementCreateSchema,
    },
    async (a) => result(await live.placement.create(a)),
  );
  server.registerTool(
    "live.data.read",
    {
      description:
        "Snapshot one map-local XML dataspace from the current Data window, anchored by an existing local Unit. Can select that Unit and the original XML view; includes pending typed XML instead of reading stale archive data. No map copy/save/reopen. Native XML is transferred privately and returned as a token, not a large payload. Requires English Editor 5.0.17.98310 x64.",
      inputSchema: dataReadSchema,
    },
    async (a) => result(await live.data.read(a)),
  );
  server.registerTool(
    "live.data.author",
    {
      description:
        "Reuse existing compact MCP Data recipes against a live.data.read snapshot. All data commands target its current XML dataspace; omit file=. Stages a validated catalog in an internal component workspace; no map archive copy. apply=false previews, apply=true commits once through original Commit XML Changes and verifies full native XML. Other component changes, anchor removal, stale/manual edits and cross-document writes refuse. No native Save. Native XML verification alone does not prove animation/model playback.",
      inputSchema: dataAuthorSchema,
    },
    async (a) => result(await live.data.author(a)),
  );
  server.registerTool(
    "live.data.release",
    {
      description:
        "Release an unused live Data snapshot without changing the open map; retained preparation artifacts remain available.",
      inputSchema: z.object({ snapshotId: z.string().uuid() }).strict(),
    },
    async (a) => result(live.data.release(a.snapshotId)),
  );
  server.registerTool(
    "live.placement.prepare",
    {
      description:
        "Select the original Terrain Doodads (default) or Units layer in the exact current document before placement inspection. Changes the active UI layer only, with no map content change, copy, save or reopen. Existing user dialogs are preserved.",
      inputSchema: placementPrepareSchema,
    },
    async (a) => result(await live.placement.prepare(a)),
  );
  server.registerTool(
    "live.placement.inspect",
    {
      description:
        "Inspect the active original Terrain Doodads or Units layer and issue a 90-second single-use snapshot with row keys, not persistent map IDs. At most 256 listed objects; details=true reads original properties for at most 32 objects. Loads the separate visible adapter; no archive copy/save/reopen. Keys cannot be reused after insertion or renaming. This is not pixel or pathing acceptance.",
      inputSchema: placementInspectSchema,
      annotations: { readOnlyHint: true },
    },
    async (a) => result(await live.placement.inspect(a)),
  );
  server.registerTool(
    "live.placement.delete",
    {
      description:
        "Delete exactly one current Doodad/Unit from a fresh scene snapshot through original Clear. At most 32 listed objects: visible native property fingerprints of every remaining instance must match despite row reindexing. Native selection, scene, archive and process guards apply. Unknown deletions consume the snapshot and never replay. No copy/reopen/save; confirmation dialogs stay untouched. Whole-document native Save can serialize other loaded object fields and needs separate comparison.",
      inputSchema: placementDeleteSchema,
    },
    async (a) => result(await live.placement.delete(a)),
  );
  server.registerTool(
    "live.placement.duplicate",
    {
      description:
        "Add one Doodad or Unit directly to the current open map by duplicating an existing instance from a fresh live.placement.inspect snapshot, then set exact half-unit x/y and optional name in original properties. Preserves existing native properties including Unit owner. Native instance/count/coordinate readback required; no map copy/reopen/save. Uses the Editor clipboard. Unknown or partial creation never replays. Existing templates only, not arbitrary catalog insertion.",
      inputSchema: placementWriteSchema,
    },
    async (a) => result(await live.placement.duplicate(a)),
  );
  server.registerTool(
    "live.placement.move",
    {
      description:
        "Move/rename one existing Doodad or Unit in the current open Terrain document using a fresh live.placement.inspect snapshot and instance key. Exact native half-unit coordinate readback; preserves unrelated object properties. No archive write/reopen/copy. Manual dialog edits are preserved; unknown commits never replay.",
      inputSchema: placementWriteSchema,
    },
    async (a) => result(await live.placement.move(a)),
  );
  server.registerTool(
    "live.document.status",
    {
      description:
        "Read the selected current Terrain document identity, dirty/dialog flags and saved archive SHA-256. No map copy, save, DLL load or checkpoint import. Use the returned hash for live.document.save.",
      inputSchema: documentTargetSchema,
      annotations: { readOnlyHint: true },
    },
    async (a) => result(await live.document.status(a)),
  );
  server.registerTool(
    "live.document.save",
    {
      description:
        "Save the explicitly selected current open map with native File > Save, never Save As or checkpoint export. Requires a fresh same-archive SHA-256 from live.document.status. Includes current unsaved user edits. Verifies unchanged document identity, clean title and stable same-file disk readback. Dialogs and unknown outcomes are never dismissed or retried. Does not add objects or expand memory editing scope.",
      inputSchema: documentSaveSchema,
    },
    async (a) => result(await live.document.save(a)),
  );
  server.registerTool(
    "live.capabilities",
    {
      description:
        "Read-only API/version and application-route discovery; no save or live.connect required. Direct providers edit current placement/Data/UI/GUI/Text/import content within their declared bounds. Accepted same_file_refresh reuses existing component generators, then reloads the same file in the same Editor; requires clean buffers and resets Undo. No checkpoint substitution. Native, rendered and gameplay proof remain separate.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    },
    async () => result(capabilities()),
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
}
