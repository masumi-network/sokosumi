import { Prisma } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";

import { LIMITS } from "@/config/constants";
import {
  conflict,
  notFound,
  serviceUnavailable,
  tooManyRequests,
} from "@/helpers/error";
import {
  buildAvatarView,
  toDbAvatarState,
} from "@/helpers/soko-bot-avatar-state";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type AvatarChange,
  drawStill,
  errorText,
  loadHouseScene,
  planChange,
  randomSeed,
  rerollDetails,
  storeAvatarAsset,
} from "@/lib/soko-bot-avatar/draw";
import { downloadAvatarAsset } from "@/lib/soko-bot-avatar/media";
import {
  AVATAR_IMAGE_FALLBACK_MODEL,
  AVATAR_IMAGE_MODEL,
  IMAGE_TIMEOUT_STUDIO_FALLBACK_MS,
  IMAGE_TIMEOUT_STUDIO_MS,
  ImageTimeoutError,
} from "@/lib/soko-bot-avatar/provider";
import {
  type AvatarLook,
  type AvatarState,
  alsoChangePrompt,
  CURRENT_AVATAR_STYLE,
  findAvatarStyle,
  freshLook,
  type SokoBotAvatarStyle,
  traitKeyOf,
} from "@/lib/soko-bot-avatar/style";
import { sokoBotAvatarLookSchema } from "@/schemas/soko-bot-avatar.schema";
import {
  avatarRowKey,
  canDraw,
  claimAvatar,
  pickFreshLooks,
  takenTraitKeys,
  takePoolLookAsDraft,
} from "@/services/soko-bot-avatar.service";

/**
 * The avatar studio: draft a change to a bot's look, keep a draft, read what
 * the bot has and how far its renders are. Who may do this is decided by the
 * routes; this module trusts the bot id it is given.
 */

const DRAWING_UNAVAILABLE = "avatar_drawing_unavailable";
const DRAW_FAILED = "avatar_draw_failed";
const DRAW_TIMED_OUT = "avatar_draw_timed_out";
/** Rolls of the scene details to find a combination nobody has. */
const REROLLS = 12;
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const DRAFT_WINDOW_MS = 60 * 60 * 1000;

export interface AvatarDraft {
  id: string;
  imageUrl: string;
  look: AvatarLook;
  expiresAt: Date;
}

function parseLook(value: unknown, style: SokoBotAvatarStyle): AvatarLook {
  const parsed = sokoBotAvatarLookSchema.safeParse(value);
  return parsed.success ? parsed.data : freshLook(style);
}

/** What the next draft edits: the named draft, else the bot's own look, else the house scene. */
async function loadBase(
  style: SokoBotAvatarStyle,
  sokoBotId: string,
  draftId: string | undefined,
) {
  const row = await prisma.sokoBotAvatar.findFirst({
    where: draftId
      ? {
          id: draftId,
          draftForSokoBotId: sokoBotId,
          claimedBySokoBotId: null,
          keptAt: null,
          reservedAt: null,
          styleId: style.id,
        }
      : { claimedBySokoBotId: sokoBotId, styleId: style.id },
    select: { id: true, imageUrl: true, look: true },
  });
  if (draftId && !row) throw notFound("Draft not found");
  // No look of its own yet: edit the house scene.
  if (!row) return { look: freshLook(style), image: null };
  return {
    look: parseLook(row.look, style),
    image: { url: row.imageUrl, avatarId: row.id },
  };
}

/**
 * An edit of the creature or the accessory is the person's choice, so if its
 * combination is already some other bot's, only the scene details change (the
 * desk item and the books), until it is free. Gives up after a few rolls: the
 * keep is the backstop and answers 409 on the rare clash.
 */
async function avoidTakenCombination<
  T extends { kind: "edit"; look: AvatarLook; prompt: string },
>(style: SokoBotAvatarStyle, plan: T): Promise<T> {
  const key = traitKeyOf(style, plan.look);
  if (!key || !(await takenTraitKeys(prisma, style, [key])).has(key)) {
    return plan;
  }
  const rolls = Array.from({ length: REROLLS }, () =>
    rerollDetails(style, plan.look, randomSeed()),
  ).filter((roll) => roll.axes.length > 0);
  const taken = await takenTraitKeys(
    prisma,
    style,
    rolls.flatMap((roll) => traitKeyOf(style, roll.look) ?? []),
  );
  const free = rolls.find((roll) => {
    const rolled = traitKeyOf(style, roll.look);
    return rolled && !taken.has(rolled);
  });
  if (!free) return plan;
  return {
    ...plan,
    look: free.look,
    prompt: plan.prompt + alsoChangePrompt(style, free.look, free.axes),
  };
}

/**
 * Draw one change as a draft. The draft is an unclaimed row tied to the bot
 * and swept after a day; nothing about the bot changes until it is kept.
 *
 * A typed change is rewritten first. When the rewriter leaves nothing to apply
 * the answer is the note and no draft, and no image is bought.
 */
export async function createAvatarDraft(input: {
  sokoBotId: string;
  userId: string;
  change: AvatarChange;
  draftId?: string;
  style?: SokoBotAvatarStyle;
}): Promise<{ draft: AvatarDraft | null; note: string }> {
  const style = input.style ?? CURRENT_AVATAR_STYLE;
  if (!canDraw()) {
    console.warn("Soko Bot avatar drawing is not configured", {
      kind: DRAWING_UNAVAILABLE,
      needs: "AI_GATEWAY_API_KEY and BLOB_READ_WRITE_TOKEN",
    });
    throw serviceUnavailable("Avatar drawing is not available right now.", {
      kind: DRAWING_UNAVAILABLE,
      reportToSentry: false,
    });
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DRAFT_TTL_MS);

  // Shuffle takes a look the pool already drew, which costs nothing, and only
  // draws a fresh one when the pool has none.
  if (input.change.kind === "shuffle") {
    const pooled = await takePoolLookAsDraft(input.sokoBotId, expiresAt, style);
    if (pooled) {
      return {
        draft: {
          id: pooled.id,
          imageUrl: pooled.imageUrl,
          look: parseLook(pooled.look, style),
          expiresAt,
        },
        note: "",
      };
    }
  }

  const base = await loadBase(style, input.sokoBotId, input.draftId);
  // A shuffle starts over from the house scene whatever the bot looks like now.
  const source =
    input.change.kind === "shuffle" || !base.image ? null : base.image;
  let plan: Awaited<ReturnType<typeof planChange>>;
  let reference: Buffer;
  let seed = randomSeed();
  try {
    // A fresh look is one nobody has; anything else keeps the look's own scene.
    const [fresh] =
      input.change.kind === "shuffle"
        ? await pickFreshLooks(prisma, style, 1)
        : [];
    if (fresh) {
      seed = fresh.seed;
      plan = { kind: "edit", look: fresh.look, prompt: fresh.prompt, note: "" };
    } else {
      plan = await planChange(style, base.look, input.change);
    }
    if (plan.kind === "unchanged") return { draft: null, note: plan.note };
    if (input.change.kind === "creature" || input.change.kind === "accessory") {
      plan = await avoidTakenCombination(style, plan);
    }
    reference = source
      ? await downloadAvatarAsset(source.url)
      : await loadHouseScene(style);
  } catch (error) {
    // A bad request is the caller's; anything else is the rewriter or the
    // blob store being down, and nothing has been spent yet.
    if (error instanceof HTTPException) throw error;
    console.warn("Soko Bot avatar draft could not be planned", {
      kind: DRAW_FAILED,
      error: errorText(error),
    });
    throw serviceUnavailable("The look could not be drawn. Try again.", {
      kind: DRAW_FAILED,
      reportToSentry: false,
    });
  }

  // Count and insert as one step, so a burst cannot all pass the same count.
  const reservation = await serializableTransaction(async (tx) => {
    const recent = await tx.sokoBotAvatar.count({
      where: {
        requestedByUserId: input.userId,
        // Drafts drawn for a bot; a pool look taken as a draft cost nothing.
        draftForSokoBotId: { not: null },
        fromPool: false,
        createdAt: { gte: new Date(now.getTime() - DRAFT_WINDOW_MS) },
      },
    });
    if (recent >= LIMITS.SOKO_BOT_AVATAR_DRAFTS_PER_HOUR) {
      throw tooManyRequests(
        `You can try at most ${LIMITS.SOKO_BOT_AVATAR_DRAFTS_PER_HOUR} looks per hour. Try again later.`,
        { kind: "avatar_draft_rate_limited" },
      );
    }
    return await tx.sokoBotAvatar.create({
      data: {
        ...avatarRowKey(style, plan.look, seed),
        model: AVATAR_IMAGE_MODEL,
        styleId: style.id,
        styleVersion: style.version,
        look: plan.look,
        parentAvatarId: source?.avatarId ?? null,
        draftForSokoBotId: input.sokoBotId,
        draftExpiresAt: expiresAt,
        requestedByUserId: input.userId,
        // Hidden from every read until the image exists.
        imageUrl: "",
        reservedAt: now,
      },
      select: { id: true },
    });
  }, "Another avatar draft is running. Try again.");

  try {
    const image = await drawStill(style, {
      prompt: plan.prompt,
      reference,
      target: style.backgroundTarget("idle"),
      timeoutMs: IMAGE_TIMEOUT_STUDIO_MS,
      // Both routes timing out is what answers `avatar_draw_timed_out`.
      fallback: {
        model: AVATAR_IMAGE_FALLBACK_MODEL,
        timeoutMs: IMAGE_TIMEOUT_STUDIO_FALLBACK_MS,
      },
    });
    const imageUrl = await storeAvatarAsset(image, `draft-${reservation.id}`);
    await prisma.sokoBotAvatar.update({
      where: { id: reservation.id },
      data: { imageUrl, reservedAt: null },
    });
    return {
      draft: {
        id: reservation.id,
        imageUrl,
        look: plan.look,
        expiresAt,
      },
      note: plan.note,
    };
  } catch (error) {
    // Nothing usable was made, so give the slot back. A stuck row would hold
    // the person's hourly allowance for nothing.
    await prisma.sokoBotAvatar
      .deleteMany({ where: { id: reservation.id } })
      .catch(() => undefined);
    // A stall upstream is not our fault and a retry usually works: say so.
    const kind =
      error instanceof ImageTimeoutError ? DRAW_TIMED_OUT : DRAW_FAILED;
    console.warn("Soko Bot avatar draft failed", {
      kind,
      error: errorText(error),
    });
    throw serviceUnavailable(
      kind === DRAW_TIMED_OUT
        ? "Drawing took too long. Try again."
        : "The look could not be drawn. Try again.",
      { kind, reportToSentry: false },
    );
  }
}

const REGENERATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Spend one of the person's daily regenerations. Counted in the `rateLimit`
 * table (a key, a count and the window's start in ms), which already exists
 * for Better Auth; the key is ours and cannot clash with its paths. A fixed
 * window that restarts on the first use after it ends, in the caller's
 * Serializable transaction so a burst cannot all pass the same count.
 */
async function spendRegeneration(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const key = `soko-bot-avatar-regenerate:${userId}`;
  const now = Date.now();
  const row = await tx.rateLimit.findFirst({ where: { key } });
  const windowStart = Number(row?.lastRequest ?? 0);
  if (!row || now - windowStart >= REGENERATION_WINDOW_MS) {
    const fresh = { count: 1, lastRequest: BigInt(now) };
    if (row) await tx.rateLimit.update({ where: { id: row.id }, data: fresh });
    else await tx.rateLimit.create({ data: { key, ...fresh } });
    return;
  }
  if ((row.count ?? 0) >= LIMITS.SOKO_BOT_AVATAR_REGENERATIONS_PER_DAY) {
    throw tooManyRequests(
      `You can regenerate at most ${LIMITS.SOKO_BOT_AVATAR_REGENERATIONS_PER_DAY} animations per day. Try again tomorrow.`,
      { kind: "avatar_regenerate_rate_limited" },
    );
  }
  await tx.rateLimit.update({
    where: { id: row.id },
    data: { count: (row.count ?? 0) + 1 },
  });
}

/**
 * Make one state's animation again, for the bot's kept look. A clip is a
 * random draw and now and then comes out ghosted; a render that failed gets
 * its retry here too.
 *
 * The state's still stays, so only the loop is redone (a failed row with no
 * still starts from the still). The row keeps its current loop URLs until the
 * new loop is ready, so the old one keeps playing meanwhile; the studio counts
 * the row as not ready while it renders. `userId` is whose daily allowance it
 * spends; staff pass null and spend none.
 */
export async function regenerateAvatarState(input: {
  sokoBotId: string;
  state: AvatarState;
  userId: string | null;
}): Promise<void> {
  await serializableTransaction(async (tx) => {
    const avatar = await tx.sokoBotAvatar.findFirst({
      where: {
        claimedBySokoBotId: input.sokoBotId,
        keptAt: { not: null },
      },
      select: { id: true, styleId: true },
    });
    // Only a kept crafted look has animations.
    if (!avatar || !findAvatarStyle(avatar.styleId)) {
      throw notFound("This bot has no animated avatar to regenerate");
    }
    const render = await tx.sokoBotAvatarRender.findUnique({
      where: {
        avatarId_state: {
          avatarId: avatar.id,
          state: toDbAvatarState(input.state),
        },
      },
    });
    if (!render)
      throw notFound("This bot has no animated avatar to regenerate");
    if (render.status !== "READY" && render.status !== "FAILED") {
      throw conflict("That animation is still being made.", {
        kind: "avatar_state_rendering",
      });
    }
    if (input.userId) await spendRegeneration(tx, input.userId);
    const restarted = await tx.sokoBotAvatarRender.updateMany({
      where: { id: render.id, status: render.status },
      data: {
        // Keep the still: only the loop is redone. `loopUrl` and
        // `loopLargeUrl` are left as they are until a new loop is ready.
        status: render.stillUrl ? "STILL_READY" : "PENDING",
        attempts: 0,
        leaseUntil: null,
        lastError: null,
        // A fresh idempotency key on the next submit, not the old job.
        providerOperation: Prisma.DbNull,
        submittedAt: null,
      },
    });
    if (restarted.count === 0) {
      throw conflict("That animation is still being made.", {
        kind: "avatar_state_rendering",
      });
    }
  }, "Another change to this avatar is running. Try again.");
}

/**
 * Cancel: discard the bot's open drafts, or just `draftId`. A look the pool
 * drew goes back to the pool; one drawn for the bot is deleted. Only drafts of
 * this bot are touched (never its kept look, its renders, or another bot's
 * drafts), and one that is already gone is not an error.
 */
export async function discardAvatarDrafts(input: {
  sokoBotId: string;
  draftId?: string;
}): Promise<void> {
  const open = {
    draftForSokoBotId: input.sokoBotId,
    claimedBySokoBotId: null,
    // A kept look that was replaced is a tombstone, not a draft.
    keptAt: null,
    // One still being drawn is not open yet; its own run deals with it.
    reservedAt: null,
    ...(input.draftId ? { id: input.draftId } : {}),
  };
  await prisma.sokoBotAvatar.updateMany({
    where: { ...open, fromPool: true },
    data: { draftForSokoBotId: null, draftExpiresAt: null },
  });
  await prisma.sokoBotAvatar.deleteMany({
    where: { ...open, fromPool: false },
  });
}

/**
 * Keep a draft: the bot claims it and its state renders begin. `userId` is
 * whose daily keep allowance this spends; staff pass null.
 */
export async function keepAvatarDraft(input: {
  sokoBotId: string;
  draftId: string;
  userId: string | null;
}): Promise<void> {
  const draft = await prisma.sokoBotAvatar.findFirst({
    where: {
      id: input.draftId,
      draftForSokoBotId: input.sokoBotId,
      reservedAt: null,
    },
    select: { id: true },
  });
  if (!draft) throw notFound("Draft not found");
  await claimAvatar(input.sokoBotId, input.draftId, {
    keptBy: input.userId ?? undefined,
    enforceKeepCap: true,
  });
}

/** The bot's look, its newest draft, and how far its renders have got. */
export async function getAvatarStudio(
  sokoBotId: string,
  style: SokoBotAvatarStyle = CURRENT_AVATAR_STYLE,
) {
  const now = new Date();
  const [bot, draft] = await Promise.all([
    prisma.sokoBot.findUnique({
      where: { id: sokoBotId },
      select: {
        avatarImageUrl: true,
        avatar: {
          select: {
            styleId: true,
            styleVersion: true,
            imageUrl: true,
            look: true,
            renders: {
              select: {
                state: true,
                status: true,
                stillUrl: true,
                loopUrl: true,
                loopLargeUrl: true,
              },
            },
          },
        },
      },
    }),
    prisma.sokoBotAvatar.findFirst({
      where: {
        draftForSokoBotId: sokoBotId,
        claimedBySokoBotId: null,
        keptAt: null,
        reservedAt: null,
        draftExpiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, imageUrl: true, look: true, draftExpiresAt: true },
    }),
  ]);
  if (!bot) throw notFound("Soko Bot not found");
  const renders = bot.avatar?.renders ?? [];
  return {
    avatar: buildAvatarView(bot.avatar, bot.avatarImageUrl),
    look: bot.avatar?.look ? parseLook(bot.avatar.look, style) : null,
    draft:
      draft?.draftExpiresAt != null
        ? {
            id: draft.id,
            imageUrl: draft.imageUrl,
            look: parseLook(draft.look, style),
            expiresAt: draft.draftExpiresAt,
          }
        : null,
    progress: {
      ready: renders.filter((one) => one.status === "READY").length,
      failed: renders.filter(
        (one) =>
          one.status === "FAILED" || one.status === "SUBMISSION_UNCERTAIN",
      ).length,
      total: renders.length,
    },
    options: {
      creatures: style.creatures.map(({ id }) => ({ id })),
      accessories: style.accessories.map(({ id }) => ({ id })),
    },
  };
}
