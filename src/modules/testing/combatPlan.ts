import * as z from "zod/v4";
import { combatSchema } from "./combatChecks.js";

export const combatPlanSchema = z
  .object({
    map: z.string().min(1),
    attacker: z.string().min(1).max(128),
    defender: z.string().min(1).max(128),
    x: z.number().finite(),
    y: z.number().finite(),
    separation: z.number().positive().max(40).default(6),
    owner: z.number().int().min(1).max(15).default(1),
    enemy: z.number().int().min(0).max(15).default(15),
    repeats: z.number().int().min(1).max(4).default(1),
    expected: combatSchema.shape.expected,
    counterattack: combatSchema.shape.counterattack,
    duration: combatSchema.shape.duration,
    timeout: combatSchema.shape.timeout,
    deathMin: z.number().nonnegative().optional(),
    deathMax: z.number().nonnegative().optional(),
  })
  .strict()
  .refine(
    (v) => (v.deathMin === undefined) === (v.deathMax === undefined),
    "Both death bounds are required",
  );

export function combatManifest(input: z.input<typeof combatPlanSchema>) {
  const args = combatPlanSchema.parse(input),
    combat = combatSchema.parse({
      id: "duel",
      attacker: { type: args.attacker, owner: args.owner, at: "attacker" },
      defender: { type: args.defender, owner: args.enemy, at: "defender" },
      expected: args.expected,
      counterattack: args.counterattack,
      duration: args.duration,
      timeout: args.timeout,
      ...(args.deathMin === undefined
        ? {}
        : { deathSeconds: { min: args.deathMin, max: args.deathMax } }),
    });
  return {
    version: 1 as const,
    map: args.map,
    label: "Controlled native combat: " + args.attacker + " / " + args.defender,
    game: {
      capture: false,
      points: {
        attacker: { x: args.x - args.separation / 2, y: args.y },
        defender: { x: args.x + args.separation / 2, y: args.y },
      },
      combats: Array.from({ length: args.repeats }, (_, i) => ({
        ...combat,
        id: "duel_" + (i + 1),
      })),
    },
  };
}
