import test from "node:test";
import assert from "node:assert/strict";
import { configureTrigger } from "../modules/editorLive/triggerConfigure.js";
import { compileAuthorScript } from "../app/authoringScript.js";

const input = { archive: "Current.SC2Map", windowId: "123", path: "MAIN/Start", section: "actions" as const,
  itemIndex: 1, expectedDetailHash: "10", edits: "integer:Count=7;unit:Type=Murloc Marine;point:Point=Spawn" };
function fixture(options: { duplicate?: boolean; fail?: boolean; throwAfterStart?: boolean } = {}) {
  const calls: Array<{ method: string; detail?: string; hash?: string; value?: unknown }> = [];
  let step = 0;
  const apply = async (method: string, args: {expectedDetailHash: string; expectedParameterHash: string; value?: number; unitName?: string; pointName?: string}) => {
    calls.push({ method, detail: args.expectedDetailHash, hash: args.expectedParameterHash,
      value: args.value ?? args.unitName ?? args.pointName });
    if (options.throwAfterStart && step === 0) throw Error("lost native transport");
    if (options.fail && step === 1) return { status: "unknown", parameterVerified: false };
    step++;
    return { status: "applied", parameterVerified: true, detailFingerprint: String(10 + step), parameterFingerprint: String(20 + step) };
  };
  const trigger = {
    parameters: async () => { calls.push({method:"parameters"}); return { parameterRoot:"Create Units", parameterFingerprint:"20", totalParameters: options.duplicate ? 4 : 3,
      nextOffset:null, parameters: [{index:1,text:"Count: 1"},{index:2,text:"Type: Marine"},{index:3,text:"Point: (No Value)"},
        ...(options.duplicate ? [{index:4,text:"Count: 2"}] : [])] }; },
    setInteger: (a: Parameters<typeof apply>[1]) => apply("integer",a), setReal: (a: Parameters<typeof apply>[1]) => apply("real",a),
    setUnit: (a: Parameters<typeof apply>[1]) => apply("unit",a), setPoint: (a: Parameters<typeof apply>[1]) => apply("point",a),
  } as unknown as Parameters<typeof configureTrigger>[0];
  return { trigger, calls };
}
test("multiple parameters retain native fingerprints after every edit", async () => {
  const f = fixture(), result = await configureTrigger(f.trigger,input);
  assert.equal(result.status,"applied");
  assert.deepEqual(f.calls, [{method:"parameters"},{method:"integer",detail:"10",hash:"20",value:7},
    {method:"unit",detail:"11",hash:"21",value:"Murloc Marine"},{method:"point",detail:"12",hash:"22",value:"Spawn"}]);
  const steps=compileAuthorScript('live trigger.configure archive=Current.SC2Map windowId=123 path="MAIN/Start" section=actions itemIndex=1 expectedDetailHash=10 edits="integer:Count=7;unit:Type=Murloc Marine;point:Point=Spawn"',"stage");
  assert.equal(steps[0].tool,"live.trigger.configure");
});
test("ambiguous names and malformed later values never start a mutation", async () => {
  const f=fixture({duplicate:true}), result=await configureTrigger(f.trigger,input);
  assert.equal(result.status,"stopped"); assert.deepEqual(f.calls,[{method:"parameters"}]);
  const g=fixture(); await assert.rejects(configureTrigger(g.trigger,{...input,edits:"integer:Count=7;real:Speed=not-a-number"}));
  assert.equal(g.calls.length,0);
});
test("unknown or lost edits stop the sequence without repeating them", async () => {
  const f=fixture({fail:true}), result=await configureTrigger(f.trigger,input);
  assert.equal(result.status,"unknown"); assert.equal(result.completed.length,1);
  assert.deepEqual(f.calls.map(c=>c.method),["parameters","integer","unit"]);
  const g=fixture({throwAfterStart:true}), lost=await configureTrigger(g.trigger,input);
  assert.equal(lost.status,"unknown"); assert.equal(lost.completed.length,0);
});
