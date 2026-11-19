import { recommendationEpisodeKey } from "@/helpers/seo-review-episode";
import prisma from "@/lib/db/prisma";
import type {
  ProjectSeoWorkspace,
  SeoActor,
} from "@/schemas/project-seo.schema";
import { seoOwnerWhere } from "./project-seo-store";

export const reviewKind = "recommendation_review";
export const pageSource = (pageId: string) => `reviewed-page:${pageId}`;

export const reviewSourceKey = (pageId: string, key: string) =>
  `${reviewKind}:${pageId}:${key}`;

/** Read only receipts for episodes this view could reopen, using the scoped unique source key. */
export async function pendingSeoActionReviews(
  actor: SeoActor,
  workspace: Pick<ProjectSeoWorkspace, "actions" | "pages">,
) {
  const pages = new Map(workspace.pages.map((p) => [p.url, p.id]));
  const keys = workspace.actions.flatMap((action) => {
    const page = pages.get(action.pageUrl);
    return page && action.followUpReview
      ? [
          reviewSourceKey(
            page,
            recommendationEpisodeKey(action.id, action.followUpReview),
          ),
        ]
      : [];
  });
  if (!keys.length) return workspace.actions;
  const receipts = await prisma.projectSeoObservation.findMany({
    where: {
      ...seoOwnerWhere(actor),
      kind: reviewKind,
      ownerId: null,
      sourceKey: { in: keys },
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
    return action.status === "needs_review" ? [] : [original];
  });
}
