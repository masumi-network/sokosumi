import type { Prisma } from "@sokosumi/database";
import { badRequest, conflict, forbidden } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type {
  RequestSeoAnalysis,
  SeoActor,
} from "@/schemas/project-seo.schema";
import {
  type SeoAuditBrief,
  type SeoBriefContent,
  saveSeoAuditBriefRequestSchema,
  seoBriefContent,
} from "@/schemas/seo-audit-brief.schema";
import { SEO_MAX_PAGES } from "@/schemas/seo-page.schema";
import {
  requireLockedSeoOwner,
  requireSeoOwner,
  requireSeoPages,
  seoOwnerWhere,
  sha256,
} from "./project-seo-store";
import { loadBriefFollowUps } from "./seo-audit-brief-follow-up";
import {
  briefLandingEvidence,
  briefPriorities,
} from "./seo-audit-brief-priorities";
import { briefNamedOutcomes } from "./seo-brief-landing-outcomes";
import { suggestSeoPageAction } from "./seo-brief-suggestion";

const BRIEF_KIND = "audit_brief";
const empty: SeoBriefContent = {
  objective: null,
  audience: null,
  outcome: null,
  constraints: null,
  pages: [],
};
function briefWhere(actor: SeoActor) {
  return {
    ...seoOwnerWhere(actor),
    ownerId: actor.userId,
    visibility: "PRIVATE",
    kind: BRIEF_KIND,
    source: "user",
  };
}

export async function currentBrief(
  actor: SeoActor,
  client: Prisma.TransactionClient,
) {
  return client.projectSeoObservation.findFirst({
    where: briefWhere(actor),
    orderBy: { scopeVersion: "desc" },
    select: { id: true, scopeVersion: true, payload: true, createdAt: true },
  });
}

function ownerSession(actor: SeoActor) {
  if (actor.sokoBotId)
    throw forbidden(
      "Use your own session to edit or view the private SEO brief",
    );
}

async function briefResponse(
  actor: SeoActor,
  row: Awaited<ReturnType<typeof currentBrief>>,
  client: Prisma.TransactionClient,
): Promise<SeoAuditBrief> {
  const content = row ? seoBriefContent.parse(row.payload) : empty;
  const pageIds = content.pages.map((page) => page.pageId);
  const pages = pageIds.length
    ? await client.projectSeoPage.findMany({
        where: { ...seoOwnerWhere(actor), id: { in: pageIds } },
        select: { id: true, url: true },
      })
    : [];
  const [indexFollowUps, evidence] = await Promise.all([
    loadBriefFollowUps(actor, content, pages, client),
    briefLandingEvidence(actor, pages, client),
  ]);
  const { followUps, sales } = await briefNamedOutcomes(
    actor,
    pages,
    content.pages,
    indexFollowUps,
    client,
  );
  return {
    ...content,
    revision: row?.scopeVersion ?? 0,
    updatedAt: row?.createdAt.toISOString() ?? null,
    followUps,
    priorities: briefPriorities(content, followUps, evidence, sales),
  };
}

export async function getSeoBrief(actor: SeoActor): Promise<SeoAuditBrief> {
  ownerSession(actor);
  await requireSeoOwner(actor);
  return briefResponse(actor, await currentBrief(actor, prisma), prisma);
}

export async function getSeoBriefSuggestion(actor: SeoActor, pageId: string) {
  ownerSession(actor);
  await requireSeoOwner(actor);
  const [page] = await requireSeoPages(actor, [pageId]);
  return { action: await suggestSeoPageAction(page.url) };
}

type BriefRow = Awaited<ReturnType<typeof currentBrief>>;

/** Both the brief editor and a confirmed one-off check append the same immutable private revision. */
async function writeBriefRevision(
  tx: Prisma.TransactionClient,
  actor: SeoActor,
  current: BriefRow,
  expectedRevision: number,
  content: SeoBriefContent,
) {
  const revision = current?.scopeVersion ?? 0;
  const sameContent =
    JSON.stringify(content) ===
    JSON.stringify(current ? seoBriefContent.parse(current.payload) : empty);
  // A retry can arrive after the first save committed but its response was lost.
  if (sameContent && expectedRevision === revision - 1) return current;
  if (expectedRevision !== revision)
    throw conflict("The SEO brief changed. Reload it before saving.");
  const pageIds = content.pages.map((page) => page.pageId);
  if (pageIds.length) await requireSeoPages(actor, pageIds, tx);
  if (sameContent) return current;
  const nextRevision = revision + 1;
  // The unique source key makes simultaneous creates contend even on the first edit.
  const sourceKey = `audit-brief:${actor.userId}:${nextRevision}`;
  const written = await tx.projectSeoObservation.createMany({
    data: {
      ...briefWhere(actor),
      sourceKey,
      scopeVersion: nextRevision,
      pageIds,
      payload: content,
      observedAt: new Date(),
      artifactHash: sha256(JSON.stringify(content)),
    },
    skipDuplicates: true,
  });
  if (!written.count)
    throw conflict("The SEO brief changed. Reload it before saving.");
  return currentBrief(actor, tx);
}

/** Update just the reviewed page, preserving every other private field. Called under the owner lock. */
export async function applySeoSetupGoal(
  tx: Prisma.TransactionClient,
  actor: SeoActor,
  current: BriefRow,
  goal: NonNullable<RequestSeoAnalysis["setupGoal"]>,
) {
  ownerSession(actor);
  if (goal.expectedRevision !== (current?.scopeVersion ?? 0))
    throw conflict(
      "The page goals changed. Review the current brief before starting.",
    );
  const content = current ? seoBriefContent.parse(current.payload) : empty;
  const pages = [...content.pages];
  const index = pages.findIndex((page) => page.pageId === goal.pageId);
  if (index === -1) {
    if (!goal.action) return current;
    if (pages.length >= SEO_MAX_PAGES)
      throw badRequest(
        "The private brief already contains the maximum number of pages",
      );
    pages.push({
      pageId: goal.pageId,
      role: null,
      job: null,
      action: goal.action,
      indexIntent: "unknown",
    });
  } else {
    const page = { ...pages[index], action: goal.action };
    if (pages[index]?.action !== goal.action) delete page.completionEvent;
    if (
      !page.action &&
      !page.role &&
      !page.job &&
      page.indexIntent === "unknown"
    )
      pages.splice(index, 1);
    else pages[index] = page;
  }
  return writeBriefRevision(tx, actor, current, goal.expectedRevision, {
    ...content,
    pages,
  });
}

export async function saveSeoBrief(
  actor: SeoActor,
  raw: unknown,
): Promise<SeoAuditBrief> {
  ownerSession(actor);
  const { expectedRevision, ...content } =
    saveSeoAuditBriefRequestSchema.parse(raw);
  const row = await serializableTransaction(async (tx) => {
    await requireLockedSeoOwner(tx, actor);
    const current = await currentBrief(actor, tx);
    return writeBriefRevision(tx, actor, current, expectedRevision, content);
  }, "The SEO brief changed. Reload it before saving.");
  return briefResponse(actor, row, prisma);
}
