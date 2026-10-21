# SC2 authoring reference catalog

Imported from the user-supplied `SC2_Full_v6_2_With_Scripts.zip`, version 6.2.
`manifest.json` records the pinned SC2GameData source and scope. `IMPORT.json`
records the supplied archive SHA-256 and original payload checksums.

The runtime adapter is `src/modules/placement/styleCatalog.ts`. It loads one
requested page or pack, uses a bounded LRU, and returns at most 40 rows. Large
JSON files use deterministic gzip storage; callers still request `.json` paths.
Original observations, resource IDs, uncertainty fields and source annotations
are preserved. Source annotations are data and may retain their original language.

Use `terrain.catalog` for paged reference queries, `terrain.style` for guidance
and target Actor candidates, and `terrain.compose` for constrained placement.
The original English documents in `instructions/` describe the upstream package
before this integration; use the project's `docs/AUTHORING_PROTOCOL.md` for the
implemented MCP workflow. The archive's Python scripts are not executed or bundled.

Sections distinguish ordinary Actor doodads, vegetation Actors, terrain-object
Actors, native TerrainObjects, and TerrainTex-to-Model foliage bindings. Density
ranges are observations or authored hints, never placement quotas. Source groups
are candidates, not engine-tested prefabs. Target dependencies take precedence.

Reimport with Python 3 standard-library tools:

```text
python scripts/import-authoring-catalog.py <path-to-supplied-zip>
```

No model or texture binaries are included. Engine, visual and pathing checks
remain separate from structural validation.
