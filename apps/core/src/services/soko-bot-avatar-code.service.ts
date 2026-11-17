import {
  type AvatarAnimal,
  type AvatarBackground,
  buildAvatarSvg,
  closestAvatarLooks,
  formatAvatarCode,
  originalAvatarLook,
  parseAvatarCode,
  randomAvatarLook,
} from "@sokosumi/soko-bot";
import { put } from "@vercel/blob";
import { HTTPException } from "hono/http-exception";
import sharp from "sharp";
import { getEnv } from "@/config/env";
import { conflict, unprocessableEntity } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { SOKO_BOT_AVATAR_BLOB_DIR } from "@/helpers/soko-bot-avatar-blob-path";
import prisma from "@/lib/db/prisma";

/**
 * A Soko Bot's face is a feature code (`v1.<animal>.<bg>…`) drawn as SVG. The
 * code is stored on `avatarCode`; `avatarImageUrl` keeps a rendered still of it
 * so every place that shows the face as a plain image keeps working.
 */

const STILL_SIZE = 512;
const STILL_QUALITY = 85;
const RANDOM_TRIES = 8;

/** The pool's `subject` text for each traced animal. */
export const POOL_SUBJECT_ANIMALS: Record<string, AvatarAnimal> = {
  owl: "owl",
  fox: "fox",
  "round helper robot": "robot",
  "bear cub": "bear",
  whale: "whale",
  cat: "cat",
  penguin: "penguin",
  sloth: "sloth",
  axolotl: "axolotl",
  frog: "frog",
  elephant: "elephant",
  koala: "koala",
  duckling: "duckling",
  hedgehog: "hedgehog",
  rabbit: "rabbit",
  otter: "otter",
};

/** The pool's `background` text for each palette background. */
export const POOL_BACKGROUNDS: Record<string, AvatarBackground> = {
  "iris flower pink": "iris",
  "golden yellow": "golden",
  "crimson purple": "crimson",
  "peach blossom pink": "peach",
  "persimmon orange": "persimmon",
  "vivid sakura pink": "sakura",
  sand: "sand",
  "electric pink": "electric",
  "scarlet red": "scarlet",
};

/** Render a code to a 512 px WebP still in the blob store; returns its public URL. */
export async function renderAvatarCode(code: string): Promise<string> {
  const look = parseAvatarCode(code);
  if (!look) throw new Error(`Invalid avatar code: ${code}`);
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  const image = await sharp(Buffer.from(buildAvatarSvg(look)))
    .resize(STILL_SIZE, STILL_SIZE)
    .webp({ quality: STILL_QUALITY })
    .toBuffer();
  // The path is the code, so the same code always writes the same bytes.
  const blob = await put(
    `${SOKO_BOT_AVATAR_BLOB_DIR}/code/${code}.webp`,
    image,
    {
      access: "public",
      contentType: "image/webp",
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      abortSignal: AbortSignal.timeout(60_000),
    },
  );
  return blob.url;
}

const taken = () =>
  conflict("Another Soko Bot already has this look", {
    kind: "avatar_code_taken",
  });

/** Give a bot the look of `code`. 422 for a bad code, 409 when another bot has it. */
export async function setSokoBotAvatarCode(sokoBotId: string, code: string) {
  if (!parseAvatarCode(code)) {
    throw unprocessableEntity("Not a valid avatar code", {
      kind: "avatar_code_invalid",
    });
  }
  const holder = await prisma.sokoBot.findFirst({
    where: { avatarCode: code, id: { not: sokoBotId } },
    select: { id: true },
  });
  if (holder) throw taken();
  const avatarImageUrl = await renderAvatarCode(code);
  try {
    // The pool row the bot may still claim stays: the pool is dropped whole (SOKD-271 3/3),
    // and touching it here would fail saves while that drop deploys.
    await prisma.sokoBot.update({
      where: { id: sokoBotId },
      data: { avatarCode: code, avatarImageUrl },
      select: { id: true },
    });
  } catch (error) {
    if (isPrismaUniqueViolation(error)) throw taken();
    throw error;
  }
  return { avatarCode: code, avatarImageUrl };
}

/** A random look no other bot has. Retries when a draw collides. */
export async function assignRandomAvatarCode(
  sokoBotId: string,
  rand: () => number = Math.random,
) {
  for (let attempt = 0; attempt < RANDOM_TRIES; attempt += 1) {
    try {
      return await setSokoBotAvatarCode(
        sokoBotId,
        formatAvatarCode(randomAvatarLook(rand)),
      );
    } catch (error) {
      if (!isTaken(error)) throw error;
    }
  }
  throw new Error("No free avatar look found");
}

/**
 * A new bot's first look: the one picked in the studio, or a random free one when none was
 * picked or another bot took it meanwhile. A failure leaves the bot faceless (the orb) rather
 * than failing the create.
 */
export async function giveNewSokoBotAvatar(
  sokoBotId: string,
  code?: string | null,
) {
  // Nowhere to keep the still: environments without Blob (tests, local)
  // create bots without a look, as before avatar codes.
  if (!getEnv().BLOB_READ_WRITE_TOKEN) return null;
  try {
    if (code) {
      try {
        return await setSokoBotAvatarCode(sokoBotId, code);
      } catch (error) {
        if (!isTaken(error) && !isInvalid(error)) throw error;
      }
    }
    return await assignRandomAvatarCode(sokoBotId);
  } catch (error) {
    console.error("Soko Bot avatar code failed", {
      sokoBotId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

const isInvalid = (error: unknown) =>
  error instanceof HTTPException && error.status === 422;
// The service's only 409 is "taken".
const isTaken = (error: unknown) =>
  error instanceof HTTPException && error.status === 409;

/**
 * One code per bot for the conversion script. A bot with a recognised pool
 * picture gets the closest look nobody holds; every other bot a random free
 * one. `held` is mutated, so two bots with the same picture get different codes.
 */
export function planAvatarCodes(
  bots: { id: string; subject?: string | null; background?: string | null }[],
  held: Set<string>,
  rand: () => number = Math.random,
): Map<string, string> {
  const plan = new Map<string, string>();
  for (const bot of bots) {
    const animal = bot.subject ? POOL_SUBJECT_ANIMALS[bot.subject] : undefined;
    const bg = bot.background ? POOL_BACKGROUNDS[bot.background] : undefined;
    const closest = animal
      ? closestAvatarLooks(animal, originalAvatarLook(animal, bg).bg).map(
          formatAvatarCode,
        )
      : [];
    let code = closest.find((one) => !held.has(one));
    while (!code) {
      const random = formatAvatarCode(randomAvatarLook(rand));
      if (!held.has(random)) code = random;
    }
    held.add(code);
    plan.set(bot.id, code);
  }
  return plan;
}
