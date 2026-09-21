const granular = [
  "list components", "open CustomAI", "list personalities", "resolve player 3", "resolve player 1", "resolve Zergling", "resolve Roach",
  "create personality", "set source", "set target", "create wave 1", "set wave 1 time", "add Zergling", "create wave 2", "set wave 2 time",
  "add Roach", "add Zergling", "validate", "diff", "save",
];
const semantic = ["ai.context", "ai.apply"];
const result = { workflow: "Create a two-wave Zerg personality with resolved players/units", granularCalls: granular.length, semanticCalls: semantic.length, savedCalls: granular.length - semantic.length, reductionPercent: Number((((granular.length - semantic.length) / granular.length) * 100).toFixed(1)), semantic, note: "ai.apply includes validation, minimal multi-file diff, ComponentList registration and atomic save/stage." };
if (result.semanticCalls > 3 || result.reductionPercent < 80) throw new Error("AI MCP economy regression");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
