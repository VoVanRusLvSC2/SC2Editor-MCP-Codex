import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  presentationSchema,
  runPresentationCheck,
  readOwnedRecordingMedia,
} from "../modules/testing/presentationChecks.js";
import type { CheckState } from "../modules/testing/schemas.js";
import type { GameResult } from "../integrations/game/transport.js";

const input = presentationSchema.parse({
  id: "bolt",
  viewId: "combat",
  action: {
    method: "game.order",
    arguments: {
      unit: "hero",
      action: "ability",
      ability: "Bolt",
      command: 0,
      target_unit: "target",
    },
  },
  events: [
    { id: "damage", match: { kind: "damage", source: "galaxy", unit: "target", amount: 30 } },
  ],
});
const clock = { session: "owned", runtimeEpoch: "epoch", mapLoadSerial: 1 };
function fixture(
  options: {
    missingHit?: boolean;
    changedStream?: boolean;
    uncertain?: boolean;
    staleMedia?: boolean;
    missingAccepted?: boolean;
  } = {},
) {
  let submissions = 0;
  const records = new Map<string, unknown>();
  return {
    records,
    submissions: () => submissions,
    hooks: {
      checkCancel: () => undefined,
      state: (result: GameResult): CheckState =>
        result.structuredContent?.status === "ok" ? "passed" : "inconclusive",
      body: (result: GameResult) => result.structuredContent as Record<string, any>,
      record: async (name: string, value: unknown) => {
        records.set(name, structuredClone(value));
        return name + ".json";
      },
      camera: async () => ({ id: "before", status: "passed" as const, required: true }),
      media: async (_file: string, sha256: string, _kind: "png" | "mp4", name: string) => {
        if (options.staleMedia) throw Error("PRESENTATION_MEDIA_STALE");
        return { file: name, sha256 };
      },
      call: async (method: string): Promise<GameResult> => {
        assert.equal(method, "game.record");
        submissions++;
        if (options.uncertain) throw Error("PrivateInjectedSourceMustNotLeak");
        return {
          content: [],
          structuredContent: {
            status: "ok",
            action: {
              status: "ok",
              ...(!options.missingAccepted ? { accepted: true } : {}),
              ...clock,
              gameTime: 1,
            },
            events: {
              status: "ok",
              ...clock,
              runtimeEpoch: options.changedStream ? "other" : "epoch",
              dropped: false,
              hasMore: false,
              events: [
                ...(!options.missingHit
                  ? [
                      {
                        kind: "damage",
                        source: "galaxy",
                        sourceUnit: "hero",
                        unit: "target",
                        amount: 30,
                        gameTime: 1.2,
                      },
                    ]
                  : []),
                {
                  kind: "ability",
                  source: "galaxy",
                  unit: "hero",
                  ability: "Bolt",
                  stageName: "complete",
                  gameTime: 1.1,
                },
              ],
            },
            frames: Array.from({ length: 4 }, (_, i) => ({
              status: "ok",
              path: "NativeFrame" + i + ".png",
              sha256: "a".repeat(64),
              elapsedRealSeconds: i / 2,
              gameTime: i / 2,
            })),
            video: { path: "NativeVideo.mp4", sha256: "b".repeat(64) },
            audio: { status: "unsupported" },
          },
        };
      },
    },
  };
}

test("presentation records exactly one action, correlates events, saves selected real-frame metadata and requires visual review", async () => {
  const f = fixture(),
    result = await runPresentationCheck(input, f.hooks);
  assert.equal(result.checks[0].status, "passed");
  assert.equal(f.submissions(), 1);
  assert.equal(result.checks.filter((c) => c.id.includes(":frame:")).length, 4);
  assert.equal(result.checks[0].evidence?.visualAcceptance, "not_checked");
  assert.equal(result.checks.at(-1)?.evidence?.audioStatus, "unsupported");
  assert.equal(result.continueSuite, true);
});

test("missing events, changed runtime and stale media stay unconfirmed without action retries", async () => {
  for (const options of [
    { missingHit: true },
    { changedStream: true },
    { staleMedia: true },
    { uncertain: true },
    { missingAccepted: true },
  ]) {
    const f = fixture(options),
      result = await runPresentationCheck(input, f.hooks);
    assert.equal(result.checks[0].status, "inconclusive");
    assert.equal(result.continueSuite, false);
    assert.equal(f.submissions(), 1);
    assert.ok(!JSON.stringify(result).includes("PrivateInjectedSourceMustNotLeak"));
  }
});

test("contradictory caster filters reject before recording and cannot be silently overwritten", async () => {
  const f = fixture(),
    result = await runPresentationCheck(
      {
        ...input,
        events: [
          { id: "damage", match: { kind: "damage", source: "galaxy", sourceUnit: "other" } },
        ],
      },
      f.hooks,
    );
  assert.equal(result.checks[0].status, "inconclusive");
  assert.equal(f.submissions(), 0);
});

test("recording artifacts enforce owned-root, type, size/signature and exact content hashes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-recording-media-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const owned = path.join(root, "owned");
  await fs.mkdir(owned);
  const bytes = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#134256" },
    })
      .png()
      .toBuffer(),
    hash = createHash("sha256").update(bytes).digest("hex"),
    file = path.join(owned, "Frame.png");
  await fs.writeFile(file, bytes);
  assert.deepEqual(await readOwnedRecordingMedia(owned, file, hash, "png"), bytes);
  const foreign = path.join(root, "Foreign.png");
  await fs.writeFile(foreign, bytes);
  await assert.rejects(readOwnedRecordingMedia(owned, foreign, hash, "png"), /BOUNDARY/);
  await assert.rejects(readOwnedRecordingMedia(owned, file, hash, "mp4"), /TYPE/);
  await fs.appendFile(file, "edited");
  await assert.rejects(readOwnedRecordingMedia(owned, file, hash, "png"), /STALE/);
});
