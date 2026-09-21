# Native Map foundation fixtures

MapInfo files and the selected Nydus document components were extracted with the bundled StormLib helper from the four user-supplied native archives on 2026-09-13. The component hashes are in manifest.json. Compressed fixture bytes are storage wrappers, not native archive entries. Terrain bytes come from the separately documented terrain-native corpus.

These are scenario-map excerpts, not clean-map blueprints. The MapInfo v39 core-prefix reader and integrity formula were cross-checked against all four original components; untouched player/variant/author/header content remains opaque. Synthetic scripts/unknown entries created by tests demonstrate byte preservation only, not game compatibility.

Layout reference: https://github.com/sc2-arcade-watcher/sc2-file-format-docs/blob/main/mapinfo.md . The magic's numeric value is 0x4d617049; its on-disk little-endian bytes spell IpaM. References to in-memory struct offsets must not be confused with variable-length on-disk string positions.
