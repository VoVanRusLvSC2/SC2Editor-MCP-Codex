import { terrainCapabilityManifest } from "../modules/terrain/capabilities.js";
import type { Project } from "./project.js";
import { bridgeCapabilities } from "../core/capabilities.js";

/** Registry counters describe bundled evidence, never the universe of engine behavior. */
export function projectCoverage(project: Project) {
  const counts = (entries: Array<{ coverage: string }>) =>
    Object.fromEntries(
      [...new Set(entries.map((entry) => entry.coverage))].map((status) => [
        status,
        entries.filter((entry) => entry.coverage === status).length,
      ]),
    );
  return {
    version: bridgeCapabilities(project.workspace.root).version,
    scope:
      "Current module inventories and scoped registries; retained native evidence is evaluated separately",
    completeEngineCoverage: false,
    overallCoveragePercent: null,
    reason:
      "The complete set of engine formats and semantic rules is not known; a global percentage would be unsupported.",
    editorValidation: "NOT_EXECUTED",
    runtimeValidation: "NOT_EXECUTED",
    modules: {
      script: {
        support: [
          "Lossless Galaxy lexical/structural declarations and bounded context",
          "Indexed pinned native signatures",
          "Stale-guarded plan/stage/save, guarded function edits, Include/init connection and periodic recipe",
        ],
        gaps: [
          "No full expression type checking or verified target compiler",
          "Scope binding, external Include activation, dynamic references and map links remain partial",
          "Editor may regenerate MapScript; target persistence not verified",
        ],
      },
      ui: {
        registry: project.schema.auditCoverage(),
        gaps: [
          "Observed-only scalar types and engine-specific constraints",
          "Blizzard-only behavior requires Editor/runtime probes",
        ],
      },
      cutscene: {
        registry: project.cutsceneSchema.coverage(),
        gaps: [
          "Preserve-only types and Editor-only properties are not complete semantic support",
          "Native timeline and playback behavior require Editor/runtime probes",
        ],
      },
      text: {
        registry: project.text.schema.coverage(),
        gaps: [
          "Not every discovered rich-text tag has semantic operations",
          "Glyph coverage, rendering and locale fallback are not verified",
        ],
      },
      data: {
        registry: project.data.schema.coverage(),
        evidenceScope:
          "Bundled historical corpus totals and current registry consistency; this call does not reparse the original corpus",
        gaps: [
          "Hidden enums, defaults and illegal combinations",
          "Full active dependency resolution and runtime behavior",
        ],
      },
      ai: {
        registry: {
          nodes: project.ai.schema.data.nodes.length,
          properties: project.ai.schema.data.properties.length,
          nodeStatus: counts(project.ai.schema.data.nodes),
          propertyStatus: counts(project.ai.schema.data.properties),
        },
        gaps: [
          "Populated wave serialization remains inferred and opt-in",
          "Config/Script nodes have preserve-only support",
          "Trigger editing and full AI runtime semantics are absent",
        ],
      },
      document: {
        support: project.document.capabilities(),
        gaps: project.document.capabilities().gaps,
      },
      settings: {
        support: project.settings.capabilities(),
        gaps: project.settings.capabilities().gaps,
      },
      casc: {
        support: [
          "Actual local CASC/MNDX index and strict BLTE reads",
          "Build-specific SHA-verified byte cache and explicit Data/Browse metadata mounts",
          "Compressed Galaxy symbol summaries and imported-reference source checks",
        ],
        gaps: [
          "No CDN fetch or storage writer",
          "No complete native inheritance/compiler/runtime proof",
          "Large binary assets are inspected/read by bounded ranges",
        ],
      },
      browse: {
        support: [
          "Catalog and loose-asset indexing",
          "Dependency-aware search, localization and references",
        ],
        gaps: [
          "Declared layers may be absent from installed roots",
          "MPQ uses explicit map.import; CASC metadata roots require explicit casc.mount",
          "No engine-rendered 3D preview",
        ],
      },
      placement: {
        support: [
          "Observed Objects XML: Unit, Doodad and ObjectPoint v27",
          "Seeded scatter, ground snapping and joint terrain plans",
        ],
        gaps: [
          "Regions/Cameras and other native object kinds are preserved without complete editors; incoming Point links are not fully checked",
          "No footprint, pathing or runtime collision validation",
        ],
      },
      terrain: terrainCapabilityManifest,
      map: {
        support: project.map.capabilities(),
        gaps: [
          "Registered native-template creation is implemented; templates are locally supplied and cleanliness is not certified",
          "MapInfo player/variant fields and DocumentHeader preserved opaque",
          "Resize and base-height rebake require the Terrain dependency graph",
          "Prefixed and unnamed MPQ entries cannot yet be repacked losslessly",
        ],
      },
    },
    transactions: {
      sharedQueue: true,
      groupedTextDrafts: true,
      cutsceneUsesSharedWorkspace: project.cutscene.workspace === project.workspace,
      staleDiskGuards: "Bytes and file existence, including staged bases",
      dependencyGuards:
        "Tracked preflight/validation text reads, external catalog reads and effective drafts persist until text-group save; AI bindings bypass cache during tracked edits",
      multiFileCommit:
        "Prepared journal restores interrupted groups on startup/next mutation; committed groups are retained; handled failures compensate",
      persistentRecoveryJournal: true,
      crossProcessWriteLock: true,
      limitations: [
        "Commit undo and drafts remain process-local; recovery journal is for interrupted commits",
        "Lock requires local filesystem hardlinks; death during stale-lock reclamation leaves an inspectable marker and blocks writes",
        "Directory enumeration and untracked adapter/binary reads are not universally pinned; Map metadata/export pins its full manifest",
        "Filesystem checks do not provide protection against a hostile concurrent symlink swap; power-loss certification has not been performed",
      ],
    },
    nextGates: [
      "Pin complete directory/dependency read sets outside the Map module",
      "Collect populated native AI and additional terrain/version fixtures",
      "Expand property and invalid-combination fixtures for every semantic operation",
      "Run save/reopen diffs in the target SC2Editor build",
      "Run generated behavior probes in StarCraft II and record results per case",
    ],
  };
}
