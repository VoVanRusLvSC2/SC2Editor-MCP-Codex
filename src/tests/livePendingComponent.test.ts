import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import { PendingComponent } from "../modules/editorLive/pendingComponent.js";

test("oversized recovery journals refuse before reserving a native submission", async () => {
  const schema = z.object({
      id: z.string(),
      archive: z.string(),
      processId: z.number(),
      processStart: z.string(),
      payload: z.string(),
    }),
    pending = new PendingComponent("pending-refresh", schema, "TEST_PENDING"),
    w = {
      processId: process.pid,
      processStart: String(Date.now()),
      windowId: "1",
      title: "Terrain - StarCraft II Editor",
      enabled: true,
      acceptsFiles: true,
    },
    record = {
      id: randomUUID(),
      archive: "Recovery-" + randomUUID() + ".SC2Map",
      processId: w.processId,
      processStart: w.processStart,
      payload: "界".repeat(6000),
    };
  assert.equal(JSON.stringify(record).length < 16384, true);
  await assert.rejects(pending.reserve(w, record), /TEST_PENDING_RECORD_INVALID/);
  assert.equal(await pending.read(w, record.archive), undefined);
  const bounded = { ...record, payload: "retained source revision" };
  await pending.reserve(w, bounded);
  try {
    assert.deepEqual(await pending.read(w, record.archive), bounded);
  } finally {
    await pending.release(w, record.archive, record.id);
  }
});
