---
name: sc2-mission-authoring
description: Create or substantially revise playable StarCraft II missions, arenas or cooperative maps through MCP. Use for end-to-end work spanning terrain, Data, triggers, UI and objectives. Do not activate for isolated catalog queries or single-field fixes.
---

# Complete map authoring

Read repository `AGENTS.md`, `docs/AUTHORING_PROTOCOL.md`, then
`docs/MCP_AUTHORING_SCRIPT.md` for compact commands. Load the other project skills
only when their subsystem is being authored.

1. Inspect the current map, dependencies, editable sources and user constraints.
   Establish genre, bounds, player roles and complete success/failure/restart flow.
2. Reserve a connected layout for routes, combat, objectives and service areas.
   Give zones readable landmarks before adding decorative details.
3. Implement a complete representative interaction: Data mechanics, coordinating
   logic, feedback, UI and localization. Extend working patterns to other content.
4. Organize real GUI elements when GUI is requested; use the user's folder limits
   and the documented genre conventions. Keep ownership and per-player state clear.
5. Develop terrain at overview and gameplay scale using the terrain skill.
6. Check startup, inputs, objectives, failure/death, success, cleanup and repeat.
   Include persistence and multiplayer state when applicable. Native/game tests
   depend on available tools and task authorization.
7. Export through MCP and deliver the artifact with compact verification evidence.

Completion means a reachable user-facing flow and a truthful check report.
Static export/reopen does not establish gameplay quality. Report missing native,
visual or gameplay tests explicitly; do not replace them with a quality score.
