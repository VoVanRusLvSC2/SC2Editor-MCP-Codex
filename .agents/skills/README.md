# Project authoring skills

These portable English workflows reference `AGENTS.md` and
`docs/AUTHORING_PROTOCOL.md`. They are instructions, not executable generators or
claims of engine validation.

| Skill | Activate for | Keep inactive for |
| --- | --- | --- |
| `sc2-mission-authoring` | New mission/arena or substantial multi-system revision | One catalog lookup or field edit |
| `sc2-terrain-composition` | Terrain, bases, forests, object scale and composition | Trigger-only repair |
| `sc2-data-trigger-systems` | Abilities, progression, gameplay coordination and GUI folders | Landscape-only repaint |

## Routing and outcome examples

- "Build a co-op defense mission": mission workflow; load specialized workflows
  during their phases. Expect a complete match flow and separate verification.
- "Decorate a military base with a vehicle route": terrain workflow; reserve
  the route, measure scale and inspect a preview.
- "Add a dash with impact damage and levels": Data/trigger workflow; Data owns
  mechanics/progression, including visible feedback and explicit runtime limits.
- "Organize these graphical triggers": Data/trigger workflow; real GUI folders
  are required rather than Galaxy filesystem directories.
- "Change the localized title": use text tools directly; these workflows do not
  require a whole-map pass.
- "Explain a renderer equation": consult renderer documentation; these workflows
  do not authorize changes to paused rendering research.
