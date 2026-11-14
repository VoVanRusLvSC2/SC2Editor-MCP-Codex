import * as z from "zod/v4";
import { documentTargetSchema } from "./document.js";
import { placementNameSchema, type LivePlacement } from "./placement.js";

const itemSchema = z
  .object({
    type: z.string().min(1).max(80),
    x: z.number().min(0).max(4096).multipleOf(0.5),
    y: z.number().min(0).max(4096).multipleOf(0.5),
    name: placementNameSchema
      .refine((name) => name.length > 0, "Name must not be empty")
      .optional(),
    expectedId: z.string().min(1).max(120).optional(),
  })
  .strict();

const groupSchema = documentTargetSchema
  .extend({
    layer: z.enum(["Doodads", "Units"]).default("Doodads"),
    owner: z.number().int().min(0).max(15).optional(),
    objects: z.array(itemSchema).min(1).max(50),
  })
  .strict();
const validateOwner = (value: z.infer<typeof groupSchema>, ctx: z.RefinementCtx) => {
  if ((value.layer === "Units") !== (value.owner !== undefined))
    ctx.addIssue({ code: "custom", message: "Units require owner; Doodads must omit owner" });
};
export const placementGroupSchema = groupSchema
  .extend({ objects: z.array(itemSchema).min(1).max(8) })
  .superRefine(validateOwner);
export const placementJobSchema = groupSchema.superRefine(validateOwner);
type GroupInput = z.input<typeof placementJobSchema>;
type GroupHooks = { cancelled?: () => boolean; progress?: (completed: unknown[]) => void };

/** Compose the existing guarded native operations; never repeat a submitted placement. */
export async function createPlacementGroup(
  placement: Pick<
    LivePlacement,
    "prepare" | "inspect" | "catalog" | "create" | "checkGroupCapacity"
  >,
  input: GroupInput,
  hooks: GroupHooks = {},
) {
  const args = placementJobSchema.parse(input);
  const target = { archive: args.archive, windowId: args.windowId };
  const completed: unknown[] = [];
  // Only a lookup hint: native create rechecks the entire palette hash and exact row.
  const paletteRows = new Map<string, { row: number; catalogHash: string }>();
  let phase = "prepare";
  let index = 0;
  try {
    await placement.prepare({ ...target, layer: args.layer });
    if (hooks.cancelled?.())
      return { status: "cancelled", phase, index, completed, saved: false, copiesCreated: 0 };
    phase = "preflight";
    const firstScene = await placement.inspect(target);
    placement.checkGroupCapacity(firstScene.snapshotId, args.objects);
    for (const object of args.objects) {
      if (hooks.cancelled?.())
        return { status: "cancelled", phase, index, completed, saved: false, copiesCreated: 0 };
      phase = "inspect";
      const scene = index === 0 ? firstScene : await placement.inspect(target);
      phase = "catalog";
      let resolved = paletteRows.get(object.type);
      if (!resolved) {
        const palette = await placement.catalog({
          snapshotId: scene.snapshotId,
          query: object.type,
        });
        const rows = palette.rows.filter((row) => row.type === object.type);
        let offset = palette.rows.length;
        while (offset < palette.matches && offset < 128) {
          const page = await placement.catalog({
            snapshotId: scene.snapshotId,
            query: object.type,
            offset,
          });
          if (
            page.catalogHash !== palette.catalogHash ||
            page.matches !== palette.matches ||
            !page.rows.length
          )
            throw Error("LIVE_PLACEMENT_PALETTE_CHANGED");
          rows.push(...page.rows.filter((row) => row.type === object.type));
          offset += page.rows.length;
        }
        if (offset < palette.matches || rows.length !== 1)
          throw Error("LIVE_PLACEMENT_EXACT_PALETTE_TYPE_NOT_UNIQUE_OR_TRUNCATED");
        resolved = { row: rows[0].row, catalogHash: palette.catalogHash };
        paletteRows.set(object.type, resolved);
      }
      phase = "create";
      const result = await placement.create({
        snapshotId: scene.snapshotId,
        catalogRow: resolved.row,
        catalogHash: resolved.catalogHash,
        ...object,
        owner: args.owner,
      });
      if (result.status !== "applied")
        return {
          status: "stopped",
          phase,
          index,
          completed,
          result,
          reason: result.status,
          recovery:
            "Inspect the same open document and the affected object before continuing; do not replay the group.",
          retryMutation: false,
          saved: false,
          copiesCreated: 0,
        };
      completed.push({
        type: object.type,
        x: object.x,
        y: object.y,
        name: "after" in result ? result.after.name : (object.name ?? null),
      });
      index++;
      hooks.progress?.([...completed]);
    }
    return { status: "applied", completed, saved: false, copiesCreated: 0, reopensMap: false };
  } catch (error) {
    return {
      status: "stopped",
      phase,
      index,
      completed,
      error: String(error),
      retryMutation: false,
      saved: false,
      copiesCreated: 0,
    };
  }
}
