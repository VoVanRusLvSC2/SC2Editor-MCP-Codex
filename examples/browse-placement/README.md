# Reproducible Browse / Placement demonstration

Run `npm run browse:demo` for the clearly labeled synthetic fixture demonstration. It copies the fixture, searches a Unit and a Doodad through Browse, records links/assets, previews a four-unit line and seeded twenty-object location, checks dry-run, applies backups, reparses and writes DEMONSTRATION.json.

To run on real data: `npm run browse:demo -- /absolute/path/to/unpacked-map`. Configure unpacked mod roots in SC2_ASSET_ROOTS and ensure they are declared in the map's DocumentInfo. Coordinates/bounds in this demonstration are illustrative 0..100; adapt them to verified dimensions before using a real map. The source is always copied into a new `runs/demo-*` directory, never edited directly.

The checked-in `runs/demo-72Uc1f` is a synthetic component fixture, not an editor-openable real map. Its catalog/model paths are illustrative regression data; no proprietary standard SC2 assets are bundled. Inspect DEMONSTRATION.json for actual responses and independent NOT_EXECUTED editor/runtime statuses.
