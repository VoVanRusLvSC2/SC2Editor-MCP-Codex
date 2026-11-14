import test from "node:test";
import assert from "node:assert/strict";
import { createPlacementGroup, placementJobSchema } from "../modules/editorLive/placementGroup.js";
import type { LivePlacement } from "../modules/editorLive/placement.js";
import { compileAuthorScript } from "../app/authoringScript.js";

test("group stops after an uncertain placement without replaying it", async () => {
  let calls = 0;
  const placement = {
    checkGroupCapacity: () => {},
    prepare: async () => ({}),
    inspect: async () => ({ snapshotId: "snapshot" }),
    catalog: async () => ({ rows: [{ type: "Lamp", row: 1 }], matches: 1, catalogHash: "1" }),
    create: async () =>
      ++calls === 1
        ? { status: "applied", objectKey: "1", after: { name: "One" } }
        : { status: "unknown", retryMutation: false },
  } as unknown as LivePlacement;
  const result = await createPlacementGroup(placement, {
    archive: "map.SC2Map",
    windowId: "1",
    objects: [
      { type: "Lamp", x: 1, y: 1 },
      { type: "Lamp", x: 2, y: 2 },
      { type: "Lamp", x: 3, y: 3 },
    ],
  });
  assert.equal(result.status, "stopped");
  assert.equal(result.completed.length, 1);
  assert.equal(calls, 2);
});

test("compact group syntax expands coordinates without JSON", () => {
  const steps = compileAuthorScript(
    'live placement.group archive=map.SC2Map windowId=1 type=Barrels points="1,2;3.5,4"',
    "stage",
  );
  assert.equal(steps[0].tool, "live.placement.create_group");
  assert.deepEqual(steps[0].args.objects, [
    { type: "Barrels", x: 1, y: 2 },
    { type: "Barrels", x: 3.5, y: 4 },
  ]);
});

test("group refuses ambiguous or truncated palette before placing", async () => {
  let calls = 0;
  const placement = {
    checkGroupCapacity: () => {},
    prepare: async () => ({}),
    inspect: async () => ({ snapshotId: "snapshot" }),
    catalog: async () => ({ rows: [{ type: "Lamp", row: 1 }], matches: 2, catalogHash: "1" }),
    create: async () => {
      calls++;
    },
  } as unknown as LivePlacement;
  const result = await createPlacementGroup(placement, {
    archive: "map.SC2Map",
    windowId: "1",
    objects: [{ type: "Lamp", x: 1, y: 1 }],
  });
  assert.equal(result.status, "stopped");
  assert.equal(calls, 0);
});

test("group capacity is checked before any object is placed", async () => {
  let creates = 0,
    catalogs = 0;
  const placement = {
    prepare: async () => ({}),
    inspect: async () => ({ snapshotId: "snapshot" }),
    checkGroupCapacity: () => {
      throw Error("LIVE_PLACEMENT_TEMPLATE_GROUP_BOUND");
    },
    catalog: async () => {
      catalogs++;
    },
    create: async () => {
      creates++;
    },
  } as unknown as LivePlacement;
  const result = await createPlacementGroup(placement, {
    archive: "map.SC2Map",
    windowId: "1",
    objects: [{ type: "Lamp", x: 1, y: 1 }],
  });
  assert.equal(result.status, "stopped");
  assert.equal(result.phase, "preflight");
  assert.equal(result.completed.length, 0);
  assert.equal(creates, 0);
  assert.equal(catalogs, 0);
});

test("a group reuses palette lookup per type while each create receives the original guard", async () => {
  const lookups: string[] = [],
    creates: Array<{ type: string; catalogRow: number; catalogHash: string }> = [];
  const placement = {
    prepare: async () => ({}),
    inspect: async () => ({ snapshotId: "snapshot" }),
    checkGroupCapacity: () => {},
    catalog: async (a: { query: string }) => {
      lookups.push(a.query);
      return {
        rows: [{ type: a.query, row: a.query === "Lamp" ? 3 : 5 }],
        matches: 1,
        catalogHash: "123",
      };
    },
    create: async (a: { type: string; catalogRow: number; catalogHash: string }) => {
      creates.push(a);
      return { status: "applied", after: { name: "created" } };
    },
  } as unknown as LivePlacement;
  const result = await createPlacementGroup(placement, {
    archive: "map.SC2Map",
    windowId: "1",
    objects: [
      { type: "Lamp", x: 1, y: 1 },
      { type: "Rock", x: 2, y: 2 },
      { type: "Lamp", x: 3, y: 3 },
    ],
  });
  assert.equal(result.status, "applied");
  assert.deepEqual(lookups, ["Lamp", "Rock"]);
  assert.deepEqual(
    creates.map((a) => [a.type, a.catalogRow, a.catalogHash]),
    [
      ["Lamp", 3, "123"],
      ["Rock", 5, "123"],
      ["Lamp", 3, "123"],
    ],
  );
});

test("a changed palette rejected by create stops the group without retrying", async () => {
  let creates = 0,
    lookups = 0;
  const placement = {
    prepare: async () => ({}),
    inspect: async () => ({ snapshotId: "snapshot" }),
    checkGroupCapacity: () => {},
    catalog: async () => {
      lookups++;
      return { rows: [{ type: "Lamp", row: 3 }], matches: 1, catalogHash: "old" };
    },
    create: async () => {
      if (++creates === 2) throw Error("LIVE_PALETTE_ROW_CHANGED");
      return { status: "applied" };
    },
  } as unknown as LivePlacement;
  const result = await createPlacementGroup(placement, {
    archive: "map.SC2Map",
    windowId: "1",
    objects: [
      { type: "Lamp", x: 1, y: 1 },
      { type: "Lamp", x: 2, y: 2 },
      { type: "Lamp", x: 3, y: 3 },
    ],
  });
  assert.equal(result.status, "stopped");
  assert.equal(result.completed.length, 1);
  assert.equal(creates, 2);
  assert.equal(lookups, 1);
});

test("group validates every name before any placement work", () => {
  assert.throws(() =>
    placementJobSchema.parse({
      archive: "map.SC2Map",
      windowId: "1",
      objects: [
        { type: "Lamp", x: 1, y: 1 },
        { type: "Rock", x: 2, y: 2, name: "bad\u001fname" },
      ],
    }),
  );
});
