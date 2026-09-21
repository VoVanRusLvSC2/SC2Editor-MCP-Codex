# Cutscene runtime bridge

Runtime Galaxy API and Cutscene Editor XML are separate registries. A matching concept does not prove matching serialization.

The available `natives.galaxy` contains `CutsceneCreateNew`, `CutsceneCreate`, `CutsceneLastCreated`, `CutscenePlay`, `CutscenePause`, `CutsceneStop`, `CutsceneSetTime`, bookmark navigation, range playback, filters, trigger controls and Cutscene events. Discovery stores the full signatures and source paths.

`cutscene.runtime.generate_trigger` emits Galaxy only when all required function names were indexed. It refuses to guess missing signatures.

## Runtime adapter

Set `SC2_CUTSCENE_RUNTIME_ADAPTER` to an executable that accepts:

```text
validate --workspace <component-directory> --cutscene <relative-file>
```

`cutscene.runtime.validate` reports `PASS` only if this process actually ran, did not time out and returned exit code zero. Without an adapter it reports `UNAVAILABLE`.

Optional environment variables:

- `SC2_EDITOR_PATH`
- `SC2_EDITOR_DECOMPILATION`
- `SC2_CUTSCENE_RUNTIME_ADAPTER`

L5 Editor validation and L6 game runtime validation remain distinct. XML/schema validation alone never upgrades either level to PASS.

