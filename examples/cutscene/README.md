# Cutscene examples

`full_example/ComposeRequest.json` is a one-call `cutscene.compose` request using only native names verified from Blizzard structure. `GeneratedNative.SC2Cutscene` is its deterministic output. `ApplyRequest.json` demonstrates a two-operation atomic edit and uses exact native ticks for the bookmark time.

The example deliberately does not contain guessed Camera property tags. Run `npm run cutscene:discover` against an installed SC2 corpus, inspect the Camera registry, then use the observed native node/property names.

