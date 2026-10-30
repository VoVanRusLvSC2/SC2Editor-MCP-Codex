import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as z from "zod/v4";
import { compileAuthorScript } from "../app/authoringScript.js";
import { coalesceAuthoringSteps } from "../app/authoringGroups.js";
import { runMcpBatch, type BatchTool, type BatchStep } from "../app/mcpBatch.js";
import { Workspace } from "../core/workspace.js";
import { TextWorkspace } from "../modules/text/workspace.js";
import { TextSchemaRegistry } from "../modules/text/schemaRegistry.js";
import { StringTableDocument } from "../modules/text/stringTable.js";
import { registerTextTools } from "../modules/text/tools.js";
import { registerSettingsTools } from "../modules/settings/tools.js";
import { SettingsWorkspace } from "../modules/settings/workspace.js";
import { PlayersDocument } from "../modules/settings/players.js";
import { createMapInfo } from "../modules/document/codecs/mapInfoFactory.js";
import { registerTerrainTools } from "../modules/terrain/tools.js";
import { registerPlacementTools } from "../modules/placement/tools.js";

function registry() {
  const tools = new Map<string, BatchTool>();
  const calls: Array<{ tool: string; args: any }> = [];
  const server = {
    registerTool(name: string, config: any, callback: any) {
      tools.set(name, {
        schema: config.inputSchema,
        invoke: async (args, context) => {
          calls.push({ tool: name, args });
          return callback(args, context);
        },
      });
    },
  } as any;
  return { tools, calls, server };
}

test("many text commands use one guarded apply/save and a later invalid value leaves no earlier partial save", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "author-text-groups-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = new Workspace(root),
    f = registry(),
    text = new TextWorkspace(workspace, await TextSchemaRegistry.load());
  registerTextTools(f.server, { workspace: text, schema: text.schema } as any);
  f.tools.set("modkit.save", {
    schema: z.object({ file: z.string() }),
    invoke: async (args) => {
      f.calls.push({ tool: "modkit.save", args });
      return workspace.save((args as any).file, { backup: false });
    },
  });
  const source = Array.from(
    { length: 200 },
    (_, i) => `text set key=Test/${i} value=Value${i}`,
  ).join("\n");
  let receipt: any;
  const steps = compileAuthorScript(source, "save", f.tools, (value) => {
    receipt = value;
  });
  assert.deepEqual(
    [receipt.commands, receipt.expandedCalls, receipt.groupedCalls, receipt.avoidedCalls],
    [200, 400, 2, 398],
  );
  assert.deepEqual(receipt.validationTools, ["text.apply"]);
  assert.deepEqual(
    steps.map((s) => s.tool),
    ["text.apply", "modkit.save"],
  );
  assert.equal((steps[0].args.operations as any[]).length, 200);
  assert.equal((await runMcpBatch(steps, f.tools, {})).ok, true);
  const file = path.join(root, "enUS.SC2Data/LocalizedData/GameStrings.txt"),
    before = await fs.readFile(file, "utf8");
  assert.equal(new StringTableDocument(before).list(undefined, 1000).length, 200);
  const bad = compileAuthorScript(
    'text set key=First value=okay\ntext set key=Second value="bad\\nline"',
    "save",
    f.tools,
  );
  // A real embedded newline is rejected inside the grouped candidate.
  (bad[0].args.operations as any[])[1].value = "bad\nline";
  assert.equal((await runMcpBatch(bad, f.tools, {})).ok, false);
  assert.equal(await fs.readFile(file, "utf8"), before);
  assert.deepEqual(workspace.draftFiles(), []);
});

test("settings, terrain and mixed placements coalesce original schema-checked lifecycle groups", async () => {
  const f = registry();
  let ids = 0;
  const fake = new Proxy(
    {},
    {
      get: () => async () => ({
        id: "p" + ++ids,
        transactionId: "t" + ids,
        accepted: true,
      }),
    },
  ) as any;
  registerSettingsTools(f.server, fake);
  registerTerrainTools(f.server, { workspace: fake });
  registerPlacementTools(f.server, { workspace: fake });
  f.tools.set("modkit.save", {
    schema: z.object({ file: z.string() }),
    invoke: async () => ({ accepted: true }),
  });
  for (const [source, expected, target, array] of [
    [
      "settings player id=1 control=User\nsettings player id=2 control=Computer",
      ["settings.plan", "settings.apply", "settings.save"],
      "settings.plan",
      "operations",
    ],
    [
      "terrain paint texture=Dirt at=3,4 radius=2\nterrain blend texture=Grass at=3,4 radius=2",
      ["terrain.plan", "terrain.apply", "terrain.save"],
      "terrain.plan",
      "operations",
    ],
    [
      "objects unit id=Marine at=3,4 player=1\nobjects doodad id=Tree at=5,6",
      ["placement.addBatch", "placement.apply", "modkit.save"],
      "placement.addBatch",
      "objects",
    ],
  ] as const) {
    const steps = compileAuthorScript(source, "save", f.tools);
    assert.deepEqual(
      steps.map((s) => s.tool),
      [...expected],
    );
    assert.equal((steps[0].args[array] as any[]).length, 2);
    assert.equal(steps[0].tool, target);
    assert.equal((await runMcpBatch(steps, f.tools, {})).ok, true);
  }
  const terrain = f.calls.find((c) => c.tool === "terrain.plan")!;
  assert.deepEqual(
    terrain.args.operations.map((o: any) => o.op),
    ["texture.paint", "texture.blend"],
  );
  const placement = f.calls.find((c) => c.tool === "placement.addBatch")!;
  assert.equal(placement.args.objects[0].owner, 1);
  assert.deepEqual(
    placement.args.objects.map((o: any) => o.kind),
    ["Unit", "Doodad"],
  );
});

test("single and grouped settings aliases save a real native candidate using its returned id", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "author-settings-save-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "MapInfo"), createMapInfo(32, 32, "Test", 8, 1));
  const workspace = new Workspace(root),
    f = registry();
  registerSettingsTools(f.server, new SettingsWorkspace(workspace));
  for (const source of [
    "settings player.set id=1 color=1",
    "settings player.set id=1 color=2\nsettings player.set id=15 color=5",
  ]) {
    const result = await runMcpBatch(compileAuthorScript(source, "save", f.tools), f.tools, {});
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(workspace.draftFiles(), []);
  }
  const players = new PlayersDocument(await fs.readFile(path.join(root, "MapInfo")));
  assert.equal(players.players.find((p) => p.id === 1)?.color, 2);
  assert.equal(players.players.find((p) => p.id === 15)?.color, 5);
});

test("group budgets split candidates and custom placement files keep their own save target", () => {
  const f = registry(),
    fake = {} as any;
  registerSettingsTools(f.server, fake);
  registerPlacementTools(f.server, { workspace: fake });
  f.tools.set("modkit.save", {
    schema: z.object({ file: z.string() }),
    invoke: async () => ({ accepted: true }),
  });
  const source = Array.from({ length: 101 }, (_, i) => `settings player id=1 color=${i % 16}`).join(
    "\n",
  );
  const settings = compileAuthorScript(source, "plan", f.tools);
  assert.deepEqual(
    settings.map((step) => (step.args.operations as unknown[]).length),
    [100, 1],
  );
  const placements = compileAuthorScript(
    "objects unit id=Marine at=3,4 objectFile=CustomObjects\nobjects doodad id=Tree at=5,6 objectFile=CustomObjects",
    "save",
    f.tools,
  );
  assert.deepEqual(
    placements.map((step) => step.tool),
    ["placement.addBatch", "placement.apply", "modkit.save"],
  );
  assert.equal(placements.at(-1)!.args.file, "CustomObjects");
});

test("reads, explicit selections, advanced guards, result consumers and placement sampling preserve boundaries", () => {
  const f = registry();
  const fake = {} as any;
  registerPlacementTools(f.server, { workspace: fake });
  const step = (id: string, args: any): BatchStep => ({
    id,
    tool: "placement.addUnit",
    args: { id: "Marine", position: { x: 1, y: 2, z: 0 }, ...args },
  });
  for (const pair of [
    [step("a", {}), step("b", { count: 2, layout: { type: "line", spacing: 1 } })],
    [step("a", {}), step("b", { objectFile: "OtherObjects" })],
  ])
    assert.deepEqual(coalesceAuthoringSteps(pair, "plan", f.tools), pair);
  const consumer: BatchStep = { id: "consumer", tool: "read", args: { value: { $from: "b.id" } } };
  const referenced = [step("a", {}), step("b", {}), consumer];
  assert.deepEqual(coalesceAuthoringSteps(referenced, "plan", f.tools), referenced);
  const selected = [{ ...step("a", {}), select: ["id"] }, step("b", {})];
  assert.deepEqual(coalesceAuthoringSteps(selected, "plan", f.tools), selected);
  const read = [step("a", {}), consumer, step("b", {})];
  assert.deepEqual(coalesceAuthoringSteps(read, "plan", f.tools), read);
});

test("batched string sets match sequential bytes including duplicate keys, whitespace accumulation and append order", () => {
  for (const nl of ["\n", "\r\n"])
    for (const trailing of ["", nl]) {
      const source = `\uFEFF// keep${nl}A= old${nl}A=duplicate${nl}B = value${nl}Unknown line${trailing}`;
      const changes = Array.from({ length: 200 }, (_, i) => ({
        key: i % 5 === 0 ? "A" : i % 7 === 0 ? "B" : "New/" + (i % 19),
        value: (i % 3 === 0 ? " \t" : "") + "V" + i,
      }));
      const plain = new StringTableDocument(source),
        batched = new StringTableDocument(source);
      for (const c of changes) plain.set(c.key, c.value);
      batched.setMany(changes);
      assert.equal(batched.source, plain.source);
      assert.deepEqual(batched.list(undefined, 1000), plain.list(undefined, 1000));
      batched.remove("A");
      plain.remove("A");
      assert.deepEqual(batched.get("A"), plain.get("A"));
    }
  for (const key of [" odd ", "#comment", "//comment", "odd\u2028key"]) {
    const changes = [
        { key, value: "one" },
        { key, value: "two" },
      ],
      plain = new StringTableDocument(""),
      batched = new StringTableDocument("");
    for (const c of changes) plain.set(c.key, c.value);
    batched.setMany(changes);
    assert.equal(batched.source, plain.source);
  }
});
