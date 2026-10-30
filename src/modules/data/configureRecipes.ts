import * as z from "zod/v4";
import { DataDocument } from "./document.js";
import type { DataObject } from "./types.js";

const id = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .max(96);
const scalar = z.number().nonnegative().lt(524288);
export const unitConfigureSchema = z
  .object({
    id,
    life: scalar.positive().optional(),
    shields: scalar.optional(),
    energy: scalar.optional(),
    speed: z.number().nonnegative().max(100).optional(),
    scale: z.number().positive().max(20).optional(),
    heroic: z.boolean().optional(),
  })
  .strict()
  .refine(
    (a) => [a.life, a.shields, a.energy, a.speed, a.scale, a.heroic].some((v) => v !== undefined),
    "UNIT_CONFIGURE_CHANGE_REQUIRED",
  );
export const spellConfigureSchema = z
  .object({
    id,
    damage: scalar.optional(),
    energy: scalar.optional(),
    cooldown: scalar.optional(),
    range: scalar.optional(),
    duration: z.number().positive().max(3600).optional(),
    period: z.number().positive().max(60).optional(),
  })
  .strict()
  .refine(
    (a) =>
      [a.damage, a.energy, a.cooldown, a.range, a.duration, a.period].some((v) => v !== undefined),
    "SPELL_CONFIGURE_CHANGE_REQUIRED",
  );
export type UnitConfigureRecipe = z.infer<typeof unitConfigureSchema>;
export type SpellConfigureRecipe = z.infer<typeof spellConfigureSchema>;

function local(document: DataDocument, domain: string, id: string, classes: string[]): DataObject {
  const matches = document.objects().filter((o) => o.domain === domain && o.id === id);
  if (matches.length !== 1 || !classes.includes(matches[0].ctype) || matches[0].isDefault)
    throw Error(`CONFIGURE_UNIQUE_LOCAL_OBJECT_REQUIRED: ${domain}:${id}`);
  return matches[0];
}

/** Update named scalar fields only; do not recreate a unit, Actor or its animation graph. */
export function configureUnit(document: DataDocument, input: UnitConfigureRecipe): string {
  const a = unitConfigureSchema.parse(input);
  local(document, "Unit", a.id, ["CUnit"]);
  const actors = document
    .objects()
    .filter((o) => o.ctype === "CActorUnit" && o.attrs.unitName === a.id);
  if (a.scale !== undefined && actors.length !== 1)
    throw Error("UNIT_CONFIGURE_UNIQUE_LOCAL_ACTOR_REQUIRED");
  const selector = { domain: "Unit", id: a.id };
  for (const [name, value] of [
    ["Life", a.life],
    ["Shields", a.shields],
    ["Energy", a.energy],
  ] as const)
    if (value !== undefined)
      for (const suffix of ["Max", "Start"])
        document.setField(selector, name + suffix, "value", value);
  if (a.speed !== undefined) document.setField(selector, "Speed", "value", a.speed);
  if (a.heroic !== undefined)
    document.setField(selector, "Attributes[Heroic]", "value", Number(a.heroic));
  if (a.scale !== undefined)
    document.setField(
      { domain: "Actor", id: actors[0].id! },
      "Scale",
      "value",
      [a.scale, a.scale, a.scale].join(","),
    );
  return "CUnit:" + a.id;
}

/** Tune an existing compact spell's native graph. Shape, targeting, presentation,
 * command cards and unknown/manual fields remain untouched. No graph replacement. */
export function configureSpell(document: DataDocument, input: SpellConfigureRecipe): string {
  const a = spellConfigureSchema.parse(input);
  const ability = local(document, "Abil", a.id, ["CAbilEffectInstant", "CAbilEffectTarget"]);
  const field = (name: string, index?: string) => {
    if (index !== undefined && ability.fields.some((f) => f.name === name && f.index === undefined))
      throw Error("SPELL_CONFIGURE_UNINDEXED_GRAPH_UNVERIFIED: " + name);
    const matches = ability.fields.filter((f) => f.name === name && f.index === index);
    if (matches.length !== 1) throw Error("SPELL_CONFIGURE_EXPLICIT_GRAPH_REQUIRED: " + name);
    return matches[0];
  };
  if (
    field("AbilSetId").value !== a.id ||
    !["Damage", "Apply", "Pattern"].some((s) => field("Effect", "0").value === a.id + s)
  )
    throw Error("SPELL_CONFIGURE_RECIPE_GRAPH_REQUIRED");
  if (a.damage !== undefined) local(document, "Effect", a.id + "Damage", ["CEffectDamage"]);
  const cost = a.energy !== undefined || a.cooldown !== undefined ? field("Cost", "0") : undefined;
  if (
    a.energy !== undefined &&
    cost!.children.filter((f) => f.name === "Vital" && f.index === "Energy").length !== 1
  )
    throw Error("SPELL_CONFIGURE_EXPLICIT_ENERGY_REQUIRED");
  if (
    a.cooldown !== undefined &&
    cost!.children.filter(
      (f) => f.name === "Cooldown" && f.link === a.id && f.attrs.Location === "Unit",
    ).length !== 1
  )
    throw Error("SPELL_CONFIGURE_PRIVATE_COOLDOWN_REQUIRED");
  if (a.range !== undefined && ability.ctype !== "CAbilEffectTarget")
    throw Error("SPELL_CONFIGURE_TARGET_RANGE_ONLY");
  if (a.duration !== undefined || a.period !== undefined) {
    const burn = local(document, "Behavior", a.id + "Burn", ["CBehaviorBuff"]);
    const value = (name: string) => {
      const fields = burn.fields.filter((f) => f.name === name);
      if (fields.length !== 1 || !Number.isFinite(Number(fields[0].value)))
        throw Error("SPELL_CONFIGURE_EXPLICIT_BURN_TIMING_REQUIRED");
      return Number(fields[0].value);
    };
    if ((a.period ?? value("Period")) > (a.duration ?? value("Duration")))
      throw Error("SPELL_PERIOD_EXCEEDS_DURATION");
  }
  const selector = { domain: "Abil", id: a.id };
  if (a.damage !== undefined)
    document.setField({ domain: "Effect", id: a.id + "Damage" }, "Amount", "value", a.damage);
  if (a.energy !== undefined)
    document.setField(selector, "Cost[0].Vital[Energy]", "value", a.energy);
  if (a.cooldown !== undefined)
    document.setField(selector, "Cost[0].Cooldown", "TimeUse", a.cooldown);
  if (a.range !== undefined) document.setField(selector, "Range[0]", "value", a.range);
  if (a.duration !== undefined)
    document.setField({ domain: "Behavior", id: a.id + "Burn" }, "Duration", "value", a.duration);
  if (a.period !== undefined)
    document.setField({ domain: "Behavior", id: a.id + "Burn" }, "Period", "value", a.period);
  return ability.ctype + ":" + a.id;
}
