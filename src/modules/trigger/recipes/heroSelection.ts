import * as z from "zod/v4";
import type { GuiCall, GuiRequest, GuiValue } from "../authoring.js";

const id = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .max(96);
export const heroSelectionSchema = z
  .object({
    prefix: id.max(24).default("Heroes"),
    heroes: z
      .array(id)
      .min(2)
      .max(20)
      .refine((v) => new Set(v).size === v.length, "Duplicate hero"),
    players: z
      .array(z.number().int().min(1).max(15))
      .min(1)
      .max(15)
      .default([1])
      .refine((v) => new Set(v).size === v.length, "Duplicate player"),
    spawn: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
    title: z.string().min(1).max(100).default("Choose your hero"),
    confirmText: z.string().min(1).max(100).default("Confirm hero"),
    previewCamera: z.string().min(1).max(128).default("Star2CameraMid03"),
  })
  .strict();

const integer = (value: number): GuiValue => ({ kind: "literal", type: "int", value });
const fixed = (value: number): GuiValue => ({ kind: "literal", type: "fixed", value });
const bool = (value: boolean): GuiValue => ({ kind: "literal", type: "bool", value });
const preset = (name: string): GuiValue => ({ kind: "preset", name });
const text = (value: string): GuiValue => ({ kind: "text", value });
const string = (value: string): GuiValue => ({ kind: "literal", type: "string", value });
const call = (functionName: string, args: Record<string, GuiValue> = {}): GuiValue => ({
  kind: "call",
  function: functionName,
  args,
});
const action = (functionName: string, args: Record<string, GuiValue> = {}): GuiCall => ({
  kind: "Action",
  function: functionName,
  args,
});
const compare = (val1: GuiValue, op: string, val2: GuiValue): GuiCall => ({
  kind: "Condition",
  function: "Comparison",
  args: { val1, op: preset(op), val2 },
});
const branch = (condition: GuiCall, then: GuiCall[], otherwise: GuiCall[] = []): GuiCall => ({
  kind: "Action",
  function: "IfThenElse",
  args: {},
  children: [
    { role: "if", call: condition },
    ...then.map((call) => ({ role: "then", call })),
    ...otherwise.map((call) => ({ role: "else", call })),
  ],
});

/** Native editable GUI and UnitModel preview; mechanics remain on the chosen Data Unit. */
export function heroSelectionRecipe(input: z.input<typeof heroSelectionSchema>): GuiRequest[] {
  const a = heroSelectionSchema.parse(input),
    prefix = a.prefix,
    variable = (name: string, ...indices: GuiValue[]): GuiValue => ({
      kind: "variable",
      name: prefix + name,
      ...(indices.length ? { indices } : {}),
    }),
    parameter = (name: string): GuiValue => ({ kind: "parameter", name }),
    set = (target: GuiValue, value: GuiValue) => action("SetVariable", { var: target, val: value }),
    player = call("EventPlayer"),
    all = call("PlayerGroupAll"),
    one = (p: GuiValue) => call("PlayerGroupSingle", { p }),
    p = parameter("player"),
    index = parameter("choice"),
    own = (name: string, args: Record<string, GuiValue> = {}) =>
      action("custom:" + prefix + name, args),
    size = (control: GuiValue, width: number, height: number) =>
      action("DialogControlSetSize", {
        dialogItem: control,
        players: all,
        width: integer(width),
        height: integer(height),
      }),
    position = (control: GuiValue, anchor: string, x: number, y: number) =>
      action("DialogControlSetPosition", {
        control,
        players: all,
        anchor: preset(anchor),
        offsetX: integer(x),
        offsetY: integer(y),
      }),
    caption = (control: GuiValue, value: GuiValue, players = all) =>
      action("DialogControlSetPropertyAsText", {
        dialogItem: control,
        property: preset("Text"),
        players,
        value,
      }),
    create = (name: string, type: string) => [
      action("DialogControlCreate", { dialog: variable("Dialog"), type: preset(type) }),
      set(variable(name), call("DialogControlLastCreated")),
    ];
  const buttons = a.heroes.map((_, i) => variable("Buttons", integer(i)));
  const roster = (start: number): GuiCall[] =>
    a.heroes.slice(start, start + 10).flatMap((hero, offset) => {
      const i = start + offset,
        button = buttons[i],
        unit: GuiValue = { kind: "gamelink", domain: "Unit", id: hero };
      return [
        set(variable("Types", integer(i)), unit),
        set(variable("Links", integer(i)), string(hero)),
        action("DialogControlCreate", { dialog: variable("Dialog"), type: preset("Button") }),
        set(button, call("DialogControlLastCreated")),
        size(button, a.heroes.length <= 10 ? 300 : 240, 42),
        position(button, "TopLeft", 24 + Math.floor(i / 10) * 250, 70 + (i % 10) * 48),
        caption(button, call("UnitTypeGetName", { unitType: unit })),
      ];
    });
  const build: GuiCall[] = [
    action("DialogCreate", {
      width: integer(1000),
      height: integer(650),
      anchor: preset("Center"),
      offsetX: integer(0),
      offsetY: integer(0),
      modal: preset("Modal"),
    }),
    set(variable("Dialog"), call("DialogLastCreated")),
    ...create("Title", "Label"),
    size(variable("Title"), 430, 36),
    position(variable("Title"), "TopLeft", 24, 20),
    caption(variable("Title"), text(a.title)),
    ...create("Preview", "UnitModel"),
    size(variable("Preview"), 360, 440),
    position(variable("Preview"), "TopRight", 35, 70),
    ...create("Caption", "Label"),
    size(variable("Caption"), 360, 40),
    position(variable("Caption"), "TopRight", 35, 30),
    ...create("Confirm", "Button"),
    size(variable("Confirm"), 300, 48),
    position(variable("Confirm"), "BottomRight", 65, 30),
    caption(variable("Confirm"), text(a.confirmText)),
    own("RosterA"),
    ...(a.heroes.length > 10 ? [own("RosterB")] : []),
  ];
  const functions: NonNullable<GuiRequest["functions"]> = [
    { name: prefix + "RosterA", kind: "Action", calls: roster(0) },
    ...(a.heroes.length > 10
      ? [{ name: prefix + "RosterB", kind: "Action" as const, calls: roster(10) }]
      : []),
    { name: prefix + "Build", kind: "Action", calls: build },
    {
      name: prefix + "PreviewHero",
      kind: "Action",
      parameters: [
        { name: "player", type: "int" },
        { name: "choice", type: "int" },
      ],
      calls: [
        set(variable("Index", p), index),
        action("DialogControlSetPropertyAsString", {
          dialogItem: variable("Preview"),
          property: preset("UnitLink"),
          players: one(p),
          value: variable("Links", index),
        }),
        action("DialogControlSetPropertyAsString", {
          dialogItem: variable("Preview"),
          property: preset("Camera"),
          players: one(p),
          value: string(a.previewCamera),
        }),
        caption(
          variable("Caption"),
          call("UnitTypeGetName", { unitType: variable("Types", index) }),
          one(p),
        ),
      ],
    },
  ];
  const globals: NonNullable<GuiRequest["variables"]> = [
    { name: prefix + "Started", type: "bool", initial: bool(false) },
    { name: prefix + "Remaining", type: "int", initial: integer(a.players.length) },
    ...["Dialog"].map((name) => ({ name: prefix + name, type: "dialog" as const })),
    ...["Title", "Preview", "Caption", "Confirm"].map((name) => ({
      name: prefix + name,
      type: "control" as const,
    })),
    { name: prefix + "Buttons", type: "control", arraySizes: [a.heroes.length - 1] },
    {
      name: prefix + "Types",
      type: "gamelink",
      gameType: "Unit",
      arraySizes: [a.heroes.length - 1],
    },
    { name: prefix + "Links", type: "string", arraySizes: [a.heroes.length - 1] },
    { name: prefix + "Allowed", type: "bool", arraySizes: [15] },
    { name: prefix + "Locked", type: "bool", arraySizes: [15] },
    { name: prefix + "Index", type: "int", arraySizes: [15] },
    { name: prefix + "Hero", type: "unit", arraySizes: [15] },
  ];
  const requests: GuiRequest[] = [
    {
      create: { identifier: prefix + "Init", folder: "GAMEPLAY/HERO_SELECTION", genre: "arena" },
      variables: globals,
      functions,
      calls: [
        { kind: "Event", function: "TriggerAddEventMapInit", args: {} },
        compare(variable("Started"), "eq", bool(false)),
        set(variable("Started"), bool(true)),
        own("Build"),
        ...a.players.flatMap((p) => [
          set(variable("Allowed", integer(p)), bool(true)),
          own("PreviewHero", { player: integer(p), choice: integer(0) }),
          action("DialogSetVisible", {
            dialog: variable("Dialog"),
            players: one(integer(p)),
            visible: preset("show"),
          }),
        ]),
      ],
    },
  ];
  const active: GuiCall[] = [
    compare(player, "gte", integer(1)),
    compare(player, "lte", integer(15)),
    compare(variable("Allowed", player), "eq", bool(true)),
    compare(variable("Locked", player), "eq", bool(false)),
  ];
  const event: GuiCall = {
    kind: "Event",
    function: "TriggerAddEventDialogControl",
    args: { player: integer(16), item: preset("any"), eventType: preset("Clicked") },
  };
  requests.push({
    create: { identifier: prefix + "Browse", folder: "GAMEPLAY/HERO_SELECTION", genre: "arena" },
    calls: [
      event,
      ...active,
      ...buttons.map((button, i) =>
        branch(compare(call("EventDialogControl"), "eq", button), [
          own("PreviewHero", { player, choice: integer(i) }),
        ]),
      ),
    ],
  });
  const selected = variable("Hero", player),
    nullUnit: GuiValue = { kind: "literal", type: "unit", value: null },
    spawn = call("Point", { x: fixed(a.spawn.x), y: fixed(a.spawn.y) });
  requests.push({
    create: {
      identifier: prefix + "ConfirmChoice",
      folder: "GAMEPLAY/HERO_SELECTION",
      genre: "arena",
    },
    calls: [
      event,
      ...active,
      compare(call("EventDialogControl"), "eq", variable("Confirm")),
      set(variable("Locked", player), bool(true)),
      action("UnitCreate", {
        count: integer(1),
        type: variable("Types", variable("Index", player)),
        flags: preset("Birth"),
        player,
        pos: spawn,
        angle: fixed(270),
      }),
      set(selected, call("UnitLastCreated")),
      branch(
        compare(selected, "ne", nullUnit),
        [
          action("UnitSelect", { unit: selected, player, select: preset("select") }),
          action("CameraPan", {
            player,
            p: spawn,
            duration: fixed(0.35),
            initialVelocity: fixed(0),
            decelerate: fixed(0),
            smart: preset("do_not"),
          }),
          action("DialogSetVisible", {
            dialog: variable("Dialog"),
            players: one(player),
            visible: preset("hide"),
          }),
          set(
            variable("Remaining"),
            call("ArithmeticInt", {
              val1: variable("Remaining"),
              op: preset("minus"),
              val2: integer(1),
            }),
          ),
          branch(compare(variable("Remaining"), "eq", integer(0)), [
            action("DialogDestroy", { dialog: variable("Dialog") }),
          ]),
        ],
        [set(variable("Locked", player), bool(false))],
      ),
    ],
  });
  return requests;
}
