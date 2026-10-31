import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import * as z from "zod/v4";
import sharp from "sharp";
import type { Workspace } from "../../core/workspace.js";
import type { TestCheck } from "./schemas.js";
import { assessNativeFrame } from "../../integrations/native/frameAssessment.js";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const visualReviewSchema = z
  .object({
    jobId: z.string().uuid(),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(8).default(6),
  })
  .strict();
export const visualCompareSchema = z
  .object({
    baselineJobId: z.string().uuid(),
    candidateJobId: z.string().uuid(),
    limit: z.number().int().min(1).max(4).default(4),
  })
  .strict()
  .refine((v) => v.baselineJobId !== v.candidateJobId, "Select two distinct completed jobs");
export const visualObservationSchema = z
  .object({
    jobId: z.string().uuid(),
    images: z
      .array(z.object({ id: z.string().min(1).max(160), sha256: hash }).strict())
      .min(1)
      .max(8),
    observations: z
      .array(
        z
          .object({
            imageId: z.string().min(1).max(160),
            subject: z.string().min(1).max(128),
            aspect: z.enum([
              "framing",
              "composition",
              "scale",
              "attack",
              "cast",
              "travel",
              "impact",
              "cleanup",
              "ui",
              "other",
            ]),
            state: z.enum(["observed", "needs_change", "not_observed"]),
            detail: z.string().trim().min(3).max(640),
            nextChange: z.string().trim().min(3).max(640).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(24),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set(value.images.map((image) => image.id));
    if (ids.size !== value.images.length)
      ctx.addIssue({ code: "custom", message: "Duplicate review image" });
    for (const observation of value.observations) {
      if (!ids.has(observation.imageId))
        ctx.addIssue({ code: "custom", message: "Observation image is not selected" });
      if (observation.state === "needs_change" && !observation.nextChange)
        ctx.addIssue({
          code: "custom",
          message: "A needs_change finding requires a concrete nextChange",
        });
    }
  });
export interface VisualReviewContext {
  id: string;
  state: string;
  directory: string;
  sourceSha256: string;
  testedSha256: string;
  checks: TestCheck[];
  unchanged: () => Promise<void>;
}

function candidates(context: VisualReviewContext) {
  return context.checks.filter(
    (check) =>
      check.status === "passed" &&
      check.evidence?.mapConfirmed !== false &&
      typeof check.evidence?.file === "string" &&
      /\.png$/i.test(check.evidence.file) &&
      typeof check.evidence.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(check.evidence.sha256),
  );
}
async function readImage(workspace: Workspace, context: VisualReviewContext, check: TestCheck) {
  const file = workspace.resolveUserPath(check.evidence!.file as string);
  if (path.dirname(file) !== workspace.resolveUserPath(context.directory) || !/\.png$/i.test(file))
    throw Error("VISUAL_REVIEW_IMAGE_BOUNDARY");
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 6 * 1024 * 1024)
    throw Error("VISUAL_REVIEW_IMAGE_INVALID");
  const bytes = await fs.readFile(file);
  if (
    bytes.length > 6 * 1024 * 1024 ||
    digest(bytes) !== check.evidence!.sha256 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw Error("VISUAL_REVIEW_IMAGE_STALE");
  return { file, bytes };
}
async function ready(context: VisualReviewContext) {
  if (context.state !== "completed") throw Error("VISUAL_REVIEW_COMPLETED_JOB_REQUIRED");
  await context.unchanged();
}
const escape = (s: string) =>
  s
    .replace(/[\p{Cc}]/gu, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** Review existing confirmed engine frames; this never launches or replays a test. */
export async function prepareVisualReview(
  workspace: Workspace,
  context: VisualReviewContext,
  input: z.input<typeof visualReviewSchema>,
) {
  const args = visualReviewSchema.parse(input);
  if (args.jobId !== context.id) throw Error("VISUAL_REVIEW_JOB_MISMATCH");
  await ready(context);
  const all = candidates(context),
    selected = all.slice(args.offset, args.offset + args.limit);
  const images = [],
    tiles = [];
  for (const [index, check] of selected.entries()) {
    const { file, bytes } = await readImage(workspace, context, check);
    const contentAssessment = await assessNativeFrame(bytes);
    const thumb = await sharp(bytes, { limitInputPixels: 16 * 1024 * 1024 })
      .resize(320, 180, { fit: "contain", background: "#141a20" })
      .png()
      .toBuffer();
    const label = Buffer.from(
      `<svg width="320" height="28"><rect width="320" height="28" fill="#141a20"/><text x="8" y="19" font-family="Arial" font-size="13" fill="white">${escape(check.id.slice(0, 44))}</text></svg>`,
    );
    tiles.push(
      { input: thumb, left: (index % 2) * 320, top: Math.floor(index / 2) * 208 },
      { input: label, left: (index % 2) * 320, top: Math.floor(index / 2) * 208 + 180 },
    );
    images.push({
      id: check.id,
      file,
      sha256: check.evidence!.sha256,
      contentAssessment,
      visualReview: "not_checked",
      camera: check.evidence!.observed ?? null,
      timeline: check.evidence!.timeline ?? null,
      includeUI: check.evidence!.includeUI ?? null,
    });
  }
  await ready(context);
  let contactSheet: { file: string; sha256: string } | undefined;
  if (selected.length) {
    const bytes = await sharp({
      create: {
        width: 640,
        height: Math.ceil(selected.length / 2) * 208,
        channels: 3,
        background: "#141a20",
      },
    })
      .composite(tiles)
      .png()
      .toBuffer();
    const file = workspace.resolveUserPath(
      path.join(context.directory, `Review_${digest(bytes).slice(0, 20)}.png`),
    );
    await fs.writeFile(file, bytes);
    contactSheet = { file, sha256: digest(bytes) };
  }
  await ready(context);
  return {
    jobId: context.id,
    sourceSha256: context.sourceSha256,
    testedArtifactSha256: context.testedSha256,
    total: all.length,
    offset: args.offset,
    nextOffset: args.offset + args.limit < all.length ? args.offset + args.limit : null,
    images,
    contactSheet,
    reviewRequired: true,
    visualAcceptance: "not_checked",
    humanApproval: false,
    scope:
      "Existing confirmed native PNGs and source identity; image content signals and a contact sheet do not certify art, animation timing or sound",
    next: images.length
      ? "Inspect the pixels, then record image-bound observations with concrete repairs. Apply repairs through normal MCP tools and rerun only the affected case."
      : "No confirmed reviewable native frames. Declare the needed views in the existing test manifest; a log or Actor count is not an image.",
  };
}

export async function recordVisualObservations(
  workspace: Workspace,
  context: VisualReviewContext,
  input: z.input<typeof visualObservationSchema>,
) {
  const args = visualObservationSchema.parse(input);
  if (args.jobId !== context.id) throw Error("VISUAL_REVIEW_JOB_MISMATCH");
  await ready(context);
  const all = candidates(context);
  for (const image of args.images) {
    const matches = all.filter((check) => check.id === image.id);
    if (matches.length !== 1 || matches[0].evidence!.sha256 !== image.sha256)
      throw Error("VISUAL_OBSERVATION_IMAGE_UNCONFIRMED");
    await readImage(workspace, context, matches[0]);
  }
  await ready(context);
  const record = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    jobId: context.id,
    sourceSha256: context.sourceSha256,
    testedArtifactSha256: context.testedSha256,
    images: args.images,
    observations: args.observations,
    origin: "agent_observation",
    humanApproval: false,
    visualAcceptance: "not_certified",
    needsChanges: args.observations.some((o) => o.state === "needs_change"),
    coverage: "Selected still frames only; no automatic repair or native gameplay verdict upgrade",
  };
  const file = workspace.resolveUserPath(
    path.join(context.directory, `ReviewNotes_${randomUUID()}.json`),
  );
  await fs.writeFile(file, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  return { file, ...record };
}

/** Compare a pinned historical artifact with the current candidate, never relabel it current. */
export async function compareVisualReviews(
  workspace: Workspace,
  baseline: VisualReviewContext,
  candidate: VisualReviewContext,
  input: z.input<typeof visualCompareSchema>,
) {
  const args = visualCompareSchema.parse(input);
  if (args.baselineJobId !== baseline.id || args.candidateJobId !== candidate.id)
    throw Error("VISUAL_COMPARE_JOB_MISMATCH");
  await ready(baseline);
  await ready(candidate);
  const old = candidates(baseline),
    next = candidates(candidate),
    paired = next
      .flatMap((check) => {
        const matches = old.filter((prior) => prior.id === check.id);
        return matches.length === 1 ? [{ baseline: matches[0], candidate: check }] : [];
      })
      .slice(0, args.limit);
  const tiles = [],
    pairs = [];
  for (const [index, pair] of paired.entries()) {
    for (const [side, context, check] of [
      [0, baseline, pair.baseline],
      [1, candidate, pair.candidate],
    ] as const) {
      const { bytes, file } = await readImage(workspace, context, check),
        thumb = await sharp(bytes, { limitInputPixels: 16 * 1024 * 1024 })
          .resize(320, 180, { fit: "contain", background: "#141a20" })
          .png()
          .toBuffer();
      tiles.push({ input: thumb, left: side * 320, top: index * 208 });
      const label = Buffer.from(
        `<svg width="320" height="28"><rect width="320" height="28" fill="#141a20"/><text x="8" y="19" font-family="Arial" font-size="12" fill="white">${side ? "CANDIDATE" : "BASELINE"} ${escape(check.id.slice(0, 32))}</text></svg>`,
      );
      tiles.push({ input: label, left: side * 320, top: index * 208 + 180 });
      if (side === 0)
        pairs.push({
          id: check.id,
          baseline: { file, sha256: check.evidence!.sha256 },
          candidate: {
            file: workspace.resolveUserPath(pair.candidate.evidence!.file as string),
            sha256: pair.candidate.evidence!.sha256,
          },
          imageBytesChanged: check.evidence!.sha256 !== pair.candidate.evidence!.sha256,
        });
    }
  }
  let contactSheet: { file: string; sha256: string } | undefined;
  if (paired.length) {
    const bytes = await sharp({
        create: { width: 640, height: paired.length * 208, channels: 3, background: "#141a20" },
      })
        .composite(tiles)
        .png()
        .toBuffer(),
      file = workspace.resolveUserPath(
        path.join(candidate.directory, "Compare_" + digest(bytes).slice(0, 20) + ".png"),
      );
    await fs.writeFile(file, bytes);
    contactSheet = { file, sha256: digest(bytes) };
  }
  await ready(baseline);
  await ready(candidate);
  return {
    baselineJobId: baseline.id,
    candidateJobId: candidate.id,
    baselineSourceSha256: baseline.sourceSha256,
    candidateSourceSha256: candidate.sourceSha256,
    sourceChanged: baseline.sourceSha256 !== candidate.sourceSha256,
    baselineHistorical: true,
    candidateCurrent: true,
    pairs,
    contactSheet,
    unpairedCandidateIds: next
      .filter((check) => !old.some((prior) => prior.id === check.id))
      .slice(0, 16)
      .map((check) => check.id),
    humanApproval: false,
    visualAcceptance: "not_certified",
    scope:
      "Pinned historical tested artifact/PNG hashes versus a current candidate. Baseline original inputs and external dependencies are not revalidated as current. Changed pixels do not prove an improvement; compare framing, phase timing and actual content, then record observations.",
  };
}
