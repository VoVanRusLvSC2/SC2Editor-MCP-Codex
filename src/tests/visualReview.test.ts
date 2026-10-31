import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Workspace } from "../core/workspace.js";
import {
  prepareVisualReview,
  recordVisualObservations,
  visualObservationSchema,
  type VisualReviewContext,
} from "../modules/testing/visualReview.js";

test("an unconfirmed-map launch screenshot cannot become map review evidence", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-visual-review-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let reads = 0;
  const context: VisualReviewContext = {
    id: randomUUID(),
    state: "completed",
    directory: root,
    sourceSha256: "a".repeat(64),
    testedSha256: "b".repeat(64),
    unchanged: async () => {
      reads++;
    },
    checks: [
      {
        id: "game.launch_capture",
        status: "passed",
        required: false,
        evidence: {
          mapConfirmed: false,
          file: path.join(root, "Unconfirmed.png"),
          sha256: "c".repeat(64),
        },
      },
    ],
  };
  const workspace = new Workspace(root),
    report = await prepareVisualReview(workspace, context, { jobId: context.id });
  assert.deepEqual(report.images, []);
  assert.equal(report.contactSheet, undefined);
  assert.equal(report.visualAcceptance, "not_checked");
  assert.ok(reads > 0);
  const images = [{ id: "game.launch_capture", sha256: "c".repeat(64) }];
  const observations = [
    {
      imageId: images[0].id,
      subject: "Map",
      aspect: "framing" as const,
      state: "not_observed" as const,
      detail: "No confirmed map frame",
    },
  ];
  await assert.rejects(
    recordVisualObservations(workspace, context, { jobId: context.id, images, observations }),
    /IMAGE_UNCONFIRMED/,
  );
  await assert.rejects(
    prepareVisualReview(workspace, { ...context, state: "running" }, { jobId: context.id }),
    /COMPLETED_JOB_REQUIRED/,
  );
});

test("review notes require selected distinct image hashes and a concrete repair for needs_change", () => {
  const jobId = randomUUID(),
    images = [{ id: "view:hero", sha256: "a".repeat(64) }];
  const note = {
    imageId: images[0].id,
    subject: "Hero",
    aspect: "scale",
    state: "needs_change",
    detail: "The hero obscures the target",
  };
  assert.equal(
    visualObservationSchema.safeParse({ jobId, images, observations: [note] }).success,
    false,
  );
  const complete = { ...note, nextChange: "Reduce the local main Actor scale from 2 to 1.5" };
  assert.equal(
    visualObservationSchema.safeParse({ jobId, images, observations: [complete] }).success,
    true,
  );
  assert.equal(
    visualObservationSchema.safeParse({
      jobId,
      images: [...images, ...images],
      observations: [complete],
    }).success,
    false,
  );
  assert.equal(
    visualObservationSchema.safeParse({
      jobId,
      images,
      observations: [{ ...complete, imageId: "other" }],
    }).success,
    false,
  );
  assert.equal(
    visualObservationSchema.safeParse({
      jobId,
      images,
      observations: [complete],
      humanApproval: true,
    }).success,
    false,
  );
});
