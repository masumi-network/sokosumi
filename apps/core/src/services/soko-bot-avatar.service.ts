import crypto from "node:crypto";

import type { Prisma } from "@sokosumi/database";

import { HTTPException } from "hono/http-exception";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import {
  notFound,
  tooManyRequests,
  unprocessableEntity,
} from "@/helpers/error";
import { toDbAvatarState } from "@/helpers/soko-bot-avatar-state";
import prisma from "@/lib/db/prisma";
import {
  CONCURRENCY_CONFLICT_KIND,
  serializableTransaction,
} from "@/lib/db/transaction";
import {
  drawStill,
  loadHouseScene,
  planShuffle,
  storeAvatarAsset,
} from "@/lib/soko-bot-avatar/draw";
import { AVATAR_IMAGE_MODEL } from "@/lib/soko-bot-avatar/provider";
import {
  AVATAR_STATES,
  type AvatarLook,
  CURRENT_AVATAR_STYLE,
  findAvatarStyle,
  type SokoBotAvatarStyle,
} from "@/lib/soko-bot-avatar/style";
import { getSokoBotAvailability } from "@/services/soko-bot-availability.service";

/**
 * Avatar pool and claim for Soko Bots. The pool holds fresh looks drawn in the
 * current style (the house scene with a random creature, maybe an accessory);
 * a bot claims exactly one, and claiming a crafted look gives it one render per
 * state (see `soko-bot-avatar-render.service`). The pool is topped up when it
 * runs low so onboarding always has choices. Legacy mascot rows are read and
 * claimed as before, never drawn again.
 */

const MAX_TOP_UP_PER_CALL = 6;
const GENERATION_WINDOW_MS = 60 * 60 * 1000;
export const KEEP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A draw this run owns, and the empty row holding it. */
interface AvatarReservation {
  id: string;
  style: SokoBotAvatarStyle;
  look: AvatarLook;
  prompt: string;
  seed: number;
}

/** Thrown when the caller has no hourly allowance left. Nothing is billed. */
export class AvatarGenerationCappedError extends Error {}

/** A random positive int; with 31 bits a clash on the unique key is negligible. */
export function randomAvatarSeed(): number {
  return crypto.randomInt(1, 2 ** 31 - 1);
}

/** The unique-key columns of a look: creature, what it wears, a random seed. */
export function avatarRowKey(
  style: SokoBotAvatarStyle,
  look: AvatarLook,
  seed: number,
) {
  return {
    subject: look.creature,
    background: `${style.id}:${[...look.accessories].sort().join("+") || "none"}`,
    seed,
  };
}

/** Whether the pool can draw at all: it needs the Gateway and a blob store. */
export function canDraw(): boolean {
  const env = getEnv();
  return Boolean(env.AI_GATEWAY_API_KEY && env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Claim draws under the caller's hourly allowance, in one atomic step.
 *
 * Counting and inserting have to be the same operation. As two statements,
 * concurrent requests all read the same count, all pass, and each then buys a
 * full batch: the cap bounded a serial loop and not a burst. Reserving alone
 * does not fix that either, because the count still happens first.
 *
 * Serializable is the repo's answer for this (see `serializableTransaction`,
 * used for credit consumption). Paid image generation is credit consumption.
 * Postgres aborts the losers of a race, the helper retries them with backoff,
 * and each retry re-reads a count that now includes the winner's rows.
 *
 * Nothing here touches the network. The images are bought after this returns,
 * so the transaction never waits on the provider.
 */
async function reserveDraws(
  count: number,
  requestedByUserId: string | null,
  style: SokoBotAvatarStyle,
): Promise<AvatarReservation[]> {
  return await serializableTransaction(async (tx) => {
    let allowed = count;
    if (requestedByUserId) {
      const recent = await tx.sokoBotAvatar.count({
        where: {
          requestedByUserId,
          // Studio drafts have their own allowance.
          draftForSokoBotId: null,
          createdAt: { gte: new Date(Date.now() - GENERATION_WINDOW_MS) },
        },
      });
      const remaining = LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR - recent;
      if (remaining <= 0) throw new AvatarGenerationCappedError();
      // Shrink to fit rather than only asking "are you under the cap". That
      // question passes a user sitting at 23 and then buys a full page of 6.
      allowed = Math.min(allowed, remaining);
    }

    const reservations: AvatarReservation[] = [];
    for (let i = 0; i < allowed; i += 1) {
      const plan = planShuffle(style);
      if (plan.kind !== "edit") continue;
      const seed = randomAvatarSeed();
      // Sequential on purpose: Prisma does not support concurrent queries on
      // one interactive transaction client.
      const row = await tx.sokoBotAvatar.create({
        data: {
          ...avatarRowKey(style, plan.look, seed),
          model: AVATAR_IMAGE_MODEL,
          styleId: style.id,
          styleVersion: style.version,
          look: plan.look,
          requestedByUserId,
          // Filled in once the image exists. `reservedAt` keeps the row out of
          // every read until then, so nobody sees or claims a blank avatar.
          imageUrl: "",
          reservedAt: new Date(),
        },
        select: { id: true },
      });
      reservations.push({
        id: row.id,
        style,
        look: plan.look,
        prompt: plan.prompt,
        seed,
      });
    }
    return reservations;
  }, "Another avatar top-up is running. Try again.");
}

/** Buy the image for a reservation and publish the row. */
async function fillReservation(reservation: AvatarReservation): Promise<void> {
  const { style } = reservation;
  const image = await drawStill(style, {
    prompt: reservation.prompt,
    reference: await loadHouseScene(style),
    target: style.backgroundTarget("idle"),
  });
  const imageUrl = await storeAvatarAsset(
    image,
    `${reservation.look.creature}-${reservation.seed}`,
  );
  // Clearing `reservedAt` is what publishes the row.
  await prisma.sokoBotAvatar.update({
    where: { id: reservation.id },
    data: { imageUrl, reservedAt: null },
  });
}

/**
 * Give back reservations this run never spent on.
 *
 * Only for draws whose image was never requested. A reservation whose provider call
 * may have run stays, because it represents money and the cap should see it
 * until it ages out of the window.
 */
async function releaseReservations(
  reservations: AvatarReservation[],
): Promise<void> {
  if (reservations.length === 0) return;
  try {
    await prisma.sokoBotAvatar.deleteMany({
      where: { id: { in: reservations.map((one) => one.id) } },
    });
  } catch (error) {
    // Giving slots back is a courtesy, not the outcome the caller waited for.
    // This runs while handling a failure the caller is meant to survive, and
    // the same blip that broke the run can break the delete, so letting it
    // throw would turn a degraded read into a 500. The cron sweep is the
    // backstop: these rows carry `reservedAt` and age out on their own.
    console.warn("Soko Bot avatar reservations could not be released", {
      count: reservations.length,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** Reads `kind` off an HTTPException cause without trusting its shape. */
function httpExceptionKind(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("kind" in cause)) {
    return undefined;
  }
  const { kind } = cause;
  return typeof kind === "string" ? kind : undefined;
}

/**
 * Generation failures that say nothing about the existing pool: the caller's
 * hourly allowance is spent, or a concurrent top-up won the serialization
 * race. In both cases the rows already in the pool are still perfectly
 * readable, so the caller should get them rather than an error.
 */
function isRecoverableGenerationFailure(error: unknown): boolean {
  if (error instanceof AvatarGenerationCappedError) return true;
  return (
    error instanceof HTTPException &&
    error.status === 409 &&
    httpExceptionKind(error.cause) === CONCURRENCY_CONFLICT_KIND
  );
}

/**
 * @param requestedByUserId The user whose top-up caused this run, or null when
 * the pool cron ran it and no user asked for anything. The per-user generation
 * cap counts these rows, so a user-triggered run that leaves this null is spend
 * charged to nobody.
 */
export async function generateAvatars(
  count: number,
  requestedByUserId: string | null = null,
  style: SokoBotAvatarStyle = CURRENT_AVATAR_STYLE,
): Promise<number> {
  const reservations = await reserveDraws(
    Math.min(count, MAX_TOP_UP_PER_CALL),
    requestedByUserId,
    style,
  );
  if (reservations.length === 0) return 0;

  // Fill one before committing to the rest. the provider bills for an image whether or
  // not we manage to store it, so a misconfigured blob token would otherwise
  // buy six images every cron run, for ever, while the pool never fills and
  // nothing louder than a warning is written.
  const [probe, ...rest] = reservations;
  try {
    await fillReservation(probe);
  } catch (error) {
    console.error("Soko Bot avatar generation failed; skipping this run", {
      attempted: reservations.length,
      error: error instanceof Error ? error.message : "unknown",
    });
    // The probe may have been billed, so its row stays and counts. The rest
    // were never attempted, so hand their draws and their allowance back.
    await releaseReservations(rest);
    return 0;
  }
  if (rest.length === 0) return 1;

  const results = await Promise.allSettled(rest.map(fillReservation));
  let generated = 1;
  for (const result of results) {
    if (result.status === "fulfilled") {
      generated += 1;
      continue;
    }
    console.warn("Soko Bot avatar generation failed", {
      error: result.reason instanceof Error ? result.reason.message : "unknown",
    });
  }
  return generated;
}

export interface AvailableAvatar {
  id: string;
  imageUrl: string;
  subject: string;
  background: string;
}

/** Unclaimed avatars the pool should hold before a picker ever asks. */
export const AVATAR_POOL_FLOOR = 24;

/**
 * Fills the pool back to {@link AVATAR_POOL_FLOOR}. Runs on a cron so image
 * generation never happens inside a page render: the sidebar asks for avatars
 * on every route, and generating a dozen images inline would block it.
 */
export async function stockAvatarPool(): Promise<{
  available: number;
  generated: number;
}> {
  // Ahead of both gates below. Sweeping buys nothing and writes no images, and
  // a dead reservation hides its draw from every future run, so leaving it
  // behind a disabled flag means it is never cleaned up at all.
  await sweepStaleReservations();
  await sweepExpiredDrafts();
  if (!canDraw()) return { available: 0, generated: 0 };
  // "Disable Soko Bot" has to mean no paid model calls of any kind. Avatar
  // generation is the one that has nothing to do with turns, so the turn gate
  // never sees it.
  if ((await getSokoBotAvailability()).disabled) {
    return { available: 0, generated: 0 };
  }
  const available = await prisma.sokoBotAvatar.count({
    where: unclaimedAvatarFilter(),
  });
  if (available >= AVATAR_POOL_FLOOR) return { available, generated: 0 };
  let generated = 0;
  try {
    generated = await generateAvatars(AVATAR_POOL_FLOOR - available);
  } catch (error) {
    // A competing top-up can exhaust the reservation retries. The next cron
    // run can try again; unrelated failures must still reach the sync handler.
    if (!isRecoverableGenerationFailure(error)) throw error;
  }
  return { available: available + generated, generated };
}

/**
 * Delete reservations whose run never finished.
 *
 * A process killed between claiming a draw and storing its image leaves a row
 * that can never be filled, and it holds that (subject, background, seed)
 * against every future run. The cutoff is past the generation timeout, so a
 * reservation still in flight is never swept out from under its own run.
 *
 * Stale rows are kept for a full window on purpose: they represent image spend
 * and the hourly cap should see them until they age out of it.
 */
async function sweepStaleReservations(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - GENERATION_WINDOW_MS);
  await prisma.sokoBotAvatar.deleteMany({
    // Aged off `createdAt`, which the cap also reads, so the two windows are
    // the same clock and cancel exactly. `reservedAt` comes from the Core
    // process, so ageing off it would let a lagging instance sweep a row
    // before it leaves the cap window and hand that allowance back early.
    where: { reservedAt: { not: null }, createdAt: { lt: cutoff } },
  });
}

/** The 429 for a caller who has spent their hourly allowance. */
function avatarGenerationCapped() {
  return tooManyRequests(
    `You can generate at most ${LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR} avatar looks per hour. Try again later.`,
    { kind: "avatar_generation_rate_limited" },
  );
}

function unclaimedAvatarFilter(excludeIds?: string[]) {
  return {
    claimedBySokoBotId: null,
    // A reserved row has no image yet. Counting it as available would let the
    // pool look full while every slot in it is still in flight.
    reservedAt: null,
    // A draft, or a kept look its bot replaced, is private to that bot.
    draftForSokoBotId: null,
    ...(excludeIds?.length ? { id: { notIn: excludeIds } } : {}),
  };
}

/** Unclaimed avatars for a picker. Reads only; never generates. */
export async function listAvailableAvatars(
  take: number,
  options: { excludeIds?: string[] } = {},
): Promise<AvailableAvatar[]> {
  const rows = await prisma.sokoBotAvatar.findMany({
    where: unclaimedAvatarFilter(options.excludeIds),
    orderBy: [{ createdAt: "desc" }],
    take,
    select: { id: true, imageUrl: true, subject: true, background: true },
  });
  return rows;
}

/**
 * Fill a short pool, then read it back. The cron keeps the pool full in
 * production, but Vercel runs crons on production deployments only, so the
 * creation picker asks to fill it explicitly rather than showing an empty grid
 * on every preview.
 *
 * This spends image budget and writes rows, so it belongs behind a POST. The
 * caller here is waiting on purpose; decorative reads use
 * `listAvailableAvatars` so a page render never waits on image generation.
 */
export async function topUpAvailableAvatars(
  take: number,
  options: { excludeIds?: string[]; requestedByUserId?: string } = {},
): Promise<AvailableAvatar[]> {
  if (canDraw()) {
    // Count the real pool, not the caller's filtered view of it. Counting
    // through `excludeIds` let a caller list the pool, hand the ids straight
    // back, and drive the count to zero, so generation ran on a pool that
    // needed nothing. Each image is billed, so that is spend on demand.
    const available = await prisma.sokoBotAvatar.count({
      where: unclaimedAvatarFilter(),
    });
    if (available < take) {
      // The cron is the usual sweeper, but Vercel runs crons on production
      // only, and this route exists precisely because preview has no cron. A
      // reservation whose run died there would otherwise hold its draw and
      // the user's allowance until somebody deployed to production.
      await sweepStaleReservations();
      try {
        await generateAvatars(
          take - available,
          options.requestedByUserId ?? null,
        );
      } catch (error) {
        if (!isRecoverableGenerationFailure(error)) throw error;
        // Neither a spent allowance nor a lost race says anything about what
        // the pool already holds, and reads are free. Serve what is there and
        // surface the failure only when that turns out to be nothing.
        const fallback = await listAvailableAvatars(take, options);
        if (fallback.length > 0) return fallback;
        throw error instanceof AvatarGenerationCappedError
          ? avatarGenerationCapped()
          : error;
      }
    }
  }
  return await listAvailableAvatars(take, options);
}

/**
 * Delete drafts and replaced looks past their expiry, and private looks whose
 * bot was deleted (no expiry left once a bot claimed them), unless a bot holds
 * them. Renders go with them (cascade).
 */
export async function sweepExpiredDrafts(
  now: Date = new Date(),
): Promise<number> {
  const { count } = await prisma.sokoBotAvatar.deleteMany({
    where: {
      claimedBySokoBotId: null,
      OR: [
        { draftExpiresAt: { lt: now } },
        { draftForSokoBotId: { not: null }, draftExpiresAt: null },
      ],
    },
  });
  return count;
}

async function assertKeepAllowance(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const kept = await tx.sokoBotAvatar.count({
    where: {
      keptByUserId: userId,
      keptAt: { gte: new Date(Date.now() - KEEP_WINDOW_MS) },
    },
  });
  if (kept >= LIMITS.SOKO_BOT_AVATAR_KEEPS_PER_DAY) {
    throw tooManyRequests(
      `You can keep at most ${LIMITS.SOKO_BOT_AVATAR_KEEPS_PER_DAY} new looks per day. Try again tomorrow.`,
      { kind: "avatar_keep_rate_limited" },
    );
  }
}

/**
 * Give an avatar to a bot, releasing whatever it held before. The unique index
 * on `claimedBySokoBotId` guarantees one avatar per bot; the updateMany guard
 * guarantees one bot per avatar.
 *
 * Claiming a crafted look is keeping it: it counts against `by`'s daily keep
 * cap (staff pass `null`), the bot's other drafts go, and one render row per
 * state is created for the cron to work through. A look the bot held that was
 * kept before is not released to the pool: it stays private to the bot until
 * it expires.
 */
export async function claimAvatar(
  sokoBotId: string,
  avatarId: string,
  outerTx?: Prisma.TransactionClient,
  by: { userId: string } | null = null,
): Promise<string> {
  const run = async (tx: Prisma.TransactionClient) => {
    const avatar = await tx.sokoBotAvatar.findUnique({
      where: { id: avatarId },
      select: {
        id: true,
        imageUrl: true,
        claimedBySokoBotId: true,
        reservedAt: true,
        styleId: true,
        keptAt: true,
        draftForSokoBotId: true,
        draftExpiresAt: true,
      },
    });
    if (!avatar) throw notFound("Avatar not found");
    // Its image is still in flight, so claiming it would set the bot's avatar
    // to an empty URL that nothing ever fills in.
    if (avatar.reservedAt) throw notFound("Avatar not found");
    // A draft is private to its bot, and an expired one is as good as swept.
    if (avatar.draftForSokoBotId && avatar.draftForSokoBotId !== sokoBotId) {
      throw notFound("Avatar not found");
    }
    const now = new Date();
    if (
      !avatar.keptAt &&
      avatar.draftExpiresAt &&
      avatar.draftExpiresAt < now
    ) {
      throw notFound("Avatar not found");
    }
    if (avatar.claimedBySokoBotId && avatar.claimedBySokoBotId !== sokoBotId) {
      throw unprocessableEntity("This avatar was just taken by another bot");
    }
    const crafted = findAvatarStyle(avatar.styleId) !== null;
    const firstKeep = crafted && !avatar.keptAt;
    if (firstKeep && by) await assertKeepAllowance(tx, by.userId);

    // The look it held before: private to the bot if it was kept (the daily
    // cap reads it), back in the pool if it never was.
    await tx.sokoBotAvatar.updateMany({
      where: {
        claimedBySokoBotId: sokoBotId,
        id: { not: avatarId },
        keptAt: { not: null },
      },
      data: {
        claimedBySokoBotId: null,
        claimedAt: null,
        draftForSokoBotId: sokoBotId,
        draftExpiresAt: new Date(now.getTime() + KEEP_WINDOW_MS),
      },
    });
    await tx.sokoBotAvatar.updateMany({
      where: {
        claimedBySokoBotId: sokoBotId,
        id: { not: avatarId },
        keptAt: null,
      },
      data: { claimedBySokoBotId: null, claimedAt: null },
    });
    const claimed = await tx.sokoBotAvatar.updateMany({
      where: {
        id: avatarId,
        OR: [{ claimedBySokoBotId: null }, { claimedBySokoBotId: sokoBotId }],
      },
      data: {
        claimedBySokoBotId: sokoBotId,
        claimedAt: now,
        ...(crafted ? { draftExpiresAt: null } : {}),
        ...(firstKeep ? { keptAt: now, keptByUserId: by?.userId ?? null } : {}),
      },
    });
    if (claimed.count === 0) {
      throw unprocessableEntity("This avatar was just taken by another bot");
    }
    await tx.sokoBot.update({
      where: { id: sokoBotId },
      data: { avatarImageUrl: avatar.imageUrl },
    });
    if (crafted) {
      // The idle still is the look itself; the other states are drawn by the cron.
      await tx.sokoBotAvatarRender.createMany({
        data: AVATAR_STATES.map((state) => ({
          avatarId,
          state: toDbAvatarState(state),
          ...(state === "idle"
            ? { status: "STILL_READY" as const, stillUrl: avatar.imageUrl }
            : {}),
        })),
        skipDuplicates: true,
      });
      await tx.sokoBotAvatar.deleteMany({
        where: {
          draftForSokoBotId: sokoBotId,
          claimedBySokoBotId: null,
          keptAt: null,
          id: { not: avatarId },
        },
      });
    }
    return avatar.imageUrl;
  };
  return outerTx
    ? run(outerTx)
    : serializableTransaction(
        run,
        "Another avatar change is running. Try again.",
      );
}
