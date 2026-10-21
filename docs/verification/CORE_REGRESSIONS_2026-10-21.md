# Core regression results — 2026-10-21

Actual status lines from the recorded core run; environment paths and diagnostic
blocks are omitted. This is a selected suite, not all repository tests.
Raw TAP SHA-256: `d146897e6225fcb74e07036982fc6c7745cbb0d400d41d88854813817f88babc`. One Unix shell fixture is skipped on Windows.

```tap
TAP version 13
ok 1 - CustomAI open/parse is byte-identical and preserves unknown extensions
ok 2 - previously extracted CustomAI samples retain exact original bytes and native Definition IDs
ok 3 - AI preserves single-quoted XML when editing IDs containing apostrophes
ok 4 - ai.apply creates missing CustomAI and registers aiai atomically
ok 5 - dry-run creates neither CustomAI nor component entry
ok 6 - one batch creates a definition and multiple inferred waves with aliases
ok 7 - validation reports exact missing unit path and rolls back the whole batch
ok 8 - typed aidef Trigger references are read-only and block rename/delete
ok 9 - AI write scope rejects Trigger/Terrain files and non-sibling component paths
ok 10 - force/native/validation opt-outs cannot break read-only aidefwave links
ok 11 - AI reference cache observes changed and staged Trigger links
ok 12 - AI and Browse reject installed-but-undeclared units and accept declared dependencies
ok 13 - AI rejects duplicate/ambiguous identities and wrong operation selectors
ok 14 - AI recursive native creation cannot bypass inferred structure gates
ok 15 - AI validates malformed components and handles self-closing Components losslessly
ok 16 - AI GUI API uses shared schema, defaults to dry-run and writes only reviewed components
ok 17 - clone/reorder preserve native unknown children
ok 18 - empty CustomAI and dozens of waves remain queryable without loading native XML
ok 19 - Data-derived wave graph uses catalog values and never hardcodes unit prices
ok 20 - AI wave graphs use data.* inheritance when the modules share one server workspace
ok 21 - invalid player/timing diagnostics are typed and source-addressed
ok 22 - stage=false writes backups for every existing changed file
ok 23 - nested GUI folders reuse IDs and preserve executable XML and other libraries
ok 24 - GUI invalid ownership fails before modifying anything
ok 25 - folder item ordering is explicit, repeatable and leaves trigger definitions intact
ok 26 - typed GUI plans reuse nested folders and keep global state and helpers with their system
ok 27 - GUI organization localizes folders, dry-runs, stages atomically and rejects stale saves
ok 28 - Galaxy is default and existing source and manifest ownership survive repeated organization
ok 29 - catalog pagination is complete, typed and bounded, including compressed data
ok 30 - polygon scatter respects concavity, reserved paths and reproducible seed
ok 31 - compact commands compile project and terrain lifecycle without JSON scaffolding
ok 32 - workflow MCP discovers and executes organization/catalog through compact author commands
ok 33 - compact commands cover terrain, placement, Data, UI, cutscene and settings
ok 34 - logic defaults to guarded Galaxy source and GUI is explicit
ok 35 - save expands into existing apply and save tools, preserving stage boundary
ok 36 - high-level recipes cover document, settings, AI, text and nested UI transaction
ok 37 - unsafe or unknown commands and malformed source fail before any tool runs
ok 38 - compiled authoring uses existing schema validation and reference resolution
ok 39 - compact receipts retain bounded Data and settings lookup results
ok 40 - operation-scoped browse snapshots avoid rebuilds while preserving dependency stale guards
ok 41 - browse.search finds a real Unit id and a localized name with ranking evidence
ok 42 - browse keeps an unknown catalog type as a generic indexed object
ok 43 - browse.related follows Unit to Actor to Model and an exact model asset path
ok 44 - browse resolves a Doodad to Actor/Model assets and reports placeability
ok 45 - browse index fingerprint is stable and changes after an indexed file changes
ok 46 - installed-but-not-declared data remains searchable but is not dependency-ready
ok 47 - browse reports duplicate ids across source layers without dropping either definition
ok 48 - dependency declarations resolve available roots and report missing mods
ok 49 - a configured catalog root without a dependency declaration is not placement-ready
ok 50 - CASC source identity selects one actual active build and omits unrelated build tags
ok 51 - CASC logical paths reject filesystem escapes and protocol injection
ok 52 - CASC byte cache verifies content keys, serves warm reads, and survives a new reader session
ok 53 - CASC same-file concurrent misses perform one native read
ok 54 - CASC cache corruption triggers a real reread rather than stale content
ok 55 - CASC build changes isolate cache files and unmount old dependency views
ok 56 - CASC rejects a source-build change during native read before persisting cache
ok 57 - CASC absent local payload stays an explicit error and is not downloaded
ok 58 - CASC bounded byte reads preserve offsets and never create bulk asset cache
ok 59 - CASC mounted catalog bytes are real read-only dependency input to Data and Browse
ok 60 - CASC mount limits and partial payloads do not register incomplete roots
ok 61 - CASC compressed Galaxy summaries reuse parser output with exact source SHA
ok 62 - CASC cache rejects a symlink root instead of writing outside its scope
ok 63 - CASC tool schemas remain bounded and unsafe reads return tool errors
ok 64 - CASC cache destinations inside the installation are refused
ok 65 - Data cannot mutate a mounted CASC dependency view through direct or batch writes
ok 66 - CASC trigger views include native SC2Lib and root Triggers bytes rather than only Galaxy files
ok 67 - CASC campaign mount ignores embedded map catalogs and retains earlier kinds
ok 68 - Internal preview read streams large CASC binaries and keeps default budget unchanged
ok 69 - normal Data validation reports the observed duplicate-primary-actor construction
ok 70 - concrete actor duplication is blocked; rebuilding preserves presentation and one inherited primary Create
ok 71 - effect model uses native bracket lifecycle and a landing effect instead of an unrelated timer
ok 72 - Blink source Start/Stop hosts and EMP stop/ground bindings match the native presentation patterns
ok 73 - visual preloads include model/effect and related sound, preserve authored entries, and do not duplicate on rerun
ok 74 - effect presentation and preload commit together, while a late failure leaves both unchanged
ok 75 - GameData open/parse is byte-identical and preserves unknown extensions
ok 76 - data.apply creates a missing Catalog and registers the native gada component
ok 77 - new Data objects keep the Catalog closing tag on its own line
ok 78 - data.apply defaults to dry-run and writes nothing
ok 79 - one batch creates and patches nested/indexed fields through an alias
ok 80 - array.append uses the next numeric index and preserves token indexes
ok 81 - clone carries unknown native XML and allows a new parent
ok 82 - typed parent and Link references update across catalog files on rename
ok 83 - delete is blocked by live references and the transaction rolls back
ok 84 - failed late operation rolls back object creation and component registration
ok 85 - context resolves inherited fields and describe_type is corpus-driven
ok 86 - selective context projects fields and omits unrelated file indexes
ok 87 - validation reports missing links with exact object/field path
ok 88 - observed semantic validation checks enum candidates and value-carried catalog references
ok 89 - generic object/field attributes can be set and removed without rewriting unknown XML
ok 90 - rename refuses ambiguous cross-domain Link targets
ok 91 - stage=false writes backups for every existing changed Data file
ok 92 - weapon burn recipe expands one semantic operation into the native linked Data graph
ok 93 - vital texture recipe creates reversible multi-slot texture states at an exact fraction
ok 94 - late failure rolls back every object expanded by a Data recipe
ok 95 - native Actor class compatibility preserves inheritance direction and unknown pairs
ok 96 - Data validation catches the Editor-reported Reaper error at the parent path
ok 97 - native missile subclass and same-class Reaper child pass the new check
ok 98 - unknown class combinations and missing parents are not invented incompatibilities
ok 99 - class repair changes outer tags only, preserves identity and refuses domain changes
ok 100 - strict Data writes reject incompatible parents atomically
ok 101 - compatibility Data writes reject incompatible parents atomically
ok 102 - selective effective fields stop at an incompatible parent instead of merging invalid data
ok 103 - MCP class operation repairs an existing Actor without deleting its catalog identity
ok 104 - geometry dimensions use referenced vertices and full nonuniform rotated transform, preserving source
ok 105 - authored attachment position is recovered from its actual inverse bind, not AABB endpoints
ok 106 - contact sheet retains shared units, escapes labels, fits Marine reference and produces deterministic PNG
ok 107 - all ready groups preserve a measured corridor and actual noncentral pivot offsets
ok 108 - Actor -> Model -> CASC passport composes scales; palette joins original catalog and reuses derived image cache
ok 109 - short author commands support measurement/palette and owned assembly save lifecycle
ok 110 - native H2CS reader handles an independently supplied complete Header and rejects every truncation
ok 111 - v2 marker matches the native 44-byte build tuple, timestamp and tag order
ok 112 - fresh MapInfo has complete verified core, standard empty players and exactly empty variant/lighting tail
ok 113 - DocumentInfo extension flag and dependency text survive XML escaping
ok 114 - flat terrain creates independent rectangular native grids with one texture and no hidden cells
ok 115 - bounded CTerrain inheritance keeps the child ID in parent tokens and labels unsupported arrays
ok 116 - schemas reject incompatible mod/map parameters, odd sizes, duplicate locales and gameplay requests
ok 117 - create dependent mod is fresh, localized and has no MapInfo/Terrain/scripts
ok 118 - create extension mod is fresh, localized and has no MapInfo/Terrain/scripts
ok 119 - new map foundation is usable by existing Terrain and Settings codecs without donor content
ok 120 - map without Terrain retains a complete MapInfo and skips all terrain components
ok 121 - build and source changes invalidate a plan before publication
ok 122 - local dependency graph detects cycles, pins all files and refuses pending drafts
ok 123 - source and destination guards reject overlapping dependency outputs and malformed identities
ok 124 - strict foundation inspect detects an external file and altered version bytes
ok 125 - packed mod is actually reopened by native archive backend with the exact fresh entry manifest
ok 126 - real SDK creates an empty document through the registered MCP tools with a supplied local game source
ok 127 - new foundations cannot overwrite a pre-existing component or packed destination
ok 128 - native maps independently confirm identity Q12 sync-height geometry
ok 129 - editor allocation and geometry checks reject the previously generated broken terrain
ok 130 - version writer admits native Objects plob and rejects the erroneous objs tag
ok 131 - Editor registry layer mask identifies all four hidden layer bits from user settings
ok 132 - script profile omits unrelated MCP tool schemas while retaining the public capability entry
ok 133 - inline layouts retain a single root when adding includes, frames and properties
ok 134 - lists and reads frames
ok 135 - creates button without rewriting unrelated XML
ok 136 - sets property and anchor
ok 137 - deletes frame subtree
ok 138 - native preload includes all placed identities, merges variations, preserves manual entries and is idempotent
ok 139 - load preparation rejects malformed preload or marker without fabricating metadata
ok 140 - MCP map preparation is dry-run by default, preserves placement and saves all load metadata together
ok 141 - MapInfo ant: integrity, dimensions, lossless prefix writer and opaque tail
ok 142 - MapInfo city: integrity, dimensions, lossless prefix writer and opaque tail
ok 143 - MapInfo nydus: integrity, dimensions, lossless prefix writer and opaque tail
ok 144 - MapInfo warships: integrity, dimensions, lossless prefix writer and opaque tail
ok 145 - metadata stage/save guards the entire file list and source bytes, while keeping the opaque tail
ok 146 - complete native clone preserves scripts and unknown entries and rejects pending drafts
ok 147 - metadata dependency guard survives a generic restage of the byte group
ok 148 - native backend preserves unknown content, encrypted entry intent, empty files and locale variants
ok 149 - MCP map export supports a root workspace via reserved output and verifies every entry
ok 150 - failed archive reopening cannot replace a pre-existing map # SKIP shell fixture
ok 151 - portable archive names reject traversal, ADS, controls, Windows aliases and ambiguous casing
ok 152 - MCP batch forwards plan identifiers and applies the original schema/defaults
ok 153 - batch preflights unknown/recursive tools before any mutation
ok 154 - batch rejects later static schema errors before invoking an earlier mutation
ok 155 - batch stops at failed schema or tool result, retaining earlier successes
ok 156 - batch references cannot traverse prototypes or unresolved/future results
ok 157 - workflow profile loads all modules for hidden tool dispatch
ok 158 - negative validation results stop a batch even when the original tool has no isError flag
ok 159 - batch preview summaries retain bounded per-state artifact paths
ok 160 - batch selective reads return only requested fields and rejected authoring stops execution
ok 161 - compact pagination keeps a continuation for rows trimmed from the response
ok 162 - ModKit snapshots preserve unknown bytes, isolate inputs and detect same-length changes/tampering
ok 163 - ModKit snapshot identity includes configured dependency catalogs
ok 164 - ModKit input revision changes when the installed CASC build changes
ok 165 - Pinned Host UVM fix is narrow, idempotent and refuses unknown platform code
ok 166 - ModKit world payload preserves typed arrays, maps and safe script boundaries
ok 167 - Self-contained map payload decodes through browser-compatible gzip streams
ok 168 - Data compact reads do not mutate frozen canonical answers or lose provenance
ok 169 - ModKit CASC preserves folder boundaries, range identity, local-only reads and package aliases
ok 170 - MCP map/Data tools expose bounded schemas and truthful missing-runtime errors
ok 171 - ModKit terrain schemas reject accidental unknown operations and oversized byte values
ok 172 - Original ModKit pathing paint/fill preserves opaque headers, tails and source data
ok 173 - A missing pathing mask uses the supplied native header without inheriting donor cells
ok 174 - Raw painted channels, scalar vertex values, fluff and PATH hints reuse ModKit writers
ok 175 - Native road repair changes duplicate keys only; partial roads and opaque VTCL suffix refuse writes
ok 176 - Navigation preview sees a newly painted barrier and does not claim catalog or engine footprints
ok 177 - Terrain palette registers native bindings while preserving geometry and mask bytes
ok 178 - Catalog closure and original footprints affect placed buildings, resources and doodads
ok 179 - Native ramp transfer keeps donor SMAP samples, CLIF samples and unrelated LFCT bits
ok 180 - Diagonal ramp fitting and widening keep all native height channels aligned
ok 181 - Shared terrain plans remain dry until apply/save and guard unrelated dependencies
ok 182 - native jobs serialize, snapshot source, retain unknown diagnostics and export exact compiler output
ok 183 - a native error stops subsequent checks, preserves full evidence and fails the job
ok 184 - queued source changes and workspace escapes fail before native access; active stop is refused
ok 185 - native tool schemas expose seven focused tools and reject invalid regions and camera modes
ok 186 - workflow compaction keeps native progress, uncertain outcomes and evidence paths
ok 187 - shutdown drains already accepted queued jobs before closing the frontend
ok 188 - native stdio handshake, fragmented responses, tool errors and safe EOF work without an Editor
ok 189 - saved camera listing is paginated, uses a verified snapshot and never starts an Editor
ok 190 - named native capture forwards exact camera ID and preserves readback, not a cutscene argument
ok 191 - Win32 startup failure preserves actionable diagnostics; next job can recover without stale Galaxy export
ok 192 - compile-only startup failure remains in the compact check result and cannot export old Galaxy
ok 193 - old or unrelated native frontends are rejected before using incompatible DLL protocols
ok 194 - an old or mixed installed package is rejected before starting its executable
ok 195 - unreadable phase logs stay unknown and retain the actual native controller failure
ok 196 - successful native phases stay in full evidence without bloating compact MCP replies
ok 197 - failed camera capture cannot publish an old image or claim a loaded document
ok 198 - saved camera requests reject mods and detect queued archive changes before querying the backend
ok 199 - PlacementDocument adds Unit and Doodad using their real distinct type attributes
ok 200 - line, grid, circle and seeded scatter planners are deterministic
ok 201 - placement.addUnit resolves through browse and dry-run changes no file
ok 202 - placement applies a Doodad atomically, creates backup, reparses, and is idempotent
ok 203 - move/rotate/scale/remove patch only selected object spans and preserve unknown data
ok 204 - duplicate ids and out-of-bounds plans are rejected by validation
ok 205 - createLocation builds forest, desert and city as one deterministic batch from browse candidates
ok 206 - scatter honors an exclusion zone and minimum distance
ok 207 - placement refuses a stale disk snapshot before any write
ok 208 - recreating the exact committed request cannot silently duplicate objects
ok 209 - rollback dry-run preserves both staged components
ok 210 - a rolled-back placement can be planned again without retaining a false applied receipt
ok 211 - invalid format and unproven writable attributes are not accepted
ok 212 - settlement createLocation reserves crossroads without pretending to paint terrain
ok 213 - for headers cannot hide invalid calls inside the loop and immediately after it
ok 214 - Galaxy token spans retain comments, escaped strings, Includes, arrays and declaration boundaries
ok 215 - script context obeys serialized budget, resolves indexed native signatures and reindexes staged changes
ok 216 - native API exposes official GUI action names instead of presenting implementation identifiers as editor actions
ok 217 - body patch and static rename preserve untouched source and reject dynamic references/collisions
ok 218 - new Include dependencies and staged edits invalidate plans without partial writes
ok 219 - native arity and local Include cycles are errors; missing external libraries remain explicit
ok 220 - create and connect stage/save atomically, preserve entry code and reject early returns
ok 221 - periodic recipe checks action signature and produces valid native arities without touching GUI triggers
ok 222 - file-set changes after staging block script save and leave the complete group staged
ok 223 - v39 ant players: actual stream profile and untouched suffix
ok 224 - v39 city players: actual stream profile and untouched suffix
ok 225 - v39 nydus players: actual stream profile and untouched suffix
ok 226 - v39 warships players: actual stream profile and untouched suffix
ok 227 - options preserve unknown bits and recompute the core integrity hash
ok 228 - players reject unregistered locations, byte-overlong strings and unknown slots
ok 229 - Attributes edits preserve XML comments, unknown elements, quote style and sibling bytes
ok 230 - native variant clone preserves all original bindings and can edit mode and locked defaults
ok 231 - malformed, duplicate and ambiguous Attributes fail before patching
ok 232 - multi-file settings stage/save preserves originals and guards the entire map manifest
ok 233 - create missing Attributes registers the component atomically and enforces scoped values
ok 234 - external MapInfo edit and overlapping staged changes invalidate a settings plan
ok 235 - real SDK Settings profile plans, stages, saves, and reads native map settings
ok 236 - empty self-closing settings containers expand without losing root attributes
ok 237 - new player defaults and value edits keep native sibling variants untouched
ok 238 - shared preflight inspects binary MapInfo Settings including staged changes
ok 239 - New map can register native starts and add a computer while preserving opaque settings
ok 240 - composition writes one owned group, repeats without duplicates, protects manual edits and terrain dependencies
ok 241 - constructed recipes require explicit measured members and keep reserved paths clear
ok 242 - measured prefab members preserve exact Actor key, variant and ground offset, and reject a wet corner
ok 243 - shared lighting terrain preview samples border normals inside the native map bounds
ok 244 - native nydus terrain: dimensions, exact component SHA, sync layout and water
ok 245 - native ant terrain: dimensions, exact component SHA, sync layout and water
ok 246 - native city terrain: dimensions, exact component SHA, sync layout and water
ok 247 - native warships terrain: dimensions, exact component SHA, sync layout and water
ok 248 - height batch preserves cliff-adjustment/mask/native data, updates interleaved sync and stages all files together
ok 249 - tiled mask addressing crosses 64-pixel boundaries without touching neighbouring nibbles
ok 250 - new palette assets resolve through browse; texture painting updates masks and sync names/indices
ok 251 - noise is deterministic; Gaussian smoothing reduces height variance and preserves outside region
ok 252 - native ramps/cliffs/holes are preserved; unsupported structural editing fails before changes
ok 253 - flat native water table supports grid rectangles and rejects unaligned edits
ok 254 - stale plans and external edits after staging are rejected; discard leaves disk untouched
ok 255 - strict XML recipe compiles known operations and rejects unknown commands/attributes
ok 256 - placement location plans include terrain + Objects atomically and snap doodads to planned ground
ok 257 - binary parsers reject truncated payloads and unknown versions
ok 258 - binary transaction compensates an interrupted multi-file commit even without backups
ok 259 - committed binary rollback restores exact bytes and removes files created by the transaction
ok 260 - all advertised style recipes and geometric features produce reparsable plans
ok 261 - whole-map donor stamps preserve native bundles and reject subsequent donor changes
ok 262 - terrain GUI API defaults to dry-run and uses the same plan as its preview
ok 263 - standalone placement ground snapping records terrain hashes and rejects a changed surface
ok 264 - texture replacement transfers only the requested layer weight
ok 265 - native cliff updates records, levels, wall holes and sync height in one transaction
ok 266 - native ramp carries measured channels and frame registration, then removes its slope
ok 267 - height brush retains the native cliff adjustment lane
ok 268 - native writer rejects unproven profiles and ramps without a level boundary
ok 269 - native ramp rejects an organic cliff that breaks a side rail
ok 270 - ramp side-cap terrain cutouts match the measured donor and preserve authored hiding
ok 271 - SC2Style constants, font groups, rename and unknown XML are lossless
ok 272 - string table patches only one value and preserves BOM/comments/CRLF
ok 273 - rich text AST preserves unknown tags and exact native spelling
ok 274 - text.apply stages style and two locales atomically with minimal patches
ok 275 - text.apply rolls back every draft when validation fails
ok 276 - font.import defaults to dry-run and never copies implicitly
ok 277 - ui.apply binds a shared Font Style through the native Style property
ok 278 - cutscene text.add emits only corpus-confirmed CCutsceneNodeText fields
ok 279 - checked-in Kaldir Font Style and locales are exactly generated by text.apply
ok 280 - revised GUI import rejects script fallback and incomplete or nested organization
ok 281 - revised GUI import pins both sources and stages tree/runtime/labels as one guarded transaction
ok 282 - revised GUI else-if chains remain exclusive, boolean groups and skip/increment execute correctly
ok 283 - abilcmd literals use ValueId for command index rather than stringifying the command
ok 284 - native empty GUI unit filter is a handle constructor, and unknown filter literals fail closed
ok 285 - descending GUI integer loops visit all elements instead of skipping cleanup
ok 286 - UI formatter writes each tag on a line and preserves attributes/entities/comments
ok 287 - UI formatter retains BOM/CRLF and never changes mixed content or CDATA
ok 288 - changed UI writes are formatted automatically; stale guards and non-UI bytes stay intact
1..288
# tests 288
# suites 0
# pass 287
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 45395.9005
```
