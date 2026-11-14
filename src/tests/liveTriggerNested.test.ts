import test from "node:test";
import { compileAuthorScript } from "../app/authoringScript.js";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { LiveTriggers, triggerAppendActionSchema } from "../modules/editorLive/triggers.js";
import {
  triggerChildPath,
  triggerAncestors,
  verifyTriggerInsertion,
  type TriggerTreeItem,
} from "../modules/editorLive/triggerPaths.js";
import { configureTrigger } from "../modules/editorLive/triggerConfigure.js";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";

let nextPid = 950000;
async function fixture(
  t: test.TestContext,
  options: {
    compound?: boolean;
    wrongBranch?: boolean;
    lostReply?: boolean;
    otherParameterChanged?: boolean;
  } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-nested-"));
  const archive = path.join(root, "Current.SC2Map");
  await fs.writeFile(archive, "original archive");
  const window = {
    windowId: "123",
    processId: nextPid++,
    processStart: "77",
    enabled: true,
    acceptsFiles: true,
    title: `Triggers - [${archive}] - StarCraft II Editor`,
  };
  const ai = {
    ...window,
    windowId: "124",
    title: `AI Assistant - [${archive}] - StarCraft II Editor`,
  };
  const row = (handle: number, parent: number, depth: number, text: string): TriggerTreeItem => ({
    handle: String(handle),
    parent: String(parent),
    depth,
    text,
  });
  const left = [row(1, 0, 0, "MAIN"), row(2, 1, 1, "Start")];
  const details = [
    row(3, 0, 0, "Start"),
    row(4, 3, 1, "Events"),
    row(5, 3, 1, "Conditions"),
    row(6, 3, 1, "Actions"),
    row(7, 6, 2, "General - If Then Else"),
    row(8, 7, 3, "If"),
    row(9, 7, 3, "Then"),
    row(10, 9, 4, "General - Existing Action"),
    row(11, 7, 3, "Else"),
  ];
  const parameters = [
    row(20, 0, 0, "Set Global Time Scale"),
    row(21, 20, 1, "Time Scale: 1 + 2"),
    row(22, 21, 2, "Value 1: 1"),
    row(23, 21, 2, "Value 2: 2"),
    row(24, 20, 1, "Other: 7"),
  ];
  let detailRevision = 40,
    parameterRevision = 50,
    mode = "",
    dialog = "initial",
    selectedDetail = "",
    selectedParameter = "",
    nativeName = "",
    calls = 0,
    commits = 0;
  const desktop: MemoryDesktop = {
    windows: async () => [window, ai],
    command: async (_w, op, args) => {
      if (op === 50)
        return {
          trees: [
            { id: 28, count: left.length, fingerprint: "30", truncated: false, items: left },
            {
              id: 134,
              count: details.length,
              fingerprint: String(detailRevision),
              truncated: false,
              items: details,
            },
            {
              id: 468,
              count: parameters.length,
              fingerprint: String(parameterRevision),
              truncated: false,
              items: parameters,
            },
          ],
        };
      if (op === 55) {
        if (args?.unit === "134") selectedDetail = args.field!;
        if (args?.unit === "468") selectedParameter = args.field!;
        return { selectionRequested: true };
      }
      if (op === 51) {
        calls++;
        mode = args!.field!;
        dialog = "initial";
        return { status: "pending" };
      }
      if (op === 52)
        return {
          title:
            mode === "trigger.real"
              ? "Integer"
              : mode === "trigger.condition"
                ? "Configure Condition"
                : "Action",
          fingerprint: dialog,
          initial: dialog,
          manualInput: false,
        };
      if (op === 59) {
        nativeName = args!.field!;
        dialog = "selected";
        return { optionsSet: true, category: "General" };
      }
      if (op === 58) {
        commits++;
        if (mode === "trigger.real") {
          assert.equal(selectedParameter, "22");
          parameters[2].text = "Value 1: " + args!.value;
          parameters[1].text = "Time Scale: " + args!.value + " + 2";
          details.find((item) => item.handle === selectedDetail)!.text = "General - Changed Action";
          if (options.otherParameterChanged) parameters[4].text = "Other: 9";
          parameterRevision++;
        } else {
          const selected = details.find((item) => item.handle === selectedDetail)!;
          const parent = ["Actions", "Conditions", "If", "Then", "Else"].includes(selected.text)
            ? selected
            : details.find((item) => item.handle === selected.parent)!;
          const target = options.wrongBranch
            ? details.find((item) => item.handle === "11")!
            : parent;
          const insertAfter = details.findIndex((item) => item.handle === target.handle);
          let end = insertAfter + 1;
          while (end < details.length && details[end].depth > target.depth) end++;
          const added = [
            row(100, Number(target.handle), target.depth + 1, "General - " + nativeName),
          ];
          if (options.compound)
            added.push(
              row(101, 100, target.depth + 2, "If"),
              row(102, 100, target.depth + 2, "Then"),
              row(103, 100, target.depth + 2, "Else"),
            );
          details.splice(end, 0, ...added);
        }
        detailRevision++;
        if (options.lostReply) throw Error("lost native acknowledgement");
        return { submitted: true };
      }
      if (op === 54) return { cancelRequested: true };
      throw Error("Unexpected native operation: " + op);
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
  const target = { archive, windowId: window.windowId, path: "MAIN/Start" };
  return { live, target, archive, calls: () => ({ calls, commits }), mode: () => mode };
}

test("nested branch discovery works from an open AI panel without changing the archive", async (t) => {
  const f = await fixture(t);
  const result = await f.live.details({
    ...f.target,
    windowId: "124",
    section: "actions",
    groupPath: "1/2",
  });
  assert.equal(result.windowId, "123");
  assert.deepEqual(result.items, [
    { index: 1, text: "General - Existing Action", hasChildren: false },
  ]);
  assert.equal(await fs.readFile(f.archive, "utf8"), "original archive");
});

test("compound built-ins are verified as one inserted subtree inside Then", async (t) => {
  const f = await fixture(t, { compound: true });
  const result = await f.live.appendAction({
    ...f.target,
    action: "builtin_default",
    actionName: "If Then Else",
    useDefaults: true,
    groupPath: [1, 2],
    expectedDetailHash: "40",
  });
  assert.equal(result.status, "needs_parameters");
  assert.equal("nativeTreeVerified" in result && result.nativeTreeVerified, true);
  assert.equal("itemIndex" in result && result.itemIndex, 2);
  const branch = await f.live.details({
    ...f.target,
    groupPath: "1/2/2",
    expectedDetailHash: "41",
  });
  assert.deepEqual(
    branch.items.map((item) => item.text),
    ["If", "Then", "Else"],
  );
});

test("stale nested insertion and non-container targets refuse before a native picker opens", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.live.appendAction({
      ...f.target,
      action: "skip_remaining",
      groupPath: [1, 2],
      expectedDetailHash: "39",
    }),
    /DETAIL_CHANGED/,
  );
  await assert.rejects(
    f.live.appendAction({
      ...f.target,
      action: "skip_remaining",
      groupPath: [1],
      expectedDetailHash: "40",
    }),
    /NOT_SUPPORTED_CONTAINER/,
  );
  assert.deepEqual(f.calls(), { calls: 0, commits: 0 });
});

test("an insertion under another branch is not accepted or replayed", async (t) => {
  const f = await fixture(t, { wrongBranch: true });
  const result = await f.live.appendAction({
    ...f.target,
    action: "skip_remaining",
    groupPath: [1, 2],
    expectedDetailHash: "40",
  });
  assert.equal(result.status, "verification_failed");
  assert.deepEqual(f.calls(), { calls: 1, commits: 1 });
});

test("conditions use original New Condition for both root and nested condition groups", async (t) => {
  for (const nested of [false, true]) {
    const f = await fixture(t);
    const result = await f.live.appendCondition({
      ...f.target,
      conditionName: "Comparison",
      useDefaults: true,
      ...(nested
        ? ({ section: "actions", groupPath: "1/1", expectedDetailHash: "40" } as const)
        : {}),
    });
    assert.equal(result.status, "needs_parameters");
    assert.equal(f.mode(), "trigger.condition");
    assert.equal("createdCondition" in result && result.createdCondition, true);
  }
});

test("nested function parameters are discoverable and a literal edit preserves sibling values", async (t) => {
  const f = await fixture(t);
  const input = {
    ...f.target,
    section: "actions" as const,
    groupPath: "1/2",
    itemIndex: 1,
    expectedDetailHash: "40",
    parameterPath: "1",
  };
  const found = await f.live.parameters(input);
  assert.deepEqual(
    found.parameters.map((row) => row.text),
    ["Value 1: 1", "Value 2: 2"],
  );
  const result = await f.live.setInteger({
    ...input,
    parameterIndex: 1,
    expectedParameterHash: "50",
    value: 8,
  });
  assert.equal(result.status, "applied");
  assert.equal(result.parameterVerified, true);
  assert.deepEqual(f.calls(), { calls: 1, commits: 1 });
});

test("a collateral parameter change is detected even if the requested literal matches", async (t) => {
  const f = await fixture(t, { otherParameterChanged: true });
  const result = await f.live.setInteger({
    ...f.target,
    section: "actions",
    groupPath: "1/2",
    itemIndex: 1,
    expectedDetailHash: "40",
    parameterPath: "1",
    parameterIndex: 1,
    expectedParameterHash: "50",
    value: 8,
  });
  assert.equal(result.status, "verification_failed");
  assert.equal(result.parameterVerified, false);
});

test("configured edits retain nested group and parameter selectors", async (t) => {
  const f = await fixture(t);
  const result = await configureTrigger(f.live, {
    ...f.target,
    section: "actions",
    groupPath: "1/2",
    itemIndex: 1,
    expectedDetailHash: "40",
    parameterPath: "1",
    edits: "integer:Value 1=8",
  });
  assert.equal(result.status, "needs_parameters");
  assert.deepEqual(result.completed, [{ parameter: "Value 1", kind: "integer" }]);
});

test("uncertain nested commits never replay an insertion", async (t) => {
  const f = await fixture(t, { lostReply: true });
  const result = await f.live.appendAction({
    ...f.target,
    action: "skip_remaining",
    groupPath: [1, 2],
    expectedDetailHash: "40",
  });
  assert.equal(result.status, "unknown");
  assert.deepEqual(f.calls(), { calls: 1, commits: 1 });
});

test("compact paths and ancestry reject invalid, excessive and cyclic selectors", () => {
  assert.deepEqual(triggerChildPath.parse("1/2/3"), [1, 2, 3]);
  for (const value of ["0", "1/0", "1//2", "1/8193", new Array(17).fill(1)])
    assert.equal(triggerChildPath.safeParse(value).success, false);
  assert.equal(
    triggerAppendActionSchema.safeParse({
      archive: "a",
      windowId: "1",
      path: "A",
      action: "skip_remaining",
      groupPath: "1/2",
    }).success,
    false,
  );
  assert.throws(
    () => triggerAncestors([{ handle: "1", parent: "1", depth: 1, text: "loop" }], "1"),
    /ANCESTRY/,
  );
});

test("native condition rebuilds can recycle every handle without losing structural verification", () => {
  const row = (handle: string, parent: string, depth: number, text: string) => ({
    handle,
    parent,
    depth,
    text,
  });
  const before = [
    row("1", "0", 0, "Start"),
    row("2", "1", 1, "Actions"),
    row("3", "2", 2, "If Then Else"),
    row("4", "3", 3, "If"),
    row("5", "3", 3, "Then"),
    row("6", "5", 4, "Wait 1"),
    row("7", "3", 3, "Else"),
  ];
  // Reuse old IDs for unrelated rows, exactly as the real Editor does.
  const after = [
    row("6", "0", 0, "Start"),
    row("5", "6", 1, "Actions"),
    row("4", "5", 2, "If Then Else"),
    row("3", "4", 3, "If"),
    row("9", "3", 4, "1 == 1"),
    row("2", "4", 3, "Then"),
    row("1", "2", 4, "Wait 1"),
    row("8", "4", 3, "Else"),
  ];
  assert.equal(verifyTriggerInsertion(before, after, "4")?.handle, "9");
  const changedSibling = after.map((item) => ({ ...item }));
  changedSibling[6].text = "Wait 8";
  assert.equal(verifyTriggerInsertion(before, changedSibling, "4"), undefined);
  assert.equal(verifyTriggerInsertion(before, after, "7"), undefined);
  const moved = after.map((item) => ({ ...item }));
  moved[4].parent = "8";
  assert.throws(() => verifyTriggerInsertion(before, moved, "4"), /ANCESTRY/);
});

test("native compound verification rejects sibling reordering and collateral inserts", () => {
  const before = [
    { handle: "1", parent: "0", depth: 0, text: "Actions" },
    { handle: "2", parent: "1", depth: 1, text: "A" },
    { handle: "3", parent: "1", depth: 1, text: "B" },
  ];
  const added = { handle: "4", parent: "1", depth: 1, text: "C" };
  assert.equal(verifyTriggerInsertion(before, [...before, added], "1")?.text, "C");
  assert.equal(
    verifyTriggerInsertion(before, [before[0], before[2], before[1], added], "1"),
    undefined,
  );
  assert.equal(
    verifyTriggerInsertion(before, [...before, added, { ...added, handle: "5" }], "1"),
    undefined,
  );
});

test("compact commands retain nested selectors and route native condition creation", () => {
  const steps = compileAuthorScript(
    'live trigger.append_condition archive=Current.SC2Map windowId=123 path="MAIN/Start" section=actions groupPath=1/1 expectedDetailHash=40 conditionName=Comparison useDefaults=true',
    "stage",
  );
  assert.equal(steps[0].tool, "live.trigger.append_condition");
  assert.equal(steps[0].args.groupPath, "1/1");
  const edit = compileAuthorScript(
    'live trigger.set_integer archive=Current.SC2Map windowId=123 path="MAIN/Start" section=actions groupPath=1/2 parameterPath=2/3 itemIndex=1 parameterIndex=1 expectedDetailHash=40 expectedParameterHash=50 value=42',
    "stage",
  );
  assert.equal(edit[0].args.parameterPath, "2/3");
});
