import type { Prisma } from "@sokosumi/database";
import { badRequest, conflict } from "@/helpers/error";
import type {
  RequestSeoAnalysis,
  SeoActor,
} from "@/schemas/project-seo.schema";
import {
  type SeoBriefContent,
  seoBriefContent,
} from "@/schemas/seo-audit-brief.schema";
import { seoOwnerWhere, sha256 } from "./project-seo-store";
import { currentBrief } from "./seo-audit-brief.service";

type PageGoal = SeoBriefContent["pages"][number];
export type PublicPageGoals = {
  pages: {
    url: string;
    role?: NonNullable<PageGoal["role"]>;
    action?: NonNullable<PageGoal["action"]>;
  }[];
};

export function publicPageGoals(
  content: SeoBriefContent,
  scope: readonly { id: string; url: string }[],
  sharedIds: readonly string[],
): PublicPageGoals {
  const selected = new Set(sharedIds);
  if (
    !selected.size ||
    selected.size !== sharedIds.length ||
    [...selected].some((id) => !scope.some((p) => p.id === id))
  )
    throw badRequest("Choose each shared goal once from the audited pages");
  const pages = scope
    .filter((p) => selected.has(p.id))
    .map((p) => {
      const goal = content.pages.find((item) => item.pageId === p.id);
      if (!goal?.role && !goal?.action)
        throw badRequest("Save a page role or action before sharing it");
      return {
        url: p.url,
        ...(goal.role ? { role: goal.role } : {}),
        ...(goal.action ? { action: goal.action } : {}),
      };
    });
  return { pages };
}

/** Pin a reference to immutable private content separately from the approved public Task packet. */
export async function pinSeoAuditBrief(
  tx: Prisma.TransactionClient,
  actor: SeoActor,
  analysisId: string,
  scope: readonly { id: string; url: string }[],
  approval: RequestSeoAnalysis["sharedBrief"],
) {
  const current = await currentBrief(actor, tx);
  if (approval && approval.revision !== current?.scopeVersion)
    throw conflict("The page goals changed. Reload the brief before sharing.");
  if (!current) return undefined;
  const context = approval
    ? publicPageGoals(
        seoBriefContent.parse(current.payload),
        scope,
        approval.pageIds,
      )
    : undefined;
  const payload: Prisma.InputJsonObject = {
    version: 1,
    briefId: current.id,
    revision: current.scopeVersion,
    sharedPageIds: approval?.pageIds ?? [],
  };
  await tx.projectSeoObservation.create({
    data: {
      ...seoOwnerWhere(actor),
      ownerId: actor.userId,
      visibility: "PRIVATE",
      kind: "audit_brief_run",
      source: "user",
      sourceKey: `audit-brief-run:${analysisId}`,
      pageIds: scope.map((p) => p.id),
      artifactHash: sha256(JSON.stringify(payload)),
      payload,
      observedAt: new Date(),
    },
  });
  return context;
}
