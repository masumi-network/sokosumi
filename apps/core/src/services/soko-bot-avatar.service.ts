import crypto from "node:crypto";

import type { Prisma } from "@sokosumi/database";

import { HTTPException } from "hono/http-exception";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import {
  conflict,
  notFound,
  tooManyRequests,
  unprocessableEntity,
} from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { toDbAvatarState } from "@/helpers/soko-bot-avatar-state";
import prisma from "@/lib/db/prisma";
import {
  CONCURRENCY_CONFLICT_KIND,
  serializableTransaction,
} from "@/lib/db/transaction";
import {
  drawStill,
  errorText,
  loadHouseScene,
  planFresh,
  randomSeed,
  storeAvatarAsset,
} from "@/lib/soko-bot-avatar/draw";
import { AVATAR_IMAGE_MODEL } from "@/lib/soko-bot-avatar/provider";
import {
  AVATAR_STATES,
  type AvatarLook,
  CURRENT_AVATAR_STYLE,
  findAvatarStyle,
  type SokoBotAvatarStyle,
  traitKeyOf,
} from "@/lib/soko-bot-avatar/style";
import { sokoBotAvatarLookSchema } from "@/schemas/soko-bot-avatar.schema";
import { getSokoBotAvailability } from "@/services/soko-bot-availability.service";

/**
 * Avatar pool and claim for Soko Bots. The pool holds fresh looks drawn in the
 * current style (the house scene redrawn from a seed: a creature, its coat, scene details and maybe an accessory);
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

/** The unique-key columns of a look: creature, what it wears, the seed it came from. */
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

/** Rolls per fresh look before it gives up on finding an unused combination. */
const FRESH_LOOK_ROLLS = 12;

/** The trait keys among `keys` that a pool or claimed look already has. */
export async function takenTraitKeys(
  client: Prisma.TransactionClient | typeof prisma,
  style: SokoBotAvatarStyle,
  keys: readonly string[],
): Promise<Set<string>> {
  const rows = await client.sokoBotAvatar.findMany({
    where: {
      styleId: style.id,
      styleVersion: style.version,
      traitKey: { in: [...keys] },
    },
    select: { traitKey: true },
  });
  return new Set(rows.flatMap((row) => (row.traitKey ? [row.traitKey] : [])));
}

/**
 * Up to `count` fresh looks, each from its own seed and none sharing a trait
 * key with a pool or claimed look (or with each other). A seed that lands on a
 * taken key is rolled again; with thousands of combinations that is rare, so a
 * slot that finds nothing in a few rolls is simply left out.
 */
export async function pickFreshLooks(
  client: Prisma.TransactionClient | typeof prisma,
  style: SokoBotAvatarStyle,
  count: number,
) {
  const chosen: { seed: number; look: AvatarLook; prompt: string }[] = [];
  const used = new Set<string>();
  for (let slot = 0; slot < count; slot += 1) {
    const rolls = Array.from({ length: FRESH_LOOK_ROLLS }, () => {
      const seed = randomSeed();
      const plan = planFresh(style, seed);
      return {
        seed,
        plan,
        key: plan.kind === "edit" ? traitKeyOf(style, plan.look) : null,
      };
    });
    const taken = await takenTraitKeys(
      client,
      style,
      rolls.flatMap((roll) => (roll.key ? [roll.key] : [])),
    );
    const free = rolls.find(
      (roll) =>
        roll.plan.kind === "edit" &&
        roll.key &&
        !taken.has(roll.key) &&
        !used.has(roll.key),
    );
    if (!free || free.plan.kind !== "edit" || !free.key) continue;
    used.add(free.key);
    chosen.push({
      seed: free.seed,
      look: free.plan.look,
      prompt: free.plan.prompt,
    });
  }
  return chosen;
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
          fromPool: true,
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
    for (const fresh of await pickFreshLooks(tx, style, allowed)) {
      const { seed, look, prompt } = fresh;
      // Sequential on purpose: Prisma does not support concurrent queries on
      // one interactive transaction client.
      const row = await tx.sokoBotAvatar.create({
        data: {
          ...avatarRowKey(style, look, seed),
          model: AVATAR_IMAGE_MODEL,
          styleId: style.id,
          styleVersion: style.version,
          look,
          traitKey: traitKeyOf(style, look),
          fromPool: true,
          requestedByUserId,
          // Filled in once the image exists. `reservedAt` keeps the row out of
          // every read until then, so nobody sees or claims a blank avatar.
          imageUrl: "",
          reservedAt: new Date(),
        },
        select: { id: true },
      });
      reservations.push({ id: row.id, style, look, prompt, seed });
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
      error: errorText(error),
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
  // Another run drew the same combination between our check and our write.
  if (isPrismaUniqueViolation(error)) return true;
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
      error: errorText(error),
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
      error: errorText(result.reason),
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

function unclaimedAvatarFilter(
  excludeIds?: string[],
  style: SokoBotAvatarStyle = CURRENT_AVATAR_STYLE,
) {
  return {
    claimedBySokoBotId: null,
    // Only looks in the current style are offered. Legacy mascots stay where
    // they are, for the bots that hold them, and are never handed to new ones.
    styleId: style.id,
    styleVersion: style.version,
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
 * Clean up private looks past their expiry, unless a bot holds them.
 *
 * - A pool look that was taken as a draft and never kept goes back to the pool.
 * - Everything else is deleted, renders with it: studio drafts, the tombstones
 *   of replaced looks, and private looks whose bot was deleted (no expiry left
 *   once a bot claimed them).
 */
export async function sweepExpiredDrafts(
  now: Date = new Date(),
): Promise<number> {
  const returned = await prisma.sokoBotAvatar.updateMany({
    where: {
      claimedBySokoBotId: null,
      fromPool: true,
      keptAt: null,
      draftExpiresAt: { lt: now },
    },
    data: { draftForSokoBotId: null, draftExpiresAt: null },
  });
  const { count } = await prisma.sokoBotAvatar.deleteMany({
    where: {
      claimedBySokoBotId: null,
      OR: [
        { draftExpiresAt: { lt: now } },
        { draftForSokoBotId: { not: null }, draftExpiresAt: null },
      ],
    },
  });
  return returned.count + count;
}

/**
 * Hand an unclaimed pool look to a bot as its draft, so Shuffle costs nothing
 * while the pool has looks. Null when the pool has none in this style.
 */
export async function takePoolLookAsDraft(
  sokoBotId: string,
  expiresAt: Date,
  style: SokoBotAvatarStyle,
) {
  const candidates = await prisma.sokoBotAvatar.findMany({
    where: unclaimedAvatarFilter(undefined, style),
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, imageUrl: true, look: true },
  });
  // A random pick, tried in turn: another bot may take the same look first.
  while (candidates.length > 0) {
    const [pick] = candidates.splice(crypto.randomInt(candidates.length), 1);
    if (!pick) break;
    const taken = await prisma.sokoBotAvatar.updateMany({
      where: { id: pick.id, ...unclaimedAvatarFilter(undefined, style) },
      data: { draftForSokoBotId: sokoBotId, draftExpiresAt: expiresAt },
    });
    if (taken.count === 1) return pick;
  }
  return null;
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

function traitKeyForRow(styleId: string, look: unknown): string | null {
  const style = findAvatarStyle(styleId);
  const parsed = sokoBotAvatarLookSchema.safeParse(look);
  return style && parsed.success ? traitKeyOf(style, parsed.data) : null;
}

export interface ClaimOptions {
  /** Run inside a caller's transaction (bot create); otherwise a serializable one. */
  tx?: Prisma.TransactionClient;
  /** Whose keep this is, recorded for the daily keep cap. Staff pass nothing. */
  keptBy?: string;
  /** Refuse past the daily cap. Bot creation records the keep but never refuses. */
  enforceKeepCap?: boolean;
}

/**
 * Give an avatar to a bot, releasing whatever it held before. The unique index
 * on `claimedBySokoBotId` guarantees one avatar per bot; the updateMany guard
 * guarantees one bot per avatar.
 *
 * Claiming a crafted look is keeping it: the keep is recorded against
 * `keptBy`'s daily cap, the bot's other drafts go, and one render row per state
 * is created for the cron to work through. A kept look the bot replaces is
 * retired: its renders are deleted and the row stays as a tombstone for the cap
 * window (the cap reads it), never claimable again. A look that was never kept
 * (a pool pick) goes back to the pool.
 */
export async function claimAvatar(
  sokoBotId: string,
  avatarId: string,
  options: ClaimOptions = {},
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
        look: true,
        traitKey: true,
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
    // A kept look nobody holds is retired: a replaced look does not come back.
    if (avatar.keptAt && !avatar.claimedBySokoBotId) {
      throw notFound("Avatar not found");
    }
    if (avatar.claimedBySokoBotId && avatar.claimedBySokoBotId !== sokoBotId) {
      throw unprocessableEntity("This avatar was just taken by another bot");
    }
    const crafted = findAvatarStyle(avatar.styleId) !== null;
    const firstKeep = crafted && !avatar.keptAt;
    if (firstKeep && options.keptBy && options.enforceKeepCap) {
      await assertKeepAllowance(tx, options.keptBy);
    }

    // The look it held before. A kept one is retired to a tombstone (renders
    // gone, row kept for the cap window); one that was never kept is released.
    const retired = await tx.sokoBotAvatar.findMany({
      where: {
        claimedBySokoBotId: sokoBotId,
        id: { not: avatarId },
        keptAt: { not: null },
      },
      select: { id: true },
    });
    if (retired.length > 0) {
      const ids = retired.map((one) => one.id);
      await tx.sokoBotAvatarRender.deleteMany({
        where: { avatarId: { in: ids } },
      });
      await tx.sokoBotAvatar.updateMany({
        where: { id: { in: ids } },
        data: {
          claimedBySokoBotId: null,
          claimedAt: null,
          draftForSokoBotId: sokoBotId,
          draftExpiresAt: new Date(now.getTime() + KEEP_WINDOW_MS),
          // The combination is free for the next bot to use.
          traitKey: null,
        },
      });
    }
    await tx.sokoBotAvatar.updateMany({
      where: {
        claimedBySokoBotId: sokoBotId,
        id: { not: avatarId },
        keptAt: null,
      },
      data: { claimedBySokoBotId: null, claimedAt: null },
    });
    // A draft takes its place among the claimed looks under its trait key.
    const traitKey =
      crafted && !avatar.traitKey
        ? traitKeyForRow(avatar.styleId, avatar.look)
        : null;
    let claimed: { count: number };
    try {
      claimed = await tx.sokoBotAvatar.updateMany({
        where: {
          id: avatarId,
          OR: [{ claimedBySokoBotId: null }, { claimedBySokoBotId: sokoBotId }],
        },
        data: {
          claimedBySokoBotId: sokoBotId,
          claimedAt: now,
          ...(crafted ? { draftExpiresAt: null } : {}),
          ...(traitKey ? { traitKey } : {}),
          ...(firstKeep
            ? { keptAt: now, keptByUserId: options.keptBy ?? null }
            : {}),
        },
      });
    } catch (error) {
      // Another bot holds, or was just offered, this exact combination.
      if (!isPrismaUniqueViolation(error)) throw error;
      throw conflict(
        "Another look just took this combination. Change something and try again.",
        { kind: "avatar_look_taken" },
      );
    }
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
      // The bot's other drafts: a pool look goes back, one drawn for the bot is deleted.
      const others = {
        draftForSokoBotId: sokoBotId,
        claimedBySokoBotId: null,
        keptAt: null,
        id: { not: avatarId },
      };
      await tx.sokoBotAvatar.updateMany({
        where: { ...others, fromPool: true },
        data: { draftForSokoBotId: null, draftExpiresAt: null },
      });
      await tx.sokoBotAvatar.deleteMany({
        where: { ...others, fromPool: false },
      });
    }
    return avatar.imageUrl;
  };
  return options.tx
    ? run(options.tx)
    : serializableTransaction(
        run,
        "Another avatar change is running. Try again.",
      );
}
