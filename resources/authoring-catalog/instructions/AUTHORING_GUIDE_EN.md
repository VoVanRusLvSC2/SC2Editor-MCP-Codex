# Authoring guide

All composition rules below are authored recommendations, not automatically learned Blizzard standards. Calibrate them on a small representative region before extending them across the map.

## Constructed and natural forms

An engineered platform may use straight segments, coordinated angles and a compatible artificial cliff style. A natural cliff outside the perimeter can remain irregular. Design the playable elevation and edge appearance separately: height deformation alone is not a substitute for cliff/pathing restrictions. Use major bends, plateaus and depressions before small-scale detail. Natural terrain can include both smooth hills and sharp rocks.

Reserve ramps, access corridors and building pads before decoration. Verify connectivity after terrain changes and again after large objects. Width depends on the units and game mode; co-op guidance is not a universal ladder or RPG dimension.

## Transitions

Base to field: pavement, slab edge or shoulder, exposed soil, then grass patches. Maintained entrances have clearer edges; abandoned margins may have cracks and localized growth. Keep fence alignment consistent with the pad and preserve entrances.

Field to forest: an irregular edge with shrubs and sparse trees leading into larger tree groups, with gaps and clearings. Use appropriate forest ground under clusters and worn ground on paths. Blend adjacent natural surfaces locally instead of blurring the entire region. Density need not increase monotonically at every point.

Rock to ground: use a major rock as an anchor, smaller stones near its base, and appropriate ground at the contact. Avoid uniform rock scatter across the entire level. Check the silhouette and ground contact from the gameplay camera.

Road to gate to courtyard: maintain a continuous route, surface and alignment. Keep objects at the sides and the center lane clear. Verify passage using actual relevant units. Decals provide markings, not geometry or pathing. Ground-marking doodads are distinct from player emblems on units.

## Composition recipes

Base entrance: reserve the opening and route first. Select compatible fence pieces; measure their model dimensions and connection points. Follow the perimeter, orienting segments along its tangent with the correct model-axis offset. Do not assume every model shares the same forward axis. Fit corners and end segments deliberately rather than stretching them blindly. Place lighting and a guard post beside the lane. Visual continuity and footprint behavior require separate checks.

Service yard: use the building entrance as the anchor. Face it toward accessible working space. Place storage by loading areas and utility equipment in service groups. A name containing Tank is not proof of a combat vehicle or a natural water feature. Select quantities by function, not full-map density.

Landing pad: start with a level surface and provide a ramp if elevated ground access is required. Inspect the actual decal variation and orient it to the pad. Align lights with the perimeter, checking scale and overlap.

Forest edge: create varied tree clusters and gaps first, then supporting ground, shrubs and foliage. Allow occasional outlying trees. Constrain random offsets by the zone mask, model bounds and reserved paths. Randomize within an intentional composition, not every parameter without limits.

Ruin: identify the original structure, damage cause and extent before selecting remains. Keep architecture and damage coherent. If the original is unknown, mark the selection as unresolved or deliberately use a generic ruin; do not claim an exact destroyed variant was found. Do not overlap an intact structure and its ruins without a scenario reason.

Store anchor and member IDs in the plan. Revisit owned dependents when editing anchors; preserve independent neighboring objects. These relations are planning data until implemented in the editor integration.

## Vegetation and terrain objects

Native foliage bindings are TerrainTex → DoodadEntry → Model. They can include stones as well as plants. Inspect the bound models and inherited fields before use. Regenerate after relevant surface/mask edits when supported. Important gameplay signals must not depend only on micro-foliage visible at certain graphics settings.

Operational means maintained, not necessarily spotless. Abandoned permits local wear and growth without implying an explosion. Damaged requires localized damage; destroyed requires coherent remains. Absent means no structure, not evidence of destruction. Runtime destruction requires appropriate Unit/Actor events or triggers and an engine test.

Native TerrainObject/CCliffDoodad and Actor doodads categorized as TerrainObject are different. Check cliff level, dimensions, hidden terrain cells and companion objects. A bridge-shaped model does not prove functional pathing.

## Lighting, camera and density

Review three scales: large zone silhouettes and paths; medium object groups; small foliage and markings. Fine detail cannot fix unreadable major shapes. Assign texture roles before choosing accents; do not fill every palette slot merely because it exists. Alternate detailed groups with quieter open areas.

Choose lighting with the biome and scenario. Check materials under the main light before adding local lights. Excessive fog, bloom or darkness should not conceal composition problems. Inspect transitions between lighting regions if used. Check an overview, normal gameplay camera and close-ups of problematic joins. A cinematic free-camera view is not a substitute for gameplay readability.

Full-map density does not reveal the actual forest or yard area. Begin with a few groups, review, and add only where useful. Calibrate scale, spacing, noise and blend width for the actual assets; no universal numbers fit every model. Record chosen parameters and seed if supported.

Campaign/RPG composition may be directional and story-driven. Co-op requires room for joint army movement. Competitive maps require separate resource, route, vision, blocking and fairness evaluation. Style is not a balance test.

## Review loop

Check composition, terrain, actual movement/buildability, surfaces, intersections, condition and foliage exclusions. For each criterion record status and evidence. Correct the causal stage locally: a narrow road is not fixed by random decoration removal elsewhere. Recheck affected regions and dependencies. Do not claim visual or engine checks that were not performed.
