export interface CutsceneEfficiencyReport {
  scenario: string;
  individualWorkflow: { toolCalls: number; operations: number; calls: string[] };
  optimizedWorkflow: { toolCalls: 2; operations: number; calls: readonly ["cutscene.context", "cutscene.compose"] | readonly ["cutscene.context", "cutscene.apply"] };
  reductionPercent: number;
  guarantees: string[];
}

export function benchmarkCutsceneWorkflow(mode: "create" | "edit", operations: number): CutsceneEfficiencyReport {
  if (!Number.isInteger(operations) || operations < 1) throw new Error("operations must be a positive integer");
  const individualCalls = [
    mode === "create" ? "cutscene.create" : "cutscene.open",
    ...Array.from({ length: operations }, (_, index) => `mutation_${index + 1}`),
    "cutscene.validate",
    "cutscene.diff",
    "cutscene.save",
  ];
  const optimizedCalls = mode === "create"
    ? ["cutscene.context", "cutscene.compose"] as const
    : ["cutscene.context", "cutscene.apply"] as const;
  return {
    scenario: mode === "create" ? "Create a complete Cutscene" : "Edit an existing Cutscene",
    individualWorkflow: { toolCalls: individualCalls.length, operations, calls: individualCalls },
    optimizedWorkflow: { toolCalls: 2, operations, calls: optimizedCalls },
    reductionPercent: Math.round((1 - 2 / individualCalls.length) * 1000) / 10,
    guarantees: [
      "all mutations share one private document",
      "validation happens before commit",
      "semantic diff is returned by the mutation call",
      "dryRun=false + stage=false writes atomically in the same call",
      "a failed operation rolls back the entire batch",
    ],
  };
}
