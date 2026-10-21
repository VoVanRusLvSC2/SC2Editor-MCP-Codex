# SC2 map authoring instructions — canonical agent policy

This is the authoritative agent policy for v6. English style_rules JSON is canonical for structured authoring rules. Russian guides are explanatory companion documents. Original game IDs and source observations remain unchanged. This package is a reference catalog and read-only lookup tools, not an installed MCP integration or map generator.

## Intent and priorities

Describe biome, zone_profile, faction, construction, condition and gameplay_mode separately. User intent overrides authored style defaults. Preserve gameplay routes, build areas, resources and existing logic. Do not turn an operational base into a ruin for visual variety. Verified target-map definitions override assumptions from the reference catalog.

Before editing, inspect the actual MCP tool schemas, map dependencies, palette, cliffs, existing placements and paths. Map each planned operation to a real available tool; never invent API names or arguments. Mark unsupported operations as blocked. Save a backup or snapshot using available facilities and identify the edit region.

## Resource selection

Read one style profile, then query only relevant catalog pages. Obtain exact IDs from the catalog and verify availability in the target dependencies. Actor, Model, TerrainObject and TerrainTex are separate namespaces. Never pass a foliage Model ID as a doodad Actor ID. Do not substitute a missing asset with a guessed identifier.

A biome selects the natural palette; a zone profile adds function and structure; condition determines wear or damage. Co-occurrence on a source map is not proof that an asset fits every zone. Consult style_rules/asset_overrides.json before using legacy lexical roles or density scaling. This small curated override list is not an exhaustive semantic review.

## Work order

1. Plan zone polygons, neighbors, entrances, paths, focal structures and exclusion masks.
2. Create major terrain forms, cliffs and ramps; verify connectivity.
3. Paint large functional surface regions, then transitions and local accents.
4. Place buildings and anchored compositions. Connect gates to roads and fences to the perimeter.
5. Add secondary props and plant clusters while retaining open space.
6. Generate native foliage where supported, respecting exclusion masks.
7. Inspect overview and gameplay-camera screenshots, test paths and buildability, correct the affected region, and verify again.

## Terrain and surfaces

Use straight, coordinated cliff edges for constructed platforms, not for every base. A field camp may retain a natural escarpment. Natural contours use large irregular bends with localized rock features; avoid a repetitive sawtooth outline or uniform noise. Keep required building pads level.

Begin with large readable texture regions. Use locally softened, irregular transitions between appropriate natural surfaces. Blur Texture blends texture borders; it is not height smoothing. Do not blur the whole map. Preserve clearer boundaries for maintained pavement. Orient markings to entrances, roads or landing pads; do not outline every object with decals.

## Relationships and condition

A gate belongs to a perimeter and an access route. Equipment serves a building or utility network. Store composition and anchor IDs in the plan; moving an anchor requires review of its dependents. Removing an anchor does not authorize deleting unrelated neighbors.

Operational, abandoned, damaged, destroyed and absent are distinct conditions. Absence does not imply destruction. Add debris, scorch marks or fire only when justified by the intended condition and cause. A decorative ruin is not a destructible gameplay Unit with working death behavior.

## Quantities and vegetation

Catalog ranges per 32x32 are broad full-map density observations or explicitly authored hints, not quotas for each zone. Do not place every returned row. Determine fence counts from perimeter length and measured segment size; determine infrastructure counts from layout and function. Suitable area, model bounds, paths and visual calibration take precedence over raw density.

Use Actor doodads for deliberately placed trees and shrubs. Use supported native foliage generation for micro-models instead of replacing it by thousands of ordinary doodads by default. Exclude roads, floors and active work areas. Probability is neither a guaranteed count nor an area percentage. Model inheritance is not resolved by this package.

## Completion

Use style_rules/quality_checks.json. Record pass, fail, not_checked or not_applicable with actual evidence. A successful JSON response is not visual validation. If screenshots or SC2 are unavailable, report that limitation explicitly. Report completed changes, performed checks, blocked capabilities and remaining corrections separately.

Read AUTHORING_GUIDE_EN.md for compositions, transitions, lighting and camera guidance; MCP_INTEGRATION_EN.md for lookup interfaces. Sources are in SOURCES_EN.md. No first-pass beauty guarantee is implied.
