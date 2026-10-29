import { HTTPException } from "hono/http-exception";

import { LIMITS } from "@/config/constants";
import { notFound, serviceUnavailable, tooManyRequests } from "@/helpers/error";
import { buildAvatarView } from "@/helpers/soko-bot-avatar-state";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type AvatarChange,
  downloadAvatarAsset,
  drawStill,
  loadHouseScene,
  planChange,
  storeAvatarAsset,
} from "@/lib/soko-bot-avatar/draw";
import { AVATAR_IMAGE_MODEL } from "@/lib/soko-bot-avatar/provider";
import {
  type AvatarLook,
  CURRENT_AVATAR_STYLE,
  freshLook,
  type SokoBotAvatarStyle,
} from "@/lib/soko-bot-avatar/style";
import { sokoBotAvatarLookSchema } from "@/schemas/soko-bot-avatar.schema";
import {
  avatarRowKey,
  canDraw,
  claimAvatar,
  randomAvatarSeed,
} from "@/services/soko-bot-avatar.service";

/**
 * The avatar studio: draft a change to a bot's look, keep a draft, read what
 * the bot has and how far its renders are. Who may do this is decided by the
 * routes; this module trusts the bot id it is given.
 */

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const DRAFT_WINDOW_MS = 60 * 60 * 1000;

export interface AvatarDraft {
  id: string;
  imageUrl: string;
  look: AvatarLook;
  expiresAt: string;
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
  if (!row) {
    return { look: freshLook(style), imageUrl: null, parentAvatarId: null };
  }
  return {
    look: parseLook(row.look, style),
    imageUrl: row.imageUrl,
    parentAvatarId: row.id,
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
    throw serviceUnavailable("Avatar drawing is not available right now.", {
      kind: "avatar_drawing_unavailable",
      reportToSentry: false,
    });
  }
  const base = await loadBase(style, input.sokoBotId, input.draftId);
  // A shuffle starts over from the house scene whatever the bot looks like now.
  const fromHouse = input.change.kind === "shuffle" || !base.imageUrl;
  let plan: Awaited<ReturnType<typeof planChange>>;
  let reference: Buffer;
  try {
    plan = await planChange(style, base.look, input.change);
    if (plan.kind === "unchanged") return { draft: null, note: plan.note };
    reference = fromHouse
      ? await loadHouseScene(style)
      : await downloadAvatarAsset(base.imageUrl as string);
  } catch (error) {
    // A bad request is the caller's; anything else is the rewriter or the
    // blob store being down, and nothing has been spent yet.
    if (error instanceof HTTPException) throw error;
    console.warn("Soko Bot avatar draft could not be planned", {
      error: error instanceof Error ? error.message : "unknown",
    });
    throw serviceUnavailable("The look could not be drawn. Try again.", {
      kind: "avatar_draw_failed",
      reportToSentry: false,
    });
  }

  // Count and insert as one step, so a burst cannot all pass the same count.
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DRAFT_TTL_MS);
  const reservation = await serializableTransaction(async (tx) => {
    const recent = await tx.sokoBotAvatar.count({
      where: {
        requestedByUserId: input.userId,
        draftForSokoBotId: { not: null },
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
        ...avatarRowKey(style, plan.look, randomAvatarSeed()),
        model: AVATAR_IMAGE_MODEL,
        styleId: style.id,
        styleVersion: style.version,
        look: plan.look,
        parentAvatarId: fromHouse ? null : base.parentAvatarId,
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
        expiresAt: expiresAt.toISOString(),
      },
      note: plan.note,
    };
  } catch (error) {
    // Nothing usable was made, so give the slot back. A stuck row would hold
    // the owner's hourly allowance for nothing.
    await prisma.sokoBotAvatar
      .deleteMany({ where: { id: reservation.id } })
      .catch(() => undefined);
    console.warn("Soko Bot avatar draft failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    throw serviceUnavailable("The look could not be drawn. Try again.", {
      kind: "avatar_draw_failed",
      reportToSentry: false,
    });
  }
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
  await claimAvatar(
    input.sokoBotId,
    input.draftId,
    undefined,
    input.userId ? { userId: input.userId } : null,
  );
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
            expiresAt: draft.draftExpiresAt.toISOString(),
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
