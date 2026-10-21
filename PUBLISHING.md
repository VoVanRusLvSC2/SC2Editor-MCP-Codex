# Source composition for GitHub

## Runtime catalogs and authoring instructions

Source updates include `AGENTS.md`, `.agents/skills/`, current English guides,
`resources/authoring-catalog/` and the MCP code that reads those inputs. The
catalog's deterministic `.json.gz` files contain reference JSON, not game assets;
do not exclude them with a blanket compressed-file filter. Preserve `IMPORT.json`,
source checksums and provenance. Verify the exact candidate with
`npm run catalog:verify`, `npm run docs:check-language`, builds and relevant tests.
Private map-specific history, captures, telemetry and backend runtime packages
remain local. Inventory classification does not replace rights/secret review.

Author of our code: **VoVanRusLvSC2**, <vladimir.lencmanis@gmail.com>.
License: [SC2Editor-MCP-Codex Attribution License 1.0](LICENSE), separate
a license with a mandatory indication of the source of modules in the project using them.
It should be mentioned **VoVanRusLvSC2**, the **SC2Editor-MCP-Codex** project, its link and
Modules used in README, Credits, Documentation or About Program.
For a public project, the mention must be publicly available. Copyright
The terms of the license are also retained. It is not enough to notify the author personally.
An example of a ready-made mention is [CREDITS.md](CREDITS.md).
The third-party code retains its terms: [license](THIRD_PARTY_LICENSES.md).

The composition includes third-party implementations required by the application.
not distributed: renderer saves GPL, StormLib/CascLib saves their MIT,
Surface Toolkit - original notice without fictional new license; author **vise**
This is according to the owner of the project.

## What needs to be preserved

| Files. | Appointment |
| --- | --- |
| `src/` | MCP, GUI, lighting, cutscene, parsers and source code tests |
| `package.json`, `package-lock.json`, `tsconfig*.json`, `eslint.config.mjs` | Dependency Installation, Assembly and Verification |
| `scripts/` | Build native backends, generate registries and checks |
| Sources `native/`, pinned revisions, StormLib and all third-party notices | MPQ/CASC reproducible assembly; collected `native/bin/` is not needed in Git source |
| `windows/` | Launcher and connection instructions |
| `schema/` and selected `generated/` runtime files | Schemes and registries that the server reads while working; rights to imported data are verified separately |
| `vendor/blizzard-models/{src,browser,dist}/`, metadata, GPL and notices | The current render uses both JS from `dist` and browser chunks; the entire vendor directory cannot be deleted. |
| `LICENSE`, `CREDITS.md`, `THIRD_PARTY_LICENSES.md`, README, current guidelines | Authorship, third-party terms, launch and use |

The exact list of candidates is created by `npm run publication:audit`.
`work/publication/audit.json`.This is a composition check, **not a publication command**:
It doesn’t commit/push, it doesn’t change the Git index, and it doesn’t copy game resources.
Category `review` means the desired file for which questions remain.
`local` means a file outside the proposed public list.

`npm run publication:prepare` creates a separate local copy of all files.
`candidate` and `review`, including third-party code and its notices, in the new directory
`work/publication/source-package-*` Each file is copied without modification and
Manifest with SHA-256 and the exact path is separately in the
`work/publication/prepare.json` Exports do not change working source or index
Git; does not delete previous copies; does not commit/push.
The next commission, not the permission of the unresolved publication holds.

Runtime whitelist `generated/` is located in `publication-policy.json`:
AI/Cutscene/Data/Text/Font/Trigger/Galaxy registries, `data-xsd-index/`, dictionary
`o200k_base` and its MIT notice. The remaining `generated/` reports are not required to run
Deleting the entire `generated/` folder will break some of the tools.

## What to leave locally

`work/`, `output/`, `release/`, `dist/`, `dist-runtime/`, `node_modules/`,
caches, browser captures, one-time checks and reports, old players,
Screenshots, DMP/EXE/Ghidra/decompilation and M3/M3A/DDS/FXA/audio.
Fixtures and examples are considered separately: among them there are game bytes.
Verification leaves these inputs locally, rather than removing them.
A full local test series may need these fixtures.

Our auxiliary TXTs are not on the whitelist.
`docs/RENDER_STATUS_V42.txt` is included as a separate exception.
**TXT licenses are retained**:
`LICENSE-GPL-2.0.txt`, `LICENSE-CascLib.txt`, `TIKTOKEN_LICENSE.txt` and notices
In third-party sources, text files within third-party source
They are stored with them so as not to lose notices and build inputs.
The `*.txt` cannot be built by one rule; for example, the `CMakeLists.txt` is used for assembly.

## What's stopping a full public push now

Mandatory mention in the project is an additional condition, so
The license is no longer called BSD-2-Clause.
GPL-2.0-only renderer is not provided.
compatible renderer / its resolution or a separate solution of the owner
rights to the terms of our code; the requirement to mention is not automatically waived.

1. Imported Surface Toolkit `core/` and `format/` do not have installed
   Distribution licenses, original author's terms or replacement
   Without these files, the current terrain module is incomplete.
2. The delivered GPL renderer lacks some local dependencies
   and the full original build entry point.
   It is necessary to check and provide a set of appropriate sources.
3. For imported circuits/registries and research derivatives
   Separate review of composition and rights. Our license does not overlicense this data.

Therefore, the audit honestly returns `readyForPublicPush=false`.
and the license has already been prepared; the entire working directory is not yet verified
You don't just run `git add -A` and push.

Before future publication, check `git diff --cached --name-only`: `.gitignore`
Does not remove already tracked game fixtures and reports from Git history.
have already been shared, a separate clean repository/export may be more convenient
Composition checks do not scan past commits and do not
It is a complete check on secrets.

Code assembly is checked by `npm run build:release`.
`npm run archive:build` and `npm run casc:build` with the appropriate native
toolchain. The game is set by the user separately.
Asset-embedded HTML players should not be in the original supply.
