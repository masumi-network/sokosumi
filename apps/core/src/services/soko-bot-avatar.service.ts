import crypto from "node:crypto";

import type { Prisma } from "@sokosumi/database";

import { put } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { notFound, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
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
export async function nextAvatarDraws(count: number) {
  const existing = await prisma.sokoBotAvatar.findMany({
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
  const blob = await put(
    `soko-bot-avatars/${key}-${hash.slice(0, 12)}.png`,
    buffer,
    {
      access: "public",
      contentType: "image/png",
      token: env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
    },
  );
  return blob.url;
}

/** Draw `count` new unique avatars into the pool. Returns how many were added. */
export async function generateAvatars(count: number): Promise<number> {
  const draws = await nextAvatarDraws(Math.min(count, MAX_TOP_UP_PER_CALL));
  const results = await Promise.allSettled(
    draws.map(async (draw) => {
      const sourceUrl = await generateImage(buildAvatarPrompt(draw), draw.seed);
      const key = `${draw.subject.subject.replaceAll(" ", "-")}-${draw.seed}`;
      const imageUrl = await persistAvatarImage(sourceUrl, key);
      await prisma.sokoBotAvatar.create({
        data: {
          subject: draw.subject.subject,
          background: draw.background.name,
          seed: draw.seed,
          model: AVATAR_MODEL,
          imageUrl,
          sourceUrl,
        },
      });
    }),
  );
  const failed = results.filter((result) => result.status === "rejected");
  for (const failure of failed) {
    console.warn("Soko Bot avatar generation failed", {
      error:
        failure.status === "rejected" && failure.reason instanceof Error
          ? failure.reason.message
          : "unknown",
    });
  }
  return results.length - failed.length;
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
  if (!getEnv().FAL_KEY) return { available: 0, generated: 0 };
  // "Disable Soko Bot" has to mean no paid model calls of any kind. Avatar
  // generation is the one that has nothing to do with turns, so the turn gate
  // never sees it.
  if ((await getSokoBotAvailability()).disabled) {
    return { available: 0, generated: 0 };
  }
  const available = await prisma.sokoBotAvatar.count({
    where: { claimedBySokoBotId: null },
  });
  if (available >= AVATAR_POOL_FLOOR) return { available, generated: 0 };
  const generated = await generateAvatars(AVATAR_POOL_FLOOR - available);
  return { available: available + generated, generated };
}

/**
 * Unclaimed avatars for a picker. Reads only unless `topUp` is set: the cron
 * keeps the pool full in production, but Vercel runs crons on production
 * deployments only, so the creation picker asks to fill it explicitly rather
 * than showing an empty grid on every preview.
 */
export async function listAvailableAvatars(
  take: number,
  options: { excludeIds?: string[]; topUp?: boolean } = {},
): Promise<AvailableAvatar[]> {
  const where = {
    claimedBySokoBotId: null,
    ...(options.excludeIds?.length
      ? { id: { notIn: options.excludeIds } }
      : {}),
  };
  if (options.topUp && getEnv().FAL_KEY) {
    const available = await prisma.sokoBotAvatar.count({ where });
    if (available < take) await generateAvatars(take - available);
  }
  const rows = await prisma.sokoBotAvatar.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take,
    select: { id: true, imageUrl: true, subject: true, background: true },
  });
  return rows;
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
      select: { id: true, imageUrl: true, claimedBySokoBotId: true },
    });
    if (!avatar) throw notFound("Avatar not found");
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
    await tx.coworker.updateMany({
      where: { sokoBotId },
      data: { image: avatar.imageUrl },
    });
    return avatar.imageUrl;
  };
  return outerTx ? run(outerTx) : prisma.$transaction(run);
}
