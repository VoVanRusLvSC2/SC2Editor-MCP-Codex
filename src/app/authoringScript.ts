import type { BatchStep, BatchTool } from "./mcpBatch.js";
import { coalesceDataAuthoringSteps } from "./authoringDataGroups.js";
import { coalesceAuthoringSteps } from "./authoringGroups.js";

export type AuthorMode = "plan" | "stage" | "save";
export const authoringGuide = {
  nativeEditorPolicy:
    "Optional pinned SC2NativeToolkit: editor.status reports connection without Editor startup; editor.check queues native load/Data, compile and save/reopen checks on a saved archive; editor.data.audit submits a full original effective-Data audit with separate native status/cancel and explicit coverage limits; editor.job polls compact results; editor.capture queues native images; editor.stop closes the owned hidden Editor. map.preview remains the fast ModKit renderer. Unknown diagnostics and native images do not certify gameplay.",
  testPolicy:
    "project.test.plan file=tests.json resolves a reusable saved-map suite; project.test.run planId=... in stage mode explicitly launches checks. Existing retained bridges are leased sequentially. Read compact status/report; source changes invalidate prior acceptance. Five trigger folders are recommended, never mandatory.",
  landscapePolicy:
    "Inspect named owned zones with terrain landscape.inspect; use zone and field to page exact config values. Refine with terrain landscape.zone zone=... expectedRequestHash=... changes.config.clusterRadius=8. Only config/terrain merge; nested objects and arrays replace whole fields. Omitted values and bindings remain unchanged. Stage/save uses the existing Terrain transaction.",
  qualityPolicy:
    "project quality.plan prepares a bounded reusable review plan without starting native jobs. Retain separate static, Editor, rendered and gameplay evidence.",
  presentationPolicy:
    "Player-facing abilities/effects normally include native Actor/Model feedback for cast, movement/travel and impact/area, plus sound when appropriate. Invisible helper effects/passives are explicit exceptions. Use native event/host/site-op/lifecycle bindings and visual preloads; mechanics or a Model ID alone do not prove visible playback.",
  format:
    "One command per line: section verb key=value. Quote values containing spaces. Use dotted keys for nested arguments and JSON only for complex arrays. A <<TAG block preserves Galaxy source verbatim.",
  modes: {
    plan: "Read or preview only; module tools keep their dry-run defaults.",
    stage: "For supported recipes, apply to staged workspace files without saving.",
    save: "For supported recipes, apply and save with existing stale guards. Compatible adjacent same-catalog Data commands form one atomic group; earlier distinct groups may remain saved if a later group fails.",
  },
  dataGroupingPolicy:
    "Adjacent compatible Data, Text, Settings, Terrain and single-object Placement commands share one candidate and grouped save. Original schemas/defaults and per-tool limits remain authoritative. Reads, differing files/options, advanced guards and external result references retain boundaries. Data recipes expand inside the transaction with a final limit of 500 native operations. Receipts keep the first command ID; compilation reports declared scopes and avoided calls, while module results report actual files and validity.",
  dataQuickStart: {
    preferred:
      "Use data unit and data spell before low-level XML/JSON. Send multiple adjacent commands in one modkit.author call. mode=plan previews; mode=save stages and saves the complete Data group once.",
    spells:
      "kind=damage|pulse|line|ring|burn. Required id/kind/damage/model/face; Model and Button face are existing exact catalog IDs. Optional unit+slot(0..14) binds a 3x5 command card; slot selects row and column. A positive delay requires warningModel. duration/period apply only to burn, damage is per tick. Sound is optional. Target templates are Stimpack for caster pulse, EMP for line/ring and Snipe for unit damage/burn; sourceAbility overrides explicitly. Area spells hit enemy ground units.",
    unit: "data unit id=Hero from=Marine life=600 scale=1.2 heroic=true creates a derived Unit and independent main Actor, retaining the source movement/attack/death presentation. Existing weapons, abilities and morph forms remain shared. Unsupported layered actors or ambiguous templates reject; no recursive graph duplication or silent replacement.",
    limits:
      "Button text/icon/hotkey inherit face; author distinct localized labels/hotkeys separately when needed. Cast/channel animations use data actor.ability_animation with real sequences. Static validation and model links do not prove native playback or balance. Creation bundles reject existing IDs; explicit configure commands update supported scalar fields of local graphs.",
    updates:
      "data unit.configure id=Hero life=800 speed=3 scale=1.4 changes explicit local Unit values and optional main Actor scale. data spell.configure id=Pulse damage=50 energy=20 cooldown=8 tunes an existing compact spell; target range and burn duration/period are supported where applicable. Omitted values, shape, cards, presentation and manual fields remain unchanged. No graph replacement or implicit creation.",
  },
  examples: [
    "project organize genre=mission",
    "terrain catalog tileset=Agria section=vegetation limit=8",
    "terrain style tileset=Agria profile=forest",
    "terrain palette_preview tileset=Agria section=vegetation limit=6 includeImage=false",
    "terrain measure id=ChainLinkFenceStraight includeImage=false",
    "terrain load.inspect",
    "terrain prefab tileset=Agria recipe=base_entrance clearance=6 includeImage=false",
    "terrain assemble zone=north_gate tileset=Agria recipe=base_entrance at=40,50 clearance=6 includeImage=false",
    "terrain compose zone=west_forest tileset=Agria profile=forest rect=10,10,30,30 count=40 seed=42",
    "map status",
    "terrain paint texture=AgriaDirt at=20,30 radius=8 strength=0.4",
    "terrain pathing rect=10,10,20,20 layer=noBuilding mode=block",
    "objects unit id=Marine at=25,31 owner=1 count=3",
    "data set id=MyMarine path=LifeMax value=600",
    "data card.check unit=Hero",
    "data unit id=Hero from=Marine life=600 scale=1.2 heroic=true",
    "data spell id=Pulse kind=pulse unit=Hero slot=11 damage=40 radius=4 model=GhostEMPAttackImpactEffect face=EMP energy=25 cooldown=5",
    "data spell id=Rift kind=line damage=48 model=GhostEMPAttackImpactEffect face=EMP delay=1.4 warningModel=MyWarningModel",
    "data spell id=Burn kind=burn damage=2 duration=180 period=1 model=MyFireModel face=Snipe",
    "data ability.instant id=Pulse effect=PulseSearch button=Pulse energy=25 cooldown=5",
    "data ability.target id=TargetPulse sourceAbility=Snipe effect=TargetDamage button=TargetPulse range=6 energy=25 cooldown=5",
    "data ability.charges id=TargetPulse max=3 start=3 use=1 regen=8 location=Unit",
    "data effect.projectile id=PointLaunch sourceEffect=EMPLaunchMissile sourceActor=GhostEMPAttack impactEffect=PointSearch damageEffect=PointDamage impactModel=GhostEMPAttackImpactEffect",
    "data hero.veterancy id=HeroXP unit=Hero levelEffect=LevelUp xp=0,50,150 lifeDelta=100 damageDelta=5",
    "data xp.search radius=0",
    "data hero.learn id=HeroLearn unit=Hero veterancy=HeroXP ability=Pulse button=LearnPulse card.page=0 card.slot=14 card.row=1 card.column=3",
    "data actor.ability_animation id=PulseMotion actor=HeroActor unit=Hero ability=Pulse cast=Attack loopCast=true",
    "logic function file=Scripts/Waves.galaxy <<END\\nvoid SpawnWave() { }\\nEND",
    "gui plan file=plans/gui-mission.json",
    "gui folder path=ROUNDS/WAVES genre=arena",
    "gui move type=Trigger id=0123ABCD folder=ROUNDS/WAVES genre=arena",
    "gui script identifier=RoundHelpers folder=ROUNDS/WAVES genre=arena <<END\\nvoid PrepareRound() { }\\nEND",
    "ui timer stylePrefix=MissionTimer",
    "cutscene show file=Base.SC2Data/Cutscenes/Intro.SC2Cutscene",
    'text set key=Mission/Title value="Defend the base" locale=ruRU',
    "settings player id=2 control=Computer color=3",
    "ai find text=Wave",
    "assets find query=marine",
    "casc find query=marine",
    "document empty kind=map width=64 height=64 destination=NewMap",
  ],
  logicDefault:
    "Galaxy. logic file/function/body and galaxy file/function/body build guarded script plans. GUI is only gui.plan or trigger.plan; no Galaxy-to-GUI conversion.",
  ownershipDefault:
    "Hero abilities, native costs/cooldowns/buttons and XP/levels belong in Data. Triggers coordinate rounds, objectives, UI and Banks and issue native ability orders. When graphical organization is requested, use actual Triggers folders, not Galaxy directories. Explicit visible Custom Script blocks may contain complex Galaxy code; generate runtime from that same GUI source.",
  sections: {
    project: "organize/check/quality.plan",
    map: "status/check/preview/create/clone",
    document: "empty/status",
    terrain:
      "status/check/paint/blend/raise/lower/flatten/pathing/nav/decorate/cliff/cliff.repair/ramp/ramp.place/landscape/landscape.inspect/landscape.zone/catalog/style/compose/measure/palette_preview/prefab/assemble",
    objects: "status/check/unit/doodad",
    data: "unit/unit.configure/spell/spell.configure/find/check/set/ability.instant/ability.target/ability.charges/hero.veterancy/hero.learn/actor.ability_animation",
    logic: "status/check/symbols/file/function/body (Galaxy)",
    gui: "status/check/plan (explicit)",
    ui: "status/timer",
    cutscene: "status/show/create/compose",
    text: "check/set",
    settings: "status/players/player/player.set",
    ai: "status/find/check/definition/wave",
    assets: "find/inspect/inspect_many/preview/measure",
    casc: "find",
    lighting: "status",
  },
  limits:
    "20 underlying MCP steps, 64 KiB source. Every command runs the original tool schema; unsupported aliases fail before any tool is called.",
};
type Args = Record<string, unknown>;
const identifier = /^[A-Za-z_]\w*$/;
const reserved = new Set(["__proto__", "prototype", "constructor"]);
const aliases: Record<string, string> = {
  "map.check": "map.validate",
  "map.status": "map.inspect",
  "map.preview": "map.preview",
  "terrain.status": "terrain.inspect",
  "terrain.check": "terrain.validate",
  "terrain.pathing": "terrain.pathing.paint",
  "terrain.nav": "terrain.navigation.preview",
  "terrain.cliff": "terrain.cliff.paint",
  "terrain.ramp": "terrain.ramp.create",
  "terrain.landscape": "terrain.landscape.plan_file",
  "terrain.landscape.zone": "terrain.landscape.zone.plan",
  "objects.status": "placement.scan",
  "objects.check": "placement.validate",
  "objects.unit": "placement.addUnit",
  "objects.doodad": "placement.addDoodad",
  "objects.variants": "placement.setVariations",
  "data.find": "data.peek",
  "data.unit": "data.unit.copy",
  "data.check": "data.validate",
  "logic.status": "script.inspect",
  "logic.check": "script.validate",
  "logic.symbols": "script.symbols",
  "galaxy.status": "script.inspect",
  "galaxy.check": "script.validate",
  "gui.status": "trigger.inspect",
  "gui.check": "trigger.validate",
  "gui.plan": "trigger.plan_file",
  "cutscene.status": "cutscene.list_files",
  "cutscene.show": "cutscene.preview",
  "ui.status": "ui.list_files",
  "text.check": "text.validate",
  "settings.status": "settings.inspect",
  "settings.players": "settings.players.list",
  "ui.timer": "ui.recipe_timer",
  "document.empty": "document.plan",
  "ai.status": "ai.context",
  "ai.find": "ai.query",
  "ai.check": "ai.validate",
  "assets.find": "assets.search",
  "casc.find": "casc.search",
  "document.status": "document.inspect",
  "lighting.status": "lighting.inspect",
};
const directCommands = new Set([
  "project.quality.plan",
  "project.test.plan",
  "project.test.run",
  "project.test.status",
  "project.test.report",
  "project.test.cancel",
  "project.organize",
  "project.check",
  "trigger.organize",
  "terrain.catalog",
  "terrain.style",
  "terrain.compose",
  "terrain.measure",
  "terrain.palette_preview",
  "terrain.prefab",
  "terrain.assemble",
  "assets.measure",
  "data.presentation.check",
  "map.inspect",
  "map.validate",
  "map.create",
  "map.clone",
  "map.blueprint.list",
  "map.blueprint.inspect",
  "map.preview",
  "terrain.inspect",
  "terrain.validate",
  "terrain.palette",
  "terrain.capabilities",
  "terrain.load.inspect",
  "terrain.load.repair",
  "terrain.paint",
  "terrain.blend",
  "terrain.raise",
  "terrain.lower",
  "terrain.flatten",
  "terrain.generate",
  "terrain.cliff.paint",
  "terrain.cliff.repair",
  "terrain.ramp.create",
  "terrain.ramp.remove",
  "terrain.ramp.repair",
  "terrain.plan_file",
  "terrain.landscape.plan",
  "terrain.landscape.plan_file",
  "terrain.landscape.inspect",
  "terrain.landscape.zone.plan",
  "terrain.pathing.paint",
  "terrain.pathing.fill",
  "terrain.navigation.preview",
  "terrain.decorate",
  "terrain.objects.snap",
  "terrain.ramp.place",
  "terrain.ramp.fit",
  "terrain.modkit.inspect",
  "terrain.modkit.plan_file",
  "placement.scan",
  "placement.validate",
  "placement.geometry_check",
  "placement.addUnit",
  "placement.addDoodad",
  "placement.addBatch",
  "placement.scatterDoodads",
  "placement.snapToTerrain",
  "placement.setVariations",
  "data.peek",
  "data.query",
  "data.context",
  "data.resolve",
  "data.validate",
  "data.card.check",
  "data.set",
  "data.unit.copy",
  "data.unit.configure",
  "data.spell.configure",
  "data.spell",
  "data.ability.instant",
  "data.ability.target",
  "data.ability.charges",
  "data.effect.projectile",
  "data.hero.veterancy",
  "data.xp.search",
  "data.hero.learn",
  "data.actor.ability_animation",
  "script.inspect",
  "script.validate",
  "script.symbols",
  "script.context",
  "trigger.inspect",
  "trigger.validate",
  "trigger.plan_file",
  "trigger.plan",
  "trigger.custom_script",
  "trigger.search_functions",
  "trigger.describe_functions",
  "trigger.types",
  "ui.list_files",
  "ui.query_frames",
  "ui.get_frame",
  "ui.preview_dialogs",
  "ui.preview_batch",
  "ui.recipe_timer",
  "ui.hookup.validate",
  "text.context",
  "text.inspect",
  "text.validate",
  "text.set",
  "cutscene.list_files",
  "cutscene.context",
  "cutscene.preview",
  "cutscene.coverage",
  "cutscene.create",
  "cutscene.compose",
  "cutscene.open",
  "cutscene.inspect",
  "cutscene.validate",
  "cutscene.rig_info",
  "cutscene.facial_info",
  "settings.inspect",
  "settings.players.list",
  "settings.capabilities",
  "settings.plan_file",
  "settings.player",
  "assets.search",
  "assets.inspect",
  "assets.inspect_many",
  "assets.preview",
  "ai.context",
  "ai.query",
  "ai.validate",
  "ai.definition",
  "ai.wave",
  "casc.search",
  "casc.file.inspect",
  "casc.read_text",
  "document.inspect",
  "document.plan_file",
  "document.plan",
  "document.validate_plan",
  "lighting.inspect",
]);

function words(line: string): string[] {
  const out: string[] = [];
  let token = "",
    quote = "",
    escaped = false,
    active = false;
  for (const ch of line) {
    if (escaped) {
      token += ch;
      escaped = false;
      active = true;
      continue;
    }
    if (quote) {
      if (ch === "\\" && quote === '"') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = "";
        continue;
      }
      token += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      active = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (active) {
        out.push(token);
        token = "";
        active = false;
      }
      continue;
    }
    token += ch;
    active = true;
  }
  if (quote || escaped) throw new Error("AUTHOR_UNTERMINATED_QUOTE");
  if (active) out.push(token);
  return out;
}
function scalar(text: string): unknown {
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return Number(text);
  if (
    (text.startsWith("[") && text.endsWith("]")) ||
    (text.startsWith("{") && text.endsWith("}"))
  ) {
    try {
      return JSON.parse(text);
    } catch {
      /* Keep a literal string; tool schema decides. */
    }
  }
  return text;
}
function assign(args: Args, key: string, value: unknown) {
  const parts = key.split(".");
  if (parts.some((p) => !identifier.test(p) || reserved.has(p)))
    throw new Error("AUTHOR_ARG_KEY: " + key);
  let target = args;
  for (const part of parts.slice(0, -1)) {
    if (target[part] === undefined) target[part] = Object.create(null);
    if (!target[part] || typeof target[part] !== "object" || Array.isArray(target[part]))
      throw new Error("AUTHOR_ARG_CONFLICT: " + key);
    target = target[part] as Args;
  }
  const last = parts.at(-1)!;
  if (Object.hasOwn(target, last)) throw new Error("AUTHOR_ARG_DUPLICATE: " + key);
  target[last] = value;
}
function argumentsOf(tokens: string[]): Args {
  const args: Args = Object.create(null);
  for (const token of tokens) {
    const at = token.indexOf("=");
    if (at < 1) throw new Error("AUTHOR_EXPECT_KEY_VALUE: " + token);
    assign(args, token.slice(0, at), scalar(token.slice(at + 1)));
  }
  return args;
}
function take(args: Args, key: string) {
  const value = args[key];
  delete args[key];
  return value;
}
function point(value: unknown, count: number, label: string): number[] {
  const parts = Array.isArray(value) ? value : String(value ?? "").split(",");
  const numbers = parts.map(Number);
  if (numbers.length !== count || numbers.some((n) => !Number.isFinite(n)))
    throw new Error("AUTHOR_" + label + "_COORDINATES");
  return numbers;
}
function area(args: Args) {
  const at = take(args, "at"),
    radius = take(args, "radius"),
    rect = take(args, "rect");
  if (rect !== undefined) {
    if (at !== undefined || radius !== undefined) throw new Error("AUTHOR_AREA_CONFLICT");
    const [minX, minY, maxX, maxY] = point(rect, 4, "RECT");
    return { type: "rectangle", minX, minY, maxX, maxY };
  }
  if (at !== undefined && radius !== undefined) {
    const [x, y] = point(at, 2, "AT");
    return { type: "circle", center: { x, y }, radius: Number(radius) };
  }
  if (at !== undefined || radius !== undefined) throw new Error("AUTHOR_AREA_INCOMPLETE");
  return undefined;
}
function shorthand(
  name: string,
  args: Args,
  block?: string,
): { tool: string; args: Args; saveFile?: string } {
  if (["logic.file", "logic.function", "logic.body"].includes(name))
    name = "galaxy." + name.slice(6);
  if (name.startsWith("galaxy.") && ["file", "function", "body"].includes(name.slice(7))) {
    if (block === undefined) throw new Error("AUTHOR_GALAXY_BLOCK_REQUIRED");
    const file = take(args, "file");
    if (typeof file !== "string" || !file.endsWith(".galaxy"))
      throw new Error("AUTHOR_GALAXY_FILE_REQUIRED");
    const kind = name.slice(7),
      functionName = take(args, "name");
    if (
      Object.keys(args).length ||
      (kind === "body" && typeof functionName !== "string") ||
      (kind !== "body" && functionName !== undefined)
    )
      throw new Error("AUTHOR_GALAXY_ARGS");
    const operation =
      kind === "file"
        ? { op: "file.create", file, source: block }
        : kind === "function"
          ? { op: "function.add", file, source: block }
          : { op: "function.body", file, name: functionName, body: block };
    return { tool: "script.plan", args: { operations: [operation] }, saveFile: file };
  }
  if (
    [
      "terrain.paint",
      "terrain.blend",
      "terrain.pathing",
      "terrain.pathing.paint",
      "terrain.cliff",
      "terrain.cliff.repair",
      "terrain.compose",
    ].includes(name)
  ) {
    const target = area(args);
    if (target) args.area = target;
  }
  if (["terrain.prefab", "terrain.assemble"].includes(name)) {
    const at = take(args, "at");
    if (at !== undefined) {
      const [x, y] = point(at, 2, "AT");
      args.anchor = { x, y };
    }
  }
  if (name === "terrain.ramp.place" || name === "terrain.ramp.fit") {
    if (typeof args.bounds === "string" || Array.isArray(args.bounds)) {
      const [minX, minY, maxX, maxY] = point(args.bounds, 4, "BOUNDS");
      args.bounds = { minX, minY, maxX, maxY };
    }
    const offset = take(args, "offset");
    if (offset !== undefined) {
      if (args.offsetX !== undefined || args.offsetY !== undefined)
        throw Error("AUTHOR_OFFSET_CONFLICT");
      const [x, y] = point(offset, 2, "OFFSET");
      args.offsetX = x;
      args.offsetY = y;
    }
  }
  if (name === "terrain.ramp") {
    const at = take(args, "at");
    if (at !== undefined) {
      const [x, y] = point(at, 2, "AT");
      args.center = { x, y };
    }
  }
  if (name === "terrain.raise" || name === "terrain.lower" || name === "terrain.flatten") {
    const target = area(args);
    if (!target) throw new Error("AUTHOR_TERRAIN_AREA_REQUIRED");
    const directory = take(args, "directory") ?? "";
    return {
      tool: "terrain.plan",
      args: {
        directory,
        operations: [
          {
            op:
              name === "terrain.flatten"
                ? "height.flatten"
                : name === "terrain.raise"
                  ? "height.raise"
                  : "height.lower",
            area: target,
            ...args,
          },
        ],
      },
    };
  }
  if (name === "objects.unit" || name === "objects.doodad") {
    const player = take(args, "player");
    if (player !== undefined) {
      if (name !== "objects.unit" || args.owner !== undefined)
        throw Error("AUTHOR_OBJECT_PLAYER_ALIAS");
      args.owner = player;
    }
    const at = take(args, "at");
    if (at !== undefined) {
      const coords = String(at).split(",");
      if (coords.length !== 2 && coords.length !== 3) throw new Error("AUTHOR_AT_COORDINATES");
      const xy = point(at, coords.length, "AT");
      args.position = { x: xy[0], y: xy[1], z: xy[2] ?? 0 };
      if (args.snapToTerrain === undefined) args.snapToTerrain = true;
    }
  }
  if (name === "data.set") {
    const object = take(args, "id"),
      path = take(args, "path"),
      value = take(args, "value"),
      file = take(args, "file") ?? "Base.SC2Data/GameData/UnitData.xml";
    if (
      typeof object !== "string" ||
      typeof path !== "string" ||
      value === undefined ||
      typeof file !== "string" ||
      Object.keys(args).length
    )
      throw new Error("AUTHOR_DATA_SET_ARGS");
    return {
      tool: "data.apply",
      args: { file, operations: [{ op: "field.set", object, path, value }] },
      saveFile: file,
    };
  }
  if (name === "data.hero.veterancy" && args.xp !== undefined) {
    const xp = String(take(args, "xp")).split(",");
    if (
      args.levels !== undefined ||
      xp.length > 100 ||
      xp.some((n) => !n.trim() || !Number.isFinite(Number(n)))
    )
      throw Error("AUTHOR_VETERANCY_THRESHOLDS");
    const life = take(args, "lifeDelta") ?? 0,
      damage = take(args, "damageDelta") ?? 0;
    args.levels = xp.map((value, index) => ({
      xp: Number(value),
      lifeDelta: index ? life : 0,
      damageDelta: index ? damage : 0,
    }));
  }
  if (name === "data.hero.learn" && args.ability !== undefined) {
    if (args.entries !== undefined) throw Error("AUTHOR_LEARN_ENTRIES_CONFLICT");
    const entry: Record<string, unknown> = { command: take(args, "command") ?? 1 };
    for (const key of ["ability", "button", "minLevel", "levelSkip", "card"]) {
      const value = take(args, key);
      if (value !== undefined) entry[key] = value;
    }
    args.entries = [entry];
  }
  if (
    name === "data.unit" ||
    name === "data.unit.copy" ||
    name === "data.unit.configure" ||
    name === "data.spell.configure" ||
    name === "data.spell" ||
    name === "data.ability.instant" ||
    name === "data.ability.target" ||
    name === "data.ability.charges" ||
    name === "data.effect.projectile" ||
    name === "data.hero.veterancy" ||
    name === "data.xp.search" ||
    name === "data.hero.learn" ||
    name === "data.actor.ability_animation"
  ) {
    const file =
      take(args, "file") ??
      (name === "data.actor.ability_animation"
        ? "Base.SC2Data/GameData/ActorData.xml"
        : name === "data.effect.projectile"
          ? "Base.SC2Data/GameData/EffectData.xml"
          : name === "data.xp.search"
            ? "Base.SC2Data/GameData/GameData.xml"
            : "Base.SC2Data/GameData/UnitData.xml");
    return { tool: aliases[name] ?? name, args: { file, ...args }, saveFile: String(file) };
  }
  if (name === "assets.inspect_many") {
    const files = take(args, "files");
    args.files = typeof files === "string" ? files.split(",").map((file) => file.trim()) : files;
    return { tool: name, args };
  }
  if (name === "cutscene.show" || name === "cutscene.preview") {
    const times = take(args, "times");
    if (typeof times === "string") {
      const parts = times.split(",").map((value) => value.trim());
      if (parts.some((value) => !/^\d+$/.test(value))) throw Error("AUTHOR_CUTSCENE_TIMES");
      args.times = parts.map(Number);
    } else if (times !== undefined) args.times = times;
    return { tool: aliases[name] ?? name, args };
  }
  if (name === "document.empty") {
    const kind = take(args, "kind") ?? "map",
      width = take(args, "width"),
      height = take(args, "height");
    if (kind === "map") {
      if (width === undefined || height === undefined)
        throw new Error("AUTHOR_DOCUMENT_SIZE_REQUIRED");
      return { tool: "document.plan", args: { ...args, kind, map: { width, height } } };
    }
    if (kind === "mod") return { tool: "document.plan", args: { ...args, kind } };
    throw new Error("AUTHOR_DOCUMENT_KIND");
  }
  if (name === "settings.player.set") {
    const playerId = take(args, "id"),
      directory = take(args, "directory") ?? "";
    return {
      tool: "settings.plan",
      args: { directory, operations: [{ op: "player.set", playerId, patch: args }] },
    };
  }
  if (name === "settings.player") {
    const playerId = take(args, "id"),
      control = take(args, "control") ?? "User",
      directory = take(args, "directory") ?? "";
    return {
      tool: "settings.plan",
      args: { directory, operations: [{ op: "player.create", playerId, control, ...args }] },
    };
  }
  if (name === "ai.definition" || name === "ai.wave") {
    const file = take(args, "file") ?? "CustomAI",
      id = take(args, "id");
    if (typeof file !== "string" || typeof id !== "string")
      throw new Error("AUTHOR_AI_ID_REQUIRED");
    const operation =
      name === "ai.definition"
        ? { op: "definition.create", id, properties: args }
        : { op: "wave.create", id, definition: take(args, "definition"), properties: args };
    return { tool: "ai.apply", args: { file, operations: [operation] }, saveFile: file };
  }
  if (name === "text.set") {
    const key = take(args, "key"),
      value = take(args, "value"),
      locale = take(args, "locale") ?? "enUS";
    if (
      typeof key !== "string" ||
      value === undefined ||
      typeof locale !== "string" ||
      Object.keys(args).length
    )
      throw new Error("AUTHOR_TEXT_SET_ARGS");
    const file = `${locale}.SC2Data/LocalizedData/GameStrings.txt`;
    return {
      tool: "text.apply",
      args: {
        stringFiles: { [locale]: file },
        operations: [{ op: "text.set", key, value: String(value), locale }],
      },
      saveFile: file,
    };
  }
  if (name === "data.find" && args.text === undefined && args.id !== undefined) {
    args.ids = [take(args, "id")];
  }
  if (name === "gui.plan") return { tool: "trigger.plan_file", args };
  if (name === "gui.script") {
    const identifier = take(args, "identifier"),
      folder = take(args, "folder"),
      triggerId = take(args, "triggerId"),
      kind = take(args, "kind") ?? (triggerId ? "action" : "declaration");
    if (typeof identifier !== "string" || typeof folder !== "string" || block === undefined)
      throw new Error("AUTHOR_GUI_SCRIPT_REQUIRED");
    return {
      tool: "trigger.custom_script",
      args: {
        ...args,
        items: [{ identifier, folder, kind, ...(triggerId ? { triggerId } : {}), code: block }],
      },
    };
  }
  if (name === "gui.folder") {
    const folder = take(args, "path");
    if (typeof folder !== "string") throw new Error("AUTHOR_GUI_FOLDER_REQUIRED");
    return { tool: "trigger.organize", args: { ...args, folders: [folder] } };
  }
  if (name === "gui.move") {
    const type = take(args, "type"),
      id = take(args, "id"),
      folder = take(args, "folder");
    if (typeof type !== "string" || typeof id !== "string" || typeof folder !== "string")
      throw new Error("AUTHOR_GUI_MOVE_REQUIRED");
    return { tool: "trigger.organize", args: { ...args, assignments: [{ type, id, folder }] } };
  }
  if (name === "logic.gui") throw new Error("AUTHOR_GUI_EXPLICIT: use gui.plan file=...");
  const tool = aliases[name] ?? name;
  if (!directCommands.has(name) && !directCommands.has(tool))
    throw new Error("AUTHOR_COMMAND_UNSUPPORTED: " + name);
  return { tool, args };
}
function lifecycle(
  command: { tool: string; args: Args; saveFile?: string },
  mode: AuthorMode,
  base: string,
): BatchStep[] {
  const first: BatchStep = { id: base, tool: command.tool, args: command.args };
  if (command.tool === "project.quality.plan") {
    first.select = [
      "integrity",
      "roadmapReady",
      "index",
      "bindingsFile",
      "pendingDrafts",
      "coverage",
      "bindingsTotal",
      "offset",
      "nextOffset",
      "bindings",
      "scope",
    ];
    return [first];
  }
  if (command.tool === "terrain.landscape.inspect") {
    first.select = [
      "version",
      "totalZones",
      "total",
      "offset",
      "returned",
      "truncated",
      "zones",
      "routeSource",
      "padSource",
      "field",
      "staged",
    ];
    return [first];
  }
  if (command.tool === "data.card.check") return [first];
  if (mode === "plan") {
    if (command.tool === "project.test.run" || command.tool === "project.test.cancel")
      throw new Error("AUTHOR_LIVE_REQUIRES_STAGE: test run/cancel is explicit; use stage mode");
    if (command.args.dryRun === false) throw new Error("AUTHOR_PLAN_REQUIRES_DRY_RUN");
    return [first];
  }
  const from = (field: string) => ({ $from: `${base}.${field}` });
  let apply: BatchStep | undefined, save: BatchStep | undefined;
  if (command.tool === "script.plan") {
    apply = {
      id: base + "_apply",
      tool: "script.apply",
      args: { planId: from("planId"), dryRun: false },
    };
    if (mode === "save") {
      if (!command.saveFile) throw new Error("AUTHOR_SAVE_FILE_REQUIRED");
      save = { id: base + "_save", tool: "script.save", args: { file: command.saveFile } };
    }
  } else if (
    command.tool === "project.organize" ||
    command.tool === "trigger.organize" ||
    command.tool === "trigger.custom_script" ||
    command.tool === "terrain.compose" ||
    command.tool === "terrain.assemble"
  ) {
    first.args = { ...first.args, dryRun: false, stage: true };
    if (mode === "save")
      save = {
        id: base + "_save",
        tool: "modkit.save",
        args: {
          file: ["terrain.compose", "terrain.assemble"].includes(command.tool)
            ? { $from: base + ".saveFile" }
            : ["trigger.organize", "trigger.custom_script"].includes(command.tool) ||
                command.args.target === "gui"
              ? "Triggers"
              : ".sc2mcp/organization.json",
        },
      };
  } else if (
    command.tool === "trigger.plan_file" ||
    command.tool === "trigger.plan" ||
    command.tool === "trigger.recipe_skirmish"
  ) {
    apply = {
      id: base + "_apply",
      tool: "trigger.apply",
      args: { planId: from("planId"), dryRun: false, stage: true },
    };
    if (mode === "save") save = { id: base + "_save", tool: "trigger.save", args: {} };
  } else if (
    command.tool === "terrain.plan" ||
    command.tool === "terrain.plan_file" ||
    command.tool === "terrain.landscape.plan" ||
    command.tool === "terrain.landscape.plan_file" ||
    command.tool === "terrain.landscape.zone.plan" ||
    command.tool === "terrain.paint" ||
    command.tool === "terrain.blend" ||
    command.tool === "terrain.cliff.paint" ||
    command.tool === "terrain.cliff.repair" ||
    command.tool === "terrain.load.repair" ||
    command.tool === "terrain.ramp.create" ||
    command.tool === "terrain.ramp.remove" ||
    command.tool === "terrain.ramp.repair" ||
    command.tool === "terrain.generate"
  ) {
    apply = {
      id: base + "_apply",
      tool: "terrain.apply",
      args: { planId: from("id"), dryRun: false, stage: true },
    };
    if (mode === "save")
      save = {
        id: base + "_save",
        tool: "terrain.save",
        args: { planId: from("id"), dryRun: false },
      };
  } else if (command.tool === "terrain.ramp.place") {
    apply = {
      id: base + "_apply",
      tool: "terrain.modkit.apply",
      args: { planId: from("planId"), dryRun: false },
    };
    if (mode === "save")
      save = { id: base + "_save", tool: "modkit.save", args: { file: from("files.0.file") } };
  } else if (
    command.tool === "placement.addUnit" ||
    command.tool === "placement.addDoodad" ||
    command.tool === "placement.addBatch" ||
    command.tool === "placement.scatterDoodads" ||
    command.tool === "placement.setVariations"
  ) {
    apply = {
      id: base + "_apply",
      tool: "placement.apply",
      args: {
        planId:
          command.tool === "placement.scatterDoodads" ? { $from: base + ".plan.id" } : from("id"),
        dryRun: false,
        stage: true,
      },
    };
    if (mode === "save")
      save = {
        id: base + "_save",
        tool: "modkit.save",
        args: { file: command.args.objectFile ?? "Objects" },
      };
  } else if (
    command.tool === "data.apply" ||
    command.tool === "data.unit.copy" ||
    command.tool === "data.unit.configure" ||
    command.tool === "data.spell.configure" ||
    command.tool === "data.spell" ||
    command.tool === "data.ability.instant" ||
    command.tool === "data.ability.target" ||
    command.tool === "data.ability.charges" ||
    command.tool === "data.effect.projectile" ||
    command.tool === "data.hero.veterancy" ||
    command.tool === "data.xp.search" ||
    command.tool === "data.hero.learn" ||
    command.tool === "data.actor.ability_animation" ||
    command.tool === "text.apply"
  ) {
    first.args = { ...first.args, dryRun: false, stage: true };
    if (mode === "save") {
      if (!command.saveFile) throw new Error("AUTHOR_SAVE_FILE_REQUIRED");
      save = { id: base + "_save", tool: "modkit.save", args: { file: command.saveFile } };
    }
  } else if (
    command.tool === "ai.apply" ||
    command.tool === "cutscene.compose" ||
    command.tool === "cutscene.create"
  ) {
    first.args = { ...first.args, dryRun: false, stage: true };
    if (mode === "save")
      save = {
        id: base + "_save",
        tool: command.tool === "ai.apply" ? "modkit.save" : "cutscene.save",
        args: { file: command.saveFile ?? command.args.file },
      };
  } else if (command.tool === "ui.recipe_timer") {
    first.args = { ...first.args, dryRun: false, stage: true };
    if (mode === "save")
      save = {
        id: base + "_save",
        tool: "ui.assets.save",
        args: { transactionId: from("transaction.transactionId"), dryRun: false },
      };
  } else if (command.tool === "settings.plan" || command.tool === "settings.plan_file") {
    apply = {
      id: base + "_apply",
      tool: "settings.apply",
      args: { planId: from("id"), dryRun: false, stage: true },
    };
    if (mode === "save")
      save = {
        id: base + "_save",
        tool: "settings.save",
        args: { transactionId: { $from: base + "_apply.transactionId" }, dryRun: false },
      };
  } else if (command.tool === "document.plan" || command.tool === "document.plan_file") {
    if (mode === "stage") throw Error("AUTHOR_DOCUMENT_NO_STAGING: use plan or save");
    apply = {
      id: base + "_create",
      tool: "document.create",
      args: { planId: from("id"), dryRun: false, output: "components" },
    };
  } else if (command.tool === "map.create" || command.tool === "map.clone") {
    if (mode === "stage") throw new Error("AUTHOR_MAP_NO_STAGING: use plan or save");
    first.args = { ...first.args, dryRun: false };
  } else throw new Error("AUTHOR_LIFECYCLE_UNSUPPORTED: " + command.tool);
  return [first, ...(apply ? [apply] : []), ...(save ? [save] : [])];
}
export interface AuthorCompilationReceipt {
  commands: number;
  expandedCalls: number;
  groupedCalls: number;
  avoidedCalls: number;
  declaredFiles: string[];
  declaredDirectories: string[];
  validationTools: string[];
}

export function compileAuthorScript(
  source: string,
  mode: AuthorMode,
  tools?: ReadonlyMap<string, BatchTool>,
  receipt?: (value: AuthorCompilationReceipt) => void,
): BatchStep[] {
  if (Buffer.byteLength(source) > 65536) throw new Error("AUTHOR_SOURCE_LIMIT");
  const lines = source.replaceAll("\r\n", "\n").split("\n"),
    steps: BatchStep[] = [];
  let commands = 0;
  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line].trim();
    if (!raw || raw.startsWith("#")) continue;
    const match = raw.match(/^(.*?)(?:\s+<<([A-Za-z_]\w*))?$/)!;
    const tokens = words(match[1]);
    if (!tokens.length) continue;
    let name = tokens.shift()!;
    if (!name.includes(".")) {
      if (!tokens.length) throw new Error(`AUTHOR_VERB_REQUIRED: ${line + 1}`);
      name += "." + tokens.shift();
    }
    if (!/^[A-Za-z][\w.-]*$/.test(name)) throw new Error("AUTHOR_COMMAND: " + name);
    let block: string | undefined;
    if (match[2]) {
      const start = line + 1;
      while (++line < lines.length && lines[line].trim() !== match[2]) {
        /* literal Galaxy source */
      }
      if (line === lines.length) throw new Error(`AUTHOR_BLOCK_UNTERMINATED: ${start}`);
      block = lines.slice(start, line).join("\n");
    }
    if (
      block !== undefined &&
      !name.startsWith("galaxy.") &&
      !name.startsWith("logic.") &&
      name !== "gui.script"
    )
      throw new Error("AUTHOR_BLOCK_ONLY_GALAXY");
    const command = shorthand(name, argumentsOf(tokens), block);
    commands++;
    if (tools && !tools.has(command.tool))
      throw new Error("AUTHOR_TOOL_UNAVAILABLE: " + command.tool);
    const next = lifecycle(command, mode, "s" + (steps.length + 1));
    for (const step of next)
      if (tools && !tools.has(step.tool)) throw new Error("AUTHOR_TOOL_UNAVAILABLE: " + step.tool);
    steps.push(...next);
  }
  if (!steps.length) throw new Error("AUTHOR_EMPTY");
  const grouped = coalesceAuthoringSteps(
    coalesceDataAuthoringSteps(steps, mode, tools),
    mode,
    tools,
  );
  if (grouped.length > 20) throw new Error("AUTHOR_STEP_LIMIT");
  const strings = (keys: string[]) =>
    [
      ...new Set(
        grouped.flatMap((step) =>
          keys
            .map((key) => step.args[key])
            .filter((value): value is string => typeof value === "string"),
        ),
      ),
    ].sort();
  receipt?.({
    commands,
    expandedCalls: steps.length,
    groupedCalls: grouped.length,
    avoidedCalls: steps.length - grouped.length,
    declaredFiles: strings(["file", "objectFile", "componentListFile"]),
    declaredDirectories: strings(["directory", "terrainDirectory"]),
    validationTools: [
      ...new Set(
        grouped
          .filter((step) => /\.(?:apply|plan|check|validate)$/.test(step.tool))
          .map((step) => step.tool),
      ),
    ],
  });
  return grouped;
}
