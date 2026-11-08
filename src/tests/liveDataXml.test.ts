import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import * as z from "zod/v4";
import { Workspace } from "../core/workspace.js";
import { LiveDataXml, dataXmlSignature } from "../modules/live/dataXml.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { registerDataTools } from "../modules/data/tools.js";
import { compileAuthorScript } from "../app/authoringScript.js";
import { runMcpBatch, type BatchTool } from "../app/mcpBatch.js";
import type { LiveRuntimeFactory } from "../modules/live/workspace.js";

const initial =
  '<Catalog><CUnit id="Hero"><LifeMax value="100"/><LifeStart value="100"/><UnknownManual value="kept"/></CUnit><CActorUnit id="HeroActor" unitName="Hero"><?token id="unitName" value="Hero"?></CActorUnit></Catalog>';
async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-data-test-"));
  const archive = path.join(root, "Current.SC2Map");
  await fs.writeFile(archive, "original map bytes");
  const window = {
    windowId: "444",
    processId: 999995,
    processStart: "823456789",
    title: `Data - [${archive}*] - StarCraft II Editor`,
    enabled: true,
    acceptsFiles: true,
  };
  const state = {
    source: initial,
    window,
    modified: true,
    lost: false,
    extraFile: false,
    closed: 0,
    blocked: false,
    writes: 0,
    preparations: 0,
    bootstrap: false,
    xmlControl: true,
    selected: true,
    selectionRequests: 0,
    manualAfterView: false,
  };
  const transfers: string[] = [];
  const location = (token: string, candidate = false) =>
    path.join(
      os.tmpdir(),
      "SC2EditorToolkit-live-data",
      token + (candidate ? ".candidate.xml" : ".xml"),
    );
  await fs.mkdir(path.dirname(location("unused")), { recursive: true });
  const factory: LiveRuntimeFactory = async (directory) => {
    const workspace = new Workspace(directory),
      data = new DataWorkspace(workspace),
      tools = new Map<string, BatchTool>();
    registerDataTools(
      {
        registerTool(
          name: string,
          config: { inputSchema: BatchTool["schema"] },
          invoke: BatchTool["invoke"],
        ) {
          tools.set(name, { schema: config.inputSchema, invoke });
        },
      } as never,
      { workspace: data },
    );
    tools.set("modkit.save", {
      schema: z.object({ file: z.string() }),
      invoke: async (a) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await workspace.save((a as { file: string }).file, { backup: false }),
            ),
          },
        ],
      }),
    });
    return {
      workspace,
      export: async () => {},
      call: async () => {},
      close: async () => {
        state.closed++;
      },
      authorData: async (script, file) => {
        state.preparations++;
        const result = await runMcpBatch(
          compileAuthorScript(script, "save", tools, undefined, { dataFile: file }),
          tools,
          {},
        );
        if (state.extraFile)
          await fs.writeFile(path.join(directory, "GameStrings.txt"), "unexpected change");
        return result;
      },
    };
  };
  const live = new LiveDataXml(
    new Workspace(root),
    () => factory,
    {
      windows: async () => [structuredClone(state.window)],
      window: async () => structuredClone(state.window),
      command: async (_w, op, args = {}) => {
        if (op === 40 && args.field === "status")
          return {
            xmlControl: state.xmlControl,
            selected: state.selected,
            mapLocal: true,
            readOnly: 0,
            modified: state.modified ? 1 : 0,
          };
        if (state.bootstrap && op === 1) return { prepared: true };
        if (state.bootstrap && op === 0) return { unitReady: true };
        if (state.bootstrap && op === 2) {
          state.selectionRequests++;
          state.selected = true;
          return { selectionRequested: true, source: path.basename(archive) };
        }
        if (state.bootstrap && op === 42) {
          state.xmlControl = true;
          state.selected = false;
          if (state.manualAfterView) {
            state.modified = true;
            state.source += "<!--manual-->";
          }
          return { xmlViewRequested: true };
        }
        if (op === 40 && args.field === "messages")
          return { sourceCoverage: "fake fixture only", windows: [] };
        if (op === 40) {
          const file = location(args.token!);
          transfers.push(file);
          await fs.writeFile(file, state.source, { flag: "wx" });
          return {
            snapshotExported: true,
            fingerprint: state.source,
            bytes: Buffer.byteLength(state.source),
            bufferModified: state.modified,
          };
        }
        assert.equal(op, 41);
        assert.equal(args.expected, state.source);
        const file = location(args.token!, true);
        transfers.push(file);
        state.source = await fs.readFile(file, "utf8");
        state.writes++;
        if (state.lost) throw Error("Commit acknowledgement lost");
        return { commitRequested: true };
      },
    },
    () => state.blocked,
    async () => {},
  );
  t.after(async () => {
    await live.close();
    for (const file of transfers) await fs.unlink(file).catch(() => {});
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const target = { archive, windowId: window.windowId, unit: "Hero" };
  return { root, archive, state, live, target };
}

test("live Data reuses existing recipe compiler and preserves pending manual XML in one native commit", async (t) => {
  const f = await fixture(t),
    read = await f.live.read(f.target);
  assert.equal(read.bufferModified, true);
  const result = await f.live.author({
    snapshotId: read.snapshotId,
    script: "data unit.configure id=Hero life=240",
    apply: true,
  });
  assert.equal(result.status, "applied");
  assert.equal(f.state.writes, 1);
  assert.match(f.state.source, /LifeMax value="240"/);
  assert.match(f.state.source, /UnknownManual value="kept"/);
  assert.match(f.state.source, /<\?token id="unitName" value="Hero"\?>/);
  assert.equal(await fs.readFile(f.archive, "utf8"), "original map bytes");
  assert.equal(f.state.closed, 1);
});

test("first XML View restores its cleared local selection before exporting a snapshot", async (t) => {
  const f = await fixture(t);
  Object.assign(f.state, { bootstrap: true, xmlControl: false, selected: false, modified: false });
  const result = await f.live.read(f.target);
  assert.equal(result.bufferModified, false);
  assert.equal(f.state.selectionRequests, 2);
  assert.equal(f.state.writes, 0);
  assert.equal(await fs.readFile(f.archive, "utf8"), "original map bytes");
});

test("manual XML appearing during view initialization prevents automatic reselection", async (t) => {
  const f = await fixture(t);
  Object.assign(f.state, {
    bootstrap: true, xmlControl: false, selected: false, modified: false, manualAfterView: true,
  });
  await assert.rejects(f.live.read(f.target), /PRESERVE_UNSELECTED_XML_BUFFER/);
  assert.equal(f.state.selectionRequests, 1);
  assert.match(f.state.source, /<!--manual-->/);
  assert.equal(f.state.writes, 0);
});
test("preparation never commits to Editor or consumes the live snapshot", async (t) => {
  const f = await fixture(t),
    read = await f.live.read(f.target);
  const result = await f.live.author({
    snapshotId: read.snapshotId,
    script: "data unit.configure id=Hero life=240",
  });
  assert.equal(result.status, "prepared");
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.source, initial);
  assert.equal(f.live.release(read.snapshotId).released, true);
});
test("manual XML edits after the snapshot refuse before native buffer replacement", async (t) => {
  const f = await fixture(t),
    read = await f.live.read(f.target);
  f.state.source = initial.replace('value="kept"', 'value="manual edit"');
  await assert.rejects(
    f.live.author({
      snapshotId: read.snapshotId,
      script: "data unit.configure id=Hero life=240",
      apply: true,
    }),
    /STALE_BUFFER/,
  );
  assert.equal(f.state.writes, 0);
  assert.match(f.state.source, /manual edit/);
});
test("changed archive and replaced process refuse before native Data writes", async (t) => {
  const f = await fixture(t),
    read = await f.live.read(f.target);
  await fs.writeFile(f.archive, "saved by another client");
  await assert.rejects(
    f.live.author({
      snapshotId: read.snapshotId,
      script: "data unit.configure id=Hero life=240",
      apply: true,
    }),
    /ARCHIVE_CHANGED/,
  );
  const next = await f.live.read(f.target);
  f.state.window.processStart = "different process";
  await assert.rejects(
    f.live.author({
      snapshotId: next.snapshotId,
      script: "data unit.configure id=Hero life=240",
      apply: true,
    }),
    /EXACT_DATA_WINDOW/,
  );
  assert.equal(f.state.writes, 0);
});
test("a lost native commit is unknown and cannot replay the consumed snapshot", async (t) => {
  const f = await fixture(t),
    read = await f.live.read(f.target);
  f.state.lost = true;
  const args = {
    snapshotId: read.snapshotId,
    script: "data unit.configure id=Hero life=240",
    apply: true,
  };
  const result = await f.live.author(args);
  assert.equal(result.status, "unknown");
  assert.equal(f.state.writes, 1);
  await assert.rejects(f.live.author(args), /SNAPSHOT_EXPIRED/);
  assert.equal(f.state.writes, 1);
});
test("additional prepared components refuse before applying a partial live Data batch", async (t) => {
  const f = await fixture(t),
    read = await f.live.read(f.target);
  f.state.extraFile = true;
  await assert.rejects(
    f.live.author({
      snapshotId: read.snapshotId,
      script: "data unit.configure id=Hero life=240",
      apply: true,
    }),
    /MULTI_COMPONENT/,
  );
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.closed, 1);
});
test("Data signature retains Actor tokens, array order and meaningful content", () => {
  assert.equal(
    dataXmlSignature(initial),
    dataXmlSignature(initial.replace('id="Hero"', 'id = "Hero"')),
  );
  assert.notEqual(
    dataXmlSignature(initial),
    dataXmlSignature(initial.replace('value="Hero"?>', 'value="Other"?>')),
  );
  assert.throws(() => dataXmlSignature("<Catalog><CUnit></Catalog>"), /INVALID_CATALOG/);
});
test("native catalog regrouping is equivalent without reordering fields or repeated entries", () => {
  const a =
    '<Catalog><CUnit id="A"><Flags value="1"/><Flags value="2"/></CUnit><CEffectDamage id="B"/></Catalog>';
  const reordered =
    '<Catalog><CEffectDamage id="B"/><CUnit id="A"><Flags value="1"/><Flags value="2"/></CUnit></Catalog>';
  assert.equal(dataXmlSignature(a), dataXmlSignature(reordered));
  assert.notEqual(
    dataXmlSignature(a),
    dataXmlSignature(
      a.replace('<Flags value="1"/><Flags value="2"/>', '<Flags value="2"/><Flags value="1"/>'),
    ),
  );
  const duplicate =
    '<Catalog><CUnit id="A"><LifeMax value="1"/></CUnit><CUnit id="A"><LifeMax value="2"/></CUnit></Catalog>';
  assert.notEqual(
    dataXmlSignature(duplicate),
    dataXmlSignature(duplicate.replace('value="1"', 'value="3"')),
  );
});
