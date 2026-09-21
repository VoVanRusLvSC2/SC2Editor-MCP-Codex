import test from "node:test";
import assert from "node:assert/strict";
import { benchmarkCutsceneWorkflow } from "../benchmark/cutsceneEfficiency.js";

test("Cutscene workflow is one context call plus one atomic compose/apply call", () => {
  const create = benchmarkCutsceneWorkflow("create", 20);
  const edit = benchmarkCutsceneWorkflow("edit", 20);
  assert.equal(create.individualWorkflow.toolCalls, 24);
  assert.deepEqual(create.optimizedWorkflow.calls, ["cutscene.context", "cutscene.compose"]);
  assert.deepEqual(edit.optimizedWorkflow.calls, ["cutscene.context", "cutscene.apply"]);
  assert.equal(create.optimizedWorkflow.toolCalls, 2);
  assert.equal(create.reductionPercent > 90, true);
});

