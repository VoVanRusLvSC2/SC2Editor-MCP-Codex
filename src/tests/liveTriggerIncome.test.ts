import test from "node:test";
import assert from "node:assert/strict";
import { createPeriodicIncome } from "../modules/editorLive/triggerIncome.js";
import { compileAuthorScript } from "../app/authoringScript.js";
test("income composes a real periodic event and resource-add action without a plan file", async () => {
  let request: unknown;
  const fake = {
    create: async (args: unknown) => {
      request = args;
      return { status: "applied" };
    },
  } as unknown as Parameters<typeof createPeriodicIncome>[0];
  const result = await createPeriodicIncome(fake, {
    archive: "K:/Maps/User.SC2Map",
    windowId: "123",
  });
  assert.equal(result.status, "applied");
  const r = request as {
    plan: {
      create: { identifier: string };
      calls: Array<{ function: string; args: Record<string, { value?: unknown; name?: unknown }> }>;
    };
    planFile?: string;
  };
  assert.equal(r.planFile, undefined);
  assert.equal(r.plan.calls[0].function, "TriggerAddEventTimePeriodic");
  assert.equal(r.plan.calls[0].args.dur.value, 5);
  assert.equal(r.plan.calls[1].function, "PlayerModifyPropertyInt");
  assert.equal(r.plan.calls[1].args.val.value, 100);
  assert.equal(r.plan.calls[1].args.p.value, 1);
  assert.equal(r.plan.calls[1].args.operation.name, "Add");
  const steps = compileAuthorScript(
    "live trigger.income archive=Current.SC2Map windowId=123 player=1 every=5 amount=100",
    "stage",
  );
  assert.equal(steps[0].tool, "live.trigger.income");
});
