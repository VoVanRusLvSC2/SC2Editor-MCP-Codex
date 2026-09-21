import { benchmarkCutsceneWorkflow } from "../src/benchmark/cutsceneEfficiency.js";

const operations = Number(process.argv[2] ?? 20);
console.log(JSON.stringify({
  create: benchmarkCutsceneWorkflow("create", operations),
  edit: benchmarkCutsceneWorkflow("edit", operations),
}, null, 2));

