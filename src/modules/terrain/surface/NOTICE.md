# Surface Toolkit source provenance

Author: **vise**, as identified by the SC2Editor-MCP-Codex project owner.
This attribution supplements the supplied provenance; it does not replace the
original notices or establish a previously unspecified redistribution license.

Imported from the user-supplied `SC2_Surface_Toolkit_SC2GameData.zip`, toolkit
version `0.2.0-gamedata-inspection`. Archive SHA-256: `7905df94fad4bdf8d488b2ad4de3be5ae4557dd1df2c9e076930e71f24b6f128`.

`format/` and `core/` retain the supplied codecs and their limits. These sources
are not a claim of ownership or relicensing of Blizzard or third-party work.
The supplied notice is retained below. Binary executables, game assets, nested
original archives, compiled JS, vendor copies and historical run logs are not
part of this integration. XML parsing uses the npm dependency and its license.

The SC2GameData observations in `tests/terrain-surface/observations.json` are
selected reconstructed excerpts for regression tests, not original remote bytes
or a current CASC dump. The source URLs and uncertainty fields are retained.

## Supplied notices

PROVENANCE AND THIRD-PARTY NOTICES

The original format.zip and painted-pathing(1).zip were supplied by the user.
They are retained byte-for-byte under originals/ for provenance. This package
makes no claim to own or relicense Blizzard software or unknown third-party
rights in those supplied sources. Review the original project's licensing
before publishing or redistributing the combined work.

The generated corrections, tests, reports and integration guidance are an
engineering audit output. No warranty of SC2 Editor/runtime compatibility or
formal verification is given.

vendor/xmldom contains @xmldom/xmldom 0.9.8. Its MIT LICENSE and original
package metadata (UPSTREAM-package.json) are retained. The local package.json
is a runtime-only manifest for offline installation; parser implementation
files were copied, not replaced with a claimed original implementation.

Public reverse-engineering documentation and target repository were consulted
as references. They are cited in evidence/sources.json; complete third-party
repositories or copyrighted documentation were not re-published here.

The two user-supplied EXE binaries are NOT included in this package. Static
metadata, hashes and selected surface-related strings are included as evidence;
these excerpts are not executable reconstructions or proof of decompilation.

SC2GameData addition: evidence/sc2gamedata contains selected factual observations transcribed from published XML, with source URLs and line ranges, not a byte-identical source snapshot or complete clone. Do not attribute the local JSON hash to the upstream file. Upstream data and asset names retain their respective owners' rights. No M3/DDS assets, game executables, or CASC storage are redistributed by this addition.
