import test from "node:test";
import assert from "node:assert/strict";
import { benchmarkTextWorkflow } from "../benchmark/textEfficiency.js";

test("Text workflow is one context call plus one atomic apply call", () => {
  const report = benchmarkTextWorkflow(12);
  assert.equal(report.individualWorkflow.toolCalls, 16);
  assert.deepEqual(report.optimizedWorkflow.calls, ["text.context", "text.apply"]);
  assert.equal(report.optimizedWorkflow.toolCalls, 2);
  assert.equal(report.reductionPercent, 87.5);
});
