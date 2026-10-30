import * as z from "zod/v4";
import { DataDocument } from "./document.js";
import { unitActorRecipe } from "./actorRecipes.js";
import type { DataField, DataObject } from "./types.js";
import type { CatalogPreload } from "./projectileRecipe.js";

const id = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .max(96);
export const unitCopySchema = z
  .object({
    id,
    from: id,
    sourceActor: id.optional(),
    model: id.optional(),
    life: z.number().positive().lt(524288).optional(),
    shields: z.number().nonnegative().lt(524288).optional(),
    energy: z.number().nonnegative().lt(524288).optional(),
    speed: z.number().nonnegative().max(100).optional(),
    scale: z.number().positive().max(20).optional(),
    heroic: z.boolean().optional(),
  })
  .strict();
export type UnitCopyRecipe = z.infer<typeof unitCopySchema>;

/** A derived unit with an independent primary Actor. Native mechanics remain
 * deliberately shared: this is not a recursively duplicated weapon/morph graph. */
export function unitCopyRecipe(
  document: DataDocument,
  available: DataObject[],
  input: UnitCopyRecipe,
): { target: string; preloads: CatalogPreload[] } {
  const a = unitCopySchema.parse(input);
  const unique = (domain: string, id: string) => {
    const matches = available.filter((o) => o.domain === domain && o.id === id);
    if (matches.length !== 1) throw Error(`UNIT_COPY_AMBIGUOUS_OR_MISSING: ${domain}:${id}`);
    return matches[0];
  };
  const source = unique("Unit", a.from);
  if (source.ctype !== "CUnit" || a.id === a.from) throw Error("UNIT_COPY_SOURCE_UNSUPPORTED");
  if (available.some((o) => o.id === a.id && ["Unit", "Actor"].includes(o.domain ?? "")))
    throw Error("UNIT_COPY_ID_EXISTS");
  const actors = available.filter(
    (o) =>
      o.ctype === "CActorUnit" &&
      o.attrs.unitName === a.from &&
      (!a.sourceActor || o.id === a.sourceActor),
  );
  if (actors.length !== 1) throw Error("UNIT_COPY_MAIN_ACTOR_AMBIGUOUS_OR_MISSING");
  const actor = actors[0];
  if (!actor.parent?.startsWith("GenericUnit"))
    throw Error("UNIT_COPY_CONCRETE_ACTOR_LAYERS_UNSUPPORTED");
  // Pin concrete actor identity tokens to the old asset names before naming its
  // new executable identity. A new ID must not invent a missing Model or Sound.
  const pin = (value: string) =>
    value.replaceAll("##id##", actor.id!).replaceAll("##unitName##", a.from);
  const copyField = (f: DataField): DataField => ({
    ...f,
    value: f.value === undefined ? undefined : pin(f.value),
    link: f.link === undefined ? undefined : pin(f.link),
    attrs: Object.fromEntries(Object.entries(f.attrs).map(([k, v]) => [k, pin(v)])),
    children: f.children.map(copyField),
  });
  const pinned = { ...actor, fields: actor.fields.map(copyField) };
  const model = a.model ?? pinned.fields.find((f) => f.name === "Model")?.value ?? a.from;
  unique("Model", model);
  document.createObject("CUnit", a.id, { parent: a.from });
  const unit = { domain: "Unit", id: a.id };
  // Preserve the source label unless the caller authors a localized rename.
  document.setField(
    unit,
    "Name",
    "value",
    source.fields.find((f) => f.name === "Name")?.value ?? "Unit/Name/" + a.from,
  );
  for (const [name, value] of [
    ["Life", a.life],
    ["Shields", a.shields],
    ["Energy", a.energy],
  ] as const)
    if (value !== undefined)
      for (const suffix of ["Max", "Start"]) document.setField(unit, name + suffix, "value", value);
  if (a.speed !== undefined) document.setField(unit, "Speed", "value", a.speed);
  if (a.heroic !== undefined)
    document.setField(unit, "Attributes[Heroic]", "value", Number(a.heroic));
  unitActorRecipe(document, pinned, { id: a.id, unit: a.id, model, scale: a.scale });
  return {
    target: "CUnit:" + a.id,
    preloads: [
      { tag: "Unit", id: a.id },
      { tag: "Actor", id: a.id },
      { tag: "Model", id: model },
    ],
  };
}
