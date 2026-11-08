import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { LiveTriggers } from "../modules/editorLive/triggers.js";
import { ComponentTransfer } from "../modules/editorLive/componentTransfer.js";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";
import type { LiveRuntimeFactory } from "../modules/editorLive/runtime.js";

test("a library dialog still initializing is observed without replaying its import command", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-library-modal-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls: number[] = [];
  const window = {
    windowId: "12",
    processId: 999992,
    processStart: "555",
    title: "Triggers - [Current.SC2Map] - StarCraft II Editor",
    enabled: true,
    acceptsFiles: true,
  };
  let observations = 0;
  const desktop: MemoryDesktop = {
    windows: async () => [window],
    componentDirectory: async () => root,
    command: async (_window, op) => {
      calls.push(op);
      if (op === 51) {
        window.enabled = false;
        return { status: "pending" };
      }
      if (op === 52) {
        if (++observations < 3) throw Error("LIVE_COMPONENT_DIALOG_NOT_READY");
        return {
          fingerprint: "owned",
          initial: "owned",
          manualInput: false,
          controls: [{ id: 1, type: "Button", text: "&Open" }],
        };
      }
      if (op === 53) {
        window.enabled = true;
        return { submitted: true };
      }
      throw Error("Unexpected native command " + op);
    },
  };
  const result = await new ComponentTransfer(desktop, async () => {}).library(
    window,
    "<TriggerData><Name>System</Name><Root/></TriggerData>",
  );
  assert.equal(result.submitted, true);
  assert.deepEqual(calls, [51, 52, 52, 52, 53]);
});

async function fixture(t: { after(fn: () => Promise<unknown>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-gui-"));
  const archive = path.join(root, "User.SC2Map");
  await fs.writeFile(archive, "same current archive");
  await fs.writeFile(
    path.join(root, "plan.json"),
    JSON.stringify({ create: { identifier: "Start" } }),
  );
  const window = {
    windowId: "123",
    processId: 44,
    processStart: "55",
    enabled: true,
    acceptsFiles: true,
    title: `Triggers - [${archive}] - StarCraft II Editor`,
  };
  const transfers: string[] = [],
    calls: number[] = [];
  let fingerprint = "original";
  const desktop: MemoryDesktop = {
    windows: async () => [window],
    command: async (_w, op, args) => {
      calls.push(op);
      if (op === 50)
        return {
          trees: [
            {
              id: 28,
              count: 1,
              fingerprint,
              truncated: false,
              items: [{ handle: "1", text: "MAIN" }],
            },
          ],
        };
      if (op === 51) {
        transfers.push(
          path.join(os.tmpdir(), "SC2EditorToolkit-live-components", args!.unit + ".SC2Lib"),
        );
        throw Error("lost native import acknowledgement");
      }
      throw Error("unexpected native command " + op);
    },
  };
  const factory: LiveRuntimeFactory = async (componentRoot) => ({
    workspace: new Workspace(componentRoot),
    call: async (tool) => {
      if (tool === "trigger.apply") {
        await fs.writeFile(
          path.join(componentRoot, "Triggers"),
          '<TriggerData><Root><Item Type="Trigger" Id="00000001"/></Root><Element Type="Trigger" Id="00000001"><Identifier>Start</Identifier></Element></TriggerData>',
        );
        await fs.writeFile(
          path.join(componentRoot, "enUS.SC2Data/LocalizedData/TriggerStrings.txt"),
          "Trigger/Name/00000001=Start\n",
        );
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ planId: "generated", saved: tool === "trigger.save" }),
          },
        ],
      };
    },
    export: async () => {
      throw Error("map export forbidden");
    },
    close: async () => {},
  });
  const live = new LiveTriggers(new Workspace(root), () => factory, desktop);
  t.after(async () => {
    await live.close();
    for (const file of transfers) await fs.rm(file, { force: true });
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    live,
    root,
    archive,
    calls,
    changeRoots: () => {
      fingerprint = "changed";
    },
    target: { archive, windowId: "123" },
  };
}

test("a changed native root snapshot refuses before import and never writes the map archive", async (t) => {
  const f = await fixture(t);
  const prepared = await f.live.prepare({ ...f.target, name: "System", planFile: "plan.json" });
  f.changeRoots();
  await assert.rejects(f.live.apply(prepared.planId), /PLAN_STALE/);
  assert.equal(f.calls.includes(51), false);
  assert.equal(await fs.readFile(f.archive, "utf8"), "same current archive");
});

test("lost native import acknowledgement consumes the plan; recovery cannot replay it", async (t) => {
  const f = await fixture(t);
  const prepared = await f.live.prepare({ ...f.target, name: "System", planFile: "plan.json" });
  const result = await f.live.apply(prepared.planId);
  assert.equal(result.status, "unknown");
  assert.equal(result.retryMutation, false);
  await assert.rejects(f.live.apply(prepared.planId), /PLAN_EXPIRED/);
  assert.equal(f.calls.filter((op) => op === 51).length, 1);
  assert.equal(await fs.readFile(f.archive, "utf8"), "same current archive");
});
