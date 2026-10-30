import * as z from "zod/v4";
import type { DataNativeFieldSpec, DataOperation } from "./types.js";
import type { CatalogPreload } from "./projectileRecipe.js";

const id = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .max(96);
const scalar = z.number().nonnegative().lt(524288);

/** Opinionated native graphs, not a free-form XML or trigger escape hatch. */
export const spellRecipeSchema = z
  .object({
    id,
    kind: z.enum(["damage", "pulse", "line", "ring", "burn"]),
    damage: scalar,
    model: id,
    face: id,
    sourceAbility: id.optional(),
    unit: id.optional(),
    slot: z.number().int().min(0).max(14).optional(),
    page: z.number().int().min(0).max(7).default(0),
    energy: scalar.default(0),
    cooldown: scalar.default(5),
    range: scalar.default(10),
    radius: z.number().positive().max(30).optional(),
    count: z.number().int().min(1).max(64).optional(),
    spacing: z.number().positive().max(10).optional(),
    gap: z.number().min(0).max(270).optional(),
    delay: z.number().min(0).max(30).default(0),
    warningModel: id.optional(),
    duration: z.number().positive().max(3600).optional(),
    period: z.number().positive().max(60).optional(),
    sound: id.optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if ((a.unit === undefined) !== (a.slot === undefined))
      issue("SPELL_UNIT_AND_SLOT_REQUIRED_TOGETHER");
    if (a.delay > 0 && !a.warningModel) issue("SPELL_DELAY_REQUIRES_WARNING_MODEL");
    if (a.warningModel && !a.delay) issue("SPELL_WARNING_REQUIRES_DELAY");
    if (["damage", "burn"].includes(a.kind) && a.delay)
      issue("SPELL_UNIT_TARGET_DELAY_UNSUPPORTED");
    if (a.kind !== "burn" && (a.duration !== undefined || a.period !== undefined))
      issue("SPELL_BURN_TIMING_ONLY");
    if (!["line", "ring"].includes(a.kind) && a.count !== undefined)
      issue("SPELL_PATTERN_COUNT_ONLY");
    if (a.kind !== "line" && a.spacing !== undefined) issue("SPELL_LINE_SPACING_ONLY");
    if (a.kind !== "ring" && a.gap !== undefined) issue("SPELL_RING_GAP_ONLY");
    if (["damage", "burn"].includes(a.kind) && a.radius !== undefined)
      issue("SPELL_AREA_RADIUS_ONLY");
    if (a.kind === "burn" && (a.period ?? 1) > (a.duration ?? 10))
      issue("SPELL_PERIOD_EXCEEDS_DURATION");
  });

export type SpellRecipe = z.infer<typeof spellRecipeSchema>;
const field = (
  name: string,
  value: string | number,
  index?: number | string,
): DataNativeFieldSpec => ({ name, value, ...(index === undefined ? {} : { index }) });
const create = (
  ctype: string,
  id: string,
  fields: DataNativeFieldSpec[],
  parent?: string,
): DataOperation => ({ op: "object.create", ctype, id, fields, ...(parent ? { parent } : {}) });

/** Expand before the existing atomic Data transaction. Existing validators,
 * command-card guards, dependency read sets and visual preloads stay authoritative. */
export function expandSpellRecipe(input: SpellRecipe): DataOperation[] {
  const a = spellRecipeSchema.parse(input),
    prefix = a.id;
  const damage = prefix + "Damage",
    hit = prefix + "Hit",
    search = prefix + "Search";
  const cell = prefix + "Cell",
    pattern = prefix + "Pattern",
    button = prefix + "Button";
  const out: DataOperation[] = [
    create("CEffectDamage", damage, [field("Amount", a.damage), field("Kind", "Spell")]),
  ];
  let effect = damage;
  const visual = (id: string, effect: string, target = false) =>
    out.push({
      op: "recipe.effectModel",
      id,
      effect,
      model: a.model,
      ...(target ? { at: "Target", siteOp: "SOpAttachCenter" } : { siteOp: "SOpShadow" }),
    });
  if (a.kind === "burn") {
    const behavior = prefix + "Burn";
    out.push(
      create("CBehaviorBuff", behavior, [
        field("Duration", a.duration ?? 10),
        field("Period", a.period ?? 1),
        field("PeriodicEffect", damage),
        field("MaxStackCount", 1),
        field("BuffFlags", 1, "RefreshStack"),
      ]),
    );
    effect = prefix + "Apply";
    out.push(create("CEffectApplyBehavior", effect, [field("Behavior", behavior)]));
    visual(prefix + "Impact", damage, true);
  } else if (a.kind === "damage") {
    visual(prefix + "Impact", damage, true);
  } else {
    // Overlapping cells deal one hit per cast window, rather than multiplying
    // damage at line/ring seams. The lock is owned by this spell only.
    const lock = prefix + "HitLock",
      fresh = prefix + "FreshTarget";
    out.push(
      create("CBehaviorBuff", lock, [field("Duration", 0.125), field("InfoFlags", 1, "Hidden")]),
    );
    out.push(
      create("CValidatorUnitCompareBehaviorCount", fresh, [
        field("Behavior", lock),
        field("Value", 0),
        { name: "WhichUnit", attrs: { Value: "Target" } },
      ]),
    );
    out.push({
      op: "native.add",
      object: { domain: "Effect", id: damage },
      field: field("ValidatorArray", fresh, 0),
    });
    out.push(create("CEffectApplyBehavior", prefix + "ApplyLock", [field("Behavior", lock)]));
    out.push(
      create("CEffectSet", hit, [
        field("EffectArray", damage, 0),
        field("EffectArray", prefix + "ApplyLock", 1),
      ]),
    );
    out.push(
      create("CEffectEnumArea", search, [
        field("SearchFilters", "Ground;Self,Player,Ally,Neutral,Missile,Dead,Hidden,Invulnerable"),
        { name: "ImpactLocation", attrs: { Value: "TargetPoint" } },
        {
          name: "AreaArray",
          index: 0,
          attrs: {
            Radius:
              a.kind === "pulse" ? (a.radius ?? 4) : a.kind === "line" ? (a.radius ?? 0.9) : 1.15,
            Effect: hit,
          },
        },
      ]),
    );
    // Every shape has a location-bearing cell, including an instant caster pulse.
    out.push(
      create("CEffectCreatePersistent", cell, [
        { name: "WhichLocation", attrs: { Value: "TargetPoint" } },
        field("PeriodCount", 1),
        field("PeriodicPeriodArray", a.delay, 0),
        field("PeriodicEffectArray", search, 0),
      ]),
    );
    const count = a.kind === "pulse" ? 1 : (a.count ?? (a.kind === "line" ? 9 : 13));
    const offsets = Array.from({ length: count }, (_, i) => {
      if (a.kind === "pulse") return "0,0,0";
      // Native aimed persistent offsets advance toward TargetPoint on local -Y.
      // Positive Y placed Narud's warning cells behind the caster in gameplay.
      if (a.kind === "line") return `0,${(-2 - i * (a.spacing ?? 1.6)).toFixed(4)},0`;
      const gap = a.gap ?? 100,
        angle = ((gap / 2 + ((360 - gap) * i) / count) * Math.PI) / 180;
      const radius = a.radius ?? 6;
      return `${(Math.sin(angle) * radius).toFixed(4)},${(Math.cos(angle) * radius).toFixed(4)},0`;
    });
    effect = pattern;
    out.push(
      create("CEffectCreatePersistent", pattern, [
        { name: "WhichLocation", attrs: { Value: "CasterPoint" } },
        ...(a.kind === "pulse"
          ? []
          : [
              { name: "OffsetVectorStartLocation", attrs: { Value: "CasterPoint" } },
              { name: "OffsetVectorEndLocation", attrs: { Value: "TargetPoint" } },
            ]),
        field("PeriodCount", count),
        ...offsets.flatMap((offset, index) => [
          field("PeriodicEffectArray", cell, index),
          field("PeriodicOffsetArray", offset, index),
          field("PeriodicPeriodArray", 0, index),
        ]),
      ]),
    );
    visual(prefix + "Impact", search);
    if (a.warningModel)
      out.push(
        create(
          "CActorModel",
          prefix + "Warning",
          [
            field("Model", a.warningModel),
            { name: "HostSiteOps", attrs: { Ops: "SOpShadow" } },
            { name: "On", attrs: { Terms: `Effect.${cell}.Start`, Send: "Create" } },
            {
              name: "On",
              attrs: { Terms: "ActorCreation", Send: `TimerSet ${a.delay} WarningEnd` },
            },
            { name: "On", attrs: { Terms: "TimerExpired; TimerName WarningEnd", Send: "Destroy" } },
          ],
          "ModelAnimationStyleContinuous",
        ),
      );
  }
  out.push(create("CButton", button, [], a.face));
  const common = {
    id: a.id,
    effect,
    button,
    energy: a.energy,
    cooldown: a.cooldown,
    ...(a.unit
      ? {
          unit: a.unit,
          card: { page: a.page, slot: a.slot!, row: Math.floor(a.slot! / 5), column: a.slot! % 5 },
        }
      : {}),
  };
  if (a.kind === "pulse")
    out.push({
      op: "recipe.instantAbility",
      ...common,
      sourceAbility: a.sourceAbility ?? "Stimpack",
    });
  else
    out.push({
      op: "recipe.targetAbility",
      ...common,
      sourceAbility: a.sourceAbility ?? (["damage", "burn"].includes(a.kind) ? "Snipe" : "EMP"),
      range: a.range,
    });
  if (a.sound)
    out.push(
      create(
        "CActorSound",
        prefix + "Sound",
        [
          field("Sound", a.sound),
          { name: "On", attrs: { Terms: `Effect.${effect}.Start; At Source`, Send: "Create" } },
        ],
        "SoundOneShot",
      ),
    );
  return out;
}

/** Continuous warnings and initial cast sounds also need explicit preload entries. */
export function spellPreloads(a: SpellRecipe): CatalogPreload[] {
  return [
    ...(a.warningModel
      ? [
          { tag: "Actor" as const, id: a.id + "Warning" },
          { tag: "Model" as const, id: a.warningModel },
        ]
      : []),
    ...(a.sound
      ? [
          { tag: "Actor" as const, id: a.id + "Sound" },
          { tag: "Sound" as const, id: a.sound },
        ]
      : []),
  ];
}
