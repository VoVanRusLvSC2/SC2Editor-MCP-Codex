import {DataDocument} from './document.js';
import {reviewCardBinding,DataCardBindingError} from './cardBindings.js';
import type {DataObject,DataNativeFieldSpec} from './types.js';

export interface LearnEntry {
  command: number;
  ability: string;
  button: string;
  minLevel?: number;
  levelSkip?: number;
  card: { page: number; slot: number; row: number; column: number; conflictReason?: string };
}
export interface LearnRecipe {id:string;unit:string;veterancy:string;points?:number;pointsPerLevel?:number;entries:LearnEntry[];replace?:boolean}
const removed=(attrs:Record<string,string>)=>['1','true'].includes(attrs.removed??'');

/** Native learn commands share one Data-owned point pool and an explicit
 * veterancy. Execution ability ranks/effects/costs remain independently authored. */
export function learnRecipe(
  document: DataDocument,
  available: readonly DataObject[],
  args: LearnRecipe,
) {
  const fail = (code: string) => Error("LEARN_RECIPE_" + code),
    integer = (v: unknown, min: number, max: number) =>
      typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
  const one = (domain: string, id: string) => {
    const values = available.filter((o) => o.domain === domain && o.id === id);
    if (values.length !== 1) throw fail("REFERENCE_AMBIGUOUS_OR_MISSING: " + domain + ":" + id);
    return values[0];
  };
  if (
    !integer(args.points ?? 0, 0, 10000) ||
    !integer(args.pointsPerLevel ?? 1, 0, 10000) ||
    !args.entries.length ||
    args.entries.length > 20
  )
    throw fail("POINTS_OR_ENTRIES");
  const unit = one("Unit", args.unit),
    veterancy = one("Behavior", args.veterancy),
    existing = document.objects().find((o) => o.domain === "Abil" && o.id === args.id);
  if (!document.objects().some((o) => o.domain === "Unit" && o.id === args.unit))
    throw fail("LOCAL_UNIT_REQUIRED");
  if (veterancy.ctype !== "CBehaviorVeterancy" || veterancy.parent)
    throw fail("EXPLICIT_VETERANCY_REQUIRED");
  const vetLevels = veterancy.fields.filter(
    (f) => f.name === "VeterancyLevelArray" && !removed(f.attrs),
  );
  const indices = vetLevels
    .map((f) => (/^\d+$/.test(f.index ?? "") ? Number(f.index) : NaN))
    .sort((a, b) => a - b);
  if (!vetLevels.length || indices.some((index, i) => !Number.isSafeInteger(index) || index !== i))
    throw fail("VETERANCY_LEVEL_TABLE");
  const active = available.filter((o) => o.domain === "Abil" && o.id === args.id);
  if (active.length > 1 || (active.length === 1 && !existing))
    throw fail("LOCAL_LEARN_ID_REQUIRED");
  if (existing && (!args.replace || existing.ctype !== "CAbilLearn"))
    throw fail(existing.ctype === "CAbilLearn" ? "REPLACE_REQUIRED" : "TARGET_CLASS");
  const seen = new Set<string>();
  let current: DataObject | undefined = unit,
    hasVeterancy = false;
  while (current) {
    if (!current.id || seen.has(current.id) || seen.size >= 64)
      throw fail("UNIT_PARENT_CYCLE_OR_DEPTH");
    seen.add(current.id);
    for (const f of current.fields.filter((f) => !removed(f.attrs))) {
      if (f.name === "BehaviorArray" && f.link) {
        const b = one("Behavior", f.link);
        if (b.ctype === "CBehaviorVeterancy") {
          if (f.link !== args.veterancy) throw fail("CONFLICTING_VETERANCY");
          hasVeterancy = true;
        }
      }
      if (
        f.name === "AbilArray" &&
        f.link &&
        f.link !== args.id &&
        available.some((o) => o.domain === "Abil" && o.id === f.link && o.ctype === "CAbilLearn")
      )
        throw fail("CONFLICTING_LEARN_POOL");
    }
    current = current.parent ? one("Unit", current.parent) : undefined;
  }
  if (!hasVeterancy) throw fail("VETERANCY_NOT_BOUND");
  const commands = new Set<number>(),
    abilities = new Set<string>(),
    cards = new Set<string>();
  for (const entry of args.entries) {
    const min = entry.minLevel ?? 1,
      skip = entry.levelSkip ?? 1,
      card = entry.card;
    if (
      !integer(entry.command, 1, 20) ||
      commands.has(entry.command) ||
      abilities.has(entry.ability) ||
      entry.ability === args.id
    )
      throw fail("DUPLICATE_OR_INVALID_ENTRY");
    commands.add(entry.command);
    abilities.add(entry.ability);
    if (
      !integer(min, 1, 100) ||
      !integer(skip, 0, 100) ||
      !integer(card.page, 0, 7) ||
      !integer(card.slot, 0, 199) ||
      !integer(card.row, 0, 2) ||
      !integer(card.column, 0, 4) ||
      cards.has(card.page + ":" + card.slot)
    )
      throw fail("LEVEL_OR_CARD_BOUNDS");
    cards.add(card.page + ":" + card.slot);
    const ability = one("Abil", entry.ability);
    one("Button", entry.button);
    if (
      !["CAbilEffectInstant", "CAbilEffectTarget"].includes(ability.ctype) ||
      !document.objects().some((o) => o.domain === "Abil" && o.id === entry.ability)
    )
      throw fail("LOCAL_EXECUTION_ABILITY_REQUIRED");
    const levels = ability.fields.filter((f) => f.name === "Levels");
    if (
      levels.length !== 1 ||
      !/^\d+$/.test(levels[0].value ?? "") ||
      !integer(Number(levels[0].value), 1, 100)
    )
      throw fail("EXPLICIT_ABILITY_LEVELS_REQUIRED");
    if (min + skip * (Number(levels[0].value) - 1) > vetLevels.length)
      throw fail("UNREACHABLE_RANK");
  }
  const fields: DataNativeFieldSpec[] = [
    { name: "AbilSetId", value: args.id },
    { name: "Points", value: args.points ?? 0 },
    { name: "PointsPerLevel", value: args.pointsPerLevel ?? 1 },
    { name: "VeterancyBehavior", value: args.veterancy },
    ...args.entries.map((e): DataNativeFieldSpec => ({
      name: "InfoArray",
      index: "Learn" + e.command,
      children: [
        { name: "Abil", value: e.ability },
        { name: "VeterancyLevelMin", value: e.minLevel ?? 1 },
        { name: "VeterancyLevelSkip", value: e.levelSkip ?? 1 },
        { name: "Button", attrs: { DefaultButtonFace: e.button, Requirements: "" } },
      ],
    })),
  ];
  const selector = { domain: "Abil", id: args.id },
    target = { domain: "Unit", id: args.unit };
  const write = (d: DataDocument, checkCards = false) => {
    if (existing) {
      d.setParent(selector, undefined);
      while (d.objects().find((o) => o.domain === "Abil" && o.id === args.id)!.fields.length)
        d.removeField(
          selector,
          d
            .objects()
            .find((o) => o.domain === "Abil" && o.id === args.id)!
            .fields.at(-1)!.path,
        );
    } else d.createObject("CAbilLearn", args.id);
    d.addNativeMany(selector, undefined, fields);
    if (!unit.fields.some((f) => f.name === "AbilArray" && f.link === args.id && !removed(f.attrs)))
      d.addNative(target, undefined, { name: "AbilArray", link: args.id });
    for (const layout of unit.fields.filter((f) => f.name === "CardLayouts"))
      for (const old of layout.children.filter(
        (f) => f.name === "LayoutButtons" && f.attrs.AbilCmd?.startsWith(args.id + ",Learn"),
      )) {
        if (layout.index === undefined || old.index === undefined)
          throw fail("UNINDEXED_OWNED_CARD");
        d.setField(
          target,
          `CardLayouts[${layout.index}].LayoutButtons[${old.index}]`,
          "removed",
          1,
        );
      }
    for (const e of args.entries) {
      const p = `CardLayouts[${e.card.page}].LayoutButtons[${e.card.slot}]`;
      if (checkCards) {
        const objects = [
          ...available.filter((o) => o.domain !== "Unit" || o.id !== args.unit),
          ...d.objects().filter((o) => o.domain === "Unit" && o.id === args.unit),
        ];
        const review = reviewCardBinding(objects, args.unit, {
          ability: args.id,
          command: "Learn" + e.command,
          button: e.button,
          ...e.card,
        });
        if (!review.accepted) throw new DataCardBindingError(review);
      }
      const button = d
        .objects()
        .find((o) => o.domain === "Unit" && o.id === args.unit)!
        .fields.find((f) => f.name === "CardLayouts" && f.index === String(e.card.page))
        ?.children.find((f) => f.name === "LayoutButtons" && f.index === String(e.card.slot));
      if (button && removed(button.attrs)) d.removeFieldAttribute(target, p, "removed");
      for (const [key, value] of Object.entries({
        Face: e.button,
        Type: "AbilCmd",
        AbilCmd: args.id + ",Learn" + e.command,
        Row: e.card.row,
        Column: e.card.column,
      }))
        d.setField(target, p, key, value);
    }
  };
  // Simulate the complete owned replacement and sequential card additions before
  // touching the caller, including conflicts with existing unrelated commands.
  const probe = new DataDocument(document.source, document.sourceFile);
  write(probe, true);
  write(document);
  return document.objectKey(document.resolve(selector));
}
