import { createProject } from "../app/project.js";
import { projectPreflight } from "../app/preflight.js";
import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { gunzipSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Workspace } from "../core/workspace.js";
import { MapInfoDocument } from "../modules/map/mapInfo.js";
import { PlayersDocument } from "../modules/settings/players.js";
import { AttributesDocument } from "../modules/settings/attributes.js";
import { SettingsWorkspace } from "../modules/settings/workspace.js";
import { settingsPlanSchema } from "../modules/settings/schemas.js";
const native = (id: string, file: string) => fs.readFile(`src/tests/fixtures/map-native/${id}/${file}.gz`).then(gunzipSync);
async function fixture(t: {
    after(fn: () => Promise<unknown>): void;
}) { const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-settings-")); t.after(() => fs.rm(root, { recursive: true, force: true })); for (const file of ["MapInfo", "Attributes", "ComponentList.SC2Components"])
    await fs.writeFile(path.join(root, file), await native("nydus", file)); const workspace = new Workspace(root); return { root, workspace, settings: new SettingsWorkspace(workspace) }; }
for (const [id, count] of [["ant", 9], ["city", 14], ["nydus", 13], ["warships", 10]] as const)
    test(`v39 ${id} players: actual stream profile and untouched suffix`, async () => {
        const b = await native(id, "MapInfo"), d = new PlayersDocument(b);
        assert.equal(d.players.length, count);
        assert.deepEqual(d.patch({ op: "options.set", patch: { disableReplay: d.inspect().options.disableReplay } }), b);
        const next = d.patch({ op: "player.set", playerId: 1, patch: { control: "Computer", aiName: "Terr", color: 3, decal: "War3_Orc" } }), n = new PlayersDocument(next);
        assert.deepEqual(next.subarray(n.tableEnd), b.subarray(d.tableEnd));
        assert.equal(n.players.find(p => p.id === 1)!.control, "Computer");
        assert.equal(n.players.find(p => p.id === 1)!.aiName, "Terr");
        assert.equal(n.core.integrityHash, d.core.integrityHash);
        const invalid = Buffer.from(b);
        invalid.writeUInt32LE(40, 4);
        assert.throws(() => new PlayersDocument(invalid), /UNSUPPORTED_MAPINFO/);
    });
test("options preserve unknown bits and recompute the core integrity hash", async () => { const b = await native("city", "MapInfo"), d = new PlayersDocument(b), next = d.patch({ op: "options.set", patch: { disableReplay: !d.inspect().options.disableReplay, showCountdown: !d.inspect().options.showCountdown } }), n = new PlayersDocument(next); assert.notEqual(n.core.gameOptionsFlags, d.core.gameOptionsFlags); assert.deepEqual(next.subarray(d.core.opaqueTailOffset), b.subarray(d.core.opaqueTailOffset)); assert.equal(n.core.computeIntegrityHash(), n.core.integrityHash); const outside = (d.core.gameOptionsFlags ^ n.core.gameOptionsFlags) & ~(1 | 8192); assert.equal(outside, 0); });
test("players reject unregistered locations, byte-overlong strings and unknown slots", async () => { const d = new PlayersDocument(await native("city", "MapInfo")); assert.throws(() => d.patch({ op: "player.set", playerId: 1, patch: { startLocation: 999999 } }), /NOT_REGISTERED/); assert.throws(() => d.patch({ op: "player.set", playerId: 16, patch: { color: 2 } }), /NOT_FOUND/); assert.throws(() => d.patch({ op: "player.set", playerId: 1, patch: { decal: "я".repeat(30) } }), /BYTE_LIMIT/); assert.equal(new PlayersDocument(d.patch({ op: "player.set", playerId: 1, patch: { startLocation: d.startLocationIds[0] } })).players.find(p => p.id === 1)!.startLocation, d.startLocationIds[0]); });
test("Attributes edits preserve XML comments, unknown elements, quote style and sibling bytes", async () => {
    const base = (await native("nydus", "Attributes")).toString(), source = base.replace('<Name Value="Attribute001/Name"/>', "<!-- comment -->\n        <Future Token='raw'/><Name Value='Attribute001/Name'/>");
    const d = new AttributesDocument(source), next = d.patch({ op: "attribute.set", id: 1, field: "Name", value: "New & Name" });
    assert.equal(next, source.replace("Value='Attribute001/Name'", "Value='New &amp; Name'"));
    assert.equal(new AttributesDocument(next).attributeDetails(1).name, "New & Name");
    assert.equal(d.inspect().variants.length, 4);
    assert.deepEqual(d.patch({ op: "attribute.default", id: 1, slot: 0, valueId: 4 }), source);
    assert.throws(() => d.patch({ op: "attribute.default", id: 1, slot: "Global", valueId: 4 }), /SCOPE_MISMATCH/);
    assert.throws(() => d.patch({ op: "attribute.default", id: 1, slot: 0, valueId: 99 }), /VALUE_NOT_FOUND/);
});
test("native variant clone preserves all original bindings and can edit mode and locked defaults", async () => {
    const source = (await native("nydus", "Attributes")).toString(), d = new AttributesDocument(source), cloned = new AttributesDocument(d.patch({ op: "variant.clone", sourceId: 4, id: 90, modeName: "Variant090/ModeName" }));
    assert.equal(cloned.inspect().variants.length, 5);
    assert.deepEqual(cloned.variantDetails(90).attributes, d.variantDetails(4).attributes);
    const next = new AttributesDocument(cloned.patch({ op: "variant.default", id: 90, namespace: 999, attributeId: 3011, slot: 0, valueId: 7, locked: false }));
    assert.equal(next.variantDetails(90).attributes.find(a => a.id === "3011")!.defaults[0].valueId, "7");
    assert.equal(next.variantDetails(90).attributes.find(a => a.id === "3011")!.defaults[0].locked, false);
    assert.throws(() => d.patch({ op: "variant.default", id: 4, namespace: 999, attributeId: 1001, slot: 0, valueId: 7 }), /SCOPE_MISMATCH/);
    assert.throws(() => d.patch({ op: "variant.set", id: 4, field: "MaxTeamSize", value: 17 }), /INVALID_VARIANT_NUMBER/);
});
test("malformed, duplicate and ambiguous Attributes fail before patching", () => {
    for (const xml of ['<Attributes><Attribute><Id Value="1"/></Attribute><Attribute><Id Value="1"/></Attribute></Attributes>', '<!DOCTYPE Attributes><Attributes/>', '<Attributes><Variant>'])
        assert.throws(() => new AttributesDocument(xml), /INVALID/);
    const d = new AttributesDocument('<Attributes><Attribute><Id Value="1"/><Name Value="a"/><Name Value="b"/></Attribute></Attributes>');
    assert.throws(() => d.patch({ op: "attribute.set", id: 1, field: "Name", value: "c" }), /AMBIGUOUS/);
    assert.equal(settingsPlanSchema.safeParse({ operations: [{ op: "player.set", playerId: 1, patch: { team: 2 } }] }).success, false);
});
test("multi-file settings stage/save preserves originals and guards the entire map manifest", async (t) => {
    const f = await fixture(t), original = await fs.readFile(path.join(f.root, "MapInfo"));
    const p = await f.settings.plan({ operations: [{ op: "player.set", playerId: 1, patch: { control: "Computer" } }, { op: "attribute.set", id: 1, field: "Name", value: "New/Name" }] });
    assert.equal(p.files.length, 2);
    await f.settings.apply(p.id);
    assert.deepEqual(await fs.readFile(path.join(f.root, "MapInfo")), original);
    const staged = await f.settings.apply(p.id, { dryRun: false });
    assert.ok(staged.transactionId);
    assert.equal((await f.settings.players()).players[0].control, "Computer");
    await fs.writeFile(path.join(f.root, "new-entry"), "external");
    await assert.rejects(f.settings.save(staged.transactionId!, { dryRun: false }), /STALE_SETTINGS/);
    await fs.unlink(path.join(f.root, "new-entry"));
    await f.settings.save(staged.transactionId!, { dryRun: false });
    assert.equal(new MapInfoDocument(await fs.readFile(path.join(f.root, "MapInfo"))).inspect().integrityVerified, true);
    assert.equal((await f.settings.get("", "attribute", 1) as {
        name: string;
    }).name, "New/Name");
});
test("create missing Attributes registers the component atomically and enforces scoped values", async (t) => {
    const f = await fixture(t);
    await fs.unlink(path.join(f.root, "Attributes"));
    await fs.writeFile(path.join(f.root, "ComponentList.SC2Components"), '<Components><!-- preserve --><DataComponent Type="mapi">MapInfo</DataComponent></Components>');
    const create = { op: "attribute.create", id: 7, type: "Global", name: "Attribute007/Name", access: "Host", availability: "All", visibility: "All" } as const;
    await assert.rejects(f.settings.plan({ operations: [create] }), /REQUIRES_VALUES/);
    const p = await f.settings.plan({ operations: [create, { op: "attribute.value.upsert", id: 7, valueId: 1, name: "Attribute007/Value001/Name" }, { op: "attribute.default", id: 7, slot: "Global", valueId: 1 }] });
    assert.deepEqual(p.files.map(f => f.file), ["Attributes", "ComponentList.SC2Components"]);
    const staged = await f.settings.apply(p.id, { dryRun: false });
    await f.settings.save(staged.transactionId!, { dryRun: false });
    assert.ok((await fs.readFile(path.join(f.root, "ComponentList.SC2Components"), "utf8")).includes('Type="attr"'));
    assert.equal((await f.settings.get("", "attribute", 7) as {
        defaults: {
            slot: string;
        }[];
    }).defaults[0].slot, "Global");
});
test("external MapInfo edit and overlapping staged changes invalidate a settings plan", async (t) => {
    const f = await fixture(t), p = await f.settings.plan({ operations: [{ op: "player.set", playerId: 1, patch: { color: 3 } }] });
    const original = await fs.readFile(path.join(f.root, "MapInfo"));
    await fs.appendFile(path.join(f.root, "MapInfo"), "external");
    await assert.rejects(f.settings.apply(p.id, { dryRun: false }), /STALE_SETTINGS/);
    await fs.writeFile(path.join(f.root, "MapInfo"), original);
    const staged = await f.settings.apply(p.id, { dryRun: false });
    await assert.rejects(f.settings.apply(p.id, { dryRun: false }), /STALE_SETTINGS_DRAFT/);
    f.settings.discard(staged.transactionId!, false);
    assert.deepEqual(await fs.readFile(path.join(f.root, "MapInfo")), original);
});
test("real SDK Settings profile plans, stages, saves, and reads native map settings", { timeout: 30000 }, async (t) => {
    const f = await fixture(t), env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [
        string,
        string
    ] => entry[1] !== undefined));
    delete env.SC2_MCP_MODULES;
    env.SC2_UI_ROOT = f.root;
    env.SC2_MCP_PROFILE = "settings";
    const client = new Client({ name: "settings-test", version: "1" });
    t.after(() => client.close());
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env, stderr: "pipe" }));
    const call = async (name: string, args: Record<string, unknown>) => { const r = await client.callTool({ name, arguments: args }); assert.notEqual(r.isError, true, JSON.stringify(r)); if (r.content[0].type !== "text")
        throw Error("Expected text"); return JSON.parse(r.content[0].text); };
    const tools = await client.listTools();
    assert.ok(tools.tools.some(t => t.name === "settings.plan"));
    assert.ok(!tools.tools.some(t => t.name === "terrain.hide"));
    const p = await call("settings.plan", { operations: [{ op: "player.set", playerId: 1, patch: { control: "Computer", color: 3 } }, { op: "variant.clone", sourceId: 4, id: 90, modeName: "Variant090/ModeName" }] });
    assert.equal(p.valid, true);
    const s = await call("settings.apply", { planId: p.id, dryRun: false });
    await call("settings.save", { transactionId: s.transactionId, dryRun: false });
    assert.equal((await call("settings.players.list", {})).players[0].control, "Computer");
    assert.equal((await call("settings.variant.get", { id: 90 })).fields.ModeName, "Variant090/ModeName");
});

test("empty self-closing settings containers expand without losing root attributes", () => {
    const d = new AttributesDocument("<!-- kept --><Attributes Future='token'/>");
    const next = new AttributesDocument(d.patch({op:"attribute.create",id:1,type:"Player",name:"Attribute001/Name",access:"Self",availability:"All",visibility:"All"}));
    assert.equal(next.root.attrs.Future,"token"); assert.ok(next.source.startsWith("<!-- kept --><Attributes Future='token'>"));
    assert.equal(next.attributeDetails(1).type,"Player");
});

test("new player defaults and value edits keep native sibling variants untouched", async () => {
    const source = (await native("nydus","Attributes")).toString(), original = new AttributesDocument(source);
    const beforeVariants = original.variants.map(v => original.raw(v));
    let next = new AttributesDocument(original.patch({op:"attribute.value.upsert",id:1,valueId:5,name:"Attribute001/Value005/Name",description:"Attribute001/Value005/Desc"}));
    next = new AttributesDocument(next.patch({op:"attribute.default",id:1,slot:15,valueId:5}));
    assert.equal(next.attributeDetails(1).defaults.find(d=>d.slot==="15")!.valueId,"5");
    assert.deepEqual(next.variants.map(v=>next.raw(v)),beforeVariants);
});

test("shared preflight inspects binary MapInfo Settings including staged changes", async t => {
    const f = await fixture(t), project = await createProject(f.root, {loadUiSchema:false});
    const p = await project.settings.plan({operations:[{op:"player.set",playerId:1,patch:{control:"Computer"}}]});
    await project.settings.apply(p.id,{dryRun:false});
    const report = await projectPreflight(project);
    assert.equal(report.checks.find(c=>c.name==="settings")!.status,"PASS");
    assert.equal(report.readyForEditorTest,false);
    assert.ok(report.pendingFiles.includes("MapInfo"));
});
