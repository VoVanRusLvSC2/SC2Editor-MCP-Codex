# Dependency check - alpha.11

Text operation captures not only the files being written, but also the dependencies read through Workspace. This applies to preflight Data/AI and checks inside ui.apply/text.apply. Data dependency catalogs and Browse dependency text/DocumentInfo also use tracked reads.

Read set contains the exact bytes and existence of the file; local readRaw additionally captures effective text based on the draft. Changing dependency draft or its discard blocks the dependent entry. Pictures are saved in the draft group until save/discard, rather than disappearing after apply.

Before transform and before commit, dependencies are checked. After preparing temporary files, the writer rechecks them; the external change rejects the result; the original written files and the draft prepared remain available; to re-evaluate, you should discard and re-build the operation on current data.

Data/AI preflight runs in the same AsyncLocalStorage read context as raw transaction; queues of different queries retain independent contexts. AI does not use cached bindings during tracked apply. The missing root Triggers fixes explicitly: the appearance of a binding file after stage blocks save. Triggers stays read-only; this is not a new trigger editing module.

## Checks.

Seven new tests: preflight dependency edit, validation dependency edit, staged dependency save, external root and missing-file existence, async edit/context isolation, Data reference added to existing catalog, AI binding file appearing after stage, dependency discard. Full regression suite: 205 PASS.

## Boundaries

This snapshot validation of the files read, not isolation of all processes. Directory enumeration is not pin: a new file in a previously scanned directory is not always detected when saved. Binary/adapter reads outside Workspace context read are also not covered automatically. Between the last check and rename, there is OS-level recovery. There is no persistent journal and crash-wide multi-file atomicity.

The next engineering job is to pin directories with the correct exception of their own new files, add a durable recovery journal, then collect confirmed native AI/Terrain semantic fixtures. Full AI/cliffs/ramps/pathing formats are not confirmed due to this infrastructure change.
