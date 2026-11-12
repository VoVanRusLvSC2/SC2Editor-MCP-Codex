import test from "node:test";
import assert from "node:assert/strict";
import { LivePlacementJobs } from "../modules/editorLive/placementJobs.js";
import type { LivePlacement } from "../modules/editorLive/placement.js";

test("background placements are single-flight and cancellation waits for the current edit", async () => {
  let release!: () => void, started!: () => void, placements = 0;
  const startedPromise = new Promise<void>(resolve => { started = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const placement = {
    checkGroupCapacity: () => {},
    prepare: async () => ({}),
    inspect: async () => ({ snapshotId: "snapshot" }),
    catalog: async () => ({ rows: [{ type: "Lamp", row: 1 }], matches: 1, catalogHash: "1" }),
    create: async () => { placements++; started(); await barrier; return { status: "applied", after: { name: "One" } }; },
  } as unknown as LivePlacement;
  const document = {} as never;
  const jobs = new LivePlacementJobs(placement, document, fn => fn(), () => false);
  const input = { archive: "map.SC2Map", windowId: "1", objects: [
    { type: "Lamp", x: 1, y: 1 }, { type: "Lamp", x: 2, y: 2 },
  ] };
  const job = jobs.start(input);
  await startedPromise;
  assert.equal(jobs.status(job.jobId).status, "running");
  assert.throws(() => jobs.start(input), /JOB_BUSY/);
  assert.equal(jobs.cancel(job.jobId).status, "running");
  release();
  await jobs.close();
  const result = jobs.status(job.jobId);
  assert.equal(result.status, "cancelled");
  assert.equal(result.completed.length, 1);
  assert.equal(placements, 1);
});

test("successful series saves the current file once only when requested", async () => {
  let saves = 0;
  const placement = {
    checkGroupCapacity: () => {},
    prepare: async () => ({}), inspect: async () => ({ snapshotId: "snapshot" }),
    catalog: async () => ({ rows: [{ type: "Lamp", row: 1 }], matches: 1, catalogHash: "1" }),
    create: async () => ({ status: "applied", after: { name: "One" } }),
  } as unknown as LivePlacement;
  const document = {
    status: async () => ({ sha256: "a".repeat(64) }),
    save: async (args: { archive: string }) => { saves++; assert.equal(args.archive, "map.SC2Map"); return { status: "saved" }; },
  } as never;
  const jobs = new LivePlacementJobs(placement, document, fn => fn(), () => false);
  const job = jobs.start({ archive: "map.SC2Map", windowId: "1", saveOnComplete: true,
    objects: [{ type: "Lamp", x: 1, y: 1 }] });
  for (let i = 0; i < 20 && jobs.status(job.jobId).status === "running"; i++)
    await new Promise(resolve => setImmediate(resolve));
  assert.equal(jobs.status(job.jobId).status, "applied");
  assert.equal(saves, 1);
  await jobs.close();
});
