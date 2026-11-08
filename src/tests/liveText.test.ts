import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as z from "zod/v4";
import { Workspace } from "../core/workspace.js";
import { LiveText } from "../modules/editorLive/text.js";
import { PendingText } from "../modules/editorLive/pendingText.js";
import {
  parseNativeLocale,
  nativeLocaleSignature,
  localeComponents,
  encodeNativeLocale,
} from "../modules/editorLive/nativeLocale.js";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";
import type { LiveRuntimeFactory } from "../modules/editorLive/runtime.js";
import { TextWorkspace } from "../modules/text/workspace.js";
import { TextSchemaRegistry } from "../modules/text/schemaRegistry.js";
import { registerTextTools } from "../modules/text/tools.js";
import { compileAuthorScript } from "../app/authoringScript.js";
import { runMcpBatch, type BatchTool } from "../app/mcpBatch.js";
import type { McpServer } from "@modelcontextprotocol/server";

test("native localization codec retains literal spaces, markup, locale tables and entry-order equivalence", () => {
  const source =
    "[LocalizedData/GameStrings.txt]Mission/Name=  Keep = this <n/>\r\n[LocalizedData/TriggerStrings.txt]Trigger/Name/X=Init\r\n";
  const encoded = encodeNativeLocale(localeComponents(source, "ruRU"), "ruRU");
  assert.equal(encoded, source);
  assert.equal(parseNativeLocale(source)[0].value, "  Keep = this <n/>");
  assert.equal(
    nativeLocaleSignature(source),
    nativeLocaleSignature(source.trimEnd().split("\r\n").reverse().join("\n")),
  );
  assert.throws(() => parseNativeLocale("[../GameStrings.txt]A=x"), /FORMAT/);
  assert.throws(
    () => parseNativeLocale(source + "[LocalizedData/GameStrings.txt]Mission/Name=another\n"),
    /DUPLICATE/,
  );
  assert.throws(() => parseNativeLocale("[LocalizedData/GameStrings.txt]A=\0"), /BOUND/);
});
test("compact Text scopes locale/table safely and permits verification without a mutation stage", () => {
  const steps = compileAuthorScript(
    "text set table=TriggerStrings key=Trigger/Name/X value=Init",
    "save",
    undefined,
    undefined,
    { textLocale: "ruRU" },
  );
  assert.equal(steps[0].tool, "text.apply");
  assert.deepEqual(steps[0].args.stringFiles, {
    ruRU: "ruRU.SC2Data/LocalizedData/TriggerStrings.txt",
  });
  assert.throws(
    () => compileAuthorScript("text set table=../Wrong key=X value=Init", "save"),
    /TEXT_SET_ARGS/,
  );
  const verify = compileAuthorScript(
    "live text.verify archive=Current.SC2Map windowId=3934182 locale=ruRU pendingId=11111111-1111-4111-8111-111111111111",
    "plan",
  );
  assert.equal(verify[0].tool, "live.text.verify");
  assert.equal(verify[0].args.windowId, "3934182");
  assert.throws(
    () =>
      compileAuthorScript(
        "live text.author snapshotId=11111111-1111-4111-8111-111111111111 script=change",
        "plan",
      ),
    /REQUIRES_STAGE/,
  );
});
async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-text-")),
    archive = path.join(root, "Current.SC2Map");
  await fs.writeFile(archive, "original archive bytes");
  const w = {
    windowId: "72",
    processId: 999992,
    processStart: "456",
    title: `Text - [${archive}*] - StarCraft II Editor`,
    enabled: true,
    acceptsFiles: true,
  };
  const state = {
    source:
      "[LocalizedData/GameStrings.txt]Mission/Name=Before\r\n[LocalizedData/GameStrings.txt]Manual=  keep spaces\r\n[LocalizedData/TriggerStrings.txt]Trigger/Name/ID=Init\r\n",
    imports: 0,
    buffered: "",
    lose: false,
    extra: false,
  };
  let dialog = "",
    mode = "",
    id = "",
    locale = "enUS";
  const transfers = new Set<string>();
  const transfer = (name: string) =>
    path.join(os.tmpdir(), "SC2EditorToolkit-live-components", name);
  const desktop: MemoryDesktop = {
    windows: async () => [w],
    command: async (_w, op, args = {}) => {
      if (op === 51) {
        id = args.unit!;
        mode = args.field!;
        if (mode === "locale.import") {
          transfers.add(transfer(id + ".txt"));
          transfers.add(transfer(`${id}_${locale}.txt`));
        }
        dialog = mode === "locale.export" ? "Export Localized Text" : "Import Localized Text";
        return { status: "pending" };
      }
      if (op === 52)
        return {
          title: dialog,
          fingerprint: "fresh",
          initial: "fresh",
          manualInput: false,
          controls:
            dialog === "Choose File"
              ? [{ id: 1, type: "Button", text: mode === "locale.export" ? "&Save" : "&Open" }]
              : [
                  { id: -1, type: "Static", text: id + ".txt" },
                  {
                    id: 14,
                    type: "SysTreeView32",
                    text: "",
                    tree: {
                      truncated: false,
                      items: [{ text: `Language <${locale}>`, stateImage: 2 }],
                    },
                  },
                  {
                    id: 15,
                    type: "Button",
                    text: "Include Text Which Only Displays In Editor",
                    checked: 1,
                  },
                ],
        };
      if (op === 59) {
        locale = args.field!;
        return { optionsSet: true };
      }
      if (op === 57) {
        dialog = "Choose File";
        return { browseRequested: true };
      }
      if (op === 53) {
        dialog = mode === "locale.export" ? "Export Localized Text" : "Import Localized Text";
        return { submitted: true };
      }
      if (op === 58) {
        if (mode === "locale.import") {
          state.imports++;
          const file = transfer(id + ".txt");
          transfers.add(file);
          state.buffered = await fs.readFile(file, "utf8");
          if (state.lose) throw Error("lost native import acknowledgement");
        } else {
          const file = transfer(`${id}_${locale}.txt`);
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, state.source, { flag: "wx" });
          transfers.add(file);
        }
        return { submitted: true };
      }
      if (op === 54) return { cancelRequested: true };
      throw Error("Unexpected native operation " + op);
    },
  };
  const factory: LiveRuntimeFactory = async (directory) => {
    const workspace = new Workspace(directory),
      text = new TextWorkspace(workspace, await TextSchemaRegistry.load()),
      tools = new Map<string, BatchTool>();
    const server = {
      registerTool(name: string, config: { inputSchema: z.ZodType }, invoke: BatchTool["invoke"]) {
        tools.set(name, { schema: config.inputSchema, invoke });
      },
    } as unknown as McpServer;
    registerTextTools(server, { workspace: text });
    tools.set("modkit.save", {
      schema: z.object({ file: z.string() }),
      invoke: async (args) =>
        workspace.save(z.object({ file: z.string() }).parse(args).file, { backup: false }),
    });
    return {
      workspace,
      call: async () => {
        throw Error("unused");
      },
      export: async () => {
        throw Error("Map export prohibited");
      },
      close: async () => {},
      authorText: async (script, locale) => {
        const steps = compileAuthorScript(script, "save", tools, undefined, { textLocale: locale });
        const result = await runMcpBatch(steps, tools, {});
        if (state.extra)
          await fs.writeFile(
            path.join(directory, "FontStyles.SC2Style"),
            "unapplied extra component",
          );
        return result;
      },
    };
  };
  const live = new LiveText(
      new Workspace(root),
      () => factory,
      desktop,
      () => false,
      async () => {},
    ),
    target = { archive, windowId: w.windowId, locale: "enUS", keys: ["Mission/Name"] };
  t.after(async () => {
    await live.close();
    const journal = new PendingText(),
      pending = await journal.read(w, archive);
    if (pending) await journal.release(w, archive, pending.id);
    for (const file of transfers) await fs.rm(file, { force: true });
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    live,
    state,
    target,
    archive,
    fork: () =>
      new LiveText(
        new Workspace(root),
        () => factory,
        desktop,
        () => false,
        async () => {},
      ),
    save: async () => {
      state.source = state.buffered;
      w.title = w.title.replace("*]", "]");
      await fs.writeFile(archive, "native saved bytes");
    },
  };
}
test("current Text author uses existing typed writer, preserves other tables/manual spaces and leaves archive unsaved", async (t) => {
  const f = await fixture(t),
    s = await f.live.read(f.target);
  assert.equal(s.values[0].value, "Before");
  const result = await f.live.author({
    snapshotId: s.snapshotId,
    script: `text set key=Mission/Name value="After <n/>"
text set table=TriggerStrings key=Trigger/Name/ID value=Initialize`,
    apply: true,
  });
  assert.equal(result.status, "import_submitted");
  assert.equal(f.state.imports, 1);
  assert.match(f.state.buffered, /Manual= {2}keep spaces/);
  assert.match(f.state.buffered, /Trigger\/Name\/ID=Initialize/);
  assert.equal(await fs.readFile(f.archive, "utf8"), "original archive bytes");
  await assert.rejects(f.live.read(f.target), /PENDING_SAVE_OR_VERIFY/);
  const peer = f.fork();
  t.after(() => peer.close());
  await assert.rejects(peer.read(f.target), /PENDING_SAVE_OR_VERIFY/);
  assert.ok("pendingId" in result);
  const pendingId = String(result.pendingId),
    verify = { archive: f.archive, windowId: f.target.windowId, locale: "enUS", pendingId };
  assert.equal((await peer.verify(verify)).status, "pending_save");
  await f.save();
  assert.equal((await peer.verify(verify)).status, "verified");
  const fresh = await peer.read(f.target);
  assert.equal(fresh.values[0].value, "After <n/>");
  assert.equal(f.state.imports, 1);
});
test("manual Text changes invalidate the snapshot before native import", async (t) => {
  const f = await fixture(t),
    s = await f.live.read(f.target);
  f.state.source = f.state.source.replace("Before", "Manual edit");
  await assert.rejects(
    f.live.author({
      snapshotId: s.snapshotId,
      script: "text set key=Mission/Name value=After",
      apply: true,
    }),
    /STALE_COMPONENT/,
  );
  assert.equal(f.state.imports, 0);
});
test("post-save manual conflicts remain a failed verification without replaying import", async (t) => {
  const f = await fixture(t),
    s = await f.live.read(f.target),
    a = await f.live.author({
      snapshotId: s.snapshotId,
      script: "text set key=Mission/Name value=After",
      apply: true,
    });
  assert.ok("pendingId" in a);
  await f.save();
  f.state.source = f.state.source.replace("=After", "=Human");
  const checked = await f.live.verify({
    archive: f.archive,
    windowId: f.target.windowId,
    locale: "enUS",
    pendingId: a.pendingId,
  });
  assert.equal(checked.status, "verification_failed");
  assert.equal(f.state.imports, 1);
  const current = await f.live.read(f.target);
  assert.equal(current.values[0].value, "Human");
});
test("uncertain Text import consumes its snapshot and never replays", async (t) => {
  const f = await fixture(t),
    s = await f.live.read(f.target);
  f.state.lose = true;
  const result = await f.live.author({
    snapshotId: s.snapshotId,
    script: "text set key=Mission/Name value=After",
    apply: true,
  });
  assert.equal(result.status, "unknown");
  assert.equal(f.state.imports, 1);
  await assert.rejects(
    f.live.author({
      snapshotId: s.snapshotId,
      script: "text set key=Mission/Name value=After",
      apply: true,
    }),
    /EXPIRED/,
  );
  assert.equal(f.state.imports, 1);
});
test("unsupported linked files and locale changes refuse before native import", async (t) => {
  const f = await fixture(t),
    s = await f.live.read(f.target);
  f.state.extra = true;
  await assert.rejects(
    f.live.author({
      snapshotId: s.snapshotId,
      script: "text set key=Mission/Name value=After",
      apply: true,
    }),
    /MULTI_COMPONENT/,
  );
  assert.equal(f.state.imports, 0);
  f.state.extra = false;
  await assert.rejects(
    f.live.author({
      snapshotId: s.snapshotId,
      script: "text set key=Mission/Name value=After locale=ruRU",
      apply: true,
    }),
    /LOCALE_SCOPE_MISMATCH/,
  );
  assert.equal(f.state.imports, 0);
});
