import { benchmarkTextWorkflow } from "../src/benchmark/textEfficiency.js";

const operations = Number(process.argv[2] ?? 12);
console.log(JSON.stringify(benchmarkTextWorkflow(operations), null, 2));
