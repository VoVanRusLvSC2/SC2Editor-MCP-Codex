# License scope and third-party notices

Original SC2Editor-MCP-Codex code is Copyright (c) 2026,
VoVanRusLvSC2 <vladimir.lencmanis@gmail.com>, under the
[SC2Editor-MCP-Codex Attribution License 1.0](LICENSE). This covers original
code across all modules, including editor/MCP functions, original renderer
settings and implementation, adapters and lighting code.
The `license` field in the root package describes this original code only.
Existing third-party copyright notices and licenses take precedence for their
respective files. The root license does not grant rights to game assets,
imported implementations, upstream schemas, or other third-party data.

Projects incorporating original source or using it as a component, including
extracts and modified modules, must credit VoVanRusLvSC2, identify
SC2Editor-MCP-Codex as their source, link to the project and identify the
functionality used in README, Credits, documentation or About. Public projects
must make that credit publicly accessible. Private projects retain the credit
in their project documentation. Copyright/license preservation is also required.
An individual notification to the author is not a substitute for that credit.
Using the authoring tools alone does not place resulting map/document data
under this license unless the output contains our code.

| Component | License / scope | Notices to retain |
| --- | --- | --- |
| Original code across all project modules and original documentation | Custom attribution license | Root `LICENSE`, required project credit and this scope notice |
| `vendor/blizzard-models/` | Package declares GPL-2.0-only; local modifications to that component retain GPL terms | `LICENSE-GPL-2.0.txt`, `NOTICE.md`, editable sources and modification/build information |
| `native/vendor/StormLib/` | MIT for StormLib; bundled codecs and other third-party files retain their individual notices | Entire upstream license/notice files, including notices within bundled sources |
| CascLib fetched by the native CASC build | MIT; pinned upstream revision | `native/casc/LICENSE-CascLib.txt`, `CASC-REVISION.json` and upstream notices |
| Tiktoken vocabulary | MIT notice supplied with the vocabulary | `generated/TIKTOKEN_LICENSE.txt` |
| npm dependencies | Individual package licenses | Preserve the licenses included in packages when bundling them; versions are recorded in `package-lock.json` |
| Imported Surface Toolkit `src/modules/terrain/surface/core/` and `format/` | Author: vise, identified by the project owner; redistribution license not established in the supplied archive | `src/modules/terrain/surface/NOTICE.md`; do not apply the root license to these files |
| Upstream XML schemas and generated SC2 registries/observations | Third-party data and provenance, not a claim of original-code ownership | Preserve sources/notices; review redistribution rights separately |

The root license is custom and is no longer BSD-2-Clause. Its mandatory
project-credit condition is an additional restriction; compatibility with a
combined GPL-2.0-only renderer distribution is not established or granted.
GPLv2 does not allow imposing further restrictions on recipients. Retaining
GPL notices does not resolve this compatibility issue. Resolve compatible
rights or use a compatible renderer before distributing a combined work.
No automatic waiver of the project's attribution requirement is provided.

GPL distribution also requires complete corresponding source and applicable
build information. Publishing only a minified renderer bundle, or retaining a
source commit hash without corresponding source, does not fulfill those
requirements. These conditions do not relicense the third-party GPL component.

The supplied renderer package references unavailable local Modkit tarballs and
an absent build entry point. Retaining its `src/`, editable `browser/` chunks
and `dist/` is necessary for the current application, but does not establish a
complete reproducible upstream source release. Resolve that before publishing
a combined renderer distribution.

Surface Toolkit publication remains unresolved until the original author's
redistribution terms or permission are obtained, or that implementation is
replaced. Excluding those files alone would leave the current terrain module
incomplete. Local builds are not a clearance to publish the complete project.

StarCraft II executables, dumps, decompiled bodies, Ghidra databases, game
models/textures/audio and asset-embedded players are local research/runtime
inputs. They are not covered by the root license and are excluded from the
GitHub source proposal. Research reports and copied reference images are also
kept local pending a separate publication decision.

License references: [GPLv2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html),
[GNU GPL FAQ on additional restrictions](https://www.gnu.org/licenses/gpl-faq.en.html).
