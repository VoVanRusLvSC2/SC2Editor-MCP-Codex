import type { PlacementPlan } from "./types.js";

export function compactPlacementPlan(plan: PlacementPlan, limit = 10) {
  return {
    ...plan,
    operations: plan.operations.slice(0, limit),
    totalOperations: plan.operations.length,
    truncated: plan.operations.length > limit,
  };
}
