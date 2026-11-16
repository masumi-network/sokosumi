import { AdFeedbackKind } from "@sokosumi/database";

import { notFound } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { scoreStudioAd } from "@/lib/image-studio/ad-score";
import type {
  StudioAssetRating,
  StudioFeedbackReason,
} from "@/schemas/project-image-studio.schema";
import { recordStudioAdEvent } from "./image-studio-events.service";

interface AssetScope {
  projectId: string;
  workspaceId: string;
  userId: string;
  assetId: string;
}

export function emptyStudioAssetRating(): StudioAssetRating {
  return {
    myThumb: null,
    myReasons: [],
    myComment: null,
    thumbsUp: 0,
    thumbsDown: 0,
    score: scoreStudioAd({ thumbsUp: 0, thumbsDown: 0, events: [] }),
  };
}

export async function getStudioAssetRatings(
  assetIds: string[],
  userId: string,
): Promise<Map<string, StudioAssetRating>> {
  const ratings = new Map(assetIds.map((id) => [id, emptyStudioAssetRating()]));
  if (assetIds.length === 0) return ratings;
  const [thumbs, mine, events] = await Promise.all([
    prisma.adFeedback.groupBy({
      by: ["assetId", "thumb"],
      where: { assetId: { in: assetIds }, kind: AdFeedbackKind.THUMB },
      _count: { _all: true },
    }),
    prisma.adFeedback.findMany({
      where: { assetId: { in: assetIds }, userId, kind: AdFeedbackKind.THUMB },
      select: { assetId: true, thumb: true, reasons: true, comment: true },
    }),
    prisma.adEvent.groupBy({
      by: ["assetId", "type"],
      where: { assetId: { in: assetIds } },
      _count: { _all: true },
    }),
  ]);
  for (const thumb of thumbs) {
    const rating = ratings.get(thumb.assetId);
    if (!rating) continue;
    if (thumb.thumb === 1) rating.thumbsUp = thumb._count._all;
    if (thumb.thumb === -1) rating.thumbsDown = thumb._count._all;
  }
  for (const thumb of mine) {
    const rating = ratings.get(thumb.assetId);
    if (!rating) continue;
    rating.myThumb =
      thumb.thumb === 1 || thumb.thumb === -1 ? thumb.thumb : null;
    rating.myReasons = thumb.reasons.filter(
      (reason): reason is StudioFeedbackReason =>
        ["off-brand", "bad text", "wrong product", "ugly", "great"].includes(
          reason,
        ),
    );
    rating.myComment = thumb.comment;
  }
  const eventsByAsset = new Map<string, { type: string; count: number }[]>();
  for (const event of events) {
    const rows = eventsByAsset.get(event.assetId) ?? [];
    rows.push({ type: event.type, count: event._count._all });
    eventsByAsset.set(event.assetId, rows);
  }
  for (const [assetId, rating] of ratings) {
    rating.score = scoreStudioAd({
      ...rating,
      events: eventsByAsset.get(assetId) ?? [],
    });
  }
  return ratings;
}

async function requireFeedbackAsset(scope: AssetScope) {
  await requireProjectAccess(scope);
  const asset = await prisma.projectImageAsset.findFirst({
    where: {
      id: scope.assetId,
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
    },
    select: {
      id: true,
      hiddenAt: true,
      job: {
        select: { batchId: true, batchSlot: { select: { batchId: true } } },
      },
    },
  });
  if (!asset) throw notFound("Image not found");
  return asset;
}

export async function setStudioAssetFeedback(
  input: AssetScope & {
    thumb: 1 | -1 | null;
    reasons?: StudioFeedbackReason[];
    comment?: string | null;
  },
): Promise<StudioAssetRating> {
  const asset = await requireFeedbackAsset(input);
  const { assetId, userId, thumb } = input;
  if (thumb === null) {
    await prisma.adFeedback.deleteMany({
      where: { userId, assetId, kind: AdFeedbackKind.THUMB },
    });
  } else {
    const feedback = {
      thumb,
      reasons: [...new Set(input.reasons ?? [])],
      comment: input.comment?.trim() || null,
    };
    const where = {
      userId_assetId: { userId, assetId },
      kind: AdFeedbackKind.THUMB,
    };
    try {
      await prisma.adFeedback.upsert({
        where,
        create: {
          ...feedback,
          userId,
          assetId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          kind: AdFeedbackKind.THUMB,
          batchId: asset.job.batchId ?? asset.job.batchSlot?.batchId,
        },
        update: feedback,
      });
    } catch (error) {
      if (!isPrismaUniqueViolation(error)) throw error;
      // Prisma may emulate this partial-index upsert; concurrent first votes
      // can then race on create. Keep the last person's intended state.
      await prisma.adFeedback.update({ where, data: feedback });
    }
  }
  return (await getStudioAssetRatings([assetId], userId)).get(assetId)!;
}

export async function recordStudioAssetLightboxView(
  scope: AssetScope,
): Promise<void> {
  await requireFeedbackAsset(scope);
  await recordStudioAdEvent({ ...scope, type: "viewed_lightbox" });
}

export async function hideStudioAsset(scope: AssetScope): Promise<void> {
  await requireFeedbackAsset(scope);
  const hidden = await prisma.projectImageAsset.updateMany({
    where: {
      id: scope.assetId,
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      hiddenAt: null,
    },
    data: { hiddenAt: new Date() },
  });
  if (hidden.count > 0) await recordStudioAdEvent({ ...scope, type: "hidden" });
}
