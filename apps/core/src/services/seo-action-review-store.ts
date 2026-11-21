import {
  isPrivateReview,
  recommendationEpisodeKey,
} from "@/helpers/seo-review-episode";
import prisma from "@/lib/db/prisma";
import type {
  ProjectSeoWorkspace,
  SeoActor,
} from "@/schemas/project-seo.schema";
import { seoOwnerWhere } from "./project-seo-store";
import type { PrivateRecommendationReviews } from "./seo-private-recommendation-reviews";

export const reviewKind = "recommendation_review";
export const pageSource = (pageId: string) => `reviewed-page:${pageId}`;

export const reviewSourceKey = (
  pageId: string,
  key: string,
  ownerId?: string | null,
) =>
  ownerId
    ? `${reviewKind}:${pageId}:${ownerId}:${key}`
    : `${reviewKind}:${pageId}:${key}`;

/** Read only receipts for episodes this view could reopen, using the scoped unique source key. */
export async function pendingSeoActionReviews(
  actor: SeoActor,
  workspace: Pick<ProjectSeoWorkspace, "actions" | "pages">,
  personal?: PrivateRecommendationReviews,
) {
  const pages = new Map(workspace.pages.map((p) => [p.url, p.id]));
  const keys: string[] = [];
  const privateKeys: string[] = [];
  for (const action of workspace.actions) {
    const page = pages.get(action.pageUrl);
    if (!page || !action.followUpReview) continue;
    const alternate = personal?.candidates.get(
      JSON.stringify([action.id, action.observationId]),
    );
    for (const review of [action.followUpReview, alternate]) {
      if (!review) continue;
      const ownerOnly = isPrivateReview(review.kind);
      const list = ownerOnly ? privateKeys : keys;
      list.push(
        reviewSourceKey(
          page,
          recommendationEpisodeKey(action.id, review),
          ownerOnly ? actor.userId : null,
        ),
      );
    }
  }
  if (!keys.length && !privateKeys.length) return workspace.actions;
  const receipts = await prisma.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(actor),
      kind: reviewKind,
      OR: [
        { ownerId: null, sourceKey: { in: keys } },
        {
          ownerId: actor.userId,
          visibility: "PRIVATE",
          sourceKey: { in: privateKeys },
        },
      ],
    },
    select: { artifactHash: true },
  });
  if (!receipts.length) return workspace.actions;
  const reviewed = new Set(receipts.map((r) => r.artifactHash));
  // Resolve only the selected episode. Looking for another candidate here can resurrect older evidence.
  return workspace.actions.flatMap((action) => {
    const { followUpReview, ...original } = action;
    if (
      !followUpReview ||
      !reviewed.has(recommendationEpisodeKey(action.id, followUpReview))
    )
      return [action];
    // A public and a private measurement can reopen the same original recommendation independently.
    const alternate = personal?.candidates.get(
      JSON.stringify([action.id, action.observationId]),
    );
    if (
      alternate &&
      !reviewed.has(recommendationEpisodeKey(action.id, alternate))
    )
      return [{ ...original, followUpReview: alternate }];
    return action.status === "needs_review" ? [] : [original];
  });
}
