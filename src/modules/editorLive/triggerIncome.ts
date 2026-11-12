import * as z from "zod/v4";
import { triggerCreateSchema, type LiveTriggers } from "./triggers.js";
import { triggerPlanSchema } from "../trigger/schemas.js";
import { folderPath } from "../trigger/organization.js";

export const triggerIncomeSchema = triggerCreateSchema
  .omit({ plan: true })
  .extend({
    name: triggerCreateSchema.shape.name.default("Periodic Mineral Income"),
    player: z.number().int().min(1).max(15).default(1),
    every: z.number().min(0.01).max(3600).multipleOf(0.01).default(5),
    amount: z.number().int().min(1).max(1000000).default(100),
    folder: folderPath.default("ECONOMY"),
  })
  .strict();

/** A small recipe over the shared typed GUI generator and current-document import. */
export async function createPeriodicIncome(
  triggers: Pick<LiveTriggers, "create">,
  input: z.input<typeof triggerIncomeSchema>,
) {
  const args = triggerIncomeSchema.parse(input);
  const plan = triggerPlanSchema.parse({
    create: { identifier: `MineralIncomePlayer${args.player}`, folder: args.folder },
    calls: [
      {
        kind: "Event",
        function: "TriggerAddEventTimePeriodic",
        args: {
          dur: { kind: "literal", type: "fixed", value: args.every },
          timeType: { kind: "preset", name: "game" },
        },
      },
      {
        kind: "Action",
        function: "PlayerModifyPropertyInt",
        args: {
          p: { kind: "literal", type: "int", value: args.player },
          prop: { kind: "preset", name: "Minerals" },
          operation: { kind: "preset", name: "Add" },
          val: { kind: "literal", type: "int", value: args.amount },
        },
      },
    ],
  });
  const result = await triggers.create({
    archive: args.archive,
    windowId: args.windowId,
    name: args.name,
    plan,
  });
  return {
    ...result,
    recipe: "periodic_mineral_income",
    player: args.player,
    every: args.every,
    amount: args.amount,
  };
}
