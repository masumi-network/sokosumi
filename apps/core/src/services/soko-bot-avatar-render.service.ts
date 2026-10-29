import type { Prisma } from "@sokosumi/database";

import pLimit from "p-limit";

import { fromDbAvatarState } from "@/helpers/soko-bot-avatar-state";
import prisma from "@/lib/db/prisma";
import {
  creatureOf,
  downloadAvatarAsset,
  drawStill,
  storeAvatarAsset,
} from "@/lib/soko-bot-avatar/draw";
import { encodeLoops } from "@/lib/soko-bot-avatar/media";
import {
  avatarProvider,
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
 * 2. **A video whose submit outcome is unknown is never submitted again.** A
 *    row stuck in VIDEO_SUBMITTING, or whose submit call died without an
 *    answer, becomes SUBMISSION_UNCERTAIN. The still stays; the loop is not
 *    retried, because the first request may still be running and billed.
 *
 * Video generation takes minutes, so submitting and collecting are separate
 * steps on separate ticks. Nothing here waits on the provider.
 */

/** A lease covers one still (up to two minutes) or one collect (download, encode, upload). */
const LEASE_MS = 4 * 60 * 1000;
/** Paid attempts per step before the render gives up and the still alone shows. */
export const MAX_RENDER_ATTEMPTS = 3;
/** A video that has not finished by now never will. */
const VIDEO_MAX_AGE_MS = 30 * 60 * 1000;
const RUN_BATCH = 9;
/** More than about four large uploads at once make the Gateway reset connections. */
const CONCURRENCY = 3;

const LIVE_STATUSES = ["PENDING", "STILL_READY", "VIDEO_SUBMITTED"] as const;

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

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : "unknown").slice(0, 300);
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
    const image = await drawStill(style, {
      prompt: stillPrompt(style, state, creatureFor(style, row.avatar.look)),
      reference: await downloadAvatarAsset(row.avatar.imageUrl),
      target: style.backgroundTarget(state),
    });
    const stillUrl = await storeAvatarAsset(image, `${row.avatar.id}-${state}`);
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
  // Claim before the paid call, and say what the lease is for: a row found in
  // VIDEO_SUBMITTING with its lease run out is an unknown outcome.
  const claim = await prisma.sokoBotAvatarRender.updateMany({
    where: { id: row.id, status: "STILL_READY", ...leaseFree(new Date()) },
    data: {
      status: "VIDEO_SUBMITTING",
      leaseUntil: new Date(Date.now() + LEASE_MS),
      attempts: { increment: 1 },
    },
  });
  if (claim.count === 0) return "skipped";
  const attempts = row.attempts + 1;
  try {
    const operation = await avatarProvider().startVideo({
      prompt: loopPrompt(style, state, creatureFor(style, row.avatar.look)),
      imageUrl: row.stillUrl,
      // The same key for the same attempt: a repeat of this request is the same job.
      idempotencyKey: `soko-bot-avatar-render:${row.id}:${attempts}`,
    });
    await prisma.sokoBotAvatarRender.updateMany({
      where: { id: row.id, status: "VIDEO_SUBMITTING" },
      data: {
        status: "VIDEO_SUBMITTED",
        providerOperation: operation as Prisma.InputJsonValue,
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
          leaseUntil: null,
          lastError: errorText(error),
        },
      });
      return "failed";
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
    const polled = await avatarProvider().pollVideo(row.providerOperation);
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
    const loops = await encodeLoops(
      polled.video,
      style.backgroundTarget(state),
    );
    const [loopUrl, loopLargeUrl] = await Promise.all([
      storeAvatarAsset(loops.loop, `${row.avatar.id}-${state}-loop`),
      storeAvatarAsset(loops.loopLarge, `${row.avatar.id}-${state}-loop-large`),
    ]);
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
  options: { shouldContinue?: () => boolean } = {},
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
  const uncertain = await prisma.sokoBotAvatarRender.updateMany({
    where: { status: "VIDEO_SUBMITTING", leaseUntil: { lt: now } },
    data: {
      status: "SUBMISSION_UNCERTAIN",
      leaseUntil: null,
      lastError: "The submit outcome is unknown",
    },
  });
  result.failed += uncertain.count;

  const rows = await prisma.sokoBotAvatarRender.findMany({
    where: {
      status: { in: [...LIVE_STATUSES] },
      avatar: { claimedBySokoBotId: { not: null } },
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
  await Promise.all(
    rows.map((row) =>
      limit(async () => {
        if (options.shouldContinue && !options.shouldContinue()) return;
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
            const outcome = await drawStateStill(row, style);
            if (outcome === "failed") result.failed += 1;
            else result.stills += 1;
          } else if (row.status === "STILL_READY") {
            const outcome = await submitLoop(row, style);
            if (outcome === "submitted") result.submitted += 1;
            if (outcome === "failed") result.failed += 1;
          } else {
            const outcome = await collectLoop(row, style);
            if (outcome === "finished") result.finished += 1;
            if (outcome === "failed") result.failed += 1;
          }
        } catch (error) {
          console.error("Soko Bot avatar render tick failed", {
            renderId: row.id,
            error: errorText(error),
          });
        }
      }),
    ),
  );
  return result;
}
