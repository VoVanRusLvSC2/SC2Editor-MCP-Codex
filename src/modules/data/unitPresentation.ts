import * as z from "zod/v4";
import type { DataField, DataObject } from "./types.js";
import type { DataWorkspace } from "./workspace.js";
import { inspectEffectPresentation } from "./presentation.js";

export const unitPresentationSchema = z
  .object({
    unit: z.string().min(1).max(128),
    includeDependencies: z.boolean().default(true),
    maxWeapons: z.number().int().min(1).max(8).default(4),
    maxEffects: z.number().int().min(1).max(64).default(24),
  })
  .strict();
type Declaration = DataObject & { file: string };
const flatten = (fields: DataField[]): DataField[] =>
  fields.flatMap((f) => [f, ...flatten(f.children)]);
const value = (field: DataField) => field.value ?? field.link;
const removed = (field: DataField) => ["1", "true"].includes(field.attrs.removed ?? "");

/** A bounded static repair shortlist, never a certificate of engine playback. */
export function inspectUnitPresentation(
  objects: Declaration[],
  input: z.input<typeof unitPresentationSchema>,
) {
  const args = unitPresentationSchema.parse(input),
    index = new Map<string, Declaration[]>();
  for (const object of objects)
    if (object.id) {
      const key = object.domain + ":" + object.id,
        entries = index.get(key);
      if (entries) entries.push(object);
      else index.set(key, [object]);
    }
  const find = (domain: string, id: string) => index.get(domain + ":" + id) ?? [];
  const findings: Array<{ code: string; target: string; detail: string }> = [];
  const lineage = (domain: string, id: string) => {
    const chain: Declaration[] = [],
      seen = new Set<string>();
    let current: string | undefined = id;
    while (current) {
      if (seen.has(current) || chain.length >= 32) {
        findings.push({
          code: "PRESENTATION_PARENT_CYCLE_OR_LIMIT",
          target: domain + ":" + id,
          detail: current,
        });
        break;
      }
      seen.add(current);
      const candidates = find(domain, current);
      if (candidates.length !== 1) {
        findings.push({
          code: "PRESENTATION_DECLARATION_UNRESOLVED",
          target: domain + ":" + current,
          detail: candidates.length
            ? "Competing declarations; no layer guessed"
            : "Declaration not found",
        });
        break;
      }
      chain.push(candidates[0]);
      current = candidates[0].parent;
    }
    return chain;
  };
  const fields = (chain: Declaration[]) => {
    const result = new Map<string, DataField>();
    for (const object of [...chain].reverse())
      for (const field of object.fields) {
        if (removed(field)) result.delete(field.path);
        else result.set(field.path, field);
      }
    return [...result.values()];
  };
  const units = find("Unit", args.unit),
    unitChain = lineage("Unit", args.unit);
  if (
    objects.some(
      (o) => !o.id && o.isDefault && ["Unit", "Actor", "Weapon", "Effect"].includes(o.domain ?? ""),
    )
  )
    findings.push({
      code: "PRESENTATION_UNNAMED_DEFAULTS_UNVERIFIED",
      target: args.unit,
      detail: "Unnamed default layers are not merged by this declared-profile audit",
    });
  const unitFields = fields(unitChain),
    allWeaponFields = unitFields.filter((f) => f.name === "WeaponArray");
  const weaponIds = [
    ...new Set(
      allWeaponFields.map((f) => f.attrs.Link ?? value(f)).filter((v): v is string => !!v),
    ),
  ];
  if (
    unitChain.length > 1 &&
    unitChain[0].fields.some((f) => f.name === "WeaponArray" && f.index === undefined)
  )
    findings.push({
      code: "PRESENTATION_UNINDEXED_WEAPONS_UNVERIFIED",
      target: args.unit,
      detail: "Derived implicit weapon-array merge needs native review",
    });
  const actors = objects.filter((o) => o.ctype === "CActorUnit" && o.attrs.unitName === args.unit);
  if (actors.length !== 1)
    findings.push({
      code: "PRESENTATION_MAIN_ACTOR_UNRESOLVED",
      target: args.unit,
      detail: actors.length
        ? "More than one explicit primary Actor"
        : "No unique explicit primary Actor; implicit/tokenized identities remain unverified",
    });
  const mainActors = actors.slice(0, 4).map((actor) => {
    const chain = lineage("Actor", actor.id!),
      authored = fields(chain),
      events = authored.filter((f) => f.name === "On");
    const attackEvents = events.filter(
      (f) => /\bWeaponStart\./.test(f.attrs.Terms ?? "") && /^Anim/.test(f.attrs.Send ?? ""),
    );
    const mismatched = attackEvents
      .flatMap((f) =>
        [...(f.attrs.Terms ?? "").matchAll(/\bWeaponStart\.([^.;\s]+)/g)].map((m) => m[1]),
      )
      .filter((id) => id !== "*" && !id.includes("##") && !weaponIds.includes(id));
    if (mismatched.length)
      findings.push({
        code: "PRESENTATION_ATTACK_WEAPON_MISMATCH",
        target: actor.id!,
        detail: [...new Set(mismatched)].join(", "),
      });
    if (weaponIds.length && !attackEvents.length)
      findings.push({
        code: "PRESENTATION_ATTACK_ANIMATION_REVIEW",
        target: actor.id!,
        detail: "No declared WeaponStart animation binding; macros/baselines may supply behavior",
      });
    const model = authored.find((f) => f.name === "Model"),
      modelId = model && value(model);
    const models = modelId ? find("Model", modelId) : [];
    if (models.length !== 1)
      findings.push({
        code: "PRESENTATION_MAIN_MODEL_UNRESOLVED",
        target: actor.id!,
        detail: modelId ?? "No declared Model",
      });
    return {
      id: actor.id,
      model: modelId ?? null,
      modelDeclaration: models.length === 1 ? "found" : models.length ? "ambiguous" : "unresolved",
      attackEvents: attackEvents
        .slice(0, 12)
        .map((f) => ({ terms: f.attrs.Terms, send: f.attrs.Send })),
      attackEventsTruncated: attackEvents.length > 12,
      movementBaseline: authored
        .filter((f) => ["WalkAnimMoveSpeed", "WalkAnimSpeed"].includes(f.name))
        .map((f) => ({ field: f.name, value: value(f) })),
      lineage: chain.map((o) => o.id),
      nativePlayback: "not_checked",
    };
  });
  const effectRows: Array<{
      id: string;
      ctype?: string;
      next: string[];
      nextTruncated?: boolean;
      state: string;
    }> = [],
    seenEffects = new Set<string>();
  const visit = (effect: string) => {
    if (seenEffects.has(effect)) return;
    if (effectRows.length >= args.maxEffects) return;
    seenEffects.add(effect);
    const matches = find("Effect", effect);
    if (matches.length !== 1 || effect.includes("##")) {
      effectRows.push({
        id: effect,
        next: [],
        state: matches.length > 1 ? "ambiguous" : "unresolved",
      });
      return;
    }
    const linked = flatten(fields(lineage("Effect", effect))).filter((f) =>
      /^(?:Effect|EffectArray|PeriodicEffect|PeriodicEffectArray|InitialEffect|FinalEffect|ImpactEffect|ExpireEffect)$/.test(
        f.name,
      ),
    );
    const allNext = [...new Set(linked.map(value).filter((v): v is string => !!v))],
      next = allNext.slice(0, 64);
    effectRows.push({
      id: effect,
      ctype: matches[0].ctype,
      next,
      nextTruncated: allNext.length > next.length,
      state: "declared",
    });
    for (const id of next) visit(id);
  };
  const weapons = weaponIds.slice(0, args.maxWeapons).map((id) => {
    const chain = lineage("Weapon", id),
      allLinks = fields(chain)
        .filter((f) => f.name === "Effect")
        .map(value)
        .filter((v): v is string => !!v),
      links = [...new Set(allLinks)].slice(0, 64);
    for (const effect of links) visit(effect);
    if (!links.length)
      findings.push({
        code: "PRESENTATION_WEAPON_EFFECT_REVIEW",
        target: id,
        detail: "No unambiguous declared Effect link",
      });
    return {
      id,
      effects: links,
      effectsTruncated: allLinks.length > 64,
      lineage: chain.map((o) => o.id),
    };
  });
  const effects = effectRows.flatMap((row, i) =>
    i % 16 === 0
      ? inspectEffectPresentation(objects, {
          effects: effectRows.slice(i, i + 16).map((r) => r.id),
        }).effects
      : [],
  );
  for (const effect of effects)
    if (!["declared_links_found", "intentionally_invisible"].includes(effect.presentation))
      findings.push({
        code: "PRESENTATION_WEAPON_EFFECT_VISUAL_REVIEW",
        target: effect.effect,
        detail: effect.presentation,
      });
  const pending = effectRows.flatMap((row) => row.next).filter((id) => !seenEffects.has(id));
  const effectsTruncated =
    pending.length > 0 ||
    effectRows.some((row) => row.nextTruncated) ||
    weapons.some((w) => w.effectsTruncated || w.effects.some((id) => !seenEffects.has(id)));
  const effectSummaries = effects.map((effect) => ({
    effect: effect.effect,
    presentation: effect.presentation,
    bindingCount: effect.bindings.length,
    bindingsTruncated: effect.bindingsTruncated,
    nativePlayback: effect.nativePlayback,
  }));
  return {
    unit: args.unit,
    unitDeclaration: units.length === 1 ? "found" : units.length ? "ambiguous" : "unresolved",
    primaryActors: mainActors,
    weapons,
    weaponCount: weaponIds.length,
    weaponsTruncated: weaponIds.length > args.maxWeapons,
    effectGraph: effectRows,
    effectsTruncated,
    effects: effectSummaries,
    findings: findings.slice(0, 24),
    findingCount: findings.length,
    findingsTruncated: findings.length > 24,
    nativePlayback: "not_checked",
    assetResolution: "not_checked",
    coverage: "bounded_declared_profile",
    limits: [
      "No asset/sequence or rendered playback verification; inherited macros, implicit actors, weapon turrets and unnamed defaults need separate review",
      "Effect traversal covers explicit common execution links only; a missing declared visual is a repair question, not proof of absence",
      "Action/Missile/Beam Actor assets and sound-only bindings need the selected effect/Actor inspection",
    ],
  };
}

export async function checkUnitPresentation(
  data: DataWorkspace,
  input: z.input<typeof unitPresentationSchema>,
) {
  const args = unitPresentationSchema.parse(input);
  return data.workspace.withReadSet(async () => {
    const records = await data.catalog();
    const selected = records.filter(
      (r) => (args.includeDependencies || r.layer === "workspace") && r.engineActive !== false,
    );
    const objects = selected.flatMap((r) =>
      r.document
        .objects()
        .filter((o) => ["Unit", "Actor", "Model", "Weapon", "Effect"].includes(o.domain ?? ""))
        .map((o) => ({ ...o, file: r.file })),
    );
    if (objects.length > 100000) throw Error("DATA_UNIT_PRESENTATION_CATALOG_LIMIT");
    return {
      ...inspectUnitPresentation(objects, args),
      catalogIssues: records.issues.slice(0, 8),
      catalogIssueCount: records.issues.length,
    };
  });
}
