import { conflict } from "@/helpers/error";
import { recommendationEpisodeKey } from "@/helpers/seo-review-episode";
import { serializableTransaction } from "@/lib/db/transaction";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { acknowledgeSeoReviewSchema } from "@/schemas/seo-review-request.schema";
import { getProjectSeoWorkspace } from "./project-seo.service";
import {
  requireLockedSeoOwner,
  requireSeoPages,
  seoOwnerData,
  seoOwnerUnique,
} from "./project-seo-store";
import {
  pageSource,
  reviewKind,
  reviewSourceKey,
} from "./seo-action-review-store";

export async function acknowledgeSeoReview(actor: SeoActor, raw: unknown) {
  const { view, ...input } = acknowledgeSeoReviewSchema.parse(raw);
  const key = recommendationEpisodeKey(input.actionId, input);
  const sourceKey = reviewSourceKey(input.pageId, key);
  const workspace = await getProjectSeoWorkspace(
    actor,
    view ?? { pageId: input.pageId },
    { includePrivateIndexing: false },
  );
  const page = workspace.pages.find((p) => p.id === input.pageId);
  const action = workspace.actions.find(
    (a) => a.id === input.actionId && a.pageUrl === page?.url,
  );
  const current =
    !!action?.followUpReview &&
    recommendationEpisodeKey(action.id, action.followUpReview) === key;
  return serializableTransaction(async (tx) => {
    await requireLockedSeoOwner(tx, actor);
    await requireSeoPages(actor, [input.pageId], tx);
    const where = seoOwnerUnique(actor, "sourceKey", { sourceKey });
    const existing = await tx.projectSeoObservation.findUnique({
      where,
      select: { id: true },
    });
    if (existing) return;
    if (!current)
      throw conflict(
        "This recommendation review has changed. Open its latest measurement.",
      );
    // Like workspace settings, acknowledgements cover no evidence pages and never enter the audit feed.
    await tx.projectSeoObservation.createMany({
      skipDuplicates: true,
      data: {
        ...seoOwnerData(actor),
        source: pageSource(input.pageId),
        sourceKey,
        kind: reviewKind,
        artifactHash: key,
        pageIds: [],
        payload: { ...input, recordedBy: actor.userId },
        observedAt: new Date(),
      },
    });
  }, "The recommendation review changed. Please retry.");
}
