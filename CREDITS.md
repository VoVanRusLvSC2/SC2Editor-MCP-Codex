# Authors and module credits

**SC2Editor-MCP-Codex — VoVanRusLvSC2**
(vladimir.lencmanis@gmail.com).
Original editor/MCP functions across all modules, project integration,
renderer settings and implementation, WebGL2 player/renderer adapters and
shared lighting modules are credited to VoVanRusLvSC2.
Project: <https://github.com/VoVanRusLvSC2/SC2Editor-MCP-Codex>.

**Surface Toolkit — vise.** This author attribution was provided by the
project owner. The supplied archive's provenance and original notices are
retained in [Surface Toolkit NOTICE](src/modules/terrain/surface/NOTICE.md).
Author attribution does not establish redistribution terms; the supplied
notice does not contain an explicit redistribution license.

Third-party implementations keep their own authorship and licenses:

- ModKit contributors: static texture filtering adapted from `@modkit/scene`;
  see its [MIT notice and pinned source](vendor/modkit-scene/NOTICE.md).
- `@modkit/blizzard-models`: the supplied model/material/effect library and
  editable sources; see its [NOTICE](vendor/blizzard-models/NOTICE.md) and
  [GPL-2.0 license](vendor/blizzard-models/LICENSE-GPL-2.0.txt).
- StormLib and CascLib: Ladislav Zezula and upstream contributors; individual
  bundled libraries retain their own notices.
- Tiktoken vocabulary: OpenAI and Shantanu Jain, as recorded in the supplied
  [MIT notice](generated/TIKTOKEN_LICENSE.txt).
- npm dependencies: their respective authors, as identified by each package.

See [license scope](THIRD_PARTY_LICENSES.md). When using original project code
in another project, provide the project credit required by [LICENSE](LICENSE),
identifying the modules or functionality used. For example:

> Uses MCP authoring and WebGL2 preview modules from SC2Editor-MCP-Codex
> by VoVanRusLvSC2: https://github.com/VoVanRusLvSC2/SC2Editor-MCP-Codex

Russian equivalent:

> MCP and WebGL2 preview modules from SC2Editor-MCP-Codex are used.
> Author VoVanRusLvSC2: https://github.com/VoVanRusLvSC2/SC2Editor-MCP-Codex

ModKit Data/CASC/map integration also uses the public Host, SDK, SC2 loader, CASC reader, Images/Models codecs and world renderer by [Modkit contributors](https://github.com/hometlt/ModKit), with Blizzard-format extensions from [ModKit-Blizzard](https://github.com/hometlt/ModKit-Blizzard). Pinned sources and license preservation are described in [the integration notes](docs/MODKIT_INTEGRATION.md). These are upstream components, not original SC2Editor-MCP-Codex implementations.

Uses **SC2 Native Toolkit by VoVanRusLvSC2**: https://github.com/VoVanRusLvSC2/SC2NativeToolkit.
The optional native Editor adapter calls the separately installed, pinned Toolkit
MCP backend. Its attribution and third-party notices remain in the local runtime.
See [Native Editor integration](docs/NATIVE_EDITOR.md) for scope and limitations.
