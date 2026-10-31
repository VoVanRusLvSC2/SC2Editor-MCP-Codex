import * as z from "zod/v4";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { GameResult } from "../../integrations/game/transport.js";
import { actionCheckSchema } from "./actionChecks.js";
import { resolveBatchReferences } from "../../app/mcpBatch.js";
import type { TestCheck, CheckState } from "./schemas.js";
import { isDeepStrictEqual } from "node:util";
import { actionEventsSchema } from "../../integrations/game/actionEvents.js";

export const presentationSchema = z
  .object({
    id: actionCheckSchema.shape.id,
    required: actionCheckSchema.shape.required,
    before: actionCheckSchema.shape.before,
    after: actionCheckSchema.shape.after,
    action: actionCheckSchema.shape.action,
    events: actionCheckSchema.shape.events,
    waitForComplete: z.boolean().default(true),
    viewId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
    beforeSeconds: z.number().min(0).max(2).default(0.5),
    afterSeconds: z.number().min(0.25).max(6).default(3),
    fps: z.number().int().min(2).max(12).default(8),
    auditAudio: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, c) => {
    const checked = actionCheckSchema.safeParse({
      id: v.id,
      required: v.required,
      before: v.before,
      after: v.after,
      action: v.action,
      events: v.events,
      waitForComplete:
        v.action.method === "game.order" && v.action.arguments.action === "ability"
          ? v.waitForComplete
          : false,
    });
    if (!checked.success)
      for (const issue of checked.error.issues)
        c.addIssue({ code: "custom", message: issue.message });
    if (v.beforeSeconds + v.afterSeconds > 6)
      c.addIssue({ code: "custom", message: "Presentation recording exceeds six real seconds" });
  });
export type PresentationSpec = z.infer<typeof presentationSchema>;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Only content-bound PNG/MP4 files inside this retained bridge's own UUID root. */
export async function readOwnedRecordingMedia(
  root: string,
  file: string,
  hash: string,
  kind: "png" | "mp4",
) {
  if (!path.isAbsolute(file) || !/^[a-f0-9]{64}$/.test(hash))
    throw Error("PRESENTATION_MEDIA_IDENTITY_REQUIRED");
  const base = await fs.realpath(root),
    relative = path.relative(base, path.resolve(file));
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(".." + path.sep)
  )
    throw Error("PRESENTATION_MEDIA_BOUNDARY");
  let cursor = base;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    if ((await fs.lstat(cursor)).isSymbolicLink()) throw Error("PRESENTATION_MEDIA_REPARSE");
  }
  if (path.extname(file).toLowerCase() !== "." + kind) throw Error("PRESENTATION_MEDIA_TYPE");
  const stat = await fs.stat(file),
    max = kind === "png" ? 6 * 1024 * 1024 : 64 * 1024 * 1024;
  if (!stat.isFile() || stat.size > max) throw Error("PRESENTATION_MEDIA_LIMIT");
  const bytes = await fs.readFile(file);
  if (bytes.length > max || sha(bytes) !== hash) throw Error("PRESENTATION_MEDIA_STALE");
  if (
    kind === "png" &&
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw Error("PRESENTATION_PNG_INVALID");
  if (kind === "mp4" && bytes.subarray(4, 8).toString() !== "ftyp")
    throw Error("PRESENTATION_MP4_INVALID");
  return bytes;
}
interface Hooks {
  call: (method: string, args: Record<string, unknown>) => Promise<GameResult>;
  body: (result: GameResult) => Record<string, any>;
  state: (result: GameResult) => CheckState;
  record: (name: string, value: unknown) => Promise<string>;
  checkCancel: () => void;
  camera: () => Promise<TestCheck>;
  media: (
    file: string,
    hash: string,
    kind: "png" | "mp4",
    name: string,
  ) => Promise<{ file: string; sha256: string }>;
}

/** Reuses the existing private game.record once; no parallel bridge or replay. */
export async function runPresentationCheck(input: PresentationSpec, h: Hooks) {
  const args = presentationSchema.parse(input),
    values = new Map<string, unknown>(),
    checks: TestCheck[] = [],
    prefix = "presentation:" + args.id;
  let submitted: boolean | "unknown" = false,
    status: CheckState,
    reason: string | undefined,
    recordingFile: string | undefined;
  const query = async (step: PresentationSpec["before"][number], phase: string) => {
    h.checkCancel();
    const parameters = resolveBatchReferences(step.arguments, values),
      response = await h.call(step.method, parameters as Record<string, unknown>),
      body = h.body(response);
    await h.record(phase + "_" + step.id, response);
    if (h.state(response) !== "passed") throw Error("PRESENTATION_QUERY_UNCONFIRMED: " + step.id);
    const expected = resolveBatchReferences(step.expect, values) as Record<string, unknown>;
    for (const [key, value] of Object.entries(expected))
      if (
        !isDeepStrictEqual(
          resolveBatchReferences({ $from: "reply." + key }, new Map([["reply", body]])),
          value,
        )
      )
        throw Error("PRESENTATION_ASSERTION_FAILED: " + step.id + "." + key);
    values.set(step.id, body);
  };
  try {
    for (const before of args.before) await query(before, "before");
    const camera = await h.camera();
    checks.push(camera);
    if (camera.status !== "passed") throw Error("PRESENTATION_CAMERA_UNCONFIRMED");
    const action = resolveBatchReferences(args.action, values) as PresentationSpec["action"],
      expected = resolveBatchReferences(args.events, values) as Array<{
        id: string;
        match: Record<string, unknown>;
      }>;
    const isAbility = action.method === "game.order" && action.arguments.action === "ability";
    actionEventsSchema.parse({
      action,
      events: expected,
      waitForComplete: isAbility ? args.waitForComplete : false,
    });
    h.checkCancel();
    submitted = "unknown";
    const response = await h.call("game.record", {
        before_seconds: args.beforeSeconds,
        after_seconds: args.afterSeconds,
        fps: args.fps,
        audit_audio: args.auditAudio,
        action,
      }),
      body = h.body(response);
    recordingFile = await h.record("recording", response);
    if (h.state(response) !== "passed") throw Error("PRESENTATION_RECORDING_UNCONFIRMED");
    const accepted = body.action,
      stream = body.events;
    if (
      accepted?.status !== "ok" ||
      (action.method === "game.order" ? accepted.accepted !== true : accepted.accepted === false) ||
      !stream ||
      stream.status !== "ok" ||
      stream.dropped !== false ||
      stream.hasMore ||
      !Array.isArray(stream.events)
    )
      throw Error("PRESENTATION_ACTION_OR_EVENTS_UNCONFIRMED");
    submitted = true;
    if (
      typeof accepted.session !== "string" ||
      !accepted.session ||
      typeof accepted.runtimeEpoch !== "string" ||
      !accepted.runtimeEpoch ||
      !Number.isSafeInteger(accepted.mapLoadSerial) ||
      !Number.isFinite(accepted.gameTime) ||
      ["session", "runtimeEpoch", "mapLoadSerial"].some((key) => accepted[key] !== stream[key])
    )
      throw Error("PRESENTATION_STREAM_IDENTITY_UNCONFIRMED");
    const ability = action.method === "game.order" && action.arguments.action === "ability";
    const targets: Array<{ id: string; match: Record<string, unknown> }> = expected.map((e) => ({
      ...e,
      match: {
        ...e.match,
        ...(ability && e.match.kind === "damage" ? { sourceUnit: action.arguments.unit } : {}),
        ...(ability && e.match.kind === "ability"
          ? { unit: action.arguments.unit, ability: action.arguments.ability }
          : {}),
      },
    }));
    if (ability && args.waitForComplete)
      targets.push({
        id: "$complete",
        match: {
          kind: "ability",
          source: "galaxy",
          unit: action.arguments.unit,
          ability: action.arguments.ability,
          stageName: "complete",
        },
      });
    const matches = targets.map((target) => ({
      id: target.id,
      event: stream.events.find(
        (e: any) =>
          Number.isFinite(e?.gameTime) &&
          e.gameTime >= accepted.gameTime &&
          Object.entries(target.match).every(
            ([key, value]) => Object.hasOwn(e, key) && e[key] === value,
          ),
      ),
    }));
    const matched = matches.every((row) => row.event);
    values.set("observation", {
      actionSubmitted: true,
      status: matched ? "passed" : "inconclusive",
      events: matches,
    });
    const frames = body.frames;
    if (
      !Array.isArray(frames) ||
      frames.length < 2 ||
      frames.length > 180 ||
      !body.video?.path ||
      !body.video?.sha256
    )
      throw Error("PRESENTATION_FRAMES_OR_VIDEO_UNCONFIRMED");
    const indexes = [
      ...new Set(
        Array.from({ length: Math.min(8, frames.length) }, (_, i) =>
          Math.round((i * (frames.length - 1)) / (Math.min(8, frames.length) - 1)),
        ),
      ),
    ];
    for (const index of indexes) {
      h.checkCancel();
      const frame = frames[index];
      if (
        frame?.status !== "ok" ||
        !Number.isFinite(frame.elapsedRealSeconds) ||
        typeof frame.path !== "string" ||
        typeof frame.sha256 !== "string"
      )
        throw Error("PRESENTATION_FRAME_METADATA_UNCONFIRMED");
      const stored = await h.media(frame.path, frame.sha256, "png", "Frame_" + index + ".png");
      checks.push({
        id: prefix + ":frame:" + index,
        status: "passed",
        required: args.required,
        evidence: {
          ...stored,
          visualReview: "not_checked",
          includeUI: frame.includesUI ?? null,
          timeline: {
            index,
            elapsedRealSeconds: frame.elapsedRealSeconds,
            lastObservedGameTime: Number.isFinite(frame.gameTime) ? frame.gameTime : null,
            orderGameTime: accepted.gameTime,
            scope:
              "Presented-frame real time and last-observed Galaxy time; not an exact animation phase label",
          },
        },
      });
    }
    const video = await h.media(body.video.path, body.video.sha256, "mp4", "Video.mp4");
    await h.record("timeline", {
      frames: frames.map((f: any) => ({
        elapsedRealSeconds: f.elapsedRealSeconds,
        gameTime: f.gameTime,
        sha256: f.sha256,
      })),
      actionGameTime: accepted.gameTime,
      matches,
      audio: body.audio,
      video,
    });
    for (const after of args.after) await query(after, "after");
    status = matched ? "passed" : "inconclusive";
    reason = matched ? undefined : "PRESENTATION_EXPECTED_EVENTS_NOT_OBSERVED";
    checks.push({
      id: prefix + ":video",
      status: "passed",
      required: args.required,
      evidence: {
        ...video,
        frameCount: frames.length,
        reviewRequired: true,
        visualAcceptance: "not_checked",
        audioStatus: body.audio?.status ?? "unavailable",
        scope:
          "Owned hash-confirmed recording; audio capture/scheduling does not certify audible content or artistic quality",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "TEST_CANCEL_REQUESTED") throw error;
    status = "inconclusive";
    await h.record("failure", { error: String(error) }).catch(() => undefined);
    reason =
      error instanceof Error && error.message.startsWith("PRESENTATION_")
        ? error.message.slice(0, 640)
        : "PRESENTATION_OPERATION_UNCONFIRMED: inspect private evidence";
  }
  checks.unshift({
    id: prefix,
    status,
    required: args.required,
    reason,
    evidence: {
      actionSubmitted: submitted,
      recordingFile,
      visualAcceptance: "not_checked",
      scope:
        "One recorded normal action, exact post-order event matching and selected real frames. Review actual motion/impact/sound separately.",
    },
  });
  return {
    checks,
    continueSuite:
      submitted !== "unknown" &&
      checks.every((c) => c.status === "passed" || (!c.required && c.status !== "failed")),
  };
}
