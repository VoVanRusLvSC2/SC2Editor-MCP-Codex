# Custom Script and the structure of GUI triggers

The SC2 Editor reads the Custom Script action as the `ScriptCode` block with an XML indent.
If you write the text in a line with a tag or without a structural indentation, the editor can
Cut the beginning of Galaxy lines. Valid XML and check the individual `.galaxy` this
They don't.

`trigger.normalizeScriptLayout` brings only Custom Script text blocks to
Preview is performed by default (`dryRun`).
For recording: `dryRun: false`, then `trigger.save` with backup.

Categories, element IDs, references, and procedures are retained.
`ScriptCode` in typed parameters are not processed.
They do not recover: this requires an intact backup.

`trigger.graft` automatically formats imported Custom Script blocks.
Existing blocks of the target file remain unchanged when copied.

The format corresponds to `appendScriptCodeBlock` processing in the local Trigger Revize.
This operation does not trigger the Galaxy → Triggers conversion and does not confirm
Compiled by the SC2 Editor compiler.
