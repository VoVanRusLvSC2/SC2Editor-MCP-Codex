---
name: sc2-terrain-composition
description: Design, decorate or review SC2 terrain, bases, forests and spatial compositions using catalog palettes, measurements and previews. Use for placement, readability and scale. Do not activate for trigger-only or text-only work.
---

# Measured terrain and decoration

Read the terrain section of `docs/AUTHORING_PROTOCOL.md` and
`docs/DECOR_VISUAL_WORKFLOW.md`. Query the bundled catalog through MCP instead of
loading large JSON files. Tool schemas govern implemented behavior; upstream
catalog instructions describe reference material.

1. Define zone purpose, biome, architecture and condition. Reserve circulation,
   gates, combat lanes, resources and pads before placement.
2. Shape major terrain and check transitions/connectivity. Use supported native
   cliffs/ramps where requested; report unresolved joints.
3. Query `terrain.catalog`/`terrain.style` for a bounded compatible shortlist.
   Verify placement namespaces and target dependencies. Counts are not quotas.
4. Inspect `terrain.measure` and `terrain.palette_preview` for bounds, scale,
   pivot, variation and ground support. Bounds are not collision footprints.
5. Use measured `terrain.prefab`/`terrain.assemble` and named `terrain.compose`
   groups with exclusions and explicit condition. Preserve manual-edit conflicts.
6. Paint functional texture regions and transitions. Place large anchors, secondary
   groups and restrained detail, with variable density and intentional clearings.
7. Resnap after height changes, run supported placement/navigation checks, and
   inspect overview and gameplay-scale images. Use native checks when authorized.
   Verify changed objects in the Editor's actual 3D view, not only its object list.
8. Rebuild the final textured minimap through the default native
   `map.minimap.rebuild` workflow. Preserve intended vision/fog; gray/white
   overviews are drafts and extra reveal does not repair a black terrain image.

Completion requires reviewed views and stated scale/placement/pathing limits.
A structural report does not prove a closed cliff seam or native model visibility.
Retain failed previews as failures and identify the area still needing review.
Use the [shared regression review](../../../docs/AUTHORING_PROTOCOL.md#regression-review-before-delivery)
for changed scope; do not replay accepted terrain tests solely to renew a label.
