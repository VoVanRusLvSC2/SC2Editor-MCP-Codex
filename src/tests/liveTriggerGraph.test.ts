import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { LiveTriggers, triggerBindSchema } from "../modules/editorLive/triggers.js";
import {
  verifyGraphEdit,
  verifyParameterRebind,
  expectedGraphTransfer,
  structuralTree,
  triggerChildPath,
  type TriggerTreeItem,
} from "../modules/editorLive/triggerPaths.js";
import { compileAuthorScript } from "../app/authoringScript.js";
const r = (h: number, p: number, d: number, text: string): TriggerTreeItem => ({
  handle: String(h),
  parent: String(p),
  depth: d,
  text,
});
const recycle = (rows: TriggerTreeItem[]) => {
  const ids = new Map(rows.map((row, index) => [row.handle, String(900 - index)]));
  return rows.map((row) => ({
    ...row,
    handle: ids.get(row.handle)!,
    parent: ids.get(row.parent) ?? "0",
  }));
};
const graph = [
  r(1, 0, 0, "Start"),
  r(2, 1, 1, "Actions"),
  r(3, 2, 2, "First"),
  r(4, 2, 2, "If Then Else"),
  r(5, 4, 3, "If"),
  r(6, 4, 3, "Then"),
  r(7, 6, 4, "Wait 1"),
  r(8, 4, 3, "Else"),
  r(9, 2, 2, "Last"),
];

test("delete verifies a complete nested subtree with recycled handles", () => {
  assert.equal(
    verifyGraphEdit(graph, recycle([...graph.slice(0, 3), graph[8]]), "4", "delete").verified,
    true,
  );
  const collateral = recycle([...graph.slice(0, 3), graph[8]]);
  collateral[2].text = "Changed";
  assert.equal(verifyGraphEdit(graph, collateral, "4", "delete").verified, false);
  assert.equal(verifyGraphEdit(graph, graph, "4", "delete").verified, false);
});
test("move up/down preserves subtree descendants and exact sibling order", () => {
  const moved = [...graph.slice(0, 2), ...graph.slice(3, 8), graph[2], graph[8]];
  assert.equal(verifyGraphEdit(graph, recycle(moved), "4", "up").verified, true);
  assert.equal(verifyGraphEdit(graph, recycle(moved), "3", "down").verified, true);
  const bad = moved.map((row) => ({ ...row }));
  bad[5].text = "Wait 8";
  assert.equal(verifyGraphEdit(graph, bad, "4", "up").verified, false);
  assert.throws(() => verifyGraphEdit(graph, graph, "3", "up"), /BOUNDARY/);
});
test("move in/out accepts one changed parent while preserving every other node", () => {
  const inside = [...graph.slice(0, 8), r(9, 6, 4, "Last")]; // insert before Else in valid preorder
  const reordered = [...graph.slice(0, 7), inside[8], graph[7]];
  const moved = verifyGraphEdit(graph, recycle(reordered), "9", "in");
  assert.equal(moved.verified, true);
  assert.deepEqual("movedPath" in moved && moved.movedPath, [1, 2, 2, 2]);
  assert.equal(verifyGraphEdit(reordered, recycle(graph), "9", "out").verified, true);
  const changed = reordered.map((row) => ({ ...row }));
  changed[2].text = "Collateral";
  assert.equal(verifyGraphEdit(graph, changed, "9", "in").verified, false);
});
test("source rebinding replaces exactly one expression subtree", () => {
  const before = [
    r(1, 0, 0, "Set Variable"),
    r(2, 1, 1, "Value: Arithmetic (Integer)"),
    r(3, 2, 2, "Value 1: 3"),
    r(4, 2, 2, "Value 2: 5"),
    r(5, 1, 1, "Other: 7"),
  ];
  const after = recycle([
    r(1, 0, 0, "Set Variable"),
    r(2, 1, 1, "Value: Round"),
    r(5, 1, 1, "Other: 7"),
  ]);
  assert.equal(verifyParameterRebind(before, after, "2").verified, true);
  const bad = after.map((row) => ({ ...row }));
  bad[2].text = "Other: 8";
  assert.equal(verifyParameterRebind(before, bad, "2").verified, false);
  assert.equal(verifyParameterRebind(before, bad, "2", true).verified, true);
});
test("binding input rejects ambiguous shapes and implicit dependent type resets", () => {
  const base = {
    archive: "A.SC2Map",
    windowId: "1",
    path: "MAIN/Start",
    section: "actions",
    itemIndex: 1,
    parameterIndex: 1,
    expectedDetailHash: "1",
    expectedParameterHash: "2",
  };
  assert.equal(triggerBindSchema.safeParse({ ...base, source: "value", value: 42 }).success, true);
  for (const change of [
    { source: "value", name: "Round" },
    { source: "variable", name: "Round", value: 42 },
    { source: "function", name: "Arithmetic (Real)", type: "Real" },
  ])
    assert.equal(triggerBindSchema.safeParse({ ...base, ...change }).success, false);
  assert.equal(
    triggerBindSchema.safeParse({
      ...base,
      source: "value",
      value: 4.5,
      type: "Real",
      allowTypeReset: true,
    }).success,
    true,
  );
});

let pid = 980000;
async function fixture(
  t: test.TestContext,
  options: { lostReply?: boolean; manual?: boolean; collateral?: boolean } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-graph-")),
    archive = path.join(root, "Current.SC2Map");
  await fs.writeFile(archive, "saved baseline");
  const w = {
    windowId: "123",
    processId: pid++,
    processStart: "80",
    title: `Triggers - [${archive}] - StarCraft II Editor`,
    enabled: true,
    acceptsFiles: true,
  };
  let params = [r(20, 0, 0, "Set Variable"), r(21, 20, 1, "Value: 30"), r(22, 20, 1, "Other: 7")];
  let detail = [
    r(3, 0, 0, "Start"),
    r(4, 3, 1, "Actions"),
    r(5, 4, 2, "Set Variable 30"),
    r(6, 4, 2, "Wait 1"),
  ];
  const left = [r(1, 0, 0, "MAIN"), r(2, 1, 1, "Start")];
  let revision = 40,
    parameterRevision = 50,
    commits = 0,
    cancels = 0,
    source = "",
    chosen = "",
    origin = "",
    dialog = "fresh";
  const calls: Array<{ op: number; args: any }> = [];
  const desktop = {
    windows: async () => [w],
    command: async (_w: unknown, op: number, args: any) => {
      calls.push({ op, args });
      if (op === 50)
        return {
          trees: [
            { id: 28, count: left.length, items: left, fingerprint: "30", truncated: false },
            {
              id: 134,
              count: detail.length,
              items: detail,
              fingerprint: String(revision),
              truncated: false,
            },
            {
              id: 468,
              count: params.length,
              items: params,
              fingerprint: String(parameterRevision),
              truncated: false,
            },
          ],
        };
      if (op === 55) return { selectionRequested: true };
      if (op === 51) {
        dialog = "fresh";
        return { status: "pending" };
      }
      if (op === 52)
        return {
          title: "Integer",
          fingerprint: dialog,
          initial: dialog,
          manualInput: !!options.manual,
          controls: [{ id: 15, type: "ComboBox", text: "Integer", enabled: false }],
        };
      if (op === 54) {
        cancels++;
        return { cancelRequested: true };
      }
      if (op === 59) {
        if (args.field === "source") source = args.value;
        else if (args.field === "choices")
          return {
            total: 1,
            items: [{ name: "Round = 0 <Integer>", origin: "Local", category: "" }],
          };
        else {
          chosen = args.value;
          origin = args.unit ?? "";
        }
        dialog += "x";
        return { optionsSet: true, name: chosen, origin };
      }
      if (op === 58) {
        commits++;
        assert.equal(args.value, chosen);
        assert.notEqual(chosen, "undefined");
        params = [
          r(20, 0, 0, "Set Variable"),
          r(21, 20, 1, "Value: " + chosen),
          r(22, 20, 1, options.collateral ? "Other: 8" : "Other: 7"),
        ];
        if (source === "function")
          params.splice(2, 0, r(23, 21, 2, "Minimum: 0"), r(24, 21, 2, "Maximum: 100"));
        detail[2].text = "Set Variable " + chosen;
        revision++;
        parameterRevision++;
        if (options.lostReply) throw Error("lost native response");
        return { submitted: true };
      }
      if (op === 68) {
        if (args.value === "cancel")
          return {
            submitted: true,
            phase: "cancelled",
            nativeTreeVerified: true,
            clipboardRestored: true,
          };
        if (args.value === "begin") {
          commits++;
          if (options.lostReply) throw Error("lost transfer acknowledgement");
          return { status: "pending", phase: "cut" };
        }
        if (args.value === "advance") {
          [detail[2], detail[3]] = [detail[3], detail[2]];
          revision++;
          return {
            submitted: true,
            phase: "pasted",
            clipboardRestored: true,
            nativeTreeVerified: true,
          };
        }
      }
      if (op === 67) {
        commits++;
        if (args.value === "delete") detail = detail.filter((row) => row.handle !== args.field);
        else if (args.value === "down") [detail[2], detail[3]] = [detail[3], detail[2]];
        revision++;
        if (options.lostReply) throw Error("lost graph response");
        return { submitted: true };
      }
      throw Error("Unexpected operation " + op);
    },
  };
  const live = new LiveTriggers(
    new Workspace(root),
    () => undefined,
    desktop,
    () => false,
    async () => {},
  );
  t.after(async () => {
    await live.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const target = {
    archive,
    windowId: "123",
    path: "MAIN/Start",
    section: "actions" as const,
    itemIndex: 1,
    expectedDetailHash: "40",
  };
  const parameter = { ...target, parameterIndex: 1, expectedParameterHash: "50" };
  return { live, target, parameter, calls, counts: () => ({ commits, cancels }), archive };
}
test("numeric rebinding forwards the value even when no name property exists", async (t) => {
  const f = await fixture(t);
  const result = await f.live.bind({ ...f.parameter, source: "value", value: 42 });
  assert.equal(result.status, "applied");
  assert.equal("nativeBindingVerified" in result && result.nativeBindingVerified, true);
  assert.equal(
    f.calls.find((call) => call.op === 59 && call.args.field === "binding_value")?.args.value,
    "42",
  );
  assert.equal(await fs.readFile(f.archive, "utf8"), "saved baseline");
});
test("variable origins and function defaults remain explicit", async (t) => {
  const f = await fixture(t);
  const result = await f.live.bind({
    ...f.parameter,
    source: "variable",
    name: "Round",
    origin: "Local",
  });
  assert.equal(result.status, "applied");
  assert.equal(f.calls.find((call) => call.op === 58)?.args.unit, "Local");
  const g = await fixture(t);
  const fn = await g.live.bind({
    ...g.parameter,
    source: "function",
    name: "Random Integer",
    origin: "Built-In",
  });
  assert.equal(fn.status, "needs_parameters");
  assert.equal("parametersVerified" in fn && fn.parametersVerified, false);
});
test("compatible binding catalog cancels the original chooser without committing", async (t) => {
  const f = await fixture(t);
  const result = await f.live.bindingOptions({ ...f.parameter, source: "variable" });
  assert.equal(result.status, "inspected");
  assert.deepEqual(f.counts(), { commits: 0, cancels: 1 });
});
test("stale parameter state and manual input never submit a binding", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.live.bind({ ...f.parameter, expectedParameterHash: "49", source: "value", value: 42 }),
    /CHANGED/,
  );
  assert.equal(
    f.calls.some((call) => call.op === 51),
    false,
  );
  const g = await fixture(t, { manual: true });
  const r = await g.live.bind({ ...g.parameter, source: "variable", name: "Round" });
  assert.equal(r.status, "stopped");
  assert.deepEqual(g.counts(), { commits: 0, cancels: 0 });
});
test("collateral parameter changes fail verification and lost commits are not replayed", async (t) => {
  const f = await fixture(t, { collateral: true });
  assert.equal(
    (await f.live.bind({ ...f.parameter, source: "value", value: 42 })).status,
    "verification_failed",
  );
  const g = await fixture(t, { lostReply: true });
  assert.equal(
    (await g.live.bind({ ...g.parameter, source: "value", value: 42 })).status,
    "unknown",
  );
  assert.equal(g.counts().commits, 1);
});
test("native block edits verify sibling preservation and reject move boundaries", async (t) => {
  const f = await fixture(t);
  const result = await f.live.editGraph({ ...f.target, operation: "delete" });
  assert.equal(result.status, "applied");
  const g = await fixture(t);
  const moved = await g.live.editGraph({ ...g.target, operation: "down" });
  assert.equal(moved.status, "applied");
  const h = await fixture(t);
  await assert.rejects(h.live.editGraph({ ...h.target, operation: "up" }), /BOUNDARY/);
  assert.equal(h.counts().commits, 0);
  const k = await fixture(t, { lostReply: true });
  assert.equal((await k.live.editGraph({ ...k.target, operation: "delete" })).status, "unknown");
  assert.equal(k.counts().commits, 1);
});
test("compact authoring routes binding and graph commands without a JSON plan", () => {
  const steps = compileAuthorScript(
    'live trigger.bind archive=Current.SC2Map windowId=123 path="MAIN/Start" section=actions groupPath=1/2 parameterPath=2 itemIndex=1 parameterIndex=1 expectedDetailHash=40 expectedParameterHash=50 source=variable name=Round origin=Local\nlive trigger.edit archive=Current.SC2Map windowId=123 path="MAIN/Start" section=actions itemIndex=2 expectedDetailHash=41 operation=up',
    "stage",
  );
  assert.deepEqual(
    steps.map((step) => step.tool),
    ["live.trigger.bind", "live.trigger.edit"],
  );
  assert.equal(steps[0].args.parameterPath, 2);
});

test("arbitrary branch transfer keeps all descendants and rejects a cyclic destination", () => {
  const moved = expectedGraphTransfer(graph, "9", "6", "7");
  const expected = [...graph.slice(0, 7), r(9, 6, 4, "Last"), graph[7]];
  assert.deepEqual(structuralTree(moved), structuralTree(expected));
  assert.throws(() => expectedGraphTransfer(graph, "4", "6", "7"), /CYCLIC/);
  const rootFirst = expectedGraphTransfer(graph, "9", "2", "2");
  assert.deepEqual(
    rootFirst.map((row) => row.text),
    ["Start", "Actions", "Last", ...graph.slice(2, 8).map((row) => row.text)],
  );
  assert.deepEqual(triggerChildPath.parse(2), [2]);
});

test("native transfer advances one Cut and verifies the expected complete destination graph", async (t) => {
  const f = await fixture(t);
  const result = await f.live.move({ ...f.target, afterIndex: 2 });
  assert.equal(result.status, "applied");
  assert.equal("clipboardRestored" in result && result.clipboardRestored, true);
  assert.equal(f.calls.filter((call) => call.op === 68 && call.args.value === "begin").length, 1);
  assert.equal(f.calls.filter((call) => call.op === 68 && call.args.value === "advance").length, 1);
  const g = await fixture(t, { lostReply: true });
  const lost = await g.live.move({ ...g.target, afterIndex: 2 });
  assert.equal(lost.status, "unknown");
  assert.equal("pendingId" in lost && typeof lost.pendingId, "string");
  assert.equal(g.calls.filter((call) => call.op === 68 && call.args.value === "begin").length, 1);
});

test("transfer recovery completes or cancels the same native token without another Cut", async (t) => {
  const f = await fixture(t, { lostReply: true });
  const lost = await f.live.move({ ...f.target, afterIndex: 2 });
  assert.equal(lost.status, "unknown");
  const pendingId = (lost as { pendingId: string }).pendingId;
  const result = await f.live.recoverMove({
    archive: f.target.archive,
    windowId: f.target.windowId,
    pendingId,
    action: "finish",
  });
  assert.equal(result.status, "applied");
  assert.equal(f.calls.filter((call) => call.op === 68 && call.args.value === "begin").length, 1);
  const g = await fixture(t, { lostReply: true });
  const other = await g.live.move({ ...g.target, afterIndex: 2 });
  const cancelled = await g.live.recoverMove({
    archive: g.target.archive,
    windowId: g.target.windowId,
    pendingId: (other as { pendingId: string }).pendingId,
    action: "cancel",
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(g.calls.filter((call) => call.op === 68 && call.args.value === "begin").length, 1);
});

test("native displayed binding names reject embedded control characters before invocation", () => {
  const base = {
    archive: "A.SC2Map",
    windowId: "1",
    path: "MAIN/Start",
    section: "actions",
    itemIndex: 1,
    parameterIndex: 1,
    expectedDetailHash: "1",
    expectedParameterHash: "2",
    source: "variable",
    name: "Round",
  };
  for (const key of ["name", "origin", "type"])
    assert.equal(
      triggerBindSchema.safeParse({ ...base, [key]: "Round\u0000Other", allowTypeReset: true })
        .success,
      false,
    );
});
