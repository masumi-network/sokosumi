import crypto from "node:crypto";

import type { Prisma } from "@sokosumi/database";

import { put } from "@vercel/blob";
import { HTTPException } from "hono/http-exception";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import {
  notFound,
  tooManyRequests,
  unprocessableEntity,
} from "@/helpers/error";
import { buildSokoBotAvatarBlobPathname } from "@/helpers/soko-bot-avatar-blob-path";
import prisma from "@/lib/db/prisma";
import {
  CONCURRENCY_CONFLICT_KIND,
  serializableTransaction,
} from "@/lib/db/transaction";
import { getSokoBotAvailability } from "@/services/soko-bot-availability.service";

/**
 * Mascot avatar pool for Soko Bots. Images follow the "IP as logo" recipe
 * (one cute character from a few rounded shapes, two character colours, one
 * solid background, emerging from a lower corner) and are drawn once per
 * unique (subject, background, seed). A bot claims exactly one; the pool is
 * topped up when it runs low so onboarding always has choices.
 */

export const AVATAR_MODEL = "fal-ai/gemini-3.1-flash-image-preview";
const FAL_SYNC_URL = `https://fal.run/${AVATAR_MODEL}`;
const GENERATION_TIMEOUT_MS = 60_000;
const MAX_TOP_UP_PER_CALL = 6;

interface AvatarSubject {
  subject: string;
  feature: string;
  colors: string;
}

/** Subjects a personal project manager can plausibly be, each with one defining feature. */
const SUBJECTS: readonly AvatarSubject[] = [
  {
    subject: "owl",
    feature: "two large round tufted ear-bumps",
    colors:
      "warm cream (#F4EBDD) body and deep ink (#1E1B2E) for the face mask and eyes",
  },
  {
    subject: "fox",
    feature: "two large rounded ears",
    colors:
      "warm apricot (#F09A5A) body and deep plum ink (#2B1E3A) for the eyes and muzzle patch",
  },
  {
    subject: "round helper robot",
    feature: "one broad rounded visor face",
    colors:
      "soft porcelain white (#F3F1EC) body and deep navy ink (#1B2140) for the visor and eyes",
  },
  {
    subject: "bear cub",
    feature: "two small round ears",
    colors:
      "cocoa brown (#8B5E3C) body and pale cream (#F7EFE3) for the muzzle patch and eyes",
  },
  {
    subject: "whale",
    feature: "one broad rounded tail fin",
    colors:
      "soft ocean blue (#5B8DEF) body and pale cream (#F4F1EA) for the belly and eyes",
  },
  {
    subject: "cat",
    feature: "two rounded ears",
    colors:
      "charcoal (#2F2F38) body and warm cream (#F5EDE0) for the muzzle patch and eyes",
  },
  {
    subject: "penguin",
    feature: "one small rounded beak",
    colors:
      "deep ink (#1F2233) body and soft white (#F6F5F0) for the belly patch and eyes",
  },
  {
    subject: "sloth",
    feature: "one broad rounded face mask",
    colors:
      "warm taupe (#A98F72) body and cream (#F3EAD9) for the face mask and eyes",
  },
  {
    subject: "axolotl",
    feature: "two rounded external gill puffs",
    colors:
      "soft pink (#F3A6B8) body and deep berry ink (#4A2138) for the eyes and tiny mouth",
  },
  {
    subject: "frog",
    feature: "two large round eye bumps",
    colors:
      "leaf green (#7BB662) body and cream (#F5F1DF) for the belly and eyes",
  },
  {
    subject: "elephant",
    feature: "two big round ears",
    colors:
      "dusty blue-gray (#8D9AB3) body and pale blush (#F5E4E0) for the inner ears and eyes",
  },
  {
    subject: "koala",
    feature: "two big fluffy round ears",
    colors:
      "soft gray (#B8B5B0) body and deep ink (#26242C) for the nose patch and eyes",
  },
  {
    subject: "duckling",
    feature: "one small rounded bill",
    colors:
      "sunny yellow (#F2C94C) body and warm orange (#E07A2F) for the bill and eyes",
  },
  {
    subject: "hedgehog",
    feature: "one rounded quill cap",
    colors: "chestnut (#8F5B3C) quill cap and cream (#F6EBDA) face",
  },
  {
    subject: "rabbit",
    feature: "two tall rounded ears",
    colors:
      "soft white (#F5F2EC) body and dusty rose (#C98A8A) for the inner ears and eyes",
  },
  {
    subject: "otter",
    feature: "one small rounded muzzle patch",
    colors:
      "warm brown (#7C5A3E) body and cream (#F4E9D6) for the muzzle patch and eyes",
  },
] as const;

interface AvatarBackground {
  name: string;
  hex: string;
}

/** Muted, clearly chromatic backgrounds; the brand wisteria is one of them, not the default for all. */
const BACKGROUNDS: readonly AvatarBackground[] = [
  { name: "gently muted lavender purple", hex: "#7A5AD6" },
  { name: "gently muted sage green", hex: "#8FB59C" },
  { name: "gently muted slate blue", hex: "#6B7FB3" },
  { name: "gently muted peach", hex: "#E8B79A" },
  { name: "gently muted teal", hex: "#5FA8A3" },
  { name: "gently muted mustard", hex: "#D9B24C" },
  { name: "gently muted dusty rose", hex: "#D98C9E" },
  { name: "gently muted mint", hex: "#9CCFB8" },
  { name: "gently muted terracotta", hex: "#D27D5B" },
  { name: "gently muted periwinkle", hex: "#8C93D9" },
] as const;

export function buildAvatarPrompt(input: {
  subject: AvatarSubject;
  background: AvatarBackground;
  corner: "lower-left" | "lower-right";
}): string {
  const side = input.corner === "lower-left" ? "left" : "right";
  return [
    "Create one complete full-bleed 1:1 square image.",
    `Background: fill the entire square with solid ${input.background.name} (like ${input.background.hex} with slightly lowered saturation). Keep that color visible in every open area and in the corners not occupied by the character; the ${input.corner} corner must be occupied by the character.`,
    `Subject: place one extremely simplified, cute, endearing ${input.subject.subject} character on the background, reduced to one soft rounded continuous silhouette and one defining feature: ${input.subject.feature}.`,
    "Complexity: use only 4–7 large basic shapes and at most two broad internal color regions. Use two simple eyes and add one tiny mouth only when it helps the expression. Remove every nonessential line, outline, anatomical detail, texture, and decoration. Keep the character readable at 32 × 32.",
    `Color behavior: use exactly three semantic colors in the complete image: exactly two character base colors plus the background color. Character colors: ${input.subject.colors}. Reuse those two colors for facial marks. Keep the character, facial marks, and background clearly separated.`,
    `Composition: keep the character upright and emerging from the ${input.corner} corner, filling about 85–95% of the square so it remains visually dominant. Cropping at the bottom or ${side} side is welcome when it strengthens the corner emergence. Preserve both paired identifying features. Never center or bottom-center the character.`,
    "Style: make simplification, cuteness, and lovable baby-like appeal the strongest qualities. Use large soft forms, compact proportions, thick rounded contours, and an ultra-clean graphic treatment. Prefer one clear shape over several explanatory details. Add an extremely, extremely subtle, almost imperceptible sense of depth through a barely-there neo-skeuomorphic treatment.",
    "Finish: show only the character on the full-canvas background, with clean surfaces and normal square outer corners.",
    "Constraints: Use no text or watermark. Add no borders, frames, cards, or presentation masks. Include one character only, with no extra subjects or scenery. Use no fragile lines, sharp tips, unnecessary outlines, tiny details, or decorative marks. Add no photorealistic material, dramatic bevel, glossy hotspot, deep occlusion, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform, with no texture, vignette, or lighting variation.",
  ].join("\n");
}

/** Deterministic draw plan: never repeats a (subject, background, seed) triple. */
export async function nextAvatarDraws(
  count: number,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const existing = await client.sokoBotAvatar.findMany({
    select: { subject: true, background: true, seed: true },
  });
  const used = new Set(
    existing.map((row) => `${row.subject}|${row.background}|${row.seed}`),
  );
  const draws: {
    subject: AvatarSubject;
    background: AvatarBackground;
    seed: number;
    corner: "lower-left" | "lower-right";
  }[] = [];
  // Walk subject × background diagonally so consecutive draws differ in both,
  // then bump the seed once the grid is exhausted.
  for (let seed = 1; draws.length < count && seed < 1_000; seed += 1) {
    for (let i = 0; i < SUBJECTS.length && draws.length < count; i += 1) {
      const subject = SUBJECTS[i]!;
      const background = BACKGROUNDS[(i + seed) % BACKGROUNDS.length]!;
      const key = `${subject.subject}|${background.name}|${seed}`;
      if (used.has(key)) continue;
      used.add(key);
      draws.push({
        subject,
        background,
        seed,
        corner: (i + seed) % 2 === 0 ? "lower-left" : "lower-right",
      });
    }
  }
  return draws;
}

async function generateImage(prompt: string, seed: number): Promise<string> {
  const env = getEnv();
  if (!env.FAL_KEY) throw new Error("FAL_KEY is not configured");
  const response = await fetch(FAL_SYNC_URL, {
    method: "POST",
    headers: {
      authorization: `Key ${env.FAL_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      aspect_ratio: "1:1",
      resolution: "1K",
      num_images: 1,
      seed,
      output_format: "png",
    }),
    signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`fal.ai returned ${response.status}`);
  }
  const body = (await response.json()) as {
    images?: Array<{ url?: string }>;
  };
  const url = body.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no image");
  return url;
}

/** Copy a generated image into our blob store; falls back to the source URL without a token. */
export async function persistAvatarImage(
  sourceUrl: string,
  key: string,
): Promise<string> {
  const env = getEnv();
  if (!env.BLOB_READ_WRITE_TOKEN) return sourceUrl;
  const response = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`avatar download failed (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const blob = await put(buildSokoBotAvatarBlobPathname(key, hash), buffer, {
    access: "public",
    contentType: "image/png",
    token: env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
    // Bounded like the two fetches above. Without it this is the one step of a
    // fill with no time limit, and a hung upload outliving the sweep cutoff
    // would have its own reservation deleted from under it.
    abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
  });
  return blob.url;
}

/** Draw `count` new unique avatars into the pool. Returns how many were added. */
type AvatarDraw = Awaited<ReturnType<typeof nextAvatarDraws>>[number];

/** A draw this run owns, and the empty row holding it. */
interface AvatarReservation {
  id: string;
  draw: AvatarDraw;
}

/** Thrown when the caller has no hourly allowance left. Nothing is billed. */
export class AvatarGenerationCappedError extends Error {}

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
 * so the transaction never waits on FAL.
 */
async function reserveDraws(
  count: number,
  requestedByUserId: string | null,
): Promise<AvatarReservation[]> {
  return await serializableTransaction(async (tx) => {
    const draws = await nextAvatarDraws(count, tx);
    if (draws.length === 0) return [];

    let allowed = draws.length;
    if (requestedByUserId) {
      const recent = await tx.sokoBotAvatar.count({
        where: {
          requestedByUserId,
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
    for (const draw of draws.slice(0, allowed)) {
      // Sequential on purpose: Prisma does not support concurrent queries on
      // one interactive transaction client.
      const row = await tx.sokoBotAvatar.create({
        data: {
          subject: draw.subject.subject,
          background: draw.background.name,
          seed: draw.seed,
          model: AVATAR_MODEL,
          // Filled in once the image exists. `reservedAt` keeps the row out of
          // every read until then, so nobody sees or claims a blank avatar.
          imageUrl: "",
          requestedByUserId,
          reservedAt: new Date(),
        },
        select: { id: true },
      });
      reservations.push({ id: row.id, draw });
    }
    return reservations;
  }, "Another avatar top-up is running. Try again.");
}

/** Buy the image for a reservation and publish the row. */
async function fillReservation(reservation: AvatarReservation): Promise<void> {
  const { draw } = reservation;
  const sourceUrl = await generateImage(buildAvatarPrompt(draw), draw.seed);
  const key = `${draw.subject.subject.replaceAll(" ", "-")}-${draw.seed}`;
  const imageUrl = await persistAvatarImage(sourceUrl, key);
  // Clearing `reservedAt` is what publishes the row.
  await prisma.sokoBotAvatar.update({
    where: { id: reservation.id },
    data: { imageUrl, sourceUrl, reservedAt: null },
  });
}

/**
 * Give back reservations this run never spent on.
 *
 * Only for draws whose image was never requested. A reservation whose FAL call
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
): Promise<number> {
  const reservations = await reserveDraws(
    Math.min(count, MAX_TOP_UP_PER_CALL),
    requestedByUserId,
  );
  if (reservations.length === 0) return 0;

  // Fill one before committing to the rest. fal bills for an image whether or
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
  if (!getEnv().FAL_KEY) return { available: 0, generated: 0 };
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
 * Stale rows are kept for a full window on purpose: they represent FAL spend
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

const GENERATION_WINDOW_MS = 60 * 60 * 1000;

/** The 429 for a caller who has spent their hourly allowance. */
function avatarGenerationCapped() {
  return tooManyRequests(
    `You can generate at most ${LIMITS.SOKO_BOT_AVATAR_GENERATION_PER_HOUR} mascot images per hour. Try again later.`,
    { kind: "avatar_generation_rate_limited" },
  );
}

function unclaimedAvatarFilter(excludeIds?: string[]) {
  return {
    claimedBySokoBotId: null,
    // A reserved row has no image yet. Counting it as available would let the
    // pool look full while every slot in it is still in flight.
    reservedAt: null,
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
 * This spends FAL budget and writes rows, so it belongs behind a POST. The
 * caller here is waiting on purpose; decorative reads use
 * `listAvailableAvatars` so a page render never waits on image generation.
 */
export async function topUpAvailableAvatars(
  take: number,
  options: { excludeIds?: string[]; requestedByUserId?: string } = {},
): Promise<AvailableAvatar[]> {
  if (getEnv().FAL_KEY) {
    // Count the real pool, not the caller's filtered view of it. Counting
    // through `excludeIds` let a caller list the pool, hand the ids straight
    // back, and drive the count to zero, so generation ran on a pool that
    // needed nothing. FAL bills per image, so that is spend on demand.
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
 * Give an unclaimed avatar to a bot, releasing whatever it held before. The
 * unique index on `claimedBySokoBotId` guarantees one avatar per bot; the
 * updateMany guard guarantees one bot per avatar.
 */
export async function claimAvatar(
  sokoBotId: string,
  avatarId: string,
  outerTx?: Prisma.TransactionClient,
): Promise<string> {
  const run = async (tx: Prisma.TransactionClient) => {
    const avatar = await tx.sokoBotAvatar.findUnique({
      where: { id: avatarId },
      select: {
        id: true,
        imageUrl: true,
        claimedBySokoBotId: true,
        reservedAt: true,
      },
    });
    if (!avatar) throw notFound("Avatar not found");
    // Its image is still in flight, so claiming it would set the bot's avatar
    // to an empty URL that nothing ever fills in.
    if (avatar.reservedAt) throw notFound("Avatar not found");
    if (avatar.claimedBySokoBotId && avatar.claimedBySokoBotId !== sokoBotId) {
      throw unprocessableEntity("This avatar was just taken by another bot");
    }
    await tx.sokoBotAvatar.updateMany({
      where: { claimedBySokoBotId: sokoBotId, id: { not: avatarId } },
      data: { claimedBySokoBotId: null, claimedAt: null },
    });
    const claimed = await tx.sokoBotAvatar.updateMany({
      where: {
        id: avatarId,
        OR: [{ claimedBySokoBotId: null }, { claimedBySokoBotId: sokoBotId }],
      },
      data: { claimedBySokoBotId: sokoBotId, claimedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw unprocessableEntity("This avatar was just taken by another bot");
    }
    await tx.sokoBot.update({
      where: { id: sokoBotId },
      data: { avatarImageUrl: avatar.imageUrl },
    });
    return avatar.imageUrl;
  };
  return outerTx ? run(outerTx) : prisma.$transaction(run);
}
