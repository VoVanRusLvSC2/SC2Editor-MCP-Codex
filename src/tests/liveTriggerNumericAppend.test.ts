import test from "node:test";
import assert from "node:assert/strict";
import { appendNumericTrigger } from "../modules/editorLive/triggerNumericAppend.js";
import { compactResult } from "../app/toolResults.js";
import { compileAuthorScript } from "../app/authoringScript.js";

const input = {
  archive: "Current.SC2Map",
  windowId: "123",
  path: "MAIN/Start",
  kind: "action" as const,
  name: "Set Global Time Scale",
  parameter: "Time Scale",
  numberType: "real" as const,
  value: 2.5,
};
function fixture(
  options: {
    extra?: boolean;
    duplicate?: boolean;
    insertionUnknown?: boolean;
    editUnknown?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const trigger = {
    appendAction: async () => {
      calls.push("append");
      return options.insertionUnknown
        ? { status: "unknown" }
        : { status: "needs_parameters", itemIndex: 2, detailFingerprint: "42" };
    },
    appendEvent: async () => {
      calls.push("event");
      return { status: "needs_parameters", itemIndex: 2, detailFingerprint: "42" };
    },
    parameters: async (args: { expectedDetailHash: string }) => {
      calls.push("parameters");
      assert.equal(args.expectedDetailHash, "42");
      const parameters = [{ index: 1, text: "Time Scale: 1.0" }];
      if (options.extra)
        parameters.push({ index: 2, text: options.duplicate ? "Time Scale: 2.0" : "Other: 1" });
      return {
        parameterRoot: input.name,
        parameters,
        totalParameters: parameters.length,
        nextOffset: null,
        parameterFingerprint: "43",
      };
    },
    setReal: async (args: { expectedParameterHash: string; value: number }) => {
      calls.push("set");
      assert.equal(args.expectedParameterHash, "43");
      assert.equal(args.value, 2.5);
      return options.editUnknown
        ? { status: "unknown", parameterVerified: false }
        : { status: "applied", parameterVerified: true };
    },
    setInteger: async () => {
      calls.push("integer");
      return { status: "applied", parameterVerified: true };
    },
  } as unknown as Parameters<typeof appendNumericTrigger>[0];
  return { trigger, calls };
}

test("one numeric action is created and configured in one guarded operation", async () => {
  const f = fixture(),
    result = await appendNumericTrigger(f.trigger, input);
  assert.equal(result.status, "applied");
  assert.deepEqual(f.calls, ["append", "parameters", "set"]);
  assert.equal((compactResult(result) as { value: number }).value, 2.5);
  const steps = compileAuthorScript(
    'live trigger.append_numeric archive=Current.SC2Map windowId=123 path="MAIN/Start" kind=action name="Set Global Time Scale" parameter="Time Scale" numberType=real value=2.5',
    "stage",
  );
  assert.equal(steps[0].args.value, 2.5);
});
test("remaining parameters stop the workflow before Save", async () => {
  const f = fixture({ extra: true }),
    result = await appendNumericTrigger(f.trigger, input);
  assert.equal(result.status, "needs_parameters");
  assert.equal("remainingParameters" in result && result.remainingParameters, 1);
});
test("unknown insertion, ambiguous parameter and unknown edit never trigger a second insertion", async () => {
  for (const [options, status, calls] of [
    [{ insertionUnknown: true }, "unknown", ["append"]],
    [{ extra: true, duplicate: true }, "partial", ["append", "parameters"]],
    [{ editUnknown: true }, "unknown", ["append", "parameters", "set"]],
  ] as const) {
    const f = fixture(options),
      result = await appendNumericTrigger(f.trigger, input);
    assert.equal(result.status, status);
    assert.deepEqual(f.calls, calls);
  }
});
test("events use their own insertion and invalid numeric values refuse before mutation", async () => {
  const f = fixture(),
    result = await appendNumericTrigger(f.trigger, {
      ...input,
      kind: "event",
      numberType: "integer",
      value: 3,
    });
  assert.equal(result.status, "applied");
  assert.deepEqual(f.calls, ["event", "parameters", "integer"]);
  const g = fixture();
  await assert.rejects(
    appendNumericTrigger(g.trigger, { ...input, numberType: "integer", value: 2.5 }),
  );
  assert.equal(g.calls.length, 0);
});
