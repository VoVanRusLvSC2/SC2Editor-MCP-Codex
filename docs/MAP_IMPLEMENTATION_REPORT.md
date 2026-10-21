# The result of development - alpha.12

Order: card base → Terrain → Galaxy scripts → editor and game check. GUI triggers are excluded from development; existing components of other people's cards are saved.

Completed: Map ninth module with 11 commands; native MPQ backend on the StormLib fixed; import, verified export and script cloning; limited editing of MapInfo v39 with unknown tail preservation; persistent recovery journal and interprocess lock. Unconfirmed recording of water bodies disabled.

Verifications: 220 PASS tests, 0 errors and omissions; build/lint PASS. Four original maps passed a full roundtrip 939 user entries with SHA-256 validation. Real interruption of test processes checked recovery of the unfinished group; external changes block recovery to write. Portable MCP/HTTP smoke passed on Linux Node: 139 tools, nine modules, Map capabilities and joint saving of UI.

Windows helper is compiled and verified as x64 PE, but it didn't run on Windows. Node 20+ is required separately. Editor and game didn't run; visual GUI check wasn't performed.

Remain: clean map from scratch and confirmed DocumentHeader/player/variant/defaults; Terrain init/resize/derived, cliff/ramp/water/pathing writers, vertex colors; separate script.* Module.Script map clone is not a new blank card.Power-loss certification and universal fixation of all directory/dependency reads off-Map are not executed; drafts and Undo remain in process memory.

The next block is to restore minimum native defaults and proven pure blueprint, then implement Terrain init and harmonized rearrangement of derived components. For unconfirmed water/pathing formats, you need native samples or restored serialization code: the existing EXE has not yet produced confirmed instruction xrefs.

Detailed JSON proofs and logs are included in generated/, plan and command description in docs/.
