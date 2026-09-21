# Text examples

- `KaldirTextApply.json`: one atomic Text transaction.
- `Base.SC2Data/UI/FontStyles.SC2Style`: generated native Font Style.
- locale directories: generated native string tables.
- `KaldirSubtitle.SC2Layout`: UI `Label` consuming the style through `<Style val="..."/>`.
- `KaldirText.SC2Cutscene`: corpus-shaped `CCutsceneNodeText` and its native step text timeline.

The Cutscene file intentionally has no invented Font Style attribute. The UI Layout and localized strings are the confirmed style consumers.
