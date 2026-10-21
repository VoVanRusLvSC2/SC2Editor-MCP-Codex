# StarCraft II — Trigger Organization Protocol for AI

Version: 1.1

## Purpose

Organize StarCraft II map triggers by responsibility and game genre. This document is a project convention, not executable code or an editor import format.

## Mission maps: exactly five top-level folders

Use these English names without numeric prefixes:

```text
FUNCTIONS
MAIN
GAMEPLAY
OBJECTIVES
CINEMATICS
```

| Folder | Responsibility |
|---|---|
| FUNCTIONS | Shared helper functions used by multiple systems. |
| MAIN | Map initialization, system startup, mission flow, victory and defeat coordination. |
| GAMEPLAY | Mission mechanics, enemy AI, attack waves, encounters, player rules and other gameplay systems. |
| OBJECTIVES | Primary and optional objectives, progress tracking, completion and failure conditions. |
| CINEMATICS | Scripted scenes, camera sequences, cinematic dialogue and scene-specific audio. |

Keep system-specific functions and variables with their owning system where the editor permits it. Keep local variables inside their corresponding elements. Place shared configuration and global state under MAIN when no single gameplay system owns them.

Use subfolders only when needed. Do not add extra top-level folders to a mission map. Gameplay UI and audio belong with the gameplay system that uses them; objective messages belong with OBJECTIVES; cinematic UI and audio belong with CINEMATICS. Shared helpers belong in FUNCTIONS.

Optional mission subfolders:

```text
FUNCTIONS
MAIN
GAMEPLAY
    AI
    WAVES
    ENCOUNTERS
    DEBUG
OBJECTIVES
    PRIMARY
    OPTIONAL
CINEMATICS
    INTRO
    OUTRO
```

The five-folder rule applies to mission maps. The following genre templates may use additional top-level system folders.

## Other genres

Start with FUNCTIONS, MAIN and GAMEPLAY. Add only the systems the map actually needs. Add UI, AUDIO or CINEMATICS only when a separate shared system is useful.

| Genre | Suggested system folders |
|---|---|
| Classic RTS / melee | ECONOMY — income and spending; BASES — bases and starting locations; TECH — progression and technology; VICTORY — win conditions; AI — computer-player behavior. |
| Co-op mission | Keep the five mission folders. Under GAMEPLAY, optionally add WAVES, COMMANDERS, DIFFICULTY and MUTATORS. Keep shared mission tasks in OBJECTIVES. |
| Tower Defense | PATHS — enemy routes; WAVES — wave management; TOWERS — tower logic; UPGRADES — upgrades; LIVES — lives and escaped enemies. |
| Survival / base defense | SPAWNING — enemy creation; WAVES — wave scheduling; BASE_DEFENSE — defense mechanics; SCALING — difficulty growth; BOSSES — boss encounters. |
| RPG / Action RPG | HEROES — hero systems; ABILITIES — ability logic; QUESTS — quests; INVENTORY — items; LOOT — drops; PROGRESSION — levels and advancement; DUNGEONS — dungeon systems. |
| MOBA | HERO_SELECTION — hero selection; LANES — lane systems; CREEPS — lane units; JUNGLE — neutral camps; SHOPS — purchases; RESPAWN — respawning; MATCH_FLOW — match phases. |
| Arena / PvP | LOADOUTS — equipment selection; ROUNDS — round management; SCORING — points; RESPAWN — respawning; ARENA_EVENTS — arena events. |
| Auto Battler / Auto Chess | DRAFT — unit selection; BOARD — board placement; SYNERGIES — unit combinations; COMBAT — automated battles; ROUNDS — round management; ECONOMY — purchases and income. |
| Puzzle / Escape | PUZZLES — puzzle logic; INTERACTIONS — interactions; ROOMS — room progression; TRAPS — traps; HINTS — hints; CHECKPOINTS — checkpoints. |
| Racing / parkour | MOVEMENT — movement mechanics; TRACKS — courses; CHECKPOINTS — checkpoints; TIMERS — timing; PLACEMENT — player standings. |
| Minigames / Party | MINIGAMES — individual games; ROTATION — game rotation; ROUNDS — rounds; SCORING — points; VOTING — voting. |

## Organization rules

1. Use English UPPER_SNAKE_CASE folder names. Use the exact five top-level names specified above for mission maps.
2. Create only necessary folders. Do not create empty systems just to fill a template.
3. Group elements by responsibility. Keep each system's triggers, dedicated functions and related state together where possible.
4. Place only cross-system helpers in FUNCTIONS.
5. Keep MAIN focused on initialization and coordination. Put detailed mechanics in their owning systems.
6. Avoid duplicated ownership. For example, do not maintain both AI/ATTACK_WAVES and WAVES for the same wave system.
7. For hybrid genres, combine the required systems without duplicating folders or responsibilities.
8. Do not use OTHER, MISC, NEW_FOLDER or equivalent catch-all folders.
9. Keep debugging elements separate from normal gameplay elements. For mission maps, use GAMEPLAY/DEBUG if needed; for other genres, a separate DEBUG folder is acceptable. Prevent debug logic from running accidentally during normal play.
10. Inspect existing organization before changing an established map. Preserve references and gameplay behavior. Do not perform unrelated renaming or restructuring.
11. These folders organize trigger logic. A folder named TOWERS or ABILITIES does not require moving object configuration out of the Data Editor.
12. Folder organization alone does not authorize changes to mechanics or balance.

## AI workflow

1. Identify the map genre and required systems.
2. Inspect the existing structure if a map already exists.
3. For a mission map, use exactly FUNCTIONS, MAIN, GAMEPLAY, OBJECTIVES and CINEMATICS at the top level.
4. For other genres, select the relevant system folders from the table.
5. Assign every new element to one owning system.
6. Extract a shared function only when multiple systems need it.
7. Report the folders changed and their responsibilities. Do not claim editor validation unless it was actually performed.

## Instruction to include in a larger AI protocol

> Organize StarCraft II triggers by system and responsibility. For mission maps, use exactly five top-level folders: FUNCTIONS, MAIN, GAMEPLAY, OBJECTIVES and CINEMATICS, without numeric prefixes. Put shared helpers in FUNCTIONS, startup and mission coordination in MAIN, mechanics and AI in GAMEPLAY, mission tasks in OBJECTIVES, and scripted scenes in CINEMATICS. Add subfolders only when needed. For other genres, use the relevant system folders from this protocol. Avoid duplicate responsibilities and catch-all folders. Preserve existing references and gameplay behavior.
