# Runtime and archive adapter boundaries

## Why adapters are explicit

SC2Layout validation and Core corpus evidence cannot prove that a particular game build will instantiate a locked type, accept every property, or render pixels identically. Likewise, a packed `.SC2Map` is not a directory and must never be overwritten with guessed archive logic.

`ui.capabilities` reports these layers separately:

1. semantic editing — built in;
2. actual SC2 runtime validation — only true when a runtime adapter is configured;
3. packed map/mod read-write — only true when an archive adapter is configured.

## Runtime corpus

Generate isolated tests for every known frame type:

```bash
npm run runtime:corpus -- ./runtime-corpus
```

Output:

```text
runtime-corpus/
  runtime-corpus.json
  UI/Layout/RuntimeCorpusIndex.SC2Layout
  UI/Layout/RuntimeCorpus/0001_....SC2Layout
  ... one file for each of 892 types
```

The manifest records frame type/class, optional Core-observed template, locked status, and expected runtime confidence. Isolation makes it possible to identify the exact failing type instead of losing an entire mega-layout.

## Runtime adapter protocol v1

Set `SC2_UI_RUNTIME_ADAPTER` to an executable. The bridge invokes it without a shell:

```text
adapter probe --workspace <absolute-component-directory> --manifest <absolute-runtime-corpus.json>
```

The adapter should:

1. install/copy the generated component into a disposable test map/mod;
2. start the matching SC2 or SC2Editor build;
3. cause each isolated layout to load;
4. collect UI/layout errors from logs;
5. write a machine-readable report to stdout;
6. return exit code 0 only when its own run completed successfully.

The bridge captures exit code, timeout, stdout and stderr. A nonzero exit is not converted into a structural validator result.

Run generation plus adapter:

```bash
SC2_UI_RUNTIME_ADAPTER=/path/to/adapter npm run runtime:corpus -- ./runtime-corpus --run
```

PowerShell:

```powershell
$env:SC2_UI_RUNTIME_ADAPTER = "E:\Tools\sc2-ui-runtime-adapter.exe"
npm run runtime:corpus -- .\runtime-corpus --run
```

## Archive adapter protocol v1

Set `SC2_UI_ARCHIVE_ADAPTER` to a StormLib/CASC-capable executable. It receives one of:

```text
adapter extract <absolute-map.SC2Map> <temporary-component-directory>
adapter pack <absolute-component-directory> <temporary-output.SC2Map>
```

Extract refuses to overwrite an existing destination and renames its temporary directory only after success.

Pack:

1. asks the adapter to create a temporary archive beside the target;
2. rejects missing/empty output;
3. copies the current archive to `.sc2uimcp.bak`;
4. atomically renames the new archive over the target.

Commands:

```bash
npm run archive -- extract MyMap.SC2Map MyMap.component
npm run archive -- pack MyMap.component MyMap.SC2Map
```

Normal GUI workflow:

```powershell
$env:SC2_UI_ARCHIVE_ADAPTER = "E:\Tools\sc2-ui-archive-adapter.exe"
npm run gui:archive -- "E:\Maps\MyMap.SC2Map"
```

The launcher extracts to an isolated temporary component directory, starts the normal workbench, and waits. After saving edits in the browser, press Ctrl+C: the server closes and the map is repacked through the guarded temporary-output + backup path. If packing fails, the edited component directory is deliberately preserved and printed instead of being deleted.

The project supplies the safety/lifecycle wrapper and protocol, but does not pretend to include Blizzard proprietary archive code. A production adapter and real-map round trip are final `1.0.0` release gates.
