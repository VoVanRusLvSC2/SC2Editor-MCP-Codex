# 1.1.0-alpha.12

Added Map as the ninth module with 11 tools; vendored pinned StormLib source and Windows/Linux x64 native helper builds. Archive export snapshots source components, rebuilds MPQ internals, reopens and verifies every user-entry hash/name/locale before publication. Full roundtrips on four supplied maps verified 939 user entries. Locale/platform variants select a classic MPQ v2 profile; neutral SC2 maps use MPQ v4.

Added bounded MapInfo v39 core-prefix parsing/integrity validation and lossless playable-bound/fog/minimap edits preserving the opaque tail. Complete eligible file-manifest guards survive staged save and restaging through shared byte transactions. Added import/export/clone/inspect/validate and explicit clean-creation/resize gaps.

Added persistent prepared/committed journals and initialized hardlink process locks for Workspace text/byte writers. Process-kill recovery preflights all targets, restores uncommitted groups/new entries, and refuses unknown external edits. Two processes serialize read-modify-write operations. Draft/commit undo remains process-local.

Corrected unsupported water claims: native table floats no longer imply water coverage, body writers are blocked, raw data remains read-only/preserved. GUI-trigger implementation is excluded from the roadmap; Galaxy scripts remain after Terrain.

No clean-map/from-scratch guarantee, structural cliff/ramp/pathing/body writer or Editor/game compatibility promotion. Windows helper was cross-compiled and PE-inspected; execution on Windows remains NOT_EXECUTED. Power-loss durability certification and general directory pinning are pending.
