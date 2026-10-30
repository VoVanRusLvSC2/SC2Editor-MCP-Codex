import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as z from "zod/v4";
import { Workspace } from "../core/workspace.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { registerDataTools } from "../modules/data/tools.js";
import { DataDocument } from "../modules/data/document.js";
import { compileAuthorScript } from "../app/authoringScript.js";
import { runMcpBatch, type BatchTool } from "../app/mcpBatch.js";
import { spellRecipeSchema } from "../modules/data/spellRecipe.js";
import { expandSpellRecipe } from "../modules/data/spellRecipe.js";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const file = "Base.SC2Data/GameData/RecipeTest.xml";
const original = `<Catalog>
<CUnit id="Marine"><LifeMax value="45"/><LifeStart value="45"/><Speed value="2.25"/></CUnit>
<CActorUnit default="1" id="GenericUnitBase"><?token id="unitName" type="CUnitLink" value=""?><On index="0" Terms="UnitBirth.##unitName##" Send="Create"/></CActorUnit>
<CActorUnit id="Marine" parent="GenericUnitBase" unitName="Marine"><Model value="Marine"/><WalkAnimMoveSpeed value="2.25"/><On index="1" Terms="UnitDeath.Marine" Send="Destroy"/><On index="2" Terms="WeaponStart.*.AttackStart" Send="AnimBracketStart Attack Attack"/></CActorUnit>
<CModel id="Marine"><Model value="Assets/Units/Terran/Marine/Marine.m3"/></CModel>
<CModel id="Impact"><Model value="Assets/Effects/Impact.m3"/></CModel>
<CModel id="Warning"><Model value="Assets/Effects/Warning.m3"/></CModel>
<CButton id="Face"/>
<CAbilEffectInstant id="Stimpack"/>
<CAbilEffectTarget id="EMP"/>
<CAbilEffectTarget id="Snipe"/>
<CActorModel id="ModelAnimationStyleOneShotNoOrphan" default="1"/>
<CActorModel id="ModelAnimationStyleContinuous" default="1"/>
<CActor id="SOpShadow"/>
<CActor id="SOpAttachCenter"/>
</Catalog>`;

async function fixture(t: test.TestContext, beforeCleanup?: () => Promise<void> | void) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-high-level-"));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  t.after(async () => {
    await beforeCleanup?.();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), original);
  await fs.writeFile(
    path.join(root, "Base.SC2Data/GameData.xml"),
    '<Includes><Catalog path="GameData/RecipeTest.xml"/></Includes>',
  );
  await fs.mkdir(path.join(root, "enUS.SC2Data/LocalizedData"), { recursive: true });
  await fs.writeFile(
    path.join(root, "enUS.SC2Data/LocalizedData/GameStrings.txt"),
    "Unit/Name/Marine=Marine\n",
  );
  const workspace = new Workspace(root),
    data = new DataWorkspace(workspace),
    tools = new Map<string, BatchTool>();
  const calls: string[] = [];
  registerDataTools(
    {
      registerTool(
        name: string,
        config: { inputSchema: BatchTool["schema"] },
        callback: (args: unknown) => Promise<unknown>,
      ) {
        tools.set(name, {
          schema: config.inputSchema,
          invoke: async (args) => {
            calls.push(name);
            return callback(args);
          },
        });
      },
    } as never,
    { workspace: data },
  );
  tools.set("modkit.save", {
    schema: z.object({ file: z.string() }),
    invoke: async (args) => {
      calls.push("modkit.save");
      const result = await workspace.save((args as { file: string }).file, { backup: false });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  });
  return { root, workspace, data, tools, calls };
}
const command = (body: string) => `data spell file=${file} ${body} model=Impact face=Face`;

test("compound spell groups respect expanded operation budgets before execution", async (t) => {
  const f = await fixture(t),
    source = Array.from({ length: 150 }, (_, i) =>
      command(`id=Spell${i} kind=damage damage=3`),
    ).join("\n");
  const steps = compileAuthorScript(source, "save", f.tools);
  assert.deepEqual(
    steps.map((step) => step.tool),
    ["data.apply", "modkit.save", "data.apply", "modkit.save"],
  );
  const groups = steps
    .filter((step) => step.tool === "data.apply")
    .map(
      (step) =>
        step.args.operations as Array<{ op: string } & Parameters<typeof expandSpellRecipe>[0]>,
    );
  assert.deepEqual(
    groups.map((group) => group.length),
    [125, 25],
  );
  assert.deepEqual(
    groups.map((group) =>
      group.reduce(
        (sum, { op, ...recipe }) =>
          sum + (op === "recipe.spell" ? expandSpellRecipe(recipe).length : 1),
        0,
      ),
    ),
    [500, 100],
  );
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.workspace.draftFiles(), []);
});

test("compact configure commands tune a saved graph together while preserving manual Actor and spell fields", async (t) => {
  const f = await fixture(t);
  const create = [
    `data unit file=${file} id=Hero from=Marine life=600`,
    command("id=Burn kind=burn damage=2 duration=180 period=1 unit=Hero slot=10"),
  ].join("\n");
  const created = await runMcpBatch(compileAuthorScript(create, "save", f.tools), f.tools, {});
  assert.equal(created.ok, true, JSON.stringify(created));
  const before = await fs.readFile(path.join(f.root, file), "utf8");
  const source = before
    .replace('<Amount value="2"/>', '<Amount value="2"/>\n<!-- manual damage annotation -->')
    .replace(
      'id="Hero" parent="GenericUnitBase"',
      'id="Hero" parent="GenericUnitBase" Manual="keep"',
    );
  await fs.writeFile(path.join(f.root, file), source);
  f.calls.length = 0;
  const steps = compileAuthorScript(
    `data unit.configure file=${file} id=Hero life=800 speed=3 scale=1.4\ndata spell.configure file=${file} id=Burn damage=3 energy=20 cooldown=8 duration=240 period=2`,
    "save",
    f.tools,
  );
  assert.deepEqual(
    steps.map((s) => s.tool),
    ["data.apply", "modkit.save"],
  );
  const tuned = await runMcpBatch(steps, f.tools, {});
  assert.equal(tuned.ok, true, JSON.stringify(tuned));
  assert.deepEqual(f.calls, ["data.apply", "modkit.save"]);
  const saved = await fs.readFile(path.join(f.root, file), "utf8"),
    document = new DataDocument(saved, file);
  assert.match(saved, /manual damage annotation/);
  assert.match(saved, /Manual="keep"/);
  assert.match(saved, /<Scale value="1.4,1.4,1.4"/);
  assert.match(saved, /<Amount value="3"/);
  assert.match(saved, /<Duration value="240"/);
  assert.match(saved, /<Period value="2"/);
  const hero = document.objects().find((o) => o.domain === "Actor" && o.id === "Hero")!;
  assert.ok(
    hero.fields.some((f) => f.name === "On" && f.attrs.Terms === "WeaponStart.*.AttackStart"),
  );
  const rejected = await runMcpBatch(
    compileAuthorScript(
      `data unit.configure file=${file} id=Hero life=900\ndata spell.configure file=${file} id=Burn duration=1 period=2`,
      "save",
      f.tools,
    ),
    f.tools,
    {},
  );
  assert.equal(rejected.ok, false);
  assert.equal(await fs.readFile(path.join(f.root, file), "utf8"), saved);
  assert.deepEqual(f.workspace.draftFiles(), []);
  assert.throws(
    () => f.tools.get("data.unit.configure")!.schema.parse({ file, id: "Hero" }),
    /CHANGE_REQUIRED/,
  );
});

test("unit plus two spells creates one guarded graph and saves catalog/registration/preloads together", async (t) => {
  const f = await fixture(t);
  const script = [
    `data unit file=${file} id=Hero from=Marine life=600 scale=1.2 heroic=true`,
    command("id=Pulse kind=pulse damage=30 radius=4 unit=Hero slot=10"),
    command("id=Rift kind=line damage=48 count=9 delay=1.4 warningModel=Warning unit=Hero slot=11"),
  ].join("\n");
  const steps = compileAuthorScript(script, "save", f.tools);
  assert.deepEqual(
    steps.map((s) => s.tool),
    ["data.apply", "modkit.save"],
  );
  const result = await runMcpBatch(steps, f.tools, {});
  assert.equal(result.ok, true, JSON.stringify(result));
  const receipt = result.steps[0].result as {
    authoring: { editor: string; runtime: string; accepted: boolean };
    efficiency: { authoredOperations: number };
  };
  assert.equal(receipt.authoring.accepted, true);
  assert.equal(receipt.authoring.editor, "NOT_RUN");
  assert.equal(receipt.authoring.runtime, "NOT_RUN");
  assert.equal(receipt.efficiency.authoredOperations, 3);
  assert.deepEqual(f.calls, ["data.apply", "modkit.save"]);
  assert.deepEqual(f.workspace.draftFiles(), []);
  const doc = new DataDocument(await fs.readFile(path.join(f.root, file), "utf8"));
  const hero = doc.objects().find((o) => o.domain === "Unit" && o.id === "Hero")!;
  assert.equal(hero.parent, "Marine");
  assert.equal(hero.fields.find((f) => f.name === "LifeStart")?.value, "600");
  const actor = doc.objects().find((o) => o.domain === "Actor" && o.id === "Hero")!;
  assert.equal(actor.parent, "GenericUnitBase");
  assert.equal(actor.attrs.unitName, "Hero");
  assert.equal(actor.fields.find((f) => f.name === "WalkAnimMoveSpeed")?.value, "2.25");
  assert.ok(actor.fields.some((f) => f.attrs.Terms === "UnitDeath.Hero"));
  assert.ok(actor.fields.some((f) => f.attrs.Terms === "WeaponStart.*.AttackStart"));
  assert.ok(doc.source.includes('AbilCmd="Pulse,Execute"'));
  assert.ok(doc.source.includes('AbilCmd="Rift,Execute"'));
  const preload = await fs.readFile(path.join(f.root, "Preload.xml"), "utf8");
  for (const fragment of [
    '<Unit id="Hero"',
    '<Actor id="Hero"',
    '<Actor id="RiftWarning"',
    '<Model id="Warning"',
    '<Actor id="RiftImpact"',
  ])
    assert.ok(preload.includes(fragment), fragment);
});

test("plan creates no drafts; stage leaves disk untouched and exposes strict validation", async (t) => {
  const f = await fixture(t),
    script = command("id=Burn kind=burn damage=2 duration=180 period=1");
  const planned = await runMcpBatch(compileAuthorScript(script, "plan", f.tools), f.tools, {});
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.deepEqual(f.workspace.draftFiles(), []);
  const staged = await runMcpBatch(compileAuthorScript(script, "stage", f.tools), f.tools, {});
  assert.equal(staged.ok, true, JSON.stringify(staged));
  assert.equal(await fs.readFile(path.join(f.root, file), "utf8"), original);
  assert.ok(f.workspace.draftFiles().includes("Preload.xml"));
  const doc = (await f.data.open(file)).document;
  const burn = doc.objects().find((o) => o.id === "BurnBurn")!;
  assert.equal(burn.fields.find((f) => f.name === "Duration")?.value, "180");
  assert.equal(burn.fields.find((f) => f.name === "MaxStackCount")?.value, "1");
});

test("a later card collision rejects the complete bundle without leaking a unit or preloads", async (t) => {
  const f = await fixture(t);
  const script = [
    `data unit file=${file} id=Hero from=Marine`,
    command("id=One kind=pulse damage=1 unit=Hero slot=10"),
    command("id=Two kind=pulse damage=2 unit=Hero slot=10"),
  ].join("\n");
  const result = await runMcpBatch(compileAuthorScript(script, "save", f.tools), f.tools, {});
  assert.equal(result.ok, false);
  assert.deepEqual(f.calls, ["data.apply"]);
  assert.deepEqual(f.workspace.draftFiles(), []);
  assert.equal(await fs.readFile(path.join(f.root, file), "utf8"), original);
  await assert.rejects(fs.stat(path.join(f.root, "Preload.xml")), { code: "ENOENT" });
});

test("ring and direct-hit presets retain their separate point/unit presentation and targeting templates", async (t) => {
  const f = await fixture(t);
  const result = await runMcpBatch(
    compileAuthorScript(
      [
        command(
          "id=Ring kind=ring damage=58 radius=6 count=13 gap=100 delay=1.8 warningModel=Warning",
        ),
        command("id=Bolt kind=damage damage=14 range=9"),
      ].join("\n"),
      "stage",
      f.tools,
    ),
    f.tools,
    {},
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  const d = (await f.data.open(file)).document;
  const ring = d.objects().find((o) => o.id === "RingPattern")!;
  assert.equal(ring.fields.filter((f) => f.name === "PeriodicOffsetArray").length, 13);
  const impact = d.objects().find((o) => o.id === "RingImpact")!;
  assert.ok(impact.fields.some((f) => f.attrs.Terms === "Effect.RingSearch.Start"));
  assert.ok(!impact.fields.some((f) => (f.attrs.Terms ?? "").includes("At Target")));
  const bolt = d.objects().find((o) => o.domain === "Abil" && o.id === "Bolt")!;
  assert.equal(bolt.parent, "Snipe");
  assert.ok(
    d
      .objects()
      .find((o) => o.id === "BoltImpact")!
      .fields.some((f) => f.attrs.Terms === "Effect.BoltDamage.Start; At Target"),
  );
});

test("existing identities, missing models and unsupported primary Actors reject without writes", async (t) => {
  const f = await fixture(t);
  for (const script of [
    `data unit file=${file} id=Marine from=Marine`,
    `data unit file=${file} id=Hero from=Marine model=Missing`,
    command("id=Bad kind=damage damage=1 sourceAbility=Missing"),
  ]) {
    const result = await runMcpBatch(compileAuthorScript(script, "save", f.tools), f.tools, {});
    assert.equal(result.ok, false);
    assert.deepEqual(f.workspace.draftFiles(), []);
    assert.equal(await fs.readFile(path.join(f.root, file), "utf8"), original);
  }
});

test("spell-specific arguments cannot silently change mechanics and delayed spells require warning visuals", () => {
  const args = { id: "Rift", kind: "line", damage: 48, model: "Impact", face: "Face" };
  for (const patch of [
    { delay: 1.4 },
    { duration: 180 },
    { gap: 90 },
    { unit: "Hero" },
    { typo: 5 },
  ])
    assert.equal(spellRecipeSchema.safeParse({ ...args, ...patch }).success, false);
  assert.equal(
    spellRecipeSchema.safeParse({ ...args, delay: 1.4, warningModel: "Warning" }).success,
    true,
  );
});

test("aimed line cells advance on native negative Y toward the selected target", () => {
  const operations = expandSpellRecipe(
    spellRecipeSchema.parse({ id: "Aim", kind: "line", damage: 48, model: "Impact", face: "Face" }),
  );
  const pattern = operations.find((o) => o.op === "object.create" && o.id === "AimPattern");
  assert.ok(pattern?.op === "object.create");
  const offsets = pattern
    .fields!.filter((f) => f.name === "PeriodicOffsetArray")
    .map((f) => String(f.value).split(",").map(Number));
  assert.equal(offsets.length, 9);
  assert.deepEqual(offsets[0], [0, -2, 0]);
  assert.deepEqual(offsets.at(-1), [0, -14.8, 0]);
  assert.ok(offsets.every((v, i) => v[0] === 0 && (i === 0 || v[1] < offsets[i - 1][1])));
});

test(
  "real MCP transport discovers short help and saves a compound graph through one author call",
  { timeout: 30000 },
  async (t) => {
    const client = new Client({ name: "compound-authoring-acceptance", version: "1" });
    const f = await fixture(t, () => client.close());
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    Object.assign(env, {
      SC2_UI_ROOT: f.root,
      SC2_MCP_PROFILE: "focused-data",
      SC2_ASSET_ROOTS: "",
      SC2_BROWSE_INSTALLED_ROOTS: "",
    });
    delete env.SC2_MCP_MODULES;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("dist/index.js")],
      env,
      stderr: "pipe",
    });
    await client.connect(transport);
    const invoke = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      assert.ok(!r.isError, JSON.stringify(r));
      const content = r.content as Array<{ type: string; text?: string }>;
      return JSON.parse(content.find((c) => c.type === "text")?.text ?? "{}");
    };
    const short = await invoke("modkit.author_help", { section: "data" });
    assert.ok(short.examples.some((e: string) => e.startsWith("data spell ")));
    assert.equal(short.nativeEditorPolicy, undefined);
    const script = [
      `data unit file=${file} id=Hero from=Marine life=600`,
      command("id=Rift kind=line damage=48 delay=1.4 warningModel=Warning unit=Hero slot=10"),
    ].join("\n");
    const result = await invoke("modkit.author", { script, mode: "save" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.completed, 2);
    assert.ok((await fs.readFile(path.join(f.root, file), "utf8")).includes('id="RiftWarning"'));
    assert.ok(
      (await fs.readFile(path.join(f.root, "Preload.xml"), "utf8")).includes(
        '<Actor id="RiftWarning"',
      ),
    );
    const spell = spellRecipeSchema.parse({
      id: "Rift",
      kind: "line",
      damage: 48,
      delay: 1.4,
      warningModel: "Warning",
      unit: "Hero",
      slot: 10,
      model: "Impact",
      face: "Face",
    });
    const expandedBytes = Buffer.byteLength(
      JSON.stringify({ file, operations: expandSpellRecipe(spell) }),
    );
    const commandBytes = Buffer.byteLength(
      command("id=Rift kind=line damage=48 delay=1.4 warningModel=Warning unit=Hero slot=10"),
    );
    t.diagnostic(
      `Equivalent spell input: compact=${commandBytes} bytes; expanded operation JSON=${expandedBytes} bytes; ratio=${(expandedBytes / commandBytes).toFixed(1)}. Excludes tool schemas and model billing.`,
    );
    assert.ok(expandedBytes > commandBytes * 5);
  },
);
