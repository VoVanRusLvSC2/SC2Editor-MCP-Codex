import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LivePlacement,
  placementWriteSchema,
  placementInspectSchema,
  placementCreateSchema,
} from "../modules/live/placement.js";
import type { EditorWindow } from "../modules/live/desktop.js";
import { withEditorLease } from "../modules/live/editorLease.js";
import { compileAuthorScript } from "../app/authoringScript.js";

let pid = 930000;
async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-placement-"));
  const archive = path.join(root, "Current.SC2Map");
  await fs.writeFile(archive, "unchanged saved map");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = {
    window: {
      windowId: "123",
      processId: ++pid,
      processStart: "99",
      title: `Terrain - [${archive}] - StarCraft II Editor`,
      enabled: true,
      acceptsFiles: true,
    } as EditorWindow,
    objects: [{ row: 0, key: "100", type: "Lamp", name: "Original", x: 2, y: 4 }],
    selected: "100",
    preview: "",
    token: "",
    manual: false,
    lost: false,
    blocked: false,
    layer: "Doodads" as "Doodads" | "Units",
    invalidCoordinates: false,
    brush: "",
    catalogHash: "11111",
    nativeOwner: 1,
    nativeSnap: false,
    collateralDelete: false,
    calls: [] as number[],
  };
  const item = () => state.objects.find((o) => o.key === state.selected)!;
  const fingerprint = () => JSON.stringify([item().x, item().y, item().name]);
  const reindex = () =>
    state.objects.forEach((o, i) => {
      o.row = i;
      o.key = String(100 + i);
    });
  const scene = () => ({
    layer: state.layer,
    count: state.objects.length,
    selectedKey: state.selected,
    sceneHash: JSON.stringify(state.objects),
    preview: state.preview,
    objects: state.objects.map(({ row, key, type, name }) => ({ row, key, type, name })),
  });
  const placement = new LivePlacement(
    root,
    {
      windows: async () => [structuredClone(state.window)],
      command: async (_w, op, a = {}) => {
        state.calls.push(op);
        if (op === 37) return scene();
        if (op === 43) {
          if (a.field === "list") return { listStyleRequested: true };
          return {
            layer: state.layer,
            catalogHash: state.catalogHash,
            brush: state.brush,
            total: 1,
            matches: 1,
            offset: 0,
            rows: [{ row: 7, type: "Zergling" }],
          };
        }
        if (op === 44) {
          if (a.expected !== state.catalogHash) throw Error("LIVE_PALETTE_ROW_CHANGED");
          state.brush = "Brush: " + a.field + " (Zergling)";
          return { paletteSelectionRequested: true };
        }
        if (op === 45) {
          if (a.field !== state.catalogHash) throw Error("LIVE_PALETTE_BRUSH_CHANGED");
          state.objects.unshift({ row: 0, key: "100", type: "Zergling", name: "", x: 8, y: 3 });
          reindex();
          state.window.title = state.window.title.replace("]", "*]");
          if (state.lost) throw Error("Reply lost after native catalog placement");
          return { placementRequested: true };
        }
        if (op === 32) {
          state.selected = a.field!;
          return { selectionRequested: true };
        }
        if (op === 39) {
          assert.equal(a.unit, state.selected);
          assert.equal(a.expected, scene().sceneHash);
          state.objects = state.objects.filter((o) => o.key !== state.selected);
          reindex();
          state.selected = "";
          state.window.title = state.window.title.replace(/\*?\]/, "*]");
          if (state.collateralDelete && state.objects[0]) state.objects[0].x += 1;
          if (state.lost) throw Error("Reply lost after native deletion");
          return { deleteRequested: true };
        }
        if (op === 33) return { copyInvoked: true };
        if (op === 31) {
          if (a.unit === "Doodads" || a.unit === "Units") state.layer = a.unit;
          state.preview = "";
          return { selectionModeRequested: true };
        }
        if (op === 34) {
          if (a.field !== "commitPreview") {
            state.preview = `Pasting: ${item().name || item().type} (Lamp)`;
            return { pasteInvoked: true };
          }
          assert.equal(a.expected, scene().sceneHash);
          // Like the Editor's owner-data table: insertion renumbers existing rows,
          // and native paste clears the copied instance's display name.
          state.objects.unshift({ ...item(), name: "", row: 0, key: "100" });
          reindex();
          state.window.title = state.window.title.replace("]", "*]");
          if (state.lost) throw Error("Reply lost after native placement");
          return { placementRequested: true };
        }
        if (op === 35) {
          state.token = a.token!;
          state.window.enabled = false;
          return { status: "pending" };
        }
        assert.equal(a.token, state.token);
        if (op === 30)
          return {
            properties: {
              fingerprint: fingerprint(),
              initial: fingerprint(),
              matches: true,
              manualInput: state.manual,
              x: state.invalidCoordinates ? "" : String(item().x),
              y: String(item().y),
              name: item().name,
              ...(state.layer === "Units"
                ? { owner: `(${state.nativeOwner}) Player ${state.nativeOwner}` }
                : {}),
            },
          };
        if (op === 36) {
          const changed = item();
          changed.x = Number(a.unit) + (state.nativeSnap ? 0.5 : 0);
          changed.y = Number(a.field) + (state.nativeSnap ? 0.5 : 0);
          if (a.value) changed.name = a.value === "\u001f" ? "" : a.value;
          state.objects.sort((a, b) => a.name.localeCompare(b.name));
          reindex();
          state.selected = changed.key;
          state.window.enabled = true;
          state.window.title = state.window.title.replace(/\*?\]/, "*]");
          return { commitRequested: true };
        }
        if (op === 38) {
          state.window.enabled = true;
          return { cancelRequested: true };
        }
        throw Error("Unexpected native operation " + op);
      },
    },
    () => state.blocked,
    async () => {},
  );
  t.after(() => placement.close());
  const target = { archive, windowId: "123" };
  const inspect = await placement.inspect(target);
  const write = { snapshotId: inspect.snapshotId, objectKey: "100", x: 12, y: 4, name: "Z lamp" };
  return { state, placement, target, write, root };
}

test("deletion verifies every surviving instance after row reindexing without saving the map", async (t) => {
  const f = await fixture(t);
  f.state.objects.push({ row: 1, key: "101", type: "Rock", name: "Other", x: 8, y: 7 });
  const snapshot = await f.placement.inspect(f.target),
    result = await f.placement.delete({ snapshotId: snapshot.snapshotId, objectKey: "100" });
  assert.equal(result.status, "applied");
  assert.equal(f.state.calls.filter((c) => c === 39).length, 1);
  assert.equal(f.state.objects.length, 1);
  assert.equal(f.state.objects[0].name, "Other");
  assert.equal(f.state.objects[0].key, "100");
  assert.equal(
    await fs.readFile(path.join(f.root, "Current.SC2Map"), "utf8"),
    "unchanged saved map",
  );
});
test("a lost deletion reply cannot replay its consumed snapshot", async (t) => {
  const f = await fixture(t);
  f.state.lost = true;
  const args = { snapshotId: f.write.snapshotId, objectKey: "100" },
    result = await f.placement.delete(args);
  assert.equal(result.status, "unknown");
  assert.equal(f.state.objects.length, 0);
  await assert.rejects(f.placement.delete(args), /CONSUMED/);
  assert.equal(f.state.calls.filter((c) => c === 39).length, 1);
});
test("collateral property changes fail deletion verification", async (t) => {
  const f = await fixture(t);
  f.state.objects.push({ row: 1, key: "101", type: "Rock", name: "Other", x: 8, y: 7 });
  const snapshot = await f.placement.inspect(f.target);
  f.state.collateralDelete = true;
  const result = await f.placement.delete({ snapshotId: snapshot.snapshotId, objectKey: "100" });
  assert.equal(result.status, "verification_failed");
  assert.equal(f.state.calls.filter((c) => c === 39).length, 1);
});
test("stale scenes, manual properties and deletion bounds refuse before Clear", async (t) => {
  const f = await fixture(t);
  f.state.objects[0].name = "Manual";
  await assert.rejects(
    f.placement.delete({ snapshotId: f.write.snapshotId, objectKey: "100" }),
    /SCENE_CHANGED/,
  );
  const snapshot = await f.placement.inspect(f.target);
  f.state.manual = true;
  await assert.rejects(
    f.placement.delete({ snapshotId: snapshot.snapshotId, objectKey: "100" }),
    /MANUAL_PROPERTIES/,
  );
  assert.equal(f.state.calls.includes(39), false);
});
test("large-layer deletion refuses before reading properties or clearing any object", async (t) => {
  const f = await fixture(t);
  f.state.objects = Array.from({ length: 33 }, (_, i) => ({
    row: i,
    key: String(100 + i),
    type: "Lamp",
    name: "Lamp " + i,
    x: i,
    y: 4,
  }));
  const s = await f.placement.inspect(f.target),
    before = f.state.calls.length;
  await assert.rejects(
    f.placement.delete({ snapshotId: s.snapshotId, objectKey: "100" }),
    /DELETE_SCENE_BOUND/,
  );
  assert.equal(
    f.state.calls.slice(before).some((op) => op === 39 || op === 35),
    false,
  );
});
test("duplicate creates exactly one native instance, verifies position and preserves the same archive", async (t) => {
  const f = await fixture(t);
  const result = await f.placement.duplicate(f.write);
  assert.equal(result.status, "applied");
  assert.equal(result.copiesCreated, 0);
  assert.equal(result.reopensMap, false);
  assert.equal(f.state.objects.length, 2);
  assert.equal(f.state.objects[0].name, "Original");
  assert.deepEqual(f.state.objects[1], {
    row: 1,
    key: "101",
    type: "Lamp",
    name: "Z lamp",
    x: 12,
    y: 4,
  });
  assert.equal(await fs.readFile(f.target.archive, "utf8"), "unchanged saved map");
  assert.deepEqual(await fs.readdir(f.root), ["Current.SC2Map"]);
  assert.equal(f.state.window.enabled, true);
  await assert.rejects(f.placement.duplicate(f.write), /EXPIRED_OR_CONSUMED/);
});
test("stale scene and archive guards refuse before native Copy or placement", async (t) => {
  const f = await fixture(t);
  f.state.objects[0].name = "Manual rename";
  await assert.rejects(f.placement.duplicate(f.write), /SCENE_CHANGED/);
  assert.equal(f.state.calls.includes(33), false);
  const fresh = await f.placement.inspect(f.target);
  await fs.writeFile(f.target.archive, "external save");
  await assert.rejects(
    f.placement.move({ ...f.write, snapshotId: fresh.snapshotId }),
    /ARCHIVE_CHANGED/,
  );
  assert.equal(f.state.calls.includes(36), false);
});
test("lost placement reply never duplicates again or commits coordinates", async (t) => {
  const f = await fixture(t);
  f.state.lost = true;
  const result = await f.placement.duplicate(f.write);
  assert.equal(result.status, "unknown");
  assert.equal(result.retryMutation, false);
  assert.equal(f.state.objects.length, 2);
  assert.equal(f.state.calls.filter((op) => op === 34).length, 2);
  assert.equal(f.state.calls.includes(36), false);
  await assert.rejects(f.placement.duplicate(f.write), /EXPIRED_OR_CONSUMED/);
});
test("manual properties edits are neither committed nor cancelled", async (t) => {
  const f = await fixture(t);
  f.state.manual = true;
  const result = await f.placement.move(f.write);
  assert.equal(result.status, "unknown");
  assert.equal(f.state.calls.includes(36), false);
  assert.equal(f.state.calls.includes(38), false);
  assert.equal(f.state.window.enabled, false);
});
test("shared process lease and native dialogs block live placement", async (t) => {
  const f = await fixture(t);
  await withEditorLease(f.state.window, async () => {
    await assert.rejects(f.placement.duplicate(f.write), /LEASE_BUSY/);
  });
  f.state.window.enabled = false;
  await assert.rejects(f.placement.inspect(f.target), /USER_DIALOG_PRESENT/);
  assert.equal(f.state.calls.includes(33), false);
});
test("compact placement is available and remains an explicit mutation", () => {
  const inspect = compileAuthorScript(
    "live placement.inspect archive=Current.SC2Map windowId=18446744073709551615",
    "plan",
  )[0];
  assert.equal(inspect.tool, "live.placement.inspect");
  assert.equal(placementInspectSchema.parse(inspect.args).windowId, "18446744073709551615");
  const write = compileAuthorScript(
    'live placement.duplicate snapshotId=11111111-1111-4111-8111-111111111111 objectKey=18446744073709551615 x=12 y=4 name="Edge light"',
    "stage",
  )[0];
  assert.equal(placementWriteSchema.parse(write.args).objectKey, "18446744073709551615");
  assert.throws(() =>
    compileAuthorScript("live placement.duplicate snapshotId=abc objectKey=1 x=12 y=4", "plan"),
  );
});
test("names reject control sentinels and half-grid bounds reject before native mutation", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.placement.move({ ...f.write, name: "bad\u001fname" }));
  await assert.rejects(f.placement.move({ ...f.write, x: 12.25 }));
  assert.equal(f.state.calls.includes(32), false);
});
test("clearing an instance name uses owned readback after row reindexing", async (t) => {
  const f = await fixture(t);
  const result = await f.placement.move({ ...f.write, name: "" });
  assert.equal(result.status, "applied");
  assert.equal(f.state.objects[0].name, "");
  assert.equal(f.state.objects[0].x, 12);
});
test("template-group limits refuse before creating an unpositioned seventeenth instance", async (t) => {
  const f = await fixture(t);
  f.state.objects = Array.from({ length: 16 }, (_, i) => ({
    row: i,
    key: String(100 + i),
    type: "Lamp",
    name: `Original ${i}`,
    x: i,
    y: 4,
  }));
  const snapshot = await f.placement.inspect(f.target);
  await assert.rejects(
    f.placement.duplicate({ ...f.write, snapshotId: snapshot.snapshotId }),
    /TEMPLATE_GROUP_BOUND/,
  );
  assert.equal(f.state.objects.length, 16);
  assert.equal(f.state.calls.includes(33), false);
});

test("a layer switch refuses even if the native scene hash incorrectly stays the same", async (t) => {
  const f = await fixture(t);
  f.state.layer = "Units";
  await assert.rejects(f.placement.duplicate(f.write), /LAYER_CHANGED/);
  assert.equal(f.state.calls.includes(33), false);
});

test("blank native coordinates never become a verified zero or reach a coordinate commit", async (t) => {
  const f = await fixture(t);
  f.state.invalidCoordinates = true;
  const result = await f.placement.move(f.write);
  assert.equal(result.status, "unknown");
  assert.equal(f.state.calls.includes(36), false);
});

test("Units use the same guarded instance workflow after explicit layer preparation", async (t) => {
  const f = await fixture(t);
  f.state.objects[0].type = "Odin";
  await f.placement.prepare({ ...f.target, layer: "Units" });
  const scene = await f.placement.inspect(f.target);
  const result = await f.placement.duplicate({
    ...f.write,
    snapshotId: scene.snapshotId,
    name: "Second Odin",
  });
  assert.equal(result.status, "applied");
  assert.ok("layer" in result && "countAfter" in result);
  assert.equal(result.layer, "Units");
  assert.equal(result.countAfter, 2);
  assert.equal(f.state.objects[0].type, "Odin");
});

test("native catalog creates a type absent from the scene and verifies explicit Unit owner", async (t) => {
  const f = await fixture(t);
  await f.placement.prepare({ ...f.target, layer: "Units" });
  const scene = await f.placement.inspect(f.target);
  const catalog = await f.placement.catalog({ snapshotId: scene.snapshotId, query: "Zergling" });
  const result = await f.placement.create({
    snapshotId: scene.snapshotId,
    catalogHash: catalog.catalogHash,
    catalogRow: 7,
    type: "Zergling",
    expectedId: "Zergling",
    owner: 1,
    x: 6,
    y: 26,
    name: "New Zergling",
  });
  assert.equal(result.status, "applied");
  assert.ok("after" in result);
  assert.equal(result.nativeCatalogId, "Zergling");
  assert.equal(result.after.owner, 1);
  assert.equal(result.after.x, 6);
  assert.equal(result.after.y, 26);
  assert.equal(f.state.objects.length, 2);
  assert.equal(f.state.calls.filter((op) => op === 45).length, 1);
});

test("lost catalog creation never repeats the brush click or positions an arbitrary existing Unit", async (t) => {
  const f = await fixture(t);
  await f.placement.prepare({ ...f.target, layer: "Units" });
  const scene = await f.placement.inspect(f.target);
  f.state.lost = true;
  const args = {
    snapshotId: scene.snapshotId,
    catalogHash: "11111",
    catalogRow: 7,
    type: "Zergling",
    owner: 1,
    x: 6,
    y: 26,
    name: "New Zergling",
  };
  const result = await f.placement.create(args);
  assert.equal(result.status, "unknown");
  assert.equal(f.state.objects.length, 2);
  assert.equal(f.state.calls.filter((op) => op === 45).length, 1);
  assert.equal(f.state.calls.includes(36), false);
  await assert.rejects(f.placement.create(args), /EXPIRED_OR_CONSUMED/);
});

test("stale catalogs and missing explicit Unit owners refuse before creation", async (t) => {
  const f = await fixture(t);
  await f.placement.prepare({ ...f.target, layer: "Units" });
  const scene = await f.placement.inspect(f.target);
  const args = {
    snapshotId: scene.snapshotId,
    catalogHash: "11111",
    catalogRow: 7,
    type: "Zergling",
    x: 6,
    y: 26,
    name: "New Zergling",
  };
  await assert.rejects(f.placement.create(args), /UNIT_OWNER_REQUIRED/);
  const fresh = await f.placement.inspect(f.target);
  f.state.catalogHash = "22222";
  await assert.rejects(
    f.placement.create({ ...args, snapshotId: fresh.snapshotId, owner: 1 }),
    /PALETTE_ROW_CHANGED/,
  );
  assert.equal(f.state.calls.includes(45), false);
});

test("a created Unit with the wrong native owner stays partial and is not moved or recreated", async (t) => {
  const f = await fixture(t);
  await f.placement.prepare({ ...f.target, layer: "Units" });
  const scene = await f.placement.inspect(f.target);
  f.state.nativeOwner = 2;
  const result = await f.placement.create({
    snapshotId: scene.snapshotId,
    catalogHash: "11111",
    catalogRow: 7,
    type: "Zergling",
    owner: 1,
    x: 6,
    y: 26,
    name: "New Zergling",
  });
  assert.equal(result.status, "partial");
  assert.match(result.error ?? "", /OWNER_MISMATCH/);
  assert.equal(f.state.calls.filter((op) => op === 45).length, 1);
  assert.equal(f.state.calls.includes(36), false);
});

test("native footprint adjustment is reported as failed exact verification without recreating the object", async (t) => {
  const f = await fixture(t);
  f.state.nativeSnap = true;
  const scene = await f.placement.inspect(f.target);
  const result = await f.placement.create({
    snapshotId: scene.snapshotId,
    catalogHash: "11111",
    catalogRow: 7,
    type: "Zergling",
    x: 6,
    y: 26,
    name: "Native snapped object",
  });
  assert.equal(result.status, "verification_failed");
  assert.ok("after" in result);
  assert.equal(result.after.x, 6.5);
  assert.equal(result.after.y, 26.5);
  assert.equal(f.state.calls.filter((op) => op === 45).length, 1);
  assert.equal(f.state.calls.filter((op) => op === 36).length, 1);
});

test("a matching display name with a different native catalog ID refuses before creation", async (t) => {
  const f = await fixture(t);
  const scene = await f.placement.inspect(f.target);
  await assert.rejects(
    f.placement.create({
      snapshotId: scene.snapshotId,
      catalogHash: "11111",
      catalogRow: 7,
      type: "Zergling",
      expectedId: "OtherUnit",
      x: 6,
      y: 26,
      name: "Wrong ID",
    }),
    /CATALOG_ID_MISMATCH/,
  );
  assert.equal(f.state.calls.includes(45), false);
  assert.equal(f.state.objects.length, 1);
});

test("compact catalog creation preserves full 64-bit palette guards and numeric-looking IDs", () => {
  const command = compileAuthorScript(
    'live placement.create snapshotId=11111111-1111-4111-8111-111111111111 catalogRow=2418 catalogHash=7137699931910175889 type=Zergling expectedId=1234 owner=1 x=6 y=26 name="Native unit"',
    "stage",
  )[0];
  const args = placementCreateSchema.parse(command.args);
  assert.equal(args.catalogHash, "7137699931910175889");
  assert.equal(args.expectedId, "1234");
});
