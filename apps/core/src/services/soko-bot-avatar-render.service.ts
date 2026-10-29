import { randomUUID } from "node:crypto";

import { Prisma } from "@sokosumi/database";

import pLimit from "p-limit";

import { fromDbAvatarState } from "@/helpers/soko-bot-avatar-state";
import prisma from "@/lib/db/prisma";
import {
  creatureOf,
  drawStill,
  errorText,
  storeAvatarAsset,
} from "@/lib/soko-bot-avatar/draw";
import {
  downloadAvatarAsset,
  encodeLoops,
  ensureFfmpeg,
} from "@/lib/soko-bot-avatar/media";
import {
  avatarProvider,
  IMAGE_TIMEOUT_RENDER_MS,
  VideoSubmissionUncertainError,
} from "@/lib/soko-bot-avatar/provider";
import {
  findAvatarStyle,
  freshLook,
  loopPrompt,
  type SokoBotAvatarStyle,
  stillPrompt,
} from "@/lib/soko-bot-avatar/style";
import { sokoBotAvatarLookSchema } from "@/schemas/soko-bot-avatar.schema";
import { getSokoBotAvailability } from "@/services/soko-bot-availability.service";

/**
 * Render a kept avatar's states, one cron tick at a time (ADR 0039: no queue).
 * Each render row moves
 *
 *   PENDING → STILL_READY → VIDEO_SUBMITTING → VIDEO_SUBMITTED → READY
 *
 * and any step can end in FAILED. Two rules carry the design:
 *
 * 1. **A paid call is claimed first.** The right to make it is a lease taken in
 *    one conditional UPDATE that also counts the attempt. A second worker loses
 *    that UPDATE and leaves the row alone.
 * 2. **A video whose submit outcome is unknown waits before it is submitted
 *    again, and then with the same idempotency key.** A row stuck in
 *    VIDEO_SUBMITTING, or whose submit call died without an answer, becomes
 *    SUBMISSION_UNCERTAIN, because the first request may still be running and
 *    billed. After {@link UNCERTAIN_WAIT_MS} it is submitted again, which counts
 *    as an attempt, so it still ends in FAILED after
 *    {@link MAX_RENDER_ATTEMPTS}. The key is one per row (avatar and state), so
 *    a Gateway that honours it returns the first job instead of a second one.
 *
 * Video generation takes minutes, so submitting and collecting are separate
 * steps on separate ticks. Nothing here waits on the provider.
 */

/**
 * A lease outlives the slowest step, or a second tick would reclaim a row that
 * is still being worked. Worst case for a still: download 60 s, image edit
 * 120 s, levels in-process, upload 60 s, about 4 minutes. A collect (poll
 * 30 s, download 60 s, an instance's first ffmpeg fetch 60 s, three ffmpeg
 * runs of 90 s with two in parallel, two uploads) is about 8 minutes.
 */
const LEASE_MS = 10 * 60 * 1000;
/** How long a submit of unknown outcome is left alone before it is submitted again. */
export const UNCERTAIN_WAIT_MS = 30 * 60 * 1000;
/** Paid attempts per step before the render gives up and the still alone shows. */
export const MAX_RENDER_ATTEMPTS = 3;
/** A video that has not finished by now never will. */
const VIDEO_MAX_AGE_MS = 30 * 60 * 1000;
const RUN_BATCH = 9;
/**
 * A step is only started when the run has this long left, so the function's own
 * time limit cannot cut it off half done (and strand its lease and its lock).
 * Sized from what a step takes, not from its worst-case timeouts: a still is an
 * image edit (usually ten seconds, up to 120) plus upload; a collect downloads
 * the clip, may fetch ffmpeg on an instance's first run, and encodes twice.
 */
export const STILL_MIN_BUDGET_MS = 60_000;
export const COLLECT_MIN_BUDGET_MS = 120_000;
/** Collects per run, one at a time: each holds a clip and two encodes in memory and CPU. */
export const MAX_COLLECTS_PER_RUN = 2;
/** More than about four large uploads at once make the Gateway reset connections. */
const CONCURRENCY = 3;

const LIVE_STATUSES = [
  "PENDING",
  "STILL_READY",
  "SUBMISSION_UNCERTAIN",
  "VIDEO_SUBMITTED",
] as const;

type RenderRow = Prisma.SokoBotAvatarRenderGetPayload<{
  include: {
    avatar: {
      select: { id: true; imageUrl: true; styleId: true; look: true };
    };
  };
}>;

export interface RenderRunResult {
  stills: number;
  submitted: number;
  finished: number;
  failed: number;
}

function leaseFree(now: Date): Prisma.SokoBotAvatarRenderWhereInput {
  return { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] };
}

/** The creature a state prompt names, read from the avatar's stored look. */
function creatureFor(style: SokoBotAvatarStyle, look: unknown) {
  const parsed = sokoBotAvatarLookSchema.safeParse(look);
  return creatureOf(
    style,
    (parsed.success ? parsed.data : freshLook(style)).creature,
  );
}

/**
 * Give up on a row, or hand it back for the next tick: a step that threw
 * releases its lease, and the attempt it spent stays counted.
 */
async function settleFailure(
  row: RenderRow,
  error: unknown,
  retryStatus: "PENDING" | "STILL_READY" | "VIDEO_SUBMITTED",
  attempts: number,
): Promise<"retry" | "failed"> {
  const exhausted = attempts >= MAX_RENDER_ATTEMPTS;
  await prisma.sokoBotAvatarRender.updateMany({
    where: { id: row.id },
    data: {
      status: exhausted ? "FAILED" : retryStatus,
      leaseUntil: null,
      lastError: errorText(error),
      // A definite outcome: the next submit is a new job under a new key.
      providerOperation: Prisma.DbNull,
    },
  });
  console.warn("Soko Bot avatar render step failed", {
    renderId: row.id,
    status: row.status,
    exhausted,
    error: errorText(error),
  });
  return exhausted ? "failed" : "retry";
}

/**
 * What a row keeps in `providerOperation`: the idempotency key of the submit it
 * is making, and once the Gateway answers, its operation beside it.
 *
 * The key is stable only across an *uncertain* submit, so that a repeat is the
 * same job. After a definite outcome (refused, or the job failed) it is cleared
 * and the next attempt mints a new one: with the old key the Gateway would hand
 * back the job that already failed.
 */
function storedSubmission(
  value: Prisma.JsonValue,
): { submissionKey: string; operation: Prisma.JsonValue } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { submissionKey, operation } = value;
  return typeof submissionKey === "string"
    ? { submissionKey, operation: operation ?? null }
    : null;
}

async function drawStateStill(
  row: RenderRow,
  style: SokoBotAvatarStyle,
): Promise<"done" | "failed"> {
  const state = fromDbAvatarState(row.state);
  if (state === "idle") return "done";
  const claim = await prisma.sokoBotAvatarRender.updateMany({
    where: { id: row.id, status: "PENDING", ...leaseFree(new Date()) },
    data: {
      leaseUntil: new Date(Date.now() + LEASE_MS),
      attempts: { increment: 1 },
    },
  });
  if (claim.count === 0) return "done";
  const attempts = row.attempts + 1;
  try {
    let timings = { editMs: 0, levelMs: 0 };
    const image = await drawStill(style, {
      prompt: stillPrompt(style, state, creatureFor(style, row.avatar.look)),
      reference: await downloadAvatarAsset(row.avatar.imageUrl),
      target: style.backgroundTarget(state),
      timeoutMs: IMAGE_TIMEOUT_RENDER_MS,
      onTimings: (measured) => {
        timings = measured;
      },
    });
    const uploadStarted = Date.now();
    const stillUrl = await storeAvatarAsset(image, `${row.avatar.id}-${state}`);
    console.info("Soko Bot avatar render step", {
      kind: "avatar_render_still",
      state,
      ...timings,
      uploadMs: Date.now() - uploadStarted,
    });
    await prisma.sokoBotAvatarRender.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: {
        status: "STILL_READY",
        stillUrl,
        attempts: 0,
        leaseUntil: null,
        lastError: null,
      },
    });
    return "done";
  } catch (error) {
    return (await settleFailure(row, error, "PENDING", attempts)) === "failed"
      ? "failed"
      : "done";
  }
}

async function submitLoop(
  row: RenderRow,
  style: SokoBotAvatarStyle,
): Promise<"submitted" | "failed" | "skipped"> {
  const state = fromDbAvatarState(row.state);
  if (!row.stillUrl) return "skipped";
  // An uncertain submit repeats under its own key; anything else is a new job.
  const submissionKey =
    (row.status === "SUBMISSION_UNCERTAIN"
      ? storedSubmission(row.providerOperation)?.submissionKey
      : undefined) ??
    `soko-bot-avatar-render:${row.avatarId}:${state}:${randomUUID()}`;
  // Claim before the paid call, and say what the lease is for: a row found in
  // VIDEO_SUBMITTING with its lease run out is an unknown outcome.
  const claim = await prisma.sokoBotAvatarRender.updateMany({
    where: {
      id: row.id,
      status: { in: ["STILL_READY", "SUBMISSION_UNCERTAIN"] },
      ...leaseFree(new Date()),
    },
    data: {
      status: "VIDEO_SUBMITTING",
      leaseUntil: new Date(Date.now() + LEASE_MS),
      attempts: { increment: 1 },
      // Stored with the claim, so a submit that dies unanswered keeps its key.
      providerOperation: { submissionKey },
    },
  });
  if (claim.count === 0) return "skipped";
  const attempts = row.attempts + 1;
  try {
    const operation = await avatarProvider().startVideo({
      prompt: loopPrompt(style, state, creatureFor(style, row.avatar.look)),
      imageUrl: row.stillUrl,
      idempotencyKey: submissionKey,
    });
    await prisma.sokoBotAvatarRender.updateMany({
      where: { id: row.id, status: "VIDEO_SUBMITTING" },
      data: {
        status: "VIDEO_SUBMITTED",
        providerOperation: { submissionKey, operation },
        submittedAt: new Date(),
        leaseUntil: null,
        lastError: null,
      },
    });
    return "submitted";
  } catch (error) {
    if (error instanceof VideoSubmissionUncertainError) {
      await prisma.sokoBotAvatarRender.updateMany({
        where: { id: row.id, status: "VIDEO_SUBMITTING" },
        data: {
          status: "SUBMISSION_UNCERTAIN",
          // Not eligible again until the wait is over.
          leaseUntil: new Date(Date.now() + UNCERTAIN_WAIT_MS),
          lastError: errorText(error),
        },
      });
      return "skipped";
    }
    // The Gateway answered and refused, so nothing was billed.
    return (await settleFailure(row, error, "STILL_READY", attempts)) ===
      "failed"
      ? "failed"
      : "skipped";
  }
}

async function collectLoop(
  row: RenderRow,
  style: SokoBotAvatarStyle,
  /** Called once the clip is in hand, which is when a collect costs something. */
  onClip: () => void,
): Promise<"finished" | "failed" | "pending"> {
  const state = fromDbAvatarState(row.state);
  const submittedAt = row.submittedAt ?? row.updatedAt;
  if (Date.now() - submittedAt.getTime() > VIDEO_MAX_AGE_MS) {
    await prisma.sokoBotAvatarRender.updateMany({
      where: { id: row.id, status: "VIDEO_SUBMITTED" },
      data: {
        status: "FAILED",
        leaseUntil: null,
        lastError: "The loop did not finish in time",
      },
    });
    return "failed";
  }
  // Polling is free; the lease only keeps two ticks from downloading and
  // encoding the same video.
  const claim = await prisma.sokoBotAvatarRender.updateMany({
    where: { id: row.id, status: "VIDEO_SUBMITTED", ...leaseFree(new Date()) },
    data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (claim.count === 0) return "pending";
  try {
    const stored = storedSubmission(row.providerOperation);
    const collectStarted = Date.now();
    const polled = await avatarProvider().pollVideo(
      // Rows stored before the key travelled with the operation hold it bare.
      stored ? stored.operation : row.providerOperation,
    );
    if (polled.status === "pending") {
      await prisma.sokoBotAvatarRender.updateMany({
        where: { id: row.id },
        data: { leaseUntil: null },
      });
      return "pending";
    }
    if (polled.status === "failed") {
      // The provider reported the job failed, so it is not running: a fresh
      // submit is safe, within the attempt budget.
      await settleFailure(
        row,
        new Error(polled.reason),
        "STILL_READY",
        row.attempts,
      );
      return row.attempts >= MAX_RENDER_ATTEMPTS ? "failed" : "pending";
    }
    onClip();
    // Polling and downloading the clip happen in one provider call.
    const downloadMs = Date.now() - collectStarted;
    // The first encode on an instance fetches ffmpeg; time that apart.
    const ffmpegStarted = Date.now();
    await ensureFfmpeg();
    const ffmpegReadyMs = Date.now() - ffmpegStarted;
    const encodeStarted = Date.now();
    const loops = await encodeLoops(
      polled.video,
      style.backgroundTarget(state),
    );
    const encodeMs = Date.now() - encodeStarted;
    const uploadStarted = Date.now();
    const [loopUrl, loopLargeUrl] = await Promise.all([
      storeAvatarAsset(loops.loop, `${row.avatar.id}-${state}-loop`, "mp4"),
      storeAvatarAsset(
        loops.loopLarge,
        `${row.avatar.id}-${state}-loop-large`,
        "mp4",
      ),
    ]);
    const uploadMs = Date.now() - uploadStarted;
    await prisma.sokoBotAvatarRender.updateMany({
      where: { id: row.id, status: "VIDEO_SUBMITTED" },
      data: {
        status: "READY",
        loopUrl,
        loopLargeUrl,
        leaseUntil: null,
        lastError: null,
      },
    });
    console.info("Soko Bot avatar render step", {
      kind: "avatar_render_collect",
      state,
      downloadMs,
      ffmpegReadyMs,
      encodeMs,
      uploadMs,
      totalMs: Date.now() - collectStarted,
    });
    return "finished";
  } catch (error) {
    // Collecting costs nothing, so the video stays and the next tick tries
    // again until it ages out. Never `STILL_READY`: that would submit again.
    await prisma.sokoBotAvatarRender.updateMany({
      where: { id: row.id },
      data: { leaseUntil: null, lastError: errorText(error) },
    });
    console.warn("Soko Bot avatar loop could not be collected", {
      renderId: row.id,
      error: errorText(error),
    });
    return "pending";
  }
}

/**
 * One cron tick. Paid steps run only while Soko Bots are enabled, and only for
 * avatars a bot still holds.
 */
export async function reconcileAvatarRenders(
  options: {
    shouldContinue?: () => boolean;
    /** Time left in this run (the sync context's `msRemaining`). Unset: no limit. */
    msRemaining?: () => number;
  } = {},
): Promise<RenderRunResult> {
  const result: RenderRunResult = {
    stills: 0,
    submitted: 0,
    finished: 0,
    failed: 0,
  };
  if ((await getSokoBotAvailability()).disabled) return result;

  const now = new Date();
  // A submit whose lease ran out without an answer: the request may be running.
  await prisma.sokoBotAvatarRender.updateMany({
    where: { status: "VIDEO_SUBMITTING", leaseUntil: { lt: now } },
    data: {
      status: "SUBMISSION_UNCERTAIN",
      leaseUntil: new Date(now.getTime() + UNCERTAIN_WAIT_MS),
      lastError: "The submit outcome is unknown",
    },
  });

  const rows = await prisma.sokoBotAvatarRender.findMany({
    where: {
      status: { in: [...LIVE_STATUSES] },
      // A look a live bot holds. A deleted bot keeps its claim as a tombstone.
      avatar: {
        claimedBySokoBotId: { not: null },
        claimedBySokoBot: { deletedAt: null },
      },
      ...leaseFree(now),
    },
    orderBy: { createdAt: "asc" },
    take: RUN_BATCH,
    include: {
      avatar: {
        select: { id: true, imageUrl: true, styleId: true, look: true },
      },
    },
  });

  const limit = pLimit(CONCURRENCY);
  // Collects run one at a time, apart from the stills and submits.
  const collectLimit = pLimit(1);
  let collected = 0;
  // Checked when a step is about to start, not when it was queued: it may have
  // waited behind others. A step that does not fit is left whole for the next run.
  const hasBudget = (needMs: number) =>
    (!options.shouldContinue || options.shouldContinue()) &&
    (!options.msRemaining || options.msRemaining() >= needMs);
  await Promise.all(
    rows.map((row) => {
      const collects = row.status === "VIDEO_SUBMITTED";
      return (collects ? collectLimit : limit)(async () => {
        if (!hasBudget(0)) return;
        const style = findAvatarStyle(row.avatar.styleId);
        if (!style) {
          // A style this deploy does not know cannot be drawn.
          await prisma.sokoBotAvatarRender.updateMany({
            where: { id: row.id },
            data: { status: "FAILED", lastError: "Unknown avatar style" },
          });
          result.failed += 1;
          return;
        }
        try {
          if (
            row.attempts >= MAX_RENDER_ATTEMPTS &&
            row.status !== "VIDEO_SUBMITTED"
          ) {
            await prisma.sokoBotAvatarRender.updateMany({
              where: { id: row.id },
              data: { status: "FAILED", leaseUntil: null },
            });
            result.failed += 1;
            return;
          }
          if (row.status === "PENDING") {
            if (!hasBudget(STILL_MIN_BUDGET_MS)) return;
            const outcome = await drawStateStill(row, style);
            if (outcome === "failed") result.failed += 1;
            else result.stills += 1;
          } else if (
            row.status === "STILL_READY" ||
            row.status === "SUBMISSION_UNCERTAIN"
          ) {
            const outcome = await submitLoop(row, style);
            if (outcome === "submitted") result.submitted += 1;
            if (outcome === "failed") result.failed += 1;
          } else {
            if (collected >= MAX_COLLECTS_PER_RUN) return;
            if (!hasBudget(COLLECT_MIN_BUDGET_MS)) return;
            const outcome = await collectLoop(row, style, () => {
              collected += 1;
            });
            if (outcome === "finished") result.finished += 1;
            if (outcome === "failed") result.failed += 1;
          }
        } catch (error) {
          console.error("Soko Bot avatar render tick failed", {
            renderId: row.id,
            error: errorText(error),
          });
        }
      });
    }),
  );
  return result;
}
