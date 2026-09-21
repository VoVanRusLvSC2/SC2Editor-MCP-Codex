export interface TextEfficiencyReport {
  scenario: string;
  individualWorkflow: { toolCalls: number; operations: number; calls: string[] };
  optimizedWorkflow: { toolCalls: 2; operations: number; calls: readonly ["text.context", "text.apply"] };
  reductionPercent: number;
  guarantees: string[];
}

export function benchmarkTextWorkflow(operations: number): TextEfficiencyReport {
  if (!Number.isInteger(operations) || operations < 1) throw new Error("operations must be a positive integer");
  const individualCalls = [
    "text.context",
    ...Array.from({ length: operations }, (_, index) => `text_mutation_${index + 1}`),
    "text.validate",
    "text.diff",
    "text.save",
  ];
  return {
    scenario: "Create styles, localized text, and rich-text spans",
    individualWorkflow: { toolCalls: individualCalls.length, operations, calls: individualCalls },
    optimizedWorkflow: { toolCalls: 2, operations, calls: ["text.context", "text.apply"] },
    reductionPercent: Math.round((1 - 2 / individualCalls.length) * 1000) / 10,
    guarantees: [
      "all style and locale mutations share one private transaction",
      "schema, reference, rich-text, and inheritance validation happens before commit",
      "per-file minimal diff is returned by text.apply",
      "dryRun=false + stage=false writes each changed file atomically with backup support",
      "a failed operation rolls back the complete multi-file batch",
    ],
  };
}
